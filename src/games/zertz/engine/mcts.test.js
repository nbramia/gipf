import ZertzBoard from '../ZertzBoard.js';
import { MCTS, applyMove, evaluatePosition, moveToKey, bestWinDistance, getMoveDestIndex } from './mcts.js';

// Helper to create a board with custom state
function createBoard(setup = {}) {
  const board = new ZertzBoard({ skipInitialHistory: true });

  if (setup.rings) {
    board.rings = new Set(setup.rings);
  }
  if (setup.marbles) {
    board.marbles = { ...setup.marbles };
  }
  if (setup.pool) {
    board.pool = { ...setup.pool };
  }
  if (setup.captures) {
    board.captures = {
      1: { ...setup.captures[1] },
      2: { ...setup.captures[2] },
    };
  }
  if (setup.currentPlayer) {
    board.currentPlayer = setup.currentPlayer;
  }
  if (setup.gamePhase) {
    board.gamePhase = setup.gamePhase;
  }
  if (setup.jumpingMarble) {
    board.jumpingMarble = setup.jumpingMarble;
  }
  if (setup.captureStarted !== undefined) {
    board.captureStarted = setup.captureStarted;
  }

  return board;
}

// ============================================================================
// Forced capture: only one legal move
// ============================================================================

describe('MCTS forced capture', () => {
  test('returns immediately when only one legal move exists', async () => {
    // Set up a board where there's only one possible jump
    const board = createBoard({
      rings: ['0,0', '1,0', '2,0'],
      marbles: { '0,0': 'white', '1,0': 'black' },
      pool: { white: 5, grey: 8, black: 9 },
      captures: {
        1: { white: 0, grey: 0, black: 0 },
        2: { white: 0, grey: 0, black: 0 },
      },
      currentPlayer: 1,
      gamePhase: 'capture',
    });

    const mcts = new MCTS({ evaluationMode: 'heuristic' });
    const move = await mcts.getBestMove(board, 100);

    expect(move).not.toBeNull();
    expect(move.type).toBe('capture');
    expect(move.fromKey).toBe('0,0');
    expect(move.toKey).toBe('2,0');
    expect(move.capturedKey).toBe('1,0');
  });
});

// ============================================================================
// Win-in-one: AI finds winning capture
// ============================================================================

describe('MCTS win detection', () => {
  test('finds winning capture move', async () => {
    // Player 1 has 3 white, needs 1 more for 4-white win
    // A capture of a white marble is available
    const board = createBoard({
      rings: ['0,0', '1,0', '2,0', '0,1', '1,1'],
      marbles: { '0,0': 'black', '1,0': 'white' },
      pool: { white: 2, grey: 8, black: 9 },
      captures: {
        1: { white: 3, grey: 0, black: 0 },
        2: { white: 0, grey: 0, black: 0 },
      },
      currentPlayer: 1,
      gamePhase: 'capture',
    });

    const mcts = new MCTS({ evaluationMode: 'heuristic' });
    const move = await mcts.getBestMove(board, 200);

    expect(move).not.toBeNull();
    expect(move.type).toBe('capture');
    // The capture should jump over the white marble
    expect(move.capturedKey).toBe('1,0');
  });
});

// ============================================================================
// Multi-jump chain: AI follows mandatory continuation
// ============================================================================

describe('MCTS multi-jump', () => {
  test('handles mandatory jump continuation', async () => {
    // Mid-capture: jumpingMarble is set, must continue with same marble
    const board = createBoard({
      rings: ['0,0', '1,0', '2,0', '3,0'],
      marbles: { '0,0': 'white', '1,0': 'black' },
      pool: { white: 5, grey: 8, black: 9 },
      captures: {
        1: { white: 0, grey: 0, black: 0 },
        2: { white: 0, grey: 0, black: 0 },
      },
      currentPlayer: 1,
      gamePhase: 'capture',
      jumpingMarble: '0,0',
      captureStarted: true,
    });

    // Only valid move is to continue jumping with marble at 0,0
    const moves = board.getLegalMoves();
    expect(moves.length).toBe(1);
    expect(moves[0].fromKey).toBe('0,0');

    const mcts = new MCTS({ evaluationMode: 'heuristic' });
    const move = await mcts.getBestMove(board, 50);

    expect(move).not.toBeNull();
    expect(move.fromKey).toBe('0,0');
  });
});

// ============================================================================
// Place + remove compound turn
// ============================================================================

