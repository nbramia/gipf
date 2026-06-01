// MCTS engine for Catan AI.
// Root-focused Monte Carlo search with heuristic rollouts for a multi-player game.

import CatanBoard, { RESOURCES, COSTS, resourceTotal } from '../CatanBoard.js';
import { extractFeatures, moveToPolicyIndex } from './features.js';

const EXPLORATION_CONSTANT = 1.25;
const MAX_ROLLOUT_STEPS = 90;
const DEFAULT_MAX_CHILDREN = 42;

function moveToKey(move) {
  if (!move) return 'null';
  switch (move.type) {
    case 'setup-settlement':
      return `ss:${move.vertexId}`;
    case 'setup-road':
      return `sr:${move.edgeId}`;
    case 'roll':
      return 'roll';
    case 'move-robber':
      return `robber:${move.tileId}:${move.stealPlayerId || ''}`;
    case 'build-road':
      return `road:${move.edgeId}:${move.free ? 'f' : 'p'}`;
    case 'build-settlement':
      return `settlement:${move.vertexId}`;
    case 'build-city':
      return `city:${move.vertexId}`;
    case 'buy-dev':
      return 'dev';
    case 'play-knight':
      return 'knight';
    case 'play-road-building':
      return 'road-building';
    case 'play-year-of-plenty':
      return `plenty:${move.resourceA}:${move.resourceB}`;
    case 'play-monopoly':
      return `monopoly:${move.resource}`;
    case 'trade':
      return `trade:${move.give}:${move.receive}:${move.ratio}`;
    case 'discard':
      return `discard:${move.resource}`;
    case 'propose-trade':
      return `propose:${bundleKey(move.give)}>${bundleKey(move.receive)}@${[...(move.targets || [])].sort((a, b) => a - b).join(',')}`;
    case 'respond-trade':
      return `respond:${move.accept ? 'y' : 'n'}`;
    case 'end-turn':
      return 'end';
    default:
      return JSON.stringify(move);
  }
}

// Canonical, order-independent serialization of a resource bundle. Must match
// features.js bundleKey so policy targets for propose-trade moves line up.
function bundleKey(bundle) {
  return Object.entries(bundle || {})
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([resource, amount]) => `${resource}=${amount}`)
    .join(',');
}

function applyMove(board, move) {
  return board.applyMove(move);
}

function numberStrength(number) {
  return CatanBoard.getPipCount(number);
}

function productionProfile(board, playerId) {
  const profile = { brick: 0, lumber: 0, wool: 0, grain: 0, ore: 0 };
  const player = board.players[playerId];
  for (const vertexId of [...player.settlements, ...player.cities]) {
    const building = board.vertices[vertexId].building;
    const multiplier = building?.type === 'city' ? 2 : 1;
    for (const tile of board.getAdjacentTilesForVertex(vertexId)) {
      if (!tile || tile.resource === 'desert') continue;
      profile[tile.resource] += numberStrength(tile.number) * multiplier;
    }
  }
  return profile;
}

function vertexValue(board, vertexId, playerId) {
  const vertex = board.vertices[vertexId];
  let score = 0;
  const seenResources = new Set();

  for (const tile of board.getAdjacentTilesForVertex(vertexId)) {
    if (!tile || tile.resource === 'desert') continue;
    const pips = numberStrength(tile.number);
    score += pips * 22;
    seenResources.add(tile.resource);
    if (tile.number === 6 || tile.number === 8) score += 18;
    if (tile.resource === 'brick' || tile.resource === 'lumber') score += pips * 2.5;
    if (tile.resource === 'grain' || tile.resource === 'ore') score += pips * 3.5;
  }

  score += seenResources.size * 35;
  if (vertex.port) {
    score += vertex.port === 'any' ? 38 : 46;
    const profile = productionProfile(board, playerId);
    if (vertex.port !== 'any') score += Math.min(70, profile[vertex.port] * 5);
  }

  return score;
}

function edgeExpansionValue(board, edgeId, playerId) {
  const edge = board.edges[edgeId];
  let score = 0;
  for (const vertexId of edge.vertices) {
    if (board.vertices[vertexId].building) continue;
    if (board.vertices[vertexId].adjacent.some(id => board.vertices[id].building)) continue;
    score += vertexValue(board, vertexId, playerId) * 0.45;
  }
  return score;
}

