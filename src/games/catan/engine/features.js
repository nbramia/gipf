// Feature extraction for Catan policy/value training data.

import CatanBoard, { RESOURCES } from '../CatanBoard.js';

const NUM_TILE_FEATURES = 19 * 8;
const NUM_PLAYER_FEATURES = 4 * 18;
const NUM_META_FEATURES = 12;
const POLICY_SIZE = 256;

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
    ...[1, 2, 3, 4].filter(player => player !== perspectivePlayer),
  ];

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

function moveToPolicyIndex(move) {
  if (!move) return -1;
  const prefix = {
    'setup-settlement': 0,
    'setup-road': 54,
    'build-settlement': 96,
    'build-city': 128,
    'build-road': 160,
    'move-robber': 210,
    trade: 232,
    'buy-dev': 248,
    'play-knight': 249,
    'play-road-building': 250,
    'play-year-of-plenty': 251,
    'play-monopoly': 252,
    roll: 253,
    'end-turn': 254,
  };

  if (move.vertexId && prefix[move.type] !== undefined) {
    const vertexNum = Number(move.vertexId.replace('v', ''));
    return prefix[move.type] + (vertexNum % 32);
  }
  if (move.edgeId && prefix[move.type] !== undefined) {
    let hash = 0;
    for (let i = 0; i < move.edgeId.length; i++) hash = (hash + move.edgeId.charCodeAt(i)) % 50;
    return prefix[move.type] + hash;
  }
  if (move.tileId && prefix[move.type] !== undefined) {
    return prefix[move.type] + Number(move.tileId.replace('t', ''));
  }
  if (move.type === 'trade') {
    return 232 + RESOURCES.indexOf(move.give) * 3 + (RESOURCES.indexOf(move.receive) % 3);
  }
  return prefix[move.type] ?? -1;
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
    case 'end-turn':
      return 'end';
    default:
      return JSON.stringify(move);
  }
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
