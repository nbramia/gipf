import CatanBoard, { COSTS, RESOURCES, resourceTotal } from './CatanBoard.js';
import { MCTS } from './engine/mcts.js';

function placeNextSetupPair(board) {
  const settlement = board.getLegalMoves().find(move => move.type === 'setup-settlement');
  expect(settlement).toBeTruthy();
  expect(board.applyMove(settlement)).toBe(true);

  const road = board.getLegalMoves().find(move => move.type === 'setup-road');
  expect(road).toBeTruthy();
  expect(board.applyMove(road)).toBe(true);
  return { settlement, road };
}

function giveResources(board, playerId, resources) {
  Object.entries(resources).forEach(([resource, amount]) => {
    board.players[playerId].resources[resource] += amount;
    board.bank[resource] -= amount;
  });
}

describe('Catan board generation', () => {
  test('creates canonical Catan topology', () => {
    const board = new CatanBoard({ seed: 7 });

    expect(board.tiles).toHaveLength(19);
    expect(Object.keys(board.vertices)).toHaveLength(54);
    expect(Object.keys(board.edges)).toHaveLength(72);
    expect(board.tiles.filter(tile => tile.resource === 'desert')).toHaveLength(1);
    expect(board.getTile(board.robberTileId).resource).toBe('desert');
  });

  test('creates the enlarged 5-6 player island profile', () => {
    const board = new CatanBoard({ seed: 7, rulesetId: 'base-5-6', playerCount: 6 });

    expect(board.tiles).toHaveLength(30);
    expect(Object.keys(board.vertices)).toHaveLength(80);
    expect(Object.keys(board.edges)).toHaveLength(109);
    expect(board.tiles.filter(tile => tile.resource === 'desert')).toHaveLength(2);
    expect(board.getPlayerIds()).toEqual([1, 2, 3, 4, 5, 6]);
    // Snake setup order, starting from a randomized first player: the first half
    // is a rotation of all players starting at firstPlayer, the second is its mirror.
    const ids = board.getPlayerIds();
    const half = board.setupOrder.slice(0, ids.length);
    const mirror = board.setupOrder.slice(ids.length);
    expect(half[0]).toBe(board.firstPlayer);
    expect([...half].sort((a, b) => a - b)).toEqual(ids);
    expect(mirror).toEqual([...half].reverse());
  });

  test('assigns nine ports to coastal edges', () => {
    const board = new CatanBoard({ seed: 8 });
    const portEdges = Object.values(board.edges).filter(edge => edge.port);

    expect(portEdges).toHaveLength(9);
    expect(portEdges.every(edge => edge.tileIds.length === 1)).toBe(true);
  });

  test('assigns eleven ports on the 5-6 player map', () => {
    const board = new CatanBoard({ seed: 8, rulesetId: 'base-5-6', playerCount: 6 });
    const portEdges = Object.values(board.edges).filter(edge => edge.port);

    expect(portEdges).toHaveLength(11);
    expect(portEdges.every(edge => edge.tileIds.length === 1)).toBe(true);
  });
});