function missingCostScore(resources, cost) {
  let score = 0;
  for (const [resource, amount] of Object.entries(cost)) {
    score += Math.max(0, amount - (resources[resource] || 0)) * 75;
  }
  return score;
}

function evaluatePosition(board, perspectivePlayer) {
  if (board.phase === 'game-over') {
    if (board.winner === perspectivePlayer) return 1;
    if (board.winner) return -1;
    return 0;
  }

  const player = board.players[perspectivePlayer];
  const myPoints = board.getVictoryPoints(perspectivePlayer);
  const opponentPoints = board.getPlayerIds()
    .filter(id => id !== perspectivePlayer)
    .map(id => board.getVictoryPoints(id));
  const bestOpponent = Math.max(0, ...opponentPoints);
  const target = board.victoryTarget || 10;
  let score = (myPoints - bestOpponent) * 2600 + myPoints * 240;

  // Endgame closing: the drive to finish must dominate once in striking range,
  // so the AI converts a 7-9 VP lead into a win instead of stalling. Quadratic in
  // the gap to target (1 VP away >> 2 away), strictly stronger than the prior
  // linear weights at 8-9 VP.
  if (myPoints >= target - 3) score += (myPoints - (target - 4)) ** 2 * 300;
  // Symmetric, stronger urgency to deny an opponent about to win.
  if (bestOpponent >= target - 3) score -= (bestOpponent - (target - 4)) ** 2 * 380;

  const profile = productionProfile(board, perspectivePlayer);
  const production = RESOURCES.reduce((sum, resource) => sum + profile[resource], 0);
  const diversity = RESOURCES.filter(resource => profile[resource] > 0).length;
  score += production * 75 + diversity * 180;
  score += Math.min(9, resourceTotal(player.resources)) * 85;

  score -= missingCostScore(player.resources, COSTS.city) * (player.settlements.length > 0 ? 0.45 : 0.08);
  score -= missingCostScore(player.resources, COSTS.settlement) * 0.18;
  score -= missingCostScore(player.resources, COSTS.road) * 0.1;

  score += player.devCards.knight * 90;
  score += player.devCards.roadBuilding * 70;
  score += player.devCards.yearOfPlenty * 75;
  score += player.devCards.monopoly * 90;
  score += player.knightsPlayed * 95;
  if (player.longestRoad) score += 520;
  if (player.largestArmy) score += 540;

  for (const vertexId of [...player.settlements, ...player.cities]) {
    const vertex = board.vertices[vertexId];
    if (vertex.port === 'any') score += 95;
    if (RESOURCES.includes(vertex.port)) score += 115 + profile[vertex.port] * 5;
  }

  const robberTile = board.getTile(board.robberTileId);
  if (robberTile) {
    for (const vertexId of robberTile.vertices) {
      const building = board.vertices[vertexId].building;
      if (!building) continue;
      const pips = numberStrength(robberTile.number);
      score += building.player === perspectivePlayer ? -pips * 75 : pips * 24;
    }
  }

  for (const opponent of board.getPlayerIds()) {
    if (opponent === perspectivePlayer) continue;
    const oppProfile = productionProfile(board, opponent);
    const oppProduction = RESOURCES.reduce((sum, resource) => sum + oppProfile[resource], 0);
    score -= oppProduction * 18;
    score -= Math.min(9, resourceTotal(board.players[opponent].resources)) * 30;
  }

  return Math.tanh(score / 6500);
}

// A move that reaches the victory target must always be chosen; one that gets
// within striking range is strongly preferred. vpGain = VP this move adds.
function winBonus(board, playerId, vpGain) {
  const target = board.victoryTarget || 10;
  const after = board.getVictoryPoints(playerId) + vpGain;
  if (after >= target) return 100000;          // winning move — dominate everything
  if (after >= target - 1) return 1400;         // one VP from winning
  if (after >= target - 2) return 600;
  return 0;
}