describe('MCTS compound turns', () => {
  test('handles place-marble phase correctly', async () => {
    const board = new ZertzBoard({ skipInitialHistory: true });
    // Fresh board, place-marble phase

    const mcts = new MCTS({ evaluationMode: 'heuristic' });
    const move = await mcts.getBestMove(board, 50);

    expect(move).not.toBeNull();
    expect(move.type).toBe('place-marble');
    expect(['white', 'grey', 'black']).toContain(move.color);
    expect(typeof move.q).toBe('number');
    expect(typeof move.r).toBe('number');
  });

  test('handles remove-ring phase correctly', async () => {
    const board = new ZertzBoard({ skipInitialHistory: true });
    board.selectMarbleColor('black');
    board.placeMarble(0, 0);
    // Now in remove-ring phase

    expect(board.gamePhase).toBe('remove-ring');

    const mcts = new MCTS({ evaluationMode: 'heuristic' });
    const move = await mcts.getBestMove(board, 50);

    expect(move).not.toBeNull();
    expect(move.type).toBe('remove-ring');
    expect(typeof move.q).toBe('number');
    expect(typeof move.r).toBe('number');
  });
});

// ============================================================================
// Heuristic evaluation
// ============================================================================

describe('Heuristic evaluation', () => {
  test('winning position scores +1', () => {
    const board = createBoard({
      rings: ['0,0'],
      marbles: {},
      pool: { white: 0, grey: 0, black: 0 },
      captures: {
        1: { white: 4, grey: 0, black: 0 },
        2: { white: 0, grey: 0, black: 0 },
      },
      currentPlayer: 1,
      gamePhase: 'game-over',
    });
    board.winner = 1;

    expect(evaluatePosition(board, 1)).toBe(1.0);
    expect(evaluatePosition(board, 2)).toBe(-1.0);
  });

  test('even position scores near 0', () => {
    const board = new ZertzBoard({ skipInitialHistory: true });
    const score = evaluatePosition(board, 1);
    expect(Math.abs(score)).toBeLessThan(0.3);
  });

  test('player closer to winning gets higher score', () => {
    const board = createBoard({
      rings: ['0,0', '1,0', '2,0', '0,1', '1,1', '-1,1', '0,-1'],
      marbles: {},
      pool: { white: 3, grey: 5, black: 7 },
      captures: {
        1: { white: 3, grey: 3, black: 3 },
        2: { white: 0, grey: 0, black: 0 },
      },
      currentPlayer: 1,
      gamePhase: 'place-marble',
    });

    // Player 1 is much closer to winning
    const score1 = evaluatePosition(board, 1);
    const score2 = evaluatePosition(board, 2);
    expect(score1).toBeGreaterThan(score2);
  });
});

// ============================================================================
// Win distance calculation
// ============================================================================

describe('Win distance', () => {
  test('bestWinDistance returns 0 when condition met', () => {
    const caps = { white: 4, grey: 5, black: 6 };
    expect(bestWinDistance(caps)).toBe(0);
  });

  test('bestWinDistance returns minimum across conditions', () => {
    const caps = { white: 3, grey: 0, black: 0 };
    // Closest: 4 white needs 1 more -> distance 1
    expect(bestWinDistance(caps)).toBe(1);
  });
});

// ============================================================================
// Move key serialization
// ============================================================================

describe('moveToKey', () => {
  test('place-marble move key', () => {
    const key = moveToKey({ type: 'place-marble', color: 'white', q: 0, r: 0 });
    expect(key).toBe('p:white:0,0');
  });

  test('remove-ring move key', () => {
    const key = moveToKey({ type: 'remove-ring', q: 3, r: 0 });
    expect(key).toBe('r:3,0');
  });

  test('capture move key', () => {
    const key = moveToKey({ type: 'capture', fromKey: '0,0', toKey: '2,0', capturedKey: '1,0' });
    expect(key).toBe('c:0,0>2,0');
  });
});

// ============================================================================
// applyMove
// ============================================================================

