// MCTS engine for Catan AI.
// Root-focused Monte Carlo search with heuristic rollouts for a four-player game.

import CatanBoard, { RESOURCES, COSTS, resourceTotal } from '../CatanBoard.js';

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
    case 'end-turn':
      return 'end';
    default:
      return JSON.stringify(move);
  }
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
  const opponentPoints = [1, 2, 3, 4]
    .filter(id => id !== perspectivePlayer)
    .map(id => board.getVictoryPoints(id));
  const bestOpponent = Math.max(...opponentPoints);
  let score = (myPoints - bestOpponent) * 2600 + myPoints * 240;

  if (myPoints >= 8) score += (myPoints - 7) * 900;
  if (bestOpponent >= 8) score -= (bestOpponent - 7) * 1000;

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

  for (let opponent = 1; opponent <= 4; opponent++) {
    if (opponent === perspectivePlayer) continue;
    const oppProfile = productionProfile(board, opponent);
    const oppProduction = RESOURCES.reduce((sum, resource) => sum + oppProfile[resource], 0);
    score -= oppProduction * 18;
    score -= Math.min(9, resourceTotal(board.players[opponent].resources)) * 30;
  }

  return Math.tanh(score / 6500);
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
        score += building.player === playerId ? -pips * 70 : pips * 55;
      }
      if (move.stealPlayerId) score += Math.min(7, board.getPlayerResourceTotal(move.stealPlayerId)) * 22;
      return score;
    }
    case 'build-city':
      return 900 + vertexValue(board, move.vertexId, playerId) * 0.8;
    case 'build-settlement':
      return 780 + vertexValue(board, move.vertexId, playerId);
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
      return 260 + [1, 2, 3, 4]
        .filter(id => id !== playerId)
        .reduce((sum, id) => sum + board.players[id].resources[move.resource], 0) * 80;
    case 'trade':
      return 95 + board._resourceNeedScore(playerId, move.receive) * 60 - move.ratio * 20;
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

function selectMoveByHeuristic(board) {
  const moves = board.getLegalMoves();
  if (moves.length === 0) return null;
  if (moves.length === 1) return moves[0];

  const playerId = board.currentPlayer;
  const pruned = pruneMoves(board, moves, playerId, 18);
  let best = pruned[0];
  let bestScore = -Infinity;
  for (const move of pruned) {
    const noise = Math.random() * 35;
    const score = scoreMove(board, move, playerId) + noise;
    if (score > bestScore) {
      best = move;
      bestScore = score;
    }
  }
  return best;
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
  } = {}) {
    this.maxChildren = maxChildren;
  }

  _rollout(board, rootPlayer) {
    const simBoard = board.clone();
    simBoard.stateHistory = [];
    simBoard.historyIndex = -1;

    let steps = 0;
    while (simBoard.phase !== 'game-over' && steps < MAX_ROLLOUT_STEPS) {
      const move = selectMoveByHeuristic(simBoard);
      if (!move) break;
      const applied = simBoard.applyMove(move);
      if (!applied) break;
      steps++;
    }

    return evaluatePosition(simBoard, rootPlayer);
  }

  async getBestMove(board, simulations = 350) {
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

export { MCTS, applyMove, evaluatePosition, moveToKey, scoreMove, selectMoveByHeuristic, vertexValue, productionProfile };
