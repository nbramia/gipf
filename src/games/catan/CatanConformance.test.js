// Official-rules conformance tests for the Catan engine, one block per audited
// rule area, plus a seeded self-play invariant soak. Companion to
// CatanBoard.test.js (which covers the core mechanics these build on).

import CatanBoard, { COSTS, RESOURCES, resourceTotal } from './CatanBoard.js';
import { MCTS } from './engine/mcts.js';

function giveResources(board, playerId, resources) {
  Object.entries(resources).forEach(([resource, amount]) => {
    board.players[playerId].resources[resource] += amount;
    board.bank[resource] -= amount;
  });
}

// Walk `length` connected, unowned edges from some vertex and assign them to
// playerId. Returns { edges, vertices } of the chain (vertices has length+1).
function buildChain(board, playerId, length) {
  for (const startId of Object.keys(board.vertices)) {
    const walk = tryWalk(board, startId, length);
    if (!walk) continue;
    walk.edges.forEach(edgeId => {
      board.edges[edgeId].owner = playerId;
      board.players[playerId].roads.push(edgeId);
    });
    return walk;
  }
  throw new Error('no chain found');
}

function tryWalk(board, startId, length) {
  const edges = [];
  const vertices = [startId];
  const visited = new Set([startId]);
  let current = startId;
  for (let i = 0; i < length; i++) {
    const edgeId = board.vertices[current].edgeIds.find(candidate => {
      if (board.edges[candidate].owner) return false;
      const next = board.edges[candidate].vertices.find(v => v !== current);
      return !visited.has(next);
    });
    if (!edgeId) return null;
    edges.push(edgeId);
    current = board.edges[edgeId].vertices.find(v => v !== current);
    visited.add(current);
    vertices.push(current);
  }
  return { edges, vertices };
}

// A mid-chain vertex where an opponent settlement can legally sever the road:
// interior to the chain, has a free third edge, and no adjacent buildings.
// Prefers the middle so the cut leaves both segments below 5.
function severableVertex(board, walk) {
  const interior = walk.vertices.slice(1, -1);
  const mid = (interior.length - 1) / 2;
  const vertexId = [...interior]
    .sort((a, b) => Math.abs(interior.indexOf(a) - mid) - Math.abs(interior.indexOf(b) - mid))
    .find(id =>
      !board.vertices[id].building &&
      board.vertices[id].adjacent.every(adj => !board.vertices[adj].building) &&
      board.vertices[id].edgeIds.some(edgeId => !board.edges[edgeId].owner));
  expect(vertexId).toBeTruthy();
  return vertexId;
}

function startActionTurn(board, playerId) {
  board.phase = 'action';
  board.currentPlayer = playerId;
  board.primaryTurnPlayer = playerId;
}

describe('Longest road severing', () => {
  test('a settlement that cuts the holder road below 5 sets the card aside', () => {
    const board = new CatanBoard({ seed: 41, skipInitialHistory: true });
    const walk = buildChain(board, 2, 6);
    board._updateLongestRoad();
    expect(board.longestRoadHolder).toBe(2);

    const cutVertex = severableVertex(board, walk);
    const freeEdge = board.vertices[cutVertex].edgeIds.find(edgeId => !board.edges[edgeId].owner);
    board.edges[freeEdge].owner = 1;
    board.players[1].roads.push(freeEdge);

    startActionTurn(board, 1);
    giveResources(board, 1, COSTS.settlement);
    expect(board.buildSettlement(cutVertex)).toBe(true);

    expect(board._longestRoadForPlayer(2)).toBeLessThan(5);
    expect(board.longestRoadHolder).toBe(null);
    expect(board.players[2].longestRoad).toBe(false);
  });

  test('severing transfers the card to a unique qualifying opponent', () => {
    const board = new CatanBoard({ seed: 42, skipInitialHistory: true });
    const walk = buildChain(board, 2, 6);
    const cutVertex = severableVertex(board, walk);
    // Claim player 1's connecting road first so player 3's chain can't take it.
    const freeEdge = board.vertices[cutVertex].edgeIds.find(edgeId => !board.edges[edgeId].owner);
    board.edges[freeEdge].owner = 1;
    board.players[1].roads.push(freeEdge);

    buildChain(board, 3, 5);
    board._updateLongestRoad();
    expect(board.longestRoadHolder).toBe(2);

    startActionTurn(board, 1);
    giveResources(board, 1, COSTS.settlement);
    expect(board.buildSettlement(cutVertex)).toBe(true);

    expect(board.longestRoadHolder).toBe(3);
    expect(board.players[3].longestRoad).toBe(true);
    expect(board.players[2].longestRoad).toBe(false);
  });

  test('the incumbent keeps the card when an opponent merely ties', () => {
    const board = new CatanBoard({ seed: 43, skipInitialHistory: true });
    buildChain(board, 2, 5);
    board._updateLongestRoad();
    expect(board.longestRoadHolder).toBe(2);

    buildChain(board, 3, 5);
    board._updateLongestRoad();
    expect(board.longestRoadHolder).toBe(2);
  });
});