describe('Catan setup', () => {
  test('uses snake setup order and grants second-settlement resources', () => {
    const board = new CatanBoard({ seed: 10 });

    expect(board.currentPlayer).toBe(1);
    placeNextSetupPair(board);
    expect(board.currentPlayer).toBe(2);
    placeNextSetupPair(board);
    expect(board.currentPlayer).toBe(3);
    placeNextSetupPair(board);
    expect(board.currentPlayer).toBe(4);
    placeNextSetupPair(board);

    const before = resourceTotal(board.players[4].resources);
    expect(board.currentPlayer).toBe(4);
    placeNextSetupPair(board);
    expect(resourceTotal(board.players[4].resources)).toBeGreaterThan(before);
    expect(board.currentPlayer).toBe(3);
  });

  test('settlement placement enforces distance rule', () => {
    const board = new CatanBoard({ seed: 11 });
    const vertexId = board.getValidSettlementVertices(1, true)[0];

    expect(board.placeSetupSettlement(vertexId)).toBe(true);
    const adjacentId = board.vertices[vertexId].adjacent[0];

    expect(board.getValidSettlementVertices(1, true)).not.toContain(adjacentId);
  });

  test('5-6 player mode gives every other player a special building phase', () => {
    const board = new CatanBoard({ seed: 12, rulesetId: 'base-5-6', playerCount: 6, skipInitialHistory: true });

    board.phase = 'action';
    board.currentPlayer = 1;
    board.primaryTurnPlayer = 1;

    const specialBuilders = [];
    expect(board.endTurn()).toBe(true);
    while (board.phase === 'paired-action') {
      specialBuilders.push(board.currentPlayer);
      expect(board.endTurn()).toBe(true);
    }

    expect(specialBuilders).toEqual([2, 3, 4, 5, 6]);
    expect(board.phase).toBe('roll');
    expect(board.currentPlayer).toBe(2);
    expect(board.primaryTurnPlayer).toBe(2);
  });
});

describe('Catan production and robber', () => {
  test('dice production pays settlements and cities on matching tiles', () => {
    const board = new CatanBoard({ seed: 12, skipInitialHistory: true });
    const tile = board.tiles.find(t => t.resource !== 'desert' && t.number);
    const settlementVertex = tile.vertices[0];
    const cityVertex = tile.vertices[2];

    board.vertices[settlementVertex].building = { player: 1, type: 'settlement' };
    board.vertices[cityVertex].building = { player: 2, type: 'city' };
    board.players[1].settlements.push(settlementVertex);
    board.players[2].cities.push(cityVertex);
    board.phase = 'roll';
    board.currentPlayer = 1;

    expect(board.rollDice(tile.number)).toBe(true);
    expect(board.players[1].resources[tile.resource]).toBe(1);
    expect(board.players[2].resources[tile.resource]).toBe(2);
  });

  test('robber blocks production and forces players above seven cards to discard', () => {
    const board = new CatanBoard({ seed: 13, skipInitialHistory: true });
    const tile = board.tiles.find(t => t.resource !== 'desert' && t.number);
    const vertexId = tile.vertices[0];

    board.vertices[vertexId].building = { player: 1, type: 'settlement' };
    board.players[1].settlements.push(vertexId);
    giveResources(board, 1, { brick: 8 });
    board.phase = 'roll';
    board.currentPlayer = 1;

    expect(board.rollDice(7)).toBe(true);
    // Discarding is now a real decision, not automatic.
    expect(board.phase).toBe('discard');
    expect(board.currentPlayer).toBe(1);
    expect(board.getLegalMoves()).toEqual([{ type: 'discard', resource: 'brick' }]);

    // Must drop floor(8/2) = 4 cards, one chosen card at a time.
    for (let i = 0; i < 4; i++) {
      expect(board.applyMove({ type: 'discard', resource: 'brick' })).toBe(true);
    }
    expect(resourceTotal(board.players[1].resources)).toBe(4);
    expect(board.phase).toBe('robber');
    expect(board.currentPlayer).toBe(1);
    expect(board.moveRobber(tile.id)).toBe(true);

    const beforeBlockedRoll = board.players[1].resources[tile.resource];
    board.phase = 'roll';
    board.rollDice(tile.number);
    expect(board.players[1].resources[tile.resource]).toBe(beforeBlockedRoll);
  });
});