describe('applyMove', () => {
  test('applies place-marble correctly', () => {
    const board = new ZertzBoard({ skipInitialHistory: true });
    applyMove(board, { type: 'place-marble', color: 'black', q: 0, r: 0 });
    expect(board.marbles['0,0']).toBe('black');
    expect(board.gamePhase).toBe('remove-ring');
  });

  test('applies remove-ring correctly', () => {
    const board = new ZertzBoard({ skipInitialHistory: true });
    board.selectMarbleColor('black');
    board.placeMarble(0, 0);
    const freeRings = board.getFreeRings();
    const [q, r] = board._fromKey(freeRings[0]);

    applyMove(board, { type: 'remove-ring', q, r });
    expect(board.rings.has(freeRings[0])).toBe(false);
    expect(board.currentPlayer).toBe(2);
  });

  test('applies capture correctly', () => {
    const board = createBoard({
      rings: ['0,0', '1,0', '2,0'],
      marbles: { '0,0': 'white', '1,0': 'black' },
      pool: { white: 5, grey: 8, black: 9 },
      captures: {
        1: { white: 0, grey: 0, black: 0 },
        2: { white: 0, grey: 0, black: 0 },
      },
      currentPlayer: 1,
      gamePhase: 'capture',
    });

    applyMove(board, { type: 'capture', fromKey: '0,0', toKey: '2,0', capturedKey: '1,0' });
    expect(board.marbles['2,0']).toBe('white');
    expect(board.marbles['1,0']).toBeUndefined();
    expect(board.captures[1].black).toBe(1);
  });
});

