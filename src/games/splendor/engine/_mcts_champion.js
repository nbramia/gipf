// MCTS engine for Splendor AI.
//
// Multi-player (2-4) game-tree PUCT search. Each node carries a win-probability
// VECTOR over the active players (maxⁿ): the to-move player at a node maximizes
// their OWN component. Unlike Catan there are NO chance nodes — Splendor's only
// hidden element is deck order, which is fixed once shuffled, so every move is a
// deterministic transition inside the search clone. Hidden-information fairness
// is handled up front by re-shuffling the decks and re-sampling opponents'
// blind-reserved cards in the determinized root (no X-ray vision).
//
// Leaf evaluation is pluggable behind the { values, priors } Evaluator seam: the
// deployed engine uses a short softmax heuristic rollout; an NN evaluator (ONNX
// value+policy) can drop in behind the same interface.

import SplendorBoard, { GEMS, GOLD, ALL_TOKENS, VICTORY_POINTS } from '../SplendorBoard.js';
import { CARDS_BY_ID, NOBLES_BY_ID } from '../splendorCards.js';
import { extractFeatures, moveToPolicyIndex, POLICY_SIZE } from './features.js';

const MAX_ROLLOUT_STEPS = 140;
const DEFAULT_MAX_CHILDREN = 36;
const PUCT_C = 1.6;
const VALUE_TEMP = 0.4;   // softmax temperature over per-player position eval
const PRIOR_TEMP = 180;   // softmax temperature over scoreMove (hundreds-scale)
const ROLLOUT_TEMP = 140; // softmax temperature for rollout move sampling
const EVAL_SCALE = 9000;  // tanh squash for evaluatePosition

function moveToKey(move) {
  if (!move) return 'null';
  switch (move.type) {
    case 'take-three':
      return `t3:${[...move.colors].sort().join('')}`;
    case 'take-two':
      return `t2:${move.color}`;
    case 'reserve':
      return `rv:${move.fromDeck ? `deck${move.tier}` : move.cardId}`;
    case 'buy':
      return `by:${move.cardId}${move.fromReserve ? 'R' : ''}`;
    case 'discard-token':
      return `dc:${move.token}`;
    case 'choose-noble':
      return `nb:${move.nobleId}`;
    case 'pass':
      return 'pass';
    default:
      return JSON.stringify(move);
  }
}

function applyMove(board, move) {
  return board.applyMove(move);
}

// ---------------------------------------------------------------------------
// Heuristics
// ---------------------------------------------------------------------------

function totalBonuses(player) {
  return GEMS.reduce((sum, gem) => sum + player.bonuses[gem], 0);
}

function tokenTotal(player) {
  return ALL_TOKENS.reduce((sum, t) => sum + player.tokens[t], 0);
}

// Per-color "demand": across the cards on offer to this player (visible market +
// own reserves), how many tokens of each color they still lack to buy them.
function colorDemand(board, playerId) {
  const player = board.players[playerId];
  const demand = { white: 0, blue: 0, green: 0, red: 0, black: 0 };
  const cards = [
    ...board.getVisibleCards().map(v => CARDS_BY_ID[v.cardId]),
    ...player.reserved.map(r => CARDS_BY_ID[r.cardId]),
  ];
  for (const card of cards) {
    for (const gem of GEMS) {
      const deficit = Math.max(0, (card.cost[gem] || 0) - player.bonuses[gem] - player.tokens[gem]);
      demand[gem] += deficit;
    }
  }
  return demand;
}

// Progress fraction toward the still-available nobles for a given player.
function nobleProgress(board, playerId) {
  const player = board.players[playerId];
  let best = 0;
  for (const nobleId of board.nobles) {
    const req = NOBLES_BY_ID[nobleId].requirement;
    let have = 0;
    let need = 0;
    for (const gem of GEMS) {
      need += req[gem] || 0;
      have += Math.min(player.bonuses[gem], req[gem] || 0);
    }
    if (need > 0) best = Math.max(best, have / need);
  }
  return best;
}