function scoreMove(board, move, playerId) {
  const player = board.players[playerId];
  switch (move.type) {
    case 'setup-settlement':
      return vertexValue(board, move.vertexId, playerId);
    case 'setup-road':
      return edgeExpansionValue(board, move.edgeId, playerId) + 20;
    case 'roll':
      return 0;
    case 'move-robber': {
      const tile = board.getTile(move.tileId);
      if (!tile) return -1000;
      let score = 0;
      for (const vertexId of tile.vertices) {
        const building = board.vertices[vertexId].building;
        if (!building) continue;
        const pips = numberStrength(tile.number);
        // Block the leader hardest: scale by how close the victim is to winning.
        const vp = board.getVictoryPoints(building.player);
        const leaderWeight = building.player === playerId ? 1 : 1 + Math.max(0, vp - 4) * 0.45;
        score += building.player === playerId ? -pips * 70 : pips * 55 * leaderWeight;
      }
      if (move.stealPlayerId) {
        score += Math.min(7, board.getPlayerResourceTotal(move.stealPlayerId)) * 22;
        score += Math.max(0, board.getVictoryPoints(move.stealPlayerId) - 4) * 55; // prefer robbing the leader
      }
      return score;
    }
    case 'build-city':
      return 900 + vertexValue(board, move.vertexId, playerId) * 0.8 + winBonus(board, playerId, 1);
    case 'build-settlement':
      return 780 + vertexValue(board, move.vertexId, playerId) + winBonus(board, playerId, 1);
    case 'build-road':
      return 140 + edgeExpansionValue(board, move.edgeId, playerId) + (move.free ? 60 : 0);
    case 'buy-dev':
      return player.settlements.length + player.cities.length >= 3 ? 250 : 120;
    case 'play-knight':
      return 310 + (player.knightsPlayed >= 2 ? 240 : 0);
    case 'play-road-building':
      return board.getValidRoadEdges(playerId, true).length > 0 ? 330 : -200;
    case 'play-year-of-plenty':
      return 360 + board._resourceNeedScore(playerId, move.resourceA) + board._resourceNeedScore(playerId, move.resourceB);
    case 'play-monopoly':
      return 260 + board.getPlayerIds()
        .filter(id => id !== playerId)
        .reduce((sum, id) => sum + board.players[id].resources[move.resource], 0) * 80;
    case 'trade':
      return 95 + board._resourceNeedScore(playerId, move.receive) * 60 - move.ratio * 20;
    case 'discard':
      // Higher score = better card to drop. Prefer dropping low-need (surplus) cards.
      return 200 - board._resourceNeedScore(playerId, move.resource) * 60;
    case 'propose-trade': {
      // Small positive only when the offer nets needed resources. Kept well below
      // bank trades (95), building, and even end-turn (25) for marginal deals so a
      // proposal never crowds out productive moves or stalls the game in
      // propose/respond cycles. Capped so it can never dominate the search.
      const gainNeed = Object.keys(move.receive)
        .reduce((sum, res) => sum + board._resourceNeedScore(playerId, res), 0);
      const giveNeed = Object.entries(move.give)
        .reduce((sum, [res, amt]) => sum + board._resourceNeedScore(playerId, res) * amt, 0);
      // Only a clearly favorable, needed-resource swap earns a small positive;
      // everything else is negative so propose-trades are pruned out ahead of
      // productive moves and the search does not stall in propose/respond cycles.
      const net = gainNeed - giveNeed;
      if (net <= 1) return -60;
      return Math.min(20, (net - 1) * 6);
    }
    case 'respond-trade': {
      const trade = board.pendingTrade;
      if (!trade) return 0;
      if (!move.accept) return 0; // declining is the neutral baseline
      // The responder GAINS trade.give and LOSES trade.receive (own-hand need).
      const gain = Object.entries(trade.give)
        .reduce((sum, [res, amt]) => sum + board._resourceNeedScore(playerId, res) * amt, 0);
      const loss = Object.entries(trade.receive)
        .reduce((sum, [res, amt]) => sum + board._resourceNeedScore(playerId, res) * amt, 0);
      // Accepting ALWAYS advances the proposer (they asked for it). Demand a clear
      // margin before helping an opponent, and a bigger one when the proposer is
      // near winning — don't hand resources to the leader. Proposer VP is public.
      const proposerVP = board.getVictoryPoints(trade.proposer);
      const helpMargin = 0.8 + Math.max(0, proposerVP - 4) * 0.5;
      return (gain - loss - helpMargin) * 80;
    }
    case 'end-turn':
      return player.resources.brick + player.resources.lumber + player.resources.grain + player.resources.ore > 7 ? -40 : 25;
    default:
      return 0;
  }
}

