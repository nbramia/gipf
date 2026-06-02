// Feature extraction and policy-target helpers for Splendor self-play data.
//
// Scaffold for the NN evaluator seam: the deployed engine is the heuristic PUCT
// tree, so these features/policy slots are not exercised in production, but the
// training pipeline (scripts/splendor, training/splendor) and NNEvaluator depend
// on a stable, consistent encoding.

import { CARDS, NOBLES, GEMS, ALL_TOKENS, VICTORY_POINTS, VISIBLE_PER_TIER } from '../splendorCards.js';

const MAX_PLAYERS = 4;
const PLAYER_FEATURES = 14;   // 6 tokens + 5 bonuses + points + reserved + nobles
const MARKET_SLOTS = 3 * VISIBLE_PER_TIER; // 12 face-up cards
const MARKET_FEATURES = 12;   // present + tier + points + bonus(5) + cost(5)... see below
const META_FEATURES = 16;

const NUM_PLAYER_FEATURES = MAX_PLAYERS * PLAYER_FEATURES;
const NUM_MARKET_FEATURES = MARKET_SLOTS * MARKET_FEATURES;

// Stable indices.
const CARD_INDEX = Object.fromEntries(CARDS.map((c, i) => [c.id, i]));   // 0..89
const NOBLE_INDEX = Object.fromEntries(NOBLES.map((n, i) => [n.id, i])); // 0..9
const TOKEN_INDEX = Object.fromEntries(ALL_TOKENS.map((t, i) => [t, i]));
const GEM_INDEX = Object.fromEntries(GEMS.map((g, i) => [g, i]));

// All nonempty colour subsets of size <= 3, in a fixed order (for take moves).
const COLOR_SUBSETS = (() => {
  const out = [];
  const n = GEMS.length;
  for (let size = 1; size <= 3; size++) {
    const combo = [];
    (function rec(start) {
      if (combo.length === size) { out.push([...combo]); return; }
      for (let i = start; i < n; i++) { combo.push(GEMS[i]); rec(i + 1); combo.pop(); }
    })(0);
  }
  return out;
})();
const SUBSET_KEY = Object.fromEntries(COLOR_SUBSETS.map((s, i) => [s.join(''), i]));

// Policy layout.
const POLICY_BASE = {};
let _cursor = 0;
const _alloc = (key, size) => { POLICY_BASE[key] = _cursor; _cursor += size; };
_alloc('take', COLOR_SUBSETS.length);   // take-three (and reduced takes)
_alloc('take-two', GEMS.length);
_alloc('reserve', CARDS.length);        // reserve a specific visible card
_alloc('reserve-deck', 3);              // blind reserve by tier
_alloc('buy', CARDS.length);            // buy a specific card (visible or reserved)
_alloc('discard', ALL_TOKENS.length);
_alloc('noble', NOBLES.length);
_alloc('pass', 1);
const POLICY_SIZE = _cursor;

function moveToPolicyIndex(move) {
  if (!move) return -1;
  switch (move.type) {
    case 'take-three': {
      const key = [...move.colors].sort((a, b) => GEM_INDEX[a] - GEM_INDEX[b]).join('');
      return POLICY_BASE.take + (SUBSET_KEY[key] ?? 0);
    }
    case 'take-two':
      return POLICY_BASE['take-two'] + GEM_INDEX[move.color];
    case 'reserve':
      return move.fromDeck
        ? POLICY_BASE['reserve-deck'] + (move.tier - 1)
        : POLICY_BASE.reserve + CARD_INDEX[move.cardId];
    case 'buy':
      return POLICY_BASE.buy + CARD_INDEX[move.cardId];
    case 'discard-token':
      return POLICY_BASE.discard + TOKEN_INDEX[move.token];
    case 'choose-noble':
      return POLICY_BASE.noble + NOBLE_INDEX[move.nobleId];
    case 'pass':
      return POLICY_BASE.pass;
    default:
      return -1;
  }
}