describe('Winning only on your own turn', () => {
  test('the active player wins immediately on reaching the target', () => {
    const board = new CatanBoard({ seed: 44, skipInitialHistory: true });
    board.victoryTarget = 1;
    startActionTurn(board, 1);

    const walk = buildChain(board, 1, 1);
    const vertexId = walk.vertices[0];
    giveResources(board, 1, COSTS.settlement);
    expect(board.buildSettlement(vertexId)).toBe(true);

    expect(board.phase).toBe('game-over');
    expect(board.winner).toBe(1);
  });

  test('an off-turn qualifier via severing waits until their own turn starts', () => {
    const board = new CatanBoard({ seed: 45, playerCount: 3, skipInitialHistory: true });
    board.victoryTarget = 5;

    // Player 2 holds longest road with a 6-chain.
    const walk = buildChain(board, 2, 6);
    board._updateLongestRoad();
    expect(board.longestRoadHolder).toBe(2);

    // Player 3: three settlements plus a 5-road chain (3 VP now, 5 with the
    // card). Settlements stay clear of player 2's chain and its neighbors so
    // they neither shorten that road nor block the cut vertex.
    buildChain(board, 3, 5);
    const banned = new Set();
    walk.vertices.forEach(v => {
      banned.add(v);
      board.vertices[v].adjacent.forEach(adj => banned.add(adj));
    });
    for (const vertexId of Object.keys(board.vertices)) {
      if (board.players[3].settlements.length >= 3) break;
      if (banned.has(vertexId) || board.vertices[vertexId].building) continue;
      if (!board.vertices[vertexId].adjacent.every(adj => !board.vertices[adj].building)) continue;
      board.vertices[vertexId].building = { player: 3, type: 'settlement' };
      board.players[3].settlements.push(vertexId);
    }
    expect(board.players[3].settlements).toHaveLength(3);
    expect(board.getVictoryPoints(3)).toBe(3);

    // Player 1 severs it; the card passes to player 3, reaching the target off-turn.
    const cutVertex = severableVertex(board, walk);
    const freeEdge = board.vertices[cutVertex].edgeIds.find(edgeId => !board.edges[edgeId].owner);
    board.edges[freeEdge].owner = 1;
    board.players[1].roads.push(freeEdge);
    startActionTurn(board, 1);
    giveResources(board, 1, COSTS.settlement);
    expect(board.buildSettlement(cutVertex)).toBe(true);

    expect(board.longestRoadHolder).toBe(3);
    expect(board.getVictoryPoints(3)).toBe(5);
    expect(board.phase).toBe('action'); // game not over — player 3 is off-turn

    // Player 2 still gets a full turn before player 3's win lands.
    expect(board.endTurn()).toBe(true);
    expect(board.currentPlayer).toBe(2);
    expect(board.phase).toBe('roll');
    expect(board.rollDice(4)).toBe(true);
    expect(board.phase).toBe('action');

    // Player 3's turn begins: they win at the start of it.
    expect(board.endTurn()).toBe(true);
    expect(board.phase).toBe('game-over');
    expect(board.winner).toBe(3);
  });
});
