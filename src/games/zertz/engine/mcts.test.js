import ZertzBoard from '../ZertzBoard.js';
import { MCTS, applyMove, evaluatePosition, moveToKey, bestWinDistance } from './mcts.js';

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
