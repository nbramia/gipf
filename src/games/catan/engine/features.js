// Feature extraction for Catan policy/value training data.

import CatanBoard, { RESOURCES } from '../CatanBoard.js';

const MAX_TILES = 30;
const MAX_PLAYERS = 6;
const NUM_TILE_FEATURES = MAX_TILES * 8;
const NUM_PLAYER_FEATURES = MAX_PLAYERS * 18;
const NUM_META_FEATURES = 12;

// Policy index layout. Each finite decision class gets a distinct, collision-free
// slot range. Vertex-based moves (setup/build settlement, city) are exact because
// vertex ids are numeric "v0".."v53". Edge-based moves (setup/build road) use a
// bounded char-sum hash of the edge id ("vA|vB") into 72 buckets -- this is an
// unavoidable approximation since edge ids are not contiguous integers, but the
// hash range matches the edge count so collisions are rare. move-robber encodes
// (tile, victim) jointly; victim 0 == no steal, 1..4 == player id. year-of-plenty
// is an order-independent pair index over the 5 resources (15 pairs). discard,
// monopoly and trade are exact per-resource. propose-trade buckets by
// (give, receive) single-resource pair (25). respond-trade is 2 (accept/reject).
const VERTEX_SLOTS = 54;
const EDGE_SLOTS = 72;
const TILE_COUNT = 19;
const VICTIM_SLOTS = 5; // 0 = none, 1..4 = player id
const ROBBER_SLOTS = TILE_COUNT * VICTIM_SLOTS; // 95
const TRADE_SLOTS = 25; // give(5) x receive(5)
const PLENTY_SLOTS = 15; // unordered resource pairs
const MONOPOLY_SLOTS = 5;
const DISCARD_SLOTS = 5;
const PROPOSE_SLOTS = 25; // (give, receive) single-resource pair
const RESPOND_SLOTS = 2;

const POLICY_BASE = {};
let _cursor = 0;
const _alloc = (key, size) => { POLICY_BASE[key] = _cursor; _cursor += size; };
_alloc('setup-settlement', VERTEX_SLOTS);
_alloc('setup-road', EDGE_SLOTS);
_alloc('build-settlement', VERTEX_SLOTS);
_alloc('build-city', VERTEX_SLOTS);
_alloc('build-road', EDGE_SLOTS);
_alloc('move-robber', ROBBER_SLOTS);
_alloc('trade', TRADE_SLOTS);
_alloc('play-year-of-plenty', PLENTY_SLOTS);
_alloc('play-monopoly', MONOPOLY_SLOTS);
_alloc('discard', DISCARD_SLOTS);
_alloc('propose-trade', PROPOSE_SLOTS);
_alloc('respond-trade', RESPOND_SLOTS);
_alloc('buy-dev', 1);
_alloc('play-knight', 1);
_alloc('play-road-building', 1);
_alloc('roll', 1);
_alloc('end-turn', 1);

const POLICY_SIZE = _cursor;

// Order-independent index for an unordered pair (a, b) over RESOURCES (15 total).
function plentyPairIndex(a, b) {
  let ia = RESOURCES.indexOf(a);
  let ib = RESOURCES.indexOf(b);
  if (ia < 0 || ib < 0) return 0;
  if (ia > ib) { const t = ia; ia = ib; ib = t; }
  // triangular number layout: rows i=0..4, columns j=i..4
  return (ia * (2 * RESOURCES.length - ia + 1)) / 2 + (ib - ia);
}

function edgeHash(edgeId) {
  let hash = 0;
  for (let i = 0; i < edgeId.length; i++) hash = (hash + edgeId.charCodeAt(i)) % EDGE_SLOTS;
  return hash;
}

function oneHotResource(resource) {
  return RESOURCES.map(r => (resource === r ? 1 : 0));
}