describe('Catan building and awards', () => {
  test('building consumes resources and upgrades settlements to cities', () => {
    const board = new CatanBoard({ seed: 14, skipInitialHistory: true });
    const vertexId = Object.keys(board.vertices)[0];

    board.phase = 'action';
    board.currentPlayer = 1;
    board.vertices[vertexId].building = { player: 1, type: 'settlement' };
    board.players[1].settlements.push(vertexId);
    giveResources(board, 1, COSTS.city);

    expect(board.buildCity(vertexId)).toBe(true);
    expect(board.players[1].settlements).not.toContain(vertexId);
    expect(board.players[1].cities).toContain(vertexId);
    expect(board.players[1].resources.ore).toBe(0);
    expect(board.players[1].resources.grain).toBe(0);
  });

  test('longest road is awarded at five connected roads', () => {
    const board = new CatanBoard({ seed: 15, skipInitialHistory: true });
    board.phase = 'action';
    board.currentPlayer = 1;

    const startVertex = Object.keys(board.vertices).find(vertexId => board.vertices[vertexId].edgeIds.length >= 2);
    board.vertices[startVertex].building = { player: 1, type: 'settlement' };
    board.players[1].settlements.push(startVertex);

    let current = startVertex;
    for (let i = 0; i < 5; i++) {
      const edgeId = board.vertices[current].edgeIds.find(edge => !board.edges[edge].owner);
      expect(edgeId).toBeTruthy();
      expect(board.buildRoad(edgeId, { free: true })).toBe(true);
      current = board.edges[edgeId].vertices.find(vertexId => vertexId !== current);
    }

    expect(board.longestRoadHolder).toBe(1);
    expect(board.players[1].longestRoad).toBe(true);
  });
});

describe('Catan trade and development cards', () => {
  test('bank trades use ports when the player has a port settlement', () => {
    const board = new CatanBoard({ seed: 18, skipInitialHistory: true });
    const portVertex = Object.values(board.vertices).find(vertex => vertex.port === 'brick');

    board.phase = 'action';
    board.currentPlayer = 1;
    board.vertices[portVertex.id].building = { player: 1, type: 'settlement' };
    board.players[1].settlements.push(portVertex.id);
    giveResources(board, 1, { brick: 2 });

    expect(board.getTradeRatio(1, 'brick')).toBe(2);
    expect(board.tradeWithBank('brick', 'ore')).toBe(true);
    expect(board.players[1].resources.brick).toBe(0);
    expect(board.players[1].resources.ore).toBe(1);
  });

  test('development cards cannot be played until a later turn', () => {
    const board = new CatanBoard({ seed: 19, skipInitialHistory: true });

    board.phase = 'action';
    board.currentPlayer = 1;
    board.devDeck = ['knight'];
    giveResources(board, 1, COSTS.dev);

    expect(board.buyDevelopmentCard()).toBe(true);
    expect(board.players[1].newDevCards.knight).toBe(1);
    expect(board.playKnight()).toBe(false);
    expect(board.endTurn()).toBe(true);

    board.currentPlayer = 1;
    board.phase = 'action';
    expect(board.players[1].devCards.knight).toBe(1);
    expect(board.playKnight()).toBe(true);
    expect(board.phase).toBe('robber');
  });
});