function cardFeatures(out, offset, card) {
  out[offset] = 1; // present
  out[offset + 1] = card.tier / 3;
  out[offset + 2] = card.points / 5;
  out[offset + 3 + GEM_INDEX[card.bonus]] = 1; // bonus one-hot (5)
  for (const gem of GEMS) out[offset + 8 + GEM_INDEX[gem]] = (card.cost[gem] || 0) / 7; // cost (5)
}

// Perspective-relative: the to-move player is encoded first.
function extractFeatures(board, perspectivePlayer = board.currentPlayer) {
  const ids = board.getPlayerIds();
  const ordered = [perspectivePlayer, ...ids.filter(id => id !== perspectivePlayer)].slice(0, MAX_PLAYERS);

  const players = new Float32Array(NUM_PLAYER_FEATURES);
  ordered.forEach((id, slot) => {
    const p = board.players[id];
    const base = slot * PLAYER_FEATURES;
    ALL_TOKENS.forEach((t, i) => { players[base + i] = p.tokens[t] / 7; });
    GEMS.forEach((g, i) => { players[base + 6 + i] = p.bonuses[g] / 10; });
    players[base + 11] = board.getVictoryPoints(id) / VICTORY_POINTS;
    players[base + 12] = p.reserved.length / 3;
    players[base + 13] = p.nobles.length / 5;
  });

  const market = new Float32Array(NUM_MARKET_FEATURES);
  let slot = 0;
  for (const tier of [1, 2, 3]) {
    for (let i = 0; i < VISIBLE_PER_TIER; i++) {
      const cardId = board.visible[tier][i];
      if (cardId) cardFeatures(market, slot * MARKET_FEATURES, board.getCard(cardId));
      slot++;
    }
  }

  const meta = new Float32Array(META_FEATURES);
  ALL_TOKENS.forEach((t, i) => { meta[i] = board.bank[t] / 7; });
  meta[6] = board.nobles.length / 5;
  meta[7] = board.decks[1].length / 40;
  meta[8] = board.decks[2].length / 30;
  meta[9] = board.decks[3].length / 20;
  meta[10] = board.phase === 'play' ? 1 : 0;
  meta[11] = board.phase === 'discard' ? 1 : 0;
  meta[12] = board.phase === 'noble-choice' ? 1 : 0;
  meta[13] = board.phase === 'game-over' ? 1 : 0;
  meta[14] = Math.min(board.turnNumber, 60) / 60;
  meta[15] = ordered.length / MAX_PLAYERS;

  return { players, market, meta };
}

// Normalized MCTS root visit distribution over POLICY_SIZE slots, attached to a
// move by getBestMove via _rootVisits / _legalMoves.
function extractPolicyTarget(move) {
  const target = new Float32Array(POLICY_SIZE);
  const visits = move?._rootVisits;
  const legal = move?._legalMoves;
  if (!visits || !legal) return target;

  let total = 0;
  for (const legalMove of legal) {
    const key = moveTrainingKey(legalMove);
    const n = visits[key] || 0;
    const index = moveToPolicyIndex(legalMove);
    if (n > 0 && index >= 0 && index < POLICY_SIZE) {
      target[index] += n;
      total += n;
    }
  }
  if (total > 0) for (let i = 0; i < target.length; i++) target[i] /= total;
  return target;
}

// Must match moveToKey in mcts.js so visit counts line up with legal moves.
function moveTrainingKey(move) {
  switch (move.type) {
    case 'take-three': return `t3:${[...move.colors].sort().join('')}`;
    case 'take-two': return `t2:${move.color}`;
    case 'reserve': return `rv:${move.fromDeck ? `deck${move.tier}` : move.cardId}`;
    case 'buy': return `by:${move.cardId}${move.fromReserve ? 'R' : ''}`;
    case 'discard-token': return `dc:${move.token}`;
    case 'choose-noble': return `nb:${move.nobleId}`;
    case 'pass': return 'pass';
    default: return JSON.stringify(move);
  }
}

export {
  extractFeatures,
  extractPolicyTarget,
  moveToPolicyIndex,
  POLICY_SIZE,
  POLICY_BASE,
  MAX_PLAYERS,
  NUM_PLAYER_FEATURES,
  NUM_MARKET_FEATURES,
  META_FEATURES,
};
