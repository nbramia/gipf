// Limited takeback: the human may revert only their own newest road,
// settlement or city placement, and only while nothing else has happened.

import CatanBoard, { COSTS } from './CatanBoard.js';
import { encodeBoard, decodeMatch } from './matchSnapshot.js';

const state = board => JSON.stringify({ ...board.serializeState(), stateHistory: [], historyIndex: -1 });

function giveResources(board, playerId, resources) {
  Object.entries(resources).forEach(([resource, amount]) => {
    board.players[playerId].resources[resource] += amount;
    board.bank[resource] -= amount;
  });
}

function tryWalk(board, startId, length) {
  const edges = [];
  const vertices = [startId];
  const visited = new Set([startId]);
  let current = startId;
  for (let i = 0; i < length; i++) {
    const edgeId = board.vertices[current].edgeIds.find(candidate => {
      if (board.edges[candidate].owner) return false;
      return !visited.has(board.edges[candidate].vertices.find(v => v !== current));
    });
    if (!edgeId) return null;
    edges.push(edgeId);
    current = board.edges[edgeId].vertices.find(v => v !== current);
    visited.add(current);
    vertices.push(current);
  }
  return { edges, vertices };
}

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

// An action-phase board for player 1 with a recorded history baseline.
function actionBoard(seed = 31) {
  const board = new CatanBoard({ seed });
  board.phase = 'action';
  board.currentPlayer = 1;
  board.primaryTurnPlayer = 1;
  return board;
}

describe('setup placements', () => {
  test('a setup settlement can be taken back and replaced', () => {
    const board = new CatanBoard({ seed: 5 });
    const player = board.currentPlayer;
    const before = state(board);
    expect(board.canUndoPlacement(player)).toBe(false);

    const settlement = board.getLegalMoves().find(move => move.type === 'setup-settlement');
    board.applyMove(settlement);
    expect(board.phase).toBe('setup-road');
    expect(board.canUndoPlacement(player)).toBe(true);

    expect(board.undoPlacement(player)).toBe(true);
    expect(state(board)).toBe(before);
    expect(board.canUndoPlacement(player)).toBe(false);
    expect(board.applyMove(settlement)).toBe(true);
  });

  test('undoing the second setup road takes the starting resources back', () => {
    const board = new CatanBoard({ seed: 6 });
    while (!(board.setupIndex >= board.playerCount && board.phase === 'setup-road')) {
      board.applyMove(board.getLegalMoves()[0]);
    }
    const player = board.currentPlayer;
    const before = state(board);
    const handBefore = { ...board.players[player].resources };
    board.applyMove(board.getLegalMoves().find(move => move.type === 'setup-road'));
    const handAfter = board.players[player].resources;
    expect(Object.values(handAfter).reduce((a, b) => a + b, 0)).toBeGreaterThan(0);

    expect(board.undoPlacement(player)).toBe(true);
    expect(board.players[player].resources).toEqual(handBefore);
    expect(state(board)).toBe(before);
  });

  test('another player cannot take the placement back', () => {
    const board = new CatanBoard({ seed: 5 });
    const player = board.currentPlayer;
    const other = player === 1 ? 2 : 1;
    board.applyMove(board.getLegalMoves().find(move => move.type === 'setup-settlement'));
    expect(board.canUndoPlacement(other)).toBe(false);
    expect(board.undoPlacement(other)).toBe(false);
  });
});