// Would gaining one `color` bonus immediately satisfy an available noble?
function completesNoble(board, playerId, color) {
  const player = board.players[playerId];
  for (const nobleId of board.nobles) {
    const req = NOBLES_BY_ID[nobleId].requirement;
    const ok = GEMS.every(gem => (player.bonuses[gem] + (gem === color ? 1 : 0)) >= (req[gem] || 0));
    if (ok) return true;
  }
  return false;
}

function evaluatePosition(board, me) {
  if (board.phase === 'game-over') {
    if (board.winner === me) return 1;
    if (board.winner != null) return -1;
    return 0;
  }

  const player = board.players[me];
  const points = board.getVictoryPoints(me);
  const target = board.victoryTarget || VICTORY_POINTS;
  const oppPoints = board.getPlayerIds().filter(id => id !== me).map(id => board.getVictoryPoints(id));
  const bestOpp = Math.max(0, ...oppPoints);

  let score = points * 1100 + (points - bestOpp) * 600;

  // Endgame closing / denial, quadratic in the gap to the target.
  if (points >= target - 4) score += (points - (target - 5)) ** 2 * 120;
  if (bestOpp >= target - 3) score -= (bestOpp - (target - 4)) ** 2 * 150;

  // Permanent engine: bonus cards drive everything downstream.
  const bonusCount = totalBonuses(player);
  const diversity = GEMS.filter(gem => player.bonuses[gem] > 0).length;
  score += bonusCount * 95 + diversity * 40;

  // Noble proximity pulls hard as it nears completion (quadratic).
  const np = nobleProgress(board, me);
  score += np * np * 240;

  // Token economy: gold is the most flexible; a near-limit hoard is mildly wasteful.
  score += player.tokens[GOLD] * 26;
  const tt = tokenTotal(player);
  score += Math.min(tt, 8) * 10;
  if (tt > 8) score -= (tt - 8) * 14;

  // Tempo: cards on offer the player can afford right now, weighted by prestige.
  for (const { cardId } of board.getVisibleCards()) {
    if (board.canAffordCard(me, cardId)) score += 28 + CARDS_BY_ID[cardId].points * 55;
  }
  for (const entry of player.reserved) {
    if (board.canAffordCard(me, entry.cardId)) score += 34 + CARDS_BY_ID[entry.cardId].points * 55;
    score += 14; // optionality / denial of a reserved card
  }

  return Math.tanh(score / EVAL_SCALE);
}

// A move reaching the target must always win the prior; near-target gets a strong push.
function winBonus(board, playerId, vpGain) {
  const target = board.victoryTarget || VICTORY_POINTS;
  const after = board.getVictoryPoints(playerId) + vpGain;
  if (after >= target) return 100000;
  if (after >= target - 1) return 1500;
  if (after >= target - 2) return 600;
  return 0;
}

function cardBuyValue(board, playerId, cardId) {
  const card = CARDS_BY_ID[cardId];
  let vpGain = card.points;
  if (completesNoble(board, playerId, card.bonus)) vpGain += 3;
  let value = 210 + card.points * 230 + winBonus(board, playerId, vpGain);
  // Bonus usefulness toward nobles.
  const player = board.players[playerId];
  for (const nobleId of board.nobles) {
    const req = NOBLES_BY_ID[nobleId].requirement;
    if ((req[card.bonus] || 0) > player.bonuses[card.bonus]) {
      let have = 0;
      let need = 0;
      for (const gem of GEMS) { need += req[gem] || 0; have += Math.min(player.bonuses[gem], req[gem] || 0); }
      value += 24 * (have / (need || 1));
    }
  }
  return value;
}

// `demand` (per-colour token demand) is constant for a position but was the #1
// hot spot when recomputed per candidate move — callers compute it once per
// scoring pass and thread it in. It's only needed for take/discard moves.
function scoreMove(board, move, playerId, demand) {
  switch (move.type) {
    case 'buy':
      return cardBuyValue(board, playerId, move.cardId);
    case 'reserve': {
      if (move.fromDeck) return 80;
      const card = CARDS_BY_ID[move.cardId];
      return 130 + card.points * 32 + (board.bank[GOLD] > 0 ? 12 : 0);
    }
    case 'take-three': {
      const d = demand || colorDemand(board, playerId);
      let s = 100;
      for (const color of move.colors) s += Math.min(d[color], 6) * 4;
      return s;
    }
    case 'take-two': {
      const d = demand || colorDemand(board, playerId);
      return 100 + Math.min(d[move.color], 8) * 6;
    }
    case 'discard-token': {
      if (move.token === GOLD) return 20; // never want to drop the wild
      const d = demand || colorDemand(board, playerId);
      const player = board.players[playerId];
      return 150 + player.tokens[move.token] * 8 - Math.min(d[move.token], 6) * 12;
    }
    case 'choose-noble':
      return 500; // all nobles are +3; any is fine
    case 'pass':
      return 5;
    default:
      return 0;
  }
}