describe('Limited-budget search and exploration', () => {
  afterEach(() => jest.restoreAllMocks());

  const network = policy => ({
    isLoaded: () => true,
    evaluatePositionWithPolicy: jest.fn(async () => ({ value: 0, policy })),
  });

  test.each(['heuristic', 'nn'])('%s: evaluations determine the choice among 100 of 111 opening actions', async evaluationMode => {
    jest.spyOn(Math, 'random').mockReturnValue(0);
    const board = createBoard();
    const legal = board.getLegalMoves();
    expect(legal).toHaveLength(111);
    const engine = new MCTS({ evaluationMode, valueNetwork: network(null), maxTableSize: 0 });
    const evaluate = jest.spyOn(engine, evaluationMode === 'nn' ? '_evaluateLeaf' : '_simulate');

    // Both targets appear late in the same deterministic expansion order.
    // Changing only their values must change the final recommendation.
    for (const target of [legal[70], legal[90]]) {
      evaluate.mockImplementation(position =>
        position.marbles[`${target.q},${target.r}`] === target.color ? 0.9 : -0.4);
      const move = await engine.getBestMove(board, 100);
      expect(moveToKey(move)).toBe(moveToKey(target));
      expect(Object.keys(move._rootVisits)).toHaveLength(100);
      expect(Object.values(move._rootVisits).every(visits => visits === 1)).toBe(true);
      expect(moveToKey(move)).not.toBe(Object.keys(move._rootVisits)[0]);
    }
    expect(board.marbles).toEqual({});
  });

  test('equal visits and values use a stable move key, not first expansion', async () => {
    jest.spyOn(Math, 'random').mockReturnValue(0);
    const board = createBoard();
    const legal = board.getLegalMoves();
    const engine = new MCTS({ maxTableSize: 0 });
    jest.spyOn(engine, '_simulate').mockReturnValue(0);
    const getMoves = ZertzBoard.prototype.getLegalMoves;
    for (const reverse of [false, true]) {
      jest.spyOn(ZertzBoard.prototype, 'getLegalMoves').mockImplementation(function () {
        const moves = getMoves.call(this);
        return reverse ? moves.reverse() : moves;
      });
      const move = await engine.getBestMove(board, 111);
      expect(moveToKey(move)).toBe(legal.map(moveToKey).sort()[0]);
    }
  });

  test('root policy orders limited-budget expansion without pruning legal actions', async () => {
    // Constant 0.5 is also safe for the root Dirichlet sampler and gives equal
    // noise to every action, so only the controlled logits distinguish priors.
    jest.spyOn(Math, 'random').mockReturnValue(0.5);
    const board = createBoard();
    const legal = board.getLegalMoves();
    const policy = new Array(49).fill(-20);
    policy[getMoveDestIndex({ type: 'place-marble', q: 0, r: 0 })] = 20;
    const engine = new MCTS({ evaluationMode: 'nn', valueNetwork: network(policy), maxTableSize: 0 });
    jest.spyOn(engine, '_evaluateLeaf').mockResolvedValue(0);
    const move = await engine.getBestMove(board, 3);
    expect(Object.keys(move._rootVisits).sort()).toEqual(
      legal.filter(m => m.q === 0 && m.r === 0).map(moveToKey).sort());
    expect(legal.map(moveToKey)).toContain(moveToKey(move));

    const expanded = await engine.getBestMove(board, 111);
    expect(Object.keys(expanded._rootVisits).sort()).toEqual(legal.map(moveToKey).sort());
    // With equal visits and values, policy is the next final-choice tie break.
    expect(expanded.q).toBe(0);
    expect(expanded.r).toBe(0);
    expect(engine.rootPriors.size).toBe(111);
    expect([...engine.rootPriors.values()].reduce((sum, prior) => sum + prior, 0)).toBeCloseTo(1);
  });

  async function searchRoot(engine, board = createBoard()) {
    let root;
    const select = engine._select.bind(engine);
    const spy = jest.spyOn(engine, '_select').mockImplementation(node => {
      root = node;
      return select(node);
    });
    await engine.getBestMove(board, 1);
    spy.mockRestore();
    return root;
  }

  test('policy-mode descendants use UCB exploration when their priors are unavailable', async () => {
    jest.spyOn(Math, 'random').mockReturnValue(0.5);
    const engine = new MCTS({ evaluationMode: 'nn', valueNetwork: network(new Array(49).fill(0)), maxTableSize: 0 });
    jest.spyOn(engine, '_evaluateLeaf').mockResolvedValue(0);
    const root = await searchRoot(engine);
    const parent = [...root.children.values()][0];
    const frequent = engine._expand(parent);
    const rare = engine._expand(parent);
    parent.visits = 20;
    frequent.visits = 19;
    frequent.wins = 19 * 0.6;
    rare.visits = 1;
    rare.wins = 0.5;
    engine.qMin = 0;
    engine.qMax = 1;
    expect(engine.usePUCT).toBe(true);
    expect(frequent.prior).toBe(0);
    expect(rare.prior).toBe(0);
    // Zero-prior PUCT would greedily prefer 0.6 over 0.5 forever.
    expect(frequent.puct(parent.visits)).toBeGreaterThan(rare.puct(parent.visits));
    expect(rare.ucb1(parent.visits)).toBeGreaterThan(rare.wins / rare.visits);
    expect(parent.selectChild()).toBe(rare);
    parent.untriedMoves = [];
    expect(engine._select(parent)).toBe(rare);
  });

  test.each([1, 2])('placement/removal backup uses the deciding player (root P%i)', async rootPlayer => {
    jest.spyOn(Math, 'random').mockReturnValue(0);
    const engine = new MCTS({ maxTableSize: 0 });
    jest.spyOn(engine, '_simulate').mockReturnValue(0);
    const example = await searchRoot(engine);
    const root = new example.constructor(createBoard({ currentPlayer: rootPlayer }), null, null, engine);
    const placed = engine._expand(root);
    expect(placed.board.gamePhase).toBe('remove-ring');
    expect(placed.board.currentPlayer).toBe(rootPlayer);
    const removed = engine._expand(placed);
    expect(removed.board.currentPlayer).toBe(3 - rootPlayer);
    const opponentPlaced = engine._expand(removed);
    engine._backpropagate(opponentPlaced, 0.8, rootPlayer);
    expect(root.wins).toBeCloseTo(0.9);
    expect(placed.wins).toBeCloseTo(0.9);
    expect(removed.wins).toBeCloseTo(0.9);
    expect(opponentPlaced.wins).toBeCloseTo(0.1);
  });

  test('capture-chain backup does not flip between mandatory jumps', async () => {
    jest.spyOn(Math, 'random').mockReturnValue(0);
    const engine = new MCTS({ maxTableSize: 0 });
    jest.spyOn(engine, '_simulate').mockReturnValue(0);
    const example = await searchRoot(engine);
    const board = createBoard({
      rings: ['-2,0', '-1,0', '0,0', '1,0', '2,0'],
      marbles: { '-2,0': 'white', '-1,0': 'black', '1,0': 'grey' },
      gamePhase: 'capture', currentPlayer: 2,
    });
    const root = new example.constructor(board, null, null, engine);
    const firstJump = engine._expand(root);
    expect(firstJump.board.currentPlayer).toBe(2);
    expect(firstJump.board.jumpingMarble).toBe('0,0');
    const secondJump = engine._expand(firstJump);
    expect(secondJump.board.currentPlayer).toBe(1);
    engine._backpropagate(secondJump, 0.8, 2);
    expect(firstJump.wins).toBeCloseTo(0.9);
    expect(secondJump.wins).toBeCloseTo(0.9);
  });
});