function extractFeatures(board, perspectivePlayer = board.currentPlayer) {
  const tileFeatures = new Float32Array(NUM_TILE_FEATURES);
  const playerFeatures = new Float32Array(NUM_PLAYER_FEATURES);
  const metaFeatures = new Float32Array(NUM_META_FEATURES);

  board.tiles.forEach((tile, index) => {
    const offset = index * 8;
    const resources = oneHotResource(tile.resource);
    resources.forEach((value, i) => { tileFeatures[offset + i] = value; });
    tileFeatures[offset + 5] = tile.resource === 'desert' ? 1 : 0;
    tileFeatures[offset + 6] = CatanBoard.getPipCount(tile.number) / 5;
    tileFeatures[offset + 7] = board.robberTileId === tile.id ? 1 : 0;
  });

  const playerOrder = [
    perspectivePlayer,
    ...board.getPlayerIds().filter(player => player !== perspectivePlayer),
  ].slice(0, MAX_PLAYERS);

  playerOrder.forEach((playerId, index) => {
    const player = board.players[playerId];
    const offset = index * 18;
    RESOURCES.forEach((resource, i) => {
      playerFeatures[offset + i] = Math.min(12, player.resources[resource]) / 12;
    });
    playerFeatures[offset + 5] = player.roads.length / 15;
    playerFeatures[offset + 6] = player.settlements.length / 5;
    playerFeatures[offset + 7] = player.cities.length / 4;
    playerFeatures[offset + 8] = board.getVictoryPoints(playerId) / 10;
    playerFeatures[offset + 9] = player.knightsPlayed / 6;
    playerFeatures[offset + 10] = player.longestRoad ? 1 : 0;
    playerFeatures[offset + 11] = player.largestArmy ? 1 : 0;
    playerFeatures[offset + 12] = Object.values(player.devCards).reduce((a, b) => a + b, 0) / 8;
    playerFeatures[offset + 13] = player.devCards.knight / 5;
    playerFeatures[offset + 14] = player.devCards.victoryPoint / 5;
    playerFeatures[offset + 15] = player.devCards.roadBuilding / 2;
    playerFeatures[offset + 16] = player.devCards.yearOfPlenty / 2;
    playerFeatures[offset + 17] = player.devCards.monopoly / 2;
  });

  metaFeatures[0] = board.currentPlayer === perspectivePlayer ? 1 : 0;
  metaFeatures[1] = board.turnNumber / 40;
  metaFeatures[2] = (board.lastRoll || 0) / 12;
  metaFeatures[3] = board.phase === 'setup-settlement' ? 1 : 0;
  metaFeatures[4] = board.phase === 'setup-road' ? 1 : 0;
  metaFeatures[5] = board.phase === 'roll' ? 1 : 0;
  metaFeatures[6] = board.phase === 'robber' ? 1 : 0;
  metaFeatures[7] = board.phase === 'action' ? 1 : 0;
  metaFeatures[8] = board.freeRoadsRemaining / 2;
  metaFeatures[9] = board.devDeck.length / 25;
  metaFeatures[10] = board.longestRoadHolder === perspectivePlayer ? 1 : 0;
  metaFeatures[11] = board.largestArmyHolder === perspectivePlayer ? 1 : 0;

  return { tiles: tileFeatures, players: playerFeatures, meta: metaFeatures };
}

function bundleFirstResource(bundle) {
  const keys = Object.keys(bundle || {});
  return keys.length > 0 ? keys[0] : null;
}

function moveToPolicyIndex(move) {
  if (!move) return -1;
  const base = POLICY_BASE[move.type];
  if (base === undefined) return -1;

  switch (move.type) {
    case 'setup-settlement':
    case 'build-settlement':
    case 'build-city': {
      const vertexNum = Number(move.vertexId.slice(1)); // "v12" -> 12, exact (0..53)
      return base + (vertexNum % VERTEX_SLOTS);
    }
    case 'setup-road':
    case 'build-road':
      return base + edgeHash(move.edgeId);
    case 'move-robber': {
      const tileNum = Number(move.tileId.slice(1)) % TILE_COUNT; // 0..18
      const victim = move.stealPlayerId ? (Number(move.stealPlayerId) % VICTIM_SLOTS) : 0;
      return base + tileNum * VICTIM_SLOTS + victim;
    }
    case 'trade': {
      const gi = RESOURCES.indexOf(move.give);
      const ri = RESOURCES.indexOf(move.receive);
      if (gi < 0 || ri < 0) return base;
      return base + gi * RESOURCES.length + ri;
    }
    case 'play-year-of-plenty':
      return base + plentyPairIndex(move.resourceA, move.resourceB);
    case 'play-monopoly':
    case 'discard': {
      const idx = RESOURCES.indexOf(move.resource);
      return base + (idx < 0 ? 0 : idx);
    }
    case 'propose-trade': {
      const gi = RESOURCES.indexOf(bundleFirstResource(move.give));
      const ri = RESOURCES.indexOf(bundleFirstResource(move.receive));
      const g = gi < 0 ? 0 : gi;
      const r = ri < 0 ? 0 : ri;
      return base + g * RESOURCES.length + r;
    }
    case 'respond-trade':
      return base + (move.accept ? 0 : 1);
    default:
      // Singleton move types (buy-dev, play-knight, play-road-building, roll, end-turn).
      return base;
  }
}

function extractPolicyTarget(move) {
  const target = new Float32Array(POLICY_SIZE);
  if (!move?._rootVisits || !move?._legalMoves) return target;

  for (const legalMove of move._legalMoves) {
    const key = moveToTrainingKey(legalMove);
    const visits = move._rootVisits[key] || 0;
    const index = moveToPolicyIndex(legalMove);
    if (visits > 0 && index >= 0 && index < POLICY_SIZE) {
      target[index] += visits;
    }
  }

  const total = target.reduce((sum, value) => sum + value, 0);
  if (total > 0) {
    for (let i = 0; i < target.length; i++) target[i] /= total;
  }
  return target;
}

function moveToTrainingKey(move) {
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

// Canonical, order-independent serialization of a resource bundle so the key is
// identical regardless of object key ordering. Must match mcts.js bundleKey.
function bundleKey(bundle) {
  return Object.entries(bundle || {})
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([resource, amount]) => `${resource}=${amount}`)
    .join(',');
}

export {
  NUM_TILE_FEATURES,
  NUM_PLAYER_FEATURES,
  NUM_META_FEATURES,
  POLICY_SIZE,
  extractFeatures,
  extractPolicyTarget,
  moveToPolicyIndex,
};