function pruneMoves(board, moves, playerId, maxChildren = DEFAULT_MAX_CHILDREN, demand) {
  if (moves.length <= maxChildren) return moves;
  const d = demand || colorDemand(board, playerId);
  return moves
    .map(move => ({ move, score: scoreMove(board, move, playerId, d) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, maxChildren)
    .map(entry => entry.move);
}

function selectMoveByHeuristic(board, { rollout = false } = {}) {
  const moves = board.getLegalMoves(rollout ? { rollout: true } : undefined);
  if (moves.length === 0) return null;
  if (moves.length === 1) return moves[0];

  const playerId = board.currentPlayer;
  const demand = colorDemand(board, playerId);
  const pruned = pruneMoves(board, moves, playerId, 16, demand);
  const scores = pruned.map(move => scoreMove(board, move, playerId, demand));

  const max = Math.max(...scores);
  let sum = 0;
  const weights = scores.map(s => { const e = Math.exp((s - max) / ROLLOUT_TEMP); sum += e; return e; });
  let r = Math.random() * sum;
  for (let i = 0; i < pruned.length; i++) {
    r -= weights[i];
    if (r <= 0) return pruned[i];
  }
  return pruned[pruned.length - 1];
}

// ---------------------------------------------------------------------------
// Fairness: determinize hidden info from the to-move player's perspective.
// Unknown to the observer: the order of the three draw decks, and the identity
// of opponents' BLIND-reserved cards (those reserved face-down from a deck — the
// tier is public, the card is not). We re-shuffle the unseen pool per tier,
// re-sample opponents' hidden reserves of the matching tier, and rebuild the
// decks from the remainder. The observer's own hand, the visible market, public
// (face-up) reserves, purchased cards, and nobles are all left untouched.
// ---------------------------------------------------------------------------

function searchClone(board) {
  // _fastClone already drops history and sets _skipHistory — the hot path.
  return board._fastClone();
}

function shuffleInPlace(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function determinizeForSearch(board, observerId) {
  const clone = searchClone(board);

  const seen = new Set();
  for (const tier of [1, 2, 3]) {
    for (const cardId of clone.visible[tier]) if (cardId) seen.add(cardId);
  }
  for (const id of clone.getPlayerIds()) {
    for (const cardId of clone.players[id].cards) seen.add(cardId);
    for (const entry of clone.players[id].reserved) {
      // Observer knows their own reserves; everyone's face-up reserves are public.
      if (id === observerId || !entry.hidden) seen.add(entry.cardId);
    }
  }

  const unseenByTier = { 1: [], 2: [], 3: [] };
  for (const cardId of Object.keys(CARDS_BY_ID)) {
    if (!seen.has(cardId)) unseenByTier[CARDS_BY_ID[cardId].tier].push(cardId);
  }
  for (const tier of [1, 2, 3]) shuffleInPlace(unseenByTier[tier]);

  // Re-sample opponents' blind reserves (same tier), then rebuild the decks from
  // what remains. Counts are exact: per tier, |unseen| = |deck| + |opp hidden|.
  for (const id of clone.getPlayerIds()) {
    if (id === observerId) continue;
    for (const entry of clone.players[id].reserved) {
      if (!entry.hidden) continue;
      const tier = CARDS_BY_ID[entry.cardId].tier;
      if (unseenByTier[tier].length > 0) entry.cardId = unseenByTier[tier].pop();
    }
  }
  for (const tier of [1, 2, 3]) {
    clone.decks[tier] = unseenByTier[tier].slice(0, clone.decks[tier].length);
  }
  return clone;
}

// ---------------------------------------------------------------------------
// Evaluators
// ---------------------------------------------------------------------------

function softmaxOverPlayers(rawByPlayer, players, temp) {
  const max = Math.max(...players.map(p => rawByPlayer[p]));
  const exps = {};
  let sum = 0;
  for (const p of players) { const e = Math.exp((rawByPlayer[p] - max) / temp); exps[p] = e; sum += e; }
  const out = {};
  for (const p of players) out[p] = exps[p] / (sum || 1);
  return out;
}

function heuristicValueVector(board, players) {
  const raw = {};
  for (const p of players) raw[p] = evaluatePosition(board, p);
  return softmaxOverPlayers(raw, players, VALUE_TEMP);
}

function terminalValueVector(board, players) {
  if (board.winner == null) return heuristicValueVector(board, players);
  const out = {};
  for (const p of players) out[p] = board.winner === p ? 1 : 0;
  return out;
}

function heuristicPriors(board, moves, toMove) {
  const demand = colorDemand(board, toMove);
  const scores = moves.map(move => scoreMove(board, move, toMove, demand));
  const max = Math.max(...scores);
  let sum = 0;
  const exps = scores.map(s => { const e = Math.exp((s - max) / PRIOR_TEMP); sum += e; return e; });
  return moves.map((move, i) => ({ move, key: moveToKey(move), p: exps[i] / (sum || 1) }));
}

// Short heuristic rollout to a terminal state or a step cap, then a one-hot
// winner (if decided) or the position-eval win-prob vector. Far stronger per-leaf
// signal than a 1-ply eval at low simulation counts.
function rolloutValueVector(board, players, steps) {
  const sim = searchClone(board);
  let i = 0;
  while (sim.phase !== 'game-over' && i < steps) {
    const move = selectMoveByHeuristic(sim, { rollout: true });
    if (!move || !sim.applyMove(move)) break;
    i++;
  }
  if (sim.phase === 'game-over' && sim.winner != null) {
    const out = {};
    for (const p of players) out[p] = sim.winner === p ? 1 : 0;
    return out;
  }
  return heuristicValueVector(sim, players);
}

class HeuristicEvaluator {
  constructor({ rolloutSteps = 0 } = {}) {
    this.rolloutSteps = rolloutSteps;
  }

  evaluate(board, prunedMoves, players) {
    const values = this.rolloutSteps > 0
      ? rolloutValueVector(board, players, this.rolloutSteps)
      : heuristicValueVector(board, players);
    return { values, priors: heuristicPriors(board, prunedMoves, board.currentPlayer) };
  }
}

function softmaxArray(logits) {
  const max = Math.max(...logits);
  const exps = logits.map(v => Math.exp(v - max));
  const sum = exps.reduce((a, b) => a + b, 0) || 1;
  return exps.map(e => e / sum);
}

// Evaluator backed by a trained network (scaffold). `net.predict(Float32Array)`
// resolves to { value: Float32Array[4], policy: Float32Array[POLICY_SIZE] }.
// Runtime-agnostic: the net comes from valueNetworkNode.js (onnxruntime-node) or
// valueNetwork.js (onnxruntime-web); this file never imports an ONNX runtime.
class NNEvaluator {
  constructor(net) {
    this.net = net;
  }

  async evaluate(board, prunedMoves, players) {
    const toMove = board.currentPlayer;
    const features = extractFeatures(board, toMove);
    const input = new Float32Array(features.players.length + features.market.length + features.meta.length);
    input.set(features.players, 0);
    input.set(features.market, features.players.length);
    input.set(features.meta, features.players.length + features.market.length);
    const { value, policy } = await this.net.predict(input);

    // Value head: seat logits relative to the to-move player (index 0 = self,
    // then the others in turn order). Softmax -> win-prob, mapped to player ids.
    const order = [toMove, ...players.filter(p => p !== toMove)];
    const valueProbs = softmaxArray(order.map((_, i) => value[i] ?? 0));
    const values = {};
    order.forEach((p, i) => { values[p] = valueProbs[i]; });

    const logits = prunedMoves.map(move => {
      const idx = moveToPolicyIndex(move);
      return idx >= 0 && idx < POLICY_SIZE ? policy[idx] : -10;
    });
    const probs = softmaxArray(logits);
    const priors = prunedMoves.map((move, i) => ({ move, key: moveToKey(move), p: probs[i] }));
    return { values, priors };
  }
}

// ---------------------------------------------------------------------------
// Tree search (PUCT) — no chance nodes (deterministic transitions).
// ---------------------------------------------------------------------------

class TreeNode {
  constructor(board) {
    this.board = board;
    this.toMove = board.currentPlayer;
    this.terminal = board.phase === 'game-over';
    this.expanded = false;
    this.value = null;   // { playerId: winProb }
    this.edges = [];     // { move, key, p, n, w, child }
  }
}

async function expandNode(node, players, evaluator, maxChildren) {
  if (node.terminal) {
    node.value = terminalValueVector(node.board, players);
    node.expanded = true;
    return;
  }
  const legal = node.board.getLegalMoves();
  const pruned = pruneMoves(node.board, legal, node.toMove, maxChildren);
  const { values, priors } = await evaluator.evaluate(node.board, pruned, players);
  node.value = values;
  node.edges = priors.map(pr => ({ move: pr.move, key: pr.key, p: pr.p, n: 0, w: 0, child: null }));
  node.expanded = true;
}

function childFor(node, edge) {
  if (!edge.child) {
    const cb = searchClone(node.board);
    cb.applyMove(edge.move);
    edge.child = new TreeNode(cb);
  }
  return edge.child;
}

async function simulateOnce(node, players, evaluator, maxChildren, c) {
  if (node.terminal) return terminalValueVector(node.board, players);
  if (!node.expanded) { await expandNode(node, players, evaluator, maxChildren); return node.value; }
  if (node.edges.length === 0) return node.value;

  const totalN = node.edges.reduce((sum, edge) => sum + edge.n, 0);
  const sqrtTotal = Math.sqrt(totalN + 1);
  const fpu = node.value[node.toMove] ?? 0; // first-play urgency = node's own estimate
  let best = node.edges[0];
  let bestU = -Infinity;
  for (const edge of node.edges) {
    const q = edge.n > 0 ? edge.w / edge.n : fpu;
    const u = q + c * edge.p * sqrtTotal / (1 + edge.n);
    if (u > bestU) { bestU = u; best = edge; }
  }

  const child = childFor(node, best);
  const value = await simulateOnce(child, players, evaluator, maxChildren, c);
  best.n++;
  best.w += value[node.toMove] ?? 0;
  return value;
}

class MCTS {
  constructor({ maxChildren = DEFAULT_MAX_CHILDREN, evaluator = null, rolloutSteps = 0, c = PUCT_C } = {}) {
    this.maxChildren = maxChildren;
    this.evaluator = evaluator || new HeuristicEvaluator({ rolloutSteps });
    this.c = c;
  }

  async getBestMove(board, simulations = 400) {
    const legalMoves = board.getLegalMoves();
    if (legalMoves.length === 0) return null;
    if (legalMoves.length === 1) return legalMoves[0];

    const players = board.getPlayerIds();
    const root = new TreeNode(determinizeForSearch(board, board.currentPlayer));
    await expandNode(root, players, this.evaluator, this.maxChildren);
    if (root.edges.length === 1) return root.edges[0].move;

    const budget = Math.max(root.edges.length, simulations);
    for (let i = 0; i < budget; i++) {
      await simulateOnce(root, players, this.evaluator, this.maxChildren, this.c);
    }

    let best = root.edges[0];
    for (const edge of root.edges) {
      if (edge.n > best.n) best = edge;
    }

    const rootVisits = {};
    for (const edge of root.edges) rootVisits[edge.key] = edge.n;
    best.move._rootVisits = rootVisits;
    best.move._legalMoves = root.edges.map(({ move }) => {
      const { _rootVisits, _legalMoves, ...rest } = move;
      return rest;
    });
    return best.move;
  }
}

export {
  MCTS,
  HeuristicEvaluator,
  NNEvaluator,
  applyMove,
  evaluatePosition,
  scoreMove,
  moveToKey,
  selectMoveByHeuristic,
  determinizeForSearch,
};