function pruneMoves(board, moves, playerId, maxChildren = DEFAULT_MAX_CHILDREN) {
  if (moves.length <= maxChildren) return moves;
  return moves
    .map(move => ({ move, score: scoreMove(board, move, playerId) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, maxChildren)
    .map(entry => entry.move);
}

const ROLLOUT_TEMP = 140; // softmax temperature for rollout move sampling

function selectMoveByHeuristic(board, { rollout = false } = {}) {
  const moves = board.getLegalMoves(rollout ? { rollout: true } : undefined);
  if (moves.length === 0) return null;
  if (moves.length === 1) return moves[0];

  const playerId = board.currentPlayer;
  const pruned = pruneMoves(board, moves, playerId, 18);
  const scores = pruned.map(move => scoreMove(board, move, playerId));

  // Softmax-sample proportional to move quality instead of near-deterministic
  // greedy. Stochastic-but-good rollouts give lower-bias Monte Carlo value
  // estimates than always taking the single greedy move.
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
// Tree search (PUCT) — real game-tree MCTS with a pluggable evaluator.
//
// Multi-player value model: each node carries a win-probability VECTOR over the
// active players (maxⁿ). The to-move player at a node maximizes their OWN
// component. Leaf value: terminal -> one-hot winner; otherwise the evaluator's
// win-prob vector. The ONLY stochastic transition in the engine is the dice
// roll, so roll edges sample an outcome each visit and key children by the
// total -> the edge's Q averages over dice outcomes (a proper expectation).
// The HeuristicEvaluator below is swappable for an NN evaluator with the same
// { values, priors } interface (one forward pass yields both).
// ---------------------------------------------------------------------------

const PUCT_C = 1.6;
const VALUE_TEMP = 0.4;   // softmax temperature over per-player position eval
const PRIOR_TEMP = 180;   // softmax temperature over scoreMove (hundreds-scale)

function searchClone(board) {
  const clone = board.clone();
  clone._skipHistory = true;
  clone.stateHistory = [];
  clone.historyIndex = -1;
  return clone;
}

// Fairness: the AI must not plan against opponents' real hands (X-ray vision).
// Re-sample each opponent's resources to a hand the OBSERVER can't see — same
// public card count, types drawn from a belief prior (their visible production
// plus a uniform floor), and reshuffle the unseen dev deck. The observer's own
// hand is left untouched. Search then plans on this believable guess; the real
// board (untouched) resolves moves with the truth, exactly like a human.
function determinizeForSearch(board, observerId) {
  const clone = searchClone(board);
  for (const pid of clone.getPlayerIds()) {
    if (pid === observerId) continue;
    const total = resourceTotal(clone.players[pid].resources);
    if (total === 0) continue;
    const profile = productionProfile(clone, pid);
    const weights = RESOURCES.map(resource => profile[resource] + 1); // +1 floor so any card is possible
    const weightSum = weights.reduce((a, b) => a + b, 0);
    const hand = { brick: 0, lumber: 0, wool: 0, grain: 0, ore: 0 };
    for (let i = 0; i < total; i++) {
      let x = Math.random() * weightSum;
      let idx = 0;
      while (idx < RESOURCES.length - 1 && x > weights[idx]) { x -= weights[idx]; idx++; }
      hand[RESOURCES[idx]]++;
    }
    clone.players[pid].resources = hand;
  }
  // Reshuffle the unseen dev deck so the AI can't "know" the next card it draws.
  for (let i = clone.devDeck.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [clone.devDeck[i], clone.devDeck[j]] = [clone.devDeck[j], clone.devDeck[i]];
  }
  return clone;
}

function softmaxOverPlayers(rawByPlayer, players, temp) {
  const max = Math.max(...players.map(p => rawByPlayer[p]));
  const exps = {};
  let sum = 0;
  for (const p of players) { const e = Math.exp((rawByPlayer[p] - max) / temp); exps[p] = e; sum += e; }
  const out = {};
  for (const p of players) out[p] = exps[p] / (sum || 1);
  return out;
}

// Win-probability vector over players from the heuristic position eval.
function heuristicValueVector(board, players) {
  const raw = {};
  for (const p of players) raw[p] = evaluatePosition(board, p);
  return softmaxOverPlayers(raw, players, VALUE_TEMP);
}

// One-hot win vector at a terminal node (falls back to the heuristic if a search
// somehow stops at a capped, winner-less terminal).
function terminalValueVector(board, players) {
  if (board.winner == null) return heuristicValueVector(board, players);
  const out = {};
  for (const p of players) out[p] = board.winner === p ? 1 : 0;
  return out;
}

// Softmax priors over the (already pruned) legal moves from scoreMove.
function heuristicPriors(board, moves, toMove) {
  const scores = moves.map(move => scoreMove(board, move, toMove));
  const max = Math.max(...scores);
  let sum = 0;
  const exps = scores.map(score => { const e = Math.exp((score - max) / PRIOR_TEMP); sum += e; return e; });
  return moves.map((move, i) => ({ move, key: moveToKey(move), p: exps[i] / (sum || 1) }));
}

// Deep value estimate via a short heuristic rollout: play cheap-mode moves to a
// terminal state or a step cap, then read a one-hot winner (if decided) or the
// position-eval win-prob vector. Gives the tree a far stronger per-leaf signal
// than a 1-ply eval at low simulation counts. The NN evaluator replaces this
// with a direct value head (no rollout).
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

// Evaluator backed by a trained network. `net.predict(Float32Array[360])` resolves
// to { value: Float32Array[6] logits, policy: Float32Array[483] logits }. Runtime-
// agnostic: the net comes from valueNetworkNode.js (onnxruntime-node) or
// valueNetwork.js (onnxruntime-web); this file never imports an ONNX runtime, so
// the browser bundle is unaffected.
class NNEvaluator {
  constructor(net) {
    this.net = net;
  }

  async evaluate(board, prunedMoves, players) {
    const toMove = board.currentPlayer;
    const features = extractFeatures(board, toMove);
    const input = new Float32Array(features.tiles.length + features.players.length + features.meta.length);
    input.set(features.tiles, 0);
    input.set(features.players, features.tiles.length);
    input.set(features.meta, features.tiles.length + features.players.length);

    const { value, policy } = await this.net.predict(input);

    // Value is a scalar tanh ∈ [-1,1] (heuristic distillation).
    // Convert: own-player win-prob = (scalar + 1) / 2; others share the rest evenly.
    const scalar = value[0] ?? 0;
    const ownProb = (scalar + 1) / 2;
    const othersProb = (1 - ownProb) / Math.max(1, players.length - 1);
    const values = {};
    for (const pid of players) values[pid] = pid === toMove ? ownProb : othersProb;

    const logits = prunedMoves.map(move => {
      const idx = moveToPolicyIndex(move);
      return idx >= 0 && idx < policy.length ? policy[idx] : -1e9;
    });
    const priorProbs = softmaxArray(logits);
    const priors = prunedMoves.map((move, i) => ({ move, key: moveToKey(move), p: priorProbs[i] }));

    return { values, priors };
  }
}

function rollDiceTotal() {
  return (1 + Math.floor(Math.random() * 6)) + (1 + Math.floor(Math.random() * 6));
}

class TreeNode {
  constructor(board) {
    this.board = board;
    this.toMove = board.currentPlayer;
    this.terminal = board.phase === 'game-over';
    this.expanded = false;
    this.value = null;   // { playerId: winProb }
    this.edges = [];     // { move, key, p, n, w, children: Map<outcomeKey, TreeNode> }
  }
}

// async because an NN evaluator awaits an ONNX inference; the heuristic
// evaluator returns synchronously and the await resolves immediately.
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
  node.edges = priors.map(pr => ({ move: pr.move, key: pr.key, p: pr.p, n: 0, w: 0, children: new Map() }));
  node.expanded = true;
}

function childFor(node, edge) {
  if (edge.move.type === 'roll') {
    const total = rollDiceTotal();
    const key = `r${total}`;
    let child = edge.children.get(key);
    if (!child) {
      const cb = searchClone(node.board);
      cb.applyMove({ type: 'roll', total });
      child = new TreeNode(cb);
      edge.children.set(key, child);
    }
    return child;
  }
  let child = edge.children.get('_');
  if (!child) {
    const cb = searchClone(node.board);
    cb.applyMove(edge.move);
    child = new TreeNode(cb);
    edge.children.set('_', child);
  }
  return child;
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

class RootChild {
  constructor(move) {
    this.move = move;
    this.key = moveToKey(move);
    this.visits = 0;
    this.value = 0;
  }

  score(parentVisits) {
    if (this.visits === 0) return Infinity;
    return (this.value / this.visits) +
      EXPLORATION_CONSTANT * Math.sqrt(Math.log(parentVisits) / this.visits);
  }
}

class MCTS {
  constructor({
    maxChildren = DEFAULT_MAX_CHILDREN,
    mode = 'tree',
    evaluator = null,
    rolloutSteps = 0,
    c = PUCT_C,
  } = {}) {
    this.maxChildren = maxChildren;
    this.mode = mode;
    this.evaluator = evaluator || new HeuristicEvaluator({ rolloutSteps });
    this.c = c;
  }

  _rollout(board, rootPlayer) {
    const simBoard = board.clone();
    simBoard.stateHistory = [];
    simBoard.historyIndex = -1;

    let steps = 0;
    while (simBoard.phase !== 'game-over' && steps < MAX_ROLLOUT_STEPS) {
      const move = selectMoveByHeuristic(simBoard, { rollout: true });
      if (!move) break;
      const applied = simBoard.applyMove(move);
      if (!applied) break;
      steps++;
    }

    return evaluatePosition(simBoard, rootPlayer);
  }

  async getBestMove(board, simulations = 350) {
    if (this.mode === 'bandit') return this._getBestMoveBandit(board, simulations);
    return this._getBestMoveTree(board, simulations);
  }

  async _getBestMoveTree(board, simulations = 350) {
    const legalMoves = board.getLegalMoves();
    if (legalMoves.length === 0) return null;
    if (legalMoves.length === 1) return legalMoves[0];

    const players = board.getPlayerIds();
    // Determinize hidden info from the to-move player's perspective (no X-ray).
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
    const legalMovesForTraining = root.edges.map(({ move }) => {
      const { _rootVisits, _legalMoves, ...rest } = move;
      return rest;
    });
    best.move._rootVisits = rootVisits;
    best.move._legalMoves = legalMovesForTraining;
    return best.move;
  }

  async _getBestMoveBandit(board, simulations = 350) {
    const legalMoves = board.getLegalMoves();
    if (legalMoves.length === 0) return null;
    if (legalMoves.length === 1) return legalMoves[0];

    const rootPlayer = board.currentPlayer;
    const pruned = pruneMoves(board, legalMoves, rootPlayer, this.maxChildren);
    const children = pruned.map(move => new RootChild(move));

    const budget = Math.max(children.length, simulations);
    for (let i = 0; i < budget; i++) {
      const parentVisits = 1 + children.reduce((sum, child) => sum + child.visits, 0);
      const child = children.reduce((best, candidate) =>
        candidate.score(parentVisits) > best.score(parentVisits) ? candidate : best
      );

      const childBoard = board.clone();
      childBoard.stateHistory = [];
      childBoard.historyIndex = -1;
      const applied = childBoard.applyMove(child.move);
      const value = applied ? this._rollout(childBoard, rootPlayer) : -1;
      child.visits++;
      child.value += value;
    }

    let best = children[0];
    for (const child of children) {
      if (child.visits > best.visits) best = child;
    }

    const rootVisits = {};
    for (const child of children) rootVisits[child.key] = child.visits;
    const legalMovesForTraining = pruned.map(({ _rootVisits, _legalMoves, ...move }) => move);
    best.move._rootVisits = rootVisits;
    best.move._legalMoves = legalMovesForTraining;
    return best.move;
  }
}

export { MCTS, HeuristicEvaluator, NNEvaluator, applyMove, evaluatePosition, moveToKey, scoreMove, selectMoveByHeuristic, vertexValue, productionProfile };