describe('build placements', () => {
  test('road, city and settlement refund exactly and restore the whole state', () => {
    const board = actionBoard();
    const start = Object.keys(board.vertices).find(id => board.vertices[id].edgeIds.length >= 2);
    board.vertices[start].building = { player: 1, type: 'settlement' };
    board.players[1].settlements.push(start);
    giveResources(board, 1, { brick: 4, lumber: 4, wool: 4, grain: 6, ore: 6 });
    board._captureState();

    const cases = [
      () => ({ type: 'build-road', edgeId: board.getValidRoadEdges(1)[0] }),
      () => ({ type: 'build-city', vertexId: start }),
    ];
    for (const makeMove of cases) {
      const before = state(board);
      const bank = { ...board.bank };
      expect(board.applyMove(makeMove())).toBe(true);
      expect(state(board)).not.toBe(before);
      expect(board.canUndoPlacement(1)).toBe(true);
      expect(board.undoPlacement(1)).toBe(true);
      expect(state(board)).toBe(before);
      expect(board.bank).toEqual(bank);
    }

    // Settlement needs a road-connected legal spot two roads out.
    const road = board.getValidRoadEdges(1)[0];
    board.applyMove({ type: 'build-road', edgeId: road });
    const next = board.edges[road].vertices.find(v => v !== start);
    const road2 = board.vertices[next].edgeIds.find(id => !board.edges[id].owner);
    board.applyMove({ type: 'build-road', edgeId: road2 });
    const far = board.edges[road2].vertices.find(v => v !== next);
    expect(board.getValidSettlementVertices(1, false)).toContain(far);
    const before = state(board);
    expect(board.applyMove({ type: 'build-settlement', vertexId: far })).toBe(true);
    expect(board.undoPlacement(1)).toBe(true);
    expect(state(board)).toBe(before);
  });

  test('longest road gained by a road is taken back with it', () => {
    const board = actionBoard(15);
    const startId = Object.keys(board.vertices).find(id => tryWalk(board, id, 5));
    const walk = tryWalk(board, startId, 5);
    board.vertices[walk.vertices[0]].building = { player: 1, type: 'settlement' };
    board.players[1].settlements.push(walk.vertices[0]);
    walk.edges.slice(0, 4).forEach(edgeId => {
      board.edges[edgeId].owner = 1;
      board.players[1].roads.push(edgeId);
    });
    giveResources(board, 1, COSTS.road);
    board._updateLongestRoad();
    expect(board.longestRoadHolder).toBe(null);
    board._captureState();
    const before = state(board);
    const vpBefore = board.getVictoryPoints(1);

    expect(board.applyMove({ type: 'build-road', edgeId: walk.edges[4] })).toBe(true);
    expect(board.longestRoadHolder).toBe(1);
    expect(board.getVictoryPoints(1)).toBe(vpBefore + 2);

    expect(board.undoPlacement(1)).toBe(true);
    expect(board.longestRoadHolder).toBe(null);
    expect(board.players[1].longestRoad).toBe(false);
    expect(board.getVictoryPoints(1)).toBe(vpBefore);
    expect(state(board)).toBe(before);
  });

  test('a settlement that severs the holder road is taken back and the card returns', () => {
    const board = actionBoard(41);
    const walk = buildChain(board, 2, 6);
    board._updateLongestRoad();
    expect(board.longestRoadHolder).toBe(2);
    const interior = walk.vertices.slice(1, -1);
    const mid = (interior.length - 1) / 2;
    const cut = [...interior].sort((a, b) => Math.abs(interior.indexOf(a) - mid) - Math.abs(interior.indexOf(b) - mid)).find(id =>
      !board.vertices[id].building &&
      board.vertices[id].adjacent.every(adj => !board.vertices[adj].building) &&
      board.vertices[id].edgeIds.some(edgeId => !board.edges[edgeId].owner));
    const free = board.vertices[cut].edgeIds.find(edgeId => !board.edges[edgeId].owner);
    board.edges[free].owner = 1;
    board.players[1].roads.push(free);
    giveResources(board, 1, COSTS.settlement);
    board._captureState();
    const before = state(board);

    expect(board.applyMove({ type: 'build-settlement', vertexId: cut })).toBe(true);
    expect(board.longestRoadHolder).toBe(null);
    expect(board.undoPlacement(1)).toBe(true);
    expect(board.longestRoadHolder).toBe(2);
    expect(board.players[2].longestRoad).toBe(true);
    expect(state(board)).toBe(before);
  });
});

describe('the takeback window', () => {
  function afterRoad() {
    const board = actionBoard();
    const start = Object.keys(board.vertices).find(id => board.vertices[id].edgeIds.length >= 2);
    board.vertices[start].building = { player: 1, type: 'settlement' };
    board.players[1].settlements.push(start);
    giveResources(board, 1, { brick: 3, lumber: 3, wool: 3, grain: 3, ore: 3 });
    board._captureState();
    board.applyMove({ type: 'build-road', edgeId: board.getValidRoadEdges(1)[0] });
    expect(board.canUndoPlacement(1)).toBe(true);
    return board;
  }

  test('closes after buying a development card', () => {
    const board = afterRoad();
    expect(board.applyMove({ type: 'buy-dev' })).toBe(true);
    expect(board.canUndoPlacement(1)).toBe(false);
    expect(board.undoPlacement(1)).toBe(false);
  });

  test('closes after a bank trade', () => {
    const board = afterRoad();
    board.players[1].resources.grain += 4;
    expect(board.applyMove({ type: 'trade', give: 'grain', receive: 'ore' })).toBe(true);
    expect(board.canUndoPlacement(1)).toBe(false);
  });

  test('closes after ending the turn and after the next roll', () => {
    const board = afterRoad();
    expect(board.applyMove({ type: 'end-turn' })).toBe(true);
    expect(board.canUndoPlacement(1)).toBe(false);
    while (board.currentPlayer !== 1) {
      if (board.phase === 'roll') board.applyMove({ type: 'roll', total: 4 });
      else board.applyMove({ type: 'end-turn' });
    }
    board.applyMove({ type: 'roll', total: 4 });
    expect(board.canUndoPlacement(1)).toBe(false);
  });

  test('is closed at the start and when the game is over', () => {
    expect(new CatanBoard({ seed: 1 }).canUndoPlacement(1)).toBe(false);
    const board = afterRoad();
    board.phase = 'game-over';
    expect(board.canUndoPlacement(1)).toBe(false);
  });

  test('survives clone but not a saved snapshot, and stays valid either way', () => {
    const board = afterRoad();
    expect(board.clone().canUndoPlacement(1)).toBe(true);
    const restored = decodeMatch({ v: 1, game: 'catan', id: 'x', updatedAt: 1, state: encodeBoard(board), ui: { showModal: false, gameConfig: { rulesetId: board.rulesetId, playerCount: board.playerCount, scenarioId: board.scenarioId } } }).board;
    expect(restored.canUndoPlacement(1)).toBe(false);
    expect(state(restored)).toBe(state(board));
  });

  test('the move list offered to the AI has no takeback', () => {
    const board = afterRoad();
    expect(board.getLegalMoves().some(move => /undo/i.test(move.type))).toBe(false);
    expect(board.applyMove({ type: 'undo' })).toBe(false);
  });
});