describe('Catan complete action space', () => {
  test('discard lets the player choose which cards to drop', () => {
    const board = new CatanBoard({ seed: 21, skipInitialHistory: true });
    board.phase = 'roll';
    board.currentPlayer = 1;
    giveResources(board, 1, { brick: 5, ore: 3 }); // total 8 -> discard 4

    expect(board.rollDice(7)).toBe(true);
    expect(board.phase).toBe('discard');
    // Choose to dump ore and keep brick.
    for (let i = 0; i < 3; i++) {
      expect(board.applyMove({ type: 'discard', resource: 'ore' })).toBe(true);
    }
    expect(board.applyMove({ type: 'discard', resource: 'brick' })).toBe(true);

    expect(board.players[1].resources.ore).toBe(0);
    expect(board.players[1].resources.brick).toBe(4);
    expect(board.phase).toBe('robber');
    expect(board.currentPlayer).toBe(1);
  });

  test('robber move enumerates a steal option per victim and honors the choice', () => {
    const board = new CatanBoard({ seed: 22, skipInitialHistory: true });
    const tile = board.tiles.find(t => t.resource !== 'desert' && t.id !== board.robberTileId);
    board.vertices[tile.vertices[0]].building = { player: 2, type: 'settlement' };
    board.vertices[tile.vertices[2]].building = { player: 3, type: 'settlement' };
    board.players[2].settlements.push(tile.vertices[0]);
    board.players[3].settlements.push(tile.vertices[2]);
    giveResources(board, 2, { brick: 1 });
    giveResources(board, 3, { ore: 1 });
    board.phase = 'robber';
    board.currentPlayer = 1;
    board.primaryTurnPlayer = 1;

    const victims = board.getLegalMoves()
      .filter(m => m.type === 'move-robber' && m.tileId === tile.id)
      .map(m => m.stealPlayerId)
      .sort();
    expect(victims).toEqual([2, 3]);

    // Steal specifically from player 3.
    expect(board.applyMove({ type: 'move-robber', tileId: tile.id, stealPlayerId: 3 })).toBe(true);
    expect(resourceTotal(board.players[3].resources)).toBe(0);
    expect(board.players[1].resources.ore).toBe(1);
  });

  test('year of plenty enumerates every bank-suppliable resource pair', () => {
    const board = new CatanBoard({ seed: 23, skipInitialHistory: true });
    board.phase = 'action';
    board.currentPlayer = 1;
    board.players[1].devCards.yearOfPlenty = 1;

    const pairs = board.getLegalMoves().filter(m => m.type === 'play-year-of-plenty');
    expect(pairs.length).toBe(15); // 5 singles + 10 distinct pairs, bank has >=2 of each

    expect(board.applyMove({ type: 'play-year-of-plenty', resourceA: 'ore', resourceB: 'grain' })).toBe(true);
    expect(board.players[1].resources.ore).toBe(1);
    expect(board.players[1].resources.grain).toBe(1);
  });

  test('monopoly enumerates one option per resource and collects that resource', () => {
    const board = new CatanBoard({ seed: 24, skipInitialHistory: true });
    board.phase = 'action';
    board.currentPlayer = 1;
    board.players[1].devCards.monopoly = 1;
    giveResources(board, 2, { wool: 3 });
    giveResources(board, 3, { wool: 2 });

    const monos = board.getLegalMoves().filter(m => m.type === 'play-monopoly');
    expect(monos.map(m => m.resource).sort()).toEqual([...RESOURCES].sort());

    expect(board.applyMove({ type: 'play-monopoly', resource: 'wool' })).toBe(true);
    expect(board.players[1].resources.wool).toBe(5);
    expect(board.players[2].resources.wool).toBe(0);
    expect(board.players[3].resources.wool).toBe(0);
  });

  test('bank trades are fully enumerated, not heuristically pruned', () => {
    const board = new CatanBoard({ seed: 25, skipInitialHistory: true });
    board.phase = 'action';
    board.currentPlayer = 1;
    giveResources(board, 1, { brick: 4 });

    const trades = board.getLegalMoves().filter(m => m.type === 'trade');
    expect(trades.length).toBe(4); // 4:1 brick for each of the other four resources
    expect(trades.every(t => t.give === 'brick')).toBe(true);
  });

  test('player-to-player trade transfers multi-resource bundles on accept', () => {
    const board = new CatanBoard({ seed: 26, skipInitialHistory: true });
    board.phase = 'action';
    board.currentPlayer = 1;
    board.primaryTurnPlayer = 1;
    giveResources(board, 1, { brick: 2, lumber: 1 });
    giveResources(board, 2, { ore: 1, grain: 1 });

    expect(board.proposeTrade({ brick: 2 }, { ore: 1, grain: 1 }, [2])).toBe(true);
    expect(board.phase).toBe('trade-response');
    expect(board.currentPlayer).toBe(2);

    expect(board.respondTrade(true)).toBe(true);
    expect(board.phase).toBe('action');
    expect(board.currentPlayer).toBe(1);
    expect(board.players[1].resources.brick).toBe(0);
    expect(board.players[1].resources.ore).toBe(1);
    expect(board.players[1].resources.grain).toBe(1);
    expect(board.players[2].resources.brick).toBe(2);
    expect(board.players[2].resources.ore).toBe(0);
  });

  test('trade offered to multiple opponents goes to the first able accepter', () => {
    const board = new CatanBoard({ seed: 27, skipInitialHistory: true });
    board.phase = 'action';
    board.currentPlayer = 1;
    board.primaryTurnPlayer = 1;
    giveResources(board, 1, { brick: 1 });
    giveResources(board, 3, { ore: 1 }); // player 2 cannot pay, player 3 can

    // Unaffordable targets are filtered out, so player 2 is never asked and the
    // responder is player 3 directly.
    expect(board.proposeTrade({ brick: 1 }, { ore: 1 }, [2, 3])).toBe(true);
    expect(board.phase).toBe('trade-response');
    expect(board.currentPlayer).toBe(3);

    expect(board.respondTrade(true)).toBe(true);
    expect(board.players[1].resources.ore).toBe(1);
    expect(board.players[3].resources.brick).toBe(1);
  });

  test('a fully declined trade returns control to the proposer unchanged', () => {
    const board = new CatanBoard({ seed: 28, skipInitialHistory: true });
    board.phase = 'action';
    board.currentPlayer = 1;
    board.primaryTurnPlayer = 1;
    giveResources(board, 1, { brick: 1 });
    giveResources(board, 2, { ore: 1 }); // both targets can afford, so both are asked
    giveResources(board, 3, { ore: 1 });

    expect(board.proposeTrade({ brick: 1 }, { ore: 1 }, [2, 3])).toBe(true);
    expect(board.respondTrade(false)).toBe(true);
    expect(board.respondTrade(false)).toBe(true);
    expect(board.phase).toBe('action');
    expect(board.currentPlayer).toBe(1);
    expect(board.players[1].resources.brick).toBe(1);
  });

  test('trade proposals are capped per turn to keep the action space finite', () => {
    const board = new CatanBoard({ seed: 29, skipInitialHistory: true });
    board.phase = 'action';
    board.currentPlayer = 1;
    board.primaryTurnPlayer = 1;
    giveResources(board, 1, { brick: 6 });
    giveResources(board, 2, { ore: 1 }); // player 2 can afford, so the proposal is asked

    // Up to maxTradeProposalsPerTurn (4) proposals are allowed.
    for (let i = 0; i < board.maxTradeProposalsPerTurn; i++) {
      expect(board.proposeTrade({ brick: 1 }, { ore: 1 }, [2])).toBe(true);
      expect(board.respondTrade(false)).toBe(true);
    }
    // The next proposal exceeds the per-turn cap.
    expect(board.proposeTrade({ brick: 1 }, { ore: 1 }, [2])).toBe(false);
  });
});

describe('Catan AI', () => {
  test('MCTS returns a legal setup move', async () => {
    const board = new CatanBoard({ seed: 16 });
    const mcts = new MCTS({ maxChildren: 8 });
    const move = await mcts.getBestMove(board, 12);

    expect(move).toBeTruthy();
    expect(board.getLegalMoves().map(m => `${m.type}:${m.vertexId}`)).toContain(`${move.type}:${move.vertexId}`);
    expect(board.applyMove(move)).toBe(true);
  });

  test('low-budget AI self-play reaches a terminal game without illegal moves', async () => {
    const board = new CatanBoard({ seed: 17 });
    const mcts = new MCTS({ maxChildren: 10 });

    // Games legitimately need ~700 moves with the full action space (trades,
    // discards, per-victim robber), so the cap must clear that.
    let moves = 0;
    while (board.phase !== 'game-over' && moves < 1300) {
      const move = await mcts.getBestMove(board, 8);
      expect(move).toBeTruthy();
      expect(board.applyMove(move)).toBe(true);
      moves++;
    }

    expect(board.phase).toBe('game-over');
    expect(board.winner).toBeGreaterThanOrEqual(1);
    expect(moves).toBeLessThan(1300);
  }, 60000);
});
