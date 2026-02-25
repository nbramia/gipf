// YinshBoard.test.js
// Comprehensive test suite for Yinsh game logic

import YinshBoard from './YinshBoard.js';
import {
  createEmptyBoard,
  createBoardWithSetup,
  createBoardWithPieces,
  placeRings,
  placeMarkers,
  simulateMove,
  createRowScenario,
  verifyBoardState,
  countPieces,
  getPieces,
  isOccupied,
  getPieceAt,
  createComplexRowScenario
} from './testHelpers.js';

describe('YinshBoard - Initialization', () => {
  test('creates empty board in setup phase', () => {
    const board = createEmptyBoard();
    expect(board.gamePhase).toBe('setup');
    expect(board.currentPlayer).toBe(1);
    expect(Object.keys(board.boardState).length).toBe(0);
  });

  test('initializes with correct ring counts', () => {
    const board = createEmptyBoard();
    expect(board.ringsPlaced[1]).toBe(0);
    expect(board.ringsPlaced[2]).toBe(0);
  });

  test('initializes with correct scores', () => {
    const board = createEmptyBoard();
    expect(board.scores[1]).toBe(0);
    expect(board.scores[2]).toBe(0);
  });

  test('random setup creates playable board', () => {
    const board = new YinshBoard({ useRandomSetup: true });
    expect(board.gamePhase).toBe('play');
    expect(board.ringsPlaced[1]).toBe(YinshBoard.RINGS_PER_PLAYER);
    expect(board.ringsPlaced[2]).toBe(YinshBoard.RINGS_PER_PLAYER);
    expect(countPieces(board, 'ring')).toBe(10);
  });
});

describe('YinshBoard - Constants', () => {
  test('has correct game constants', () => {
    expect(YinshBoard.RINGS_PER_PLAYER).toBe(5);
    expect(YinshBoard.MARKERS_IN_ROW).toBe(5);
    expect(YinshBoard.RINGS_TO_WIN).toBe(3);
  });

  test('has 6 directions defined', () => {
    expect(YinshBoard.DIRECTIONS).toHaveLength(6);
  });
});

describe('YinshBoard - Helper Methods', () => {
  let board;

  beforeEach(() => {
    board = createEmptyBoard();
  });

  test('_toKey converts coordinates to string', () => {
    expect(board._toKey(0, 0)).toBe('0,0');
    expect(board._toKey(-5, 3)).toBe('-5,3');
    expect(board._toKey(4, -2)).toBe('4,-2');
  });

  test('_fromKey converts string to coordinates', () => {
    expect(board._fromKey('0,0')).toEqual([0, 0]);
    expect(board._fromKey('-5,3')).toEqual([-5, 3]);
    expect(board._fromKey('4,-2')).toEqual([4, -2]);
  });

  test('_isInBounds validates board boundaries', () => {
    // Valid positions
    expect(board._isInBounds(0, 0)).toBe(true);
    expect(board._isInBounds(3, 2)).toBe(true);
    expect(board._isInBounds(-3, -2)).toBe(true);

    // Out of bounds
    expect(board._isInBounds(6, 0)).toBe(false);
    expect(board._isInBounds(-6, 0)).toBe(false);
    expect(board._isInBounds(0, 6)).toBe(false);

    // Corner exclusions
    expect(board._isInBounds(-5, -5)).toBe(false);
    expect(board._isInBounds(5, 5)).toBe(false);
    expect(board._isInBounds(0, -5)).toBe(false);
    expect(board._isInBounds(0, 5)).toBe(false);
  });
});

describe('YinshBoard - Grid Generation', () => {
  test('generateGridPoints returns correct number of points', () => {
    const points = YinshBoard.generateGridPoints();
    // Hexagonal grid from -5 to 5 with 8 corner exclusions
    expect(points.length).toBe(85); // Valid intersection points on Yinsh board
  });

  test('generateGridPoints excludes corner positions', () => {
    const points = YinshBoard.generateGridPoints();
    const excluded = [
      [-5, -5], [5, -5], [-5, 5], [5, 5],
      [0, -5], [0, 5], [-5, 0], [5, 0]
    ];

    excluded.forEach(([q, r]) => {
      const found = points.some(([pq, pr]) => pq === q && pr === r);
      expect(found).toBe(false);
    });
  });
});

describe('YinshBoard - Setup Phase', () => {
  let board;

  beforeEach(() => {
    board = createEmptyBoard();
  });

  test('allows placing first ring when setup ring selected', () => {
    board.selectedSetupRing = { player: 1, index: 0 };
    board.handleClick(0, 0);

    expect(isOccupied(board, 0, 0)).toBe(true);
    expect(getPieceAt(board, 0, 0)).toEqual({ type: 'ring', player: 1 });
    expect(board.ringsPlaced[1]).toBe(1);
  });

  test('alternates players during setup', () => {
    board.selectedSetupRing = { player: 1, index: 0 };
    board.handleClick(0, 0);
    expect(board.currentPlayer).toBe(2);

    board.selectedSetupRing = { player: 2, index: 0 };
    board.handleClick(1, 0);
    expect(board.currentPlayer).toBe(1);
  });

  test('transitions to play phase after 10 rings placed', () => {
    // Place 5 rings for each player
    for (let i = 0; i < YinshBoard.RINGS_PER_PLAYER; i++) {
      board.selectedSetupRing = { player: 1, index: i };
      board.handleClick(i, 0);

      board.selectedSetupRing = { player: 2, index: i };
      board.handleClick(i, 1);
    }

    expect(board.gamePhase).toBe('play');
    expect(board.currentPlayer).toBe(1);
  });

  test('prevents placing ring on occupied space', () => {
    board.selectedSetupRing = { player: 1, index: 0 };
    board.handleClick(0, 0);

    board.selectedSetupRing = { player: 2, index: 0 };
    board.handleClick(0, 0); // Try to place on same spot

    // Should still only have 1 ring
    expect(countPieces(board, 'ring')).toBe(1);
  });
});

describe('YinshBoard - Valid Move Calculation', () => {
  let board;

  beforeEach(() => {
    board = createBoardWithSetup([
      { player: 1, positions: [[0, 0], [2, 0], [0, 2]] },
      { player: 2, positions: [[1, 0], [0, 1], [3, 3]] }
    ]);
  });

  test('returns empty array for non-existent ring', () => {
    const moves = board.calculateValidMoves(5, 5);
    expect(moves).toEqual([]);
  });

  test('returns empty array for marker position', () => {
    placeMarkers(board, [[1, 1]], 1);
    const moves = board.calculateValidMoves(1, 1);
    expect(moves).toEqual([]);
  });

  test('calculates moves in all 6 directions for unobstructed ring', () => {
    const moves = board.calculateValidMoves(0, 0);
    expect(moves.length).toBeGreaterThan(0);
  });

  test('ring cannot jump over other rings', () => {
    // Ring at (0,0), another ring at (1,0)
    const moves = board.calculateValidMoves(0, 0);

    // Should not be able to move to (2,0) or beyond in that direction
    // since there's a ring at (1,0)
    const hasMoveBeyondRing = moves.some(([q, r]) => q > 1 && r === 0);
    expect(hasMoveBeyondRing).toBe(false);
  });

  test('ring can move to empty spaces without markers', () => {
    const moves = board.calculateValidMoves(0, 2);
    expect(moves.length).toBeGreaterThan(0);
    // Verify all moves are to valid board positions
    moves.forEach(([q, r]) => {
      expect(board._isInBounds(q, r)).toBe(true);
    });
  });
});

describe('YinshBoard - Marker Placement and Flipping', () => {
  let board;

  beforeEach(() => {
    board = createBoardWithSetup([
      { player: 1, positions: [[0, 0], [-2, 0]] },
      { player: 2, positions: [[0, 1], [0, -1]] }
    ]);
    // Manually set to play phase since we have fewer than 10 rings
    board.gamePhase = 'play';
    board.currentPlayer = 1;
  });

  test('places marker at ring starting position after move', () => {
    board.selectedRing = [0, 0];
    board.validMoves = [[3, 0]];
    board.handleClick(3, 0);

    const piece = getPieceAt(board, 0, 0);
    expect(piece).toBeTruthy();
    expect(piece.type).toBe('marker');
    expect(piece.player).toBe(1);
  });

  test('moves ring to destination', () => {
    board.selectedRing = [0, 0];
    board.validMoves = [[3, 0]];
    board.handleClick(3, 0);

    const piece = getPieceAt(board, 3, 0);
    expect(piece).toBeTruthy();
    expect(piece.type).toBe('ring');
    expect(piece.player).toBe(1);
  });

  test('flips markers when jumping over them', () => {
    // Place markers between two positions
    placeMarkers(board, [[1, 0], [2, 0]], 2);

    // Move ring from (0,0) to (3,0), jumping over markers
    board.selectedRing = [0, 0];
    board.validMoves = [[3, 0]];
    board.handleClick(3, 0);

    // Markers should be flipped to player 1
    expect(getPieceAt(board, 1, 0).player).toBe(1);
    expect(getPieceAt(board, 2, 0).player).toBe(1);
  });
});

describe('YinshBoard - Row Detection', () => {
  test('detects horizontal row of exactly 5 markers', () => {
    const board = createRowScenario(1, [0, 0], [1, 0], 5);
    const rows = board.checkForRows();

    expect(rows.length).toBeGreaterThan(0);
    expect(rows[0].player).toBe(1);
    expect(rows[0].markers).toHaveLength(YinshBoard.MARKERS_IN_ROW);
  });

  test('detects diagonal row', () => {
    const board = createRowScenario(2, [0, 0], [1, -1], 5);
    const rows = board.checkForRows();

    expect(rows.length).toBeGreaterThan(0);
    expect(rows[0].player).toBe(2);
    expect(rows[0].markers).toHaveLength(YinshBoard.MARKERS_IN_ROW);
  });

  test('returns empty for row of 4 markers', () => {
    const board = createRowScenario(1, [0, 0], [1, 0], 4);
    const rows = board.checkForRows();

    expect(rows).toEqual([]);
  });

  test('detects row of 6 markers', () => {
    const board = createRowScenario(1, [0, 0], [1, 0], 6);
    const rows = board.checkForRows();

    // Should detect at least one row (the first 5 markers)
    expect(rows.length).toBeGreaterThan(0);
    expect(rows[0].markers).toHaveLength(YinshBoard.MARKERS_IN_ROW);
  });

  test('does not detect row with mixed player markers', () => {
    const board = createEmptyBoard();
    board.gamePhase = 'play';

    // Create a line with mixed players
    placeMarkers(board, [[0, 0], [1, 0], [2, 0]], 1);
    placeMarkers(board, [[3, 0], [4, 0]], 2);

    const rows = board.checkForRows();
    expect(rows).toEqual([]);
  });
});

describe('YinshBoard - Win Condition', () => {
  test('detects player 1 win', () => {
    const board = createEmptyBoard();
    board.scores[1] = YinshBoard.RINGS_TO_WIN;

    expect(board.isGameOver()).toBe(1);
  });

  test('detects player 2 win', () => {
    const board = createEmptyBoard();
    board.scores[2] = YinshBoard.RINGS_TO_WIN;

    expect(board.isGameOver()).toBe(2);
  });

  test('returns null when game not over', () => {
    const board = createEmptyBoard();
    board.scores[1] = 2;
    board.scores[2] = 1;

    expect(board.isGameOver()).toBeNull();
  });
});

describe('YinshBoard - Clone Method', () => {
  test('creates independent copy of board', () => {
    const board1 = createBoardWithSetup([
      { player: 1, positions: [[0, 0], [1, 1]] }
    ]);

    const board2 = board1.clone();

    // Modify board2
    board2.boardState[board2._toKey(2, 2)] = { type: 'ring', player: 2 };

    // board1 should be unchanged
    expect(getPieceAt(board1, 2, 2)).toBeNull();
    expect(getPieceAt(board2, 2, 2)).toBeTruthy();
  });

  test('clones all game state', () => {
    const board1 = createEmptyBoard();
    board1.gamePhase = 'play';
    board1.currentPlayer = 2;
    board1.scores[1] = 1;
    board1.selectedRing = [0, 0];

    const board2 = board1.clone();

    expect(board2.gamePhase).toBe('play');
    expect(board2.currentPlayer).toBe(2);
    expect(board2.scores[1]).toBe(1);
    expect(board2.selectedRing).toEqual([0, 0]);
  });
});

describe('YinshBoard - Remove Markers and Rings', () => {
  test('removeMarkers removes specified markers from board', () => {
    const board = createEmptyBoard();
    placeMarkers(board, [[0, 0], [1, 0], [2, 0]], 1);

    board.removeMarkers([[0, 0], [1, 0]]);

    expect(getPieceAt(board, 0, 0)).toBeNull();
    expect(getPieceAt(board, 1, 0)).toBeNull();
    expect(getPieceAt(board, 2, 0)).toBeTruthy();
  });

  test('removeRing removes ring and increments score', () => {
    const board = createBoardWithSetup([
      { player: 1, positions: [[0, 0]] }
    ]);

    board.removeRing(0, 0);

    expect(getPieceAt(board, 0, 0)).toBeNull();
    expect(board.scores[1]).toBe(1);
  });
});

describe('YinshBoard - Edge Cases & Row Resolution', () => {
  test('multiple rows for same player - resolves all rows before ring removal', () => {
    const board = createEmptyBoard();
    board.gamePhase = 'play';
    board.currentPlayer = 1;

    // Create two separate horizontal rows for player 1
    placeMarkers(board, [[0, 0], [1, 0], [2, 0], [3, 0], [4, 0]], 1); // Row 1
    placeMarkers(board, [[0, 2], [1, 2], [2, 2], [3, 2], [4, 2]], 1); // Row 2

    // Add some rings
    placeRings(board, [
      { player: 1, positions: [[-1, -1], [-2, -2]] },
      { player: 2, positions: [[3, 3], [4, 4]] }
    ]);

    const rows = board.checkForRows();
    expect(rows.length).toBe(2); // Should detect both rows

    // Set up row resolution queue like the play phase would
    board.rowResolutionQueue = [
      { player: 1, rows: rows }
    ];
    board.nextTurnPlayer = 2;
    board._startNextRowResolution();

    // Should be in remove-row phase with both rows available
    expect(board.gamePhase).toBe('remove-row');
    expect(board.rows.length).toBe(2);

    // Remove first row by clicking a marker
    board.handleClick(0, 0);

    // After removing first row, second row is detected and must be resolved
    // So we stay in remove-row phase for the second row
    expect(board.gamePhase).toBe('remove-row');

    // Remove second row
    board.handleClick(0, 2);

    // NOW we should be in remove-ring phase
    expect(board.gamePhase).toBe('remove-ring');
  });

  test('both players have rows - active player resolves first', () => {
    const board = createEmptyBoard();
    board.gamePhase = 'play';
    board.currentPlayer = 1;
    board.nextTurnPlayer = 2;

    // Create row for player 1
    placeMarkers(board, [[0, 0], [1, 0], [2, 0], [3, 0], [4, 0]], 1);
    // Create row for player 2
    placeMarkers(board, [[0, 1], [1, 1], [2, 1], [3, 1], [4, 1]], 2);

    // Add rings
    placeRings(board, [
      { player: 1, positions: [[-1, -1]] },
      { player: 2, positions: [[-2, -2]] }
    ]);

    const rows = board.checkForRows();
    const player1Rows = rows.filter(r => r.player === 1);
    const player2Rows = rows.filter(r => r.player === 2);

    expect(player1Rows.length).toBeGreaterThan(0);
    expect(player2Rows.length).toBeGreaterThan(0);

    // Build queue like the play phase would
    board.rowResolutionQueue = [
      { player: 1, rows: player1Rows },
      { player: 2, rows: player2Rows }
    ];

    board._startNextRowResolution();

    // First resolution should be for player 1
    expect(board.currentPlayer).toBe(1);
    expect(board.gamePhase).toBe('remove-row');
  });

  test('row of 6 markers returns 2 possible row selections', () => {
    const board = createRowScenario(1, [0, 0], [1, 0], 6);
    const rows = board.checkForRows();

    // Row of 6 should give 2 possible 5-marker subsets
    expect(rows.length).toBe(2);
    expect(rows[0].markers).toHaveLength(5);
    expect(rows[1].markers).toHaveLength(5);
  });

  test('row of 7 markers returns 3 possible row selections', () => {
    const board = createRowScenario(1, [0, 0], [1, 0], 7);
    const rows = board.checkForRows();

    // Row of 7 should give 3 possible 5-marker subsets
    expect(rows.length).toBe(3);
    rows.forEach(row => {
      expect(row.markers).toHaveLength(5);
    });
  });

  test('overlapping rows are detected separately', () => {
    const board = createComplexRowScenario();
    const rows = board.checkForRows();

    // Should detect the horizontal row
    const horizontalRows = rows.filter(row =>
      row.markers.every(([q, r]) => r === 0)
    );
    expect(horizontalRows.length).toBeGreaterThan(0);
  });
});

describe('Test Helpers', () => {
  test('countPieces counts correctly', () => {
    const board = createBoardWithSetup([
      { player: 1, positions: [[0, 0], [1, 1]] },
      { player: 2, positions: [[2, 2], [3, 3]] }
    ]);

    expect(countPieces(board, 'ring')).toBe(4);
    expect(countPieces(board, 'ring', 1)).toBe(2);
    expect(countPieces(board, 'marker')).toBe(0);
  });

  test('getPieces returns all pieces of type', () => {
    const board = createBoardWithPieces([
      { q: 0, r: 0, type: 'ring', player: 1 },
      { q: 1, r: 0, type: 'marker', player: 2 }
    ]);

    const rings = getPieces(board, 'ring');
    expect(rings).toHaveLength(1);
    expect(rings[0]).toEqual({ q: 0, r: 0, player: 1 });
  });

  test('verifyBoardState validates board state', () => {
    const board = createEmptyBoard();
    board.gamePhase = 'setup';
    board.currentPlayer = 1;

    expect(() => {
      verifyBoardState(board, { phase: 'setup', currentPlayer: 1 });
    }).not.toThrow();

    expect(() => {
      verifyBoardState(board, { phase: 'play' });
    }).toThrow();
  });
});

describe('YinshBoard - Undo/Redo Functionality', () => {
  test('initial state has no undo/redo available', () => {
    const board = createEmptyBoard();
    expect(board.canUndo()).toBe(false);
    expect(board.canRedo()).toBe(false);
  });

  test('undo/redo disabled before first move', () => {
    const board = createEmptyBoard();
    expect(board.undo()).toBe(false);
    expect(board.redo()).toBe(false);
  });

  test('undo setup ring placement', () => {
    const board = createEmptyBoard();

    // Place a ring
    board.handleSetupRingClick(1, 0);
    board.handleClick(0, 0);

    expect(countPieces(board, 'ring')).toBe(1);
    expect(board.canUndo()).toBe(true);

    // Undo
    const success = board.undo();
    expect(success).toBe(true);
    expect(countPieces(board, 'ring')).toBe(0);
    expect(board.gamePhase).toBe('setup');
    expect(board.currentPlayer).toBe(1);
  });

  test('redo setup ring placement', () => {
    const board = createEmptyBoard();

    board.handleSetupRingClick(1, 0);
    board.handleClick(0, 0);
    board.undo();

    expect(board.canRedo()).toBe(true);
    const success = board.redo();
    expect(success).toBe(true);
    expect(countPieces(board, 'ring')).toBe(1);
    expect(getPieceAt(board, 0, 0).type).toBe('ring');
  });

  test('undo/redo multiple setup moves', () => {
    const board = createEmptyBoard();

    // Place rings alternating
    board.handleSetupRingClick(1, 0);
    board.handleClick(0, 0);
    board.handleSetupRingClick(2, 0);
    board.handleClick(1, 0);
    board.handleSetupRingClick(1, 1);
    board.handleClick(2, 0);

    expect(countPieces(board, 'ring')).toBe(3);

    // Undo all 3 moves
    board.undo();
    expect(countPieces(board, 'ring')).toBe(2);
    board.undo();
    expect(countPieces(board, 'ring')).toBe(1);
    board.undo();
    expect(countPieces(board, 'ring')).toBe(0);

    // Redo all 3 moves
    board.redo();
    expect(countPieces(board, 'ring')).toBe(1);
    board.redo();
    expect(countPieces(board, 'ring')).toBe(2);
    board.redo();
    expect(countPieces(board, 'ring')).toBe(3);
  });

  test('undo ring move in play phase', () => {
    const board = createBoardWithSetup([
      { player: 1, positions: [[0, 0], [0, 2], [0, 4], [-2, 0], [-4, 0]] },
      { player: 2, positions: [[0, 1], [0, 3], [0, -1], [2, 0], [4, 0]] }
    ]);

    // Make a move
    board.handleClick(0, 0);  // Select ring
    const validMoves = board.getValidMoves();
    expect(validMoves.length).toBeGreaterThan(0);

    // Pick the first valid move
    const [destQ, destR] = validMoves[0];
    board.handleClick(destQ, destR);  // Move ring

    expect(getPieceAt(board, destQ, destR).type).toBe('ring');
    expect(getPieceAt(board, 0, 0).type).toBe('marker');

    // Undo
    board.undo();
    expect(getPieceAt(board, 0, 0).type).toBe('ring');
    expect(getPieceAt(board, destQ, destR)).toBe(null);
    expect(board.currentPlayer).toBe(1);
  });

  test('undo preserves game phase', () => {
    const board = createBoardWithSetup([
      { player: 1, positions: [[0, 0], [0, 2], [0, 4], [-2, 0], [-4, 0]] },
      { player: 2, positions: [[0, 1], [0, 3], [0, -1], [2, 0], [4, 0]] }
    ]);

    const initialPhase = board.gamePhase;
    board.handleClick(0, 0);
    board.handleClick(3, 0);

    board.undo();
    expect(board.gamePhase).toBe(initialPhase);
  });

  test('undo limit history to max length', () => {
    const board = createEmptyBoard();
    board.maxHistoryLength = 5;

    // Place 7 rings (exceeds max history of 5)
    for (let i = 0; i < 7; i++) {
      board.handleSetupRingClick(i % 2 + 1, 0);
      board.handleClick(i, 0);
    }

    const historyPos = board.getHistoryPosition();
    expect(historyPos.total).toBeLessThanOrEqual(5);
  });

  test('undo clears redo history when new move made', () => {
    const board = createEmptyBoard();

    // Make 3 moves
    board.handleSetupRingClick(1, 0);
    board.handleClick(0, 0);
    expect(board.currentPlayer).toBe(2);

    board.handleSetupRingClick(2, 0);
    board.handleClick(1, 0);
    expect(board.currentPlayer).toBe(1);

    board.handleSetupRingClick(1, 1);
    board.handleClick(2, 0);
    expect(board.currentPlayer).toBe(2);

    // Undo twice (back to after first move)
    board.undo();
    expect(board.currentPlayer).toBe(1);
    board.undo();
    expect(board.currentPlayer).toBe(2);
    expect(board.canRedo()).toBe(true);

    // Make a new move (player 2's turn)
    board.handleSetupRingClick(2, 0);
    board.handleClick(3, 0);

    // Redo should now be disabled
    expect(board.canRedo()).toBe(false);
  });

  test('clearHistory removes all history', () => {
    const board = createEmptyBoard();

    board.handleSetupRingClick(1, 0);
    board.handleClick(0, 0);
    board.handleSetupRingClick(2, 0);
    board.handleClick(1, 0);

    expect(board.canUndo()).toBe(true);

    board.clearHistory();
    expect(board.canUndo()).toBe(false);
    expect(board.canRedo()).toBe(false);
    expect(board.getHistoryPosition().current).toBe(0);
    expect(board.getHistoryPosition().total).toBe(0);
  });

  test('startNewGame clears history', () => {
    const board = createEmptyBoard();

    board.handleSetupRingClick(1, 0);
    board.handleClick(0, 0);

    expect(board.canUndo()).toBe(true);

    board.startNewGame();
    expect(board.canUndo()).toBe(false);
  });

  test('undo restores player turn correctly', () => {
    const board = createEmptyBoard();

    board.handleSetupRingClick(1, 0);
    board.handleClick(0, 0);  // Player 1 moves
    expect(board.currentPlayer).toBe(2);

    board.handleSetupRingClick(2, 0);
    board.handleClick(1, 0);  // Player 2 moves
    expect(board.currentPlayer).toBe(1);

    // Undo Player 2's move
    board.undo();
    expect(board.currentPlayer).toBe(2);

    // Undo Player 1's move
    board.undo();
    expect(board.currentPlayer).toBe(1);
  });

  test('undo restores notation correctly', () => {
    const board = createEmptyBoard();

    board.handleSetupRingClick(1, 0);
    board.handleClick(0, 0);

    const movesAfter = board.getMoveHistory().length;
    expect(movesAfter).toBe(1);

    board.undo();
    const movesAfterUndo = board.getMoveHistory().length;
    expect(movesAfterUndo).toBe(0);

    board.redo();
    const movesAfterRedo = board.getMoveHistory().length;
    expect(movesAfterRedo).toBe(1);
  });

  test('getHistoryPosition returns correct values', () => {
    const board = createEmptyBoard();

    let pos = board.getHistoryPosition();
    expect(pos.current).toBe(1);  // Initial state is captured
    expect(pos.total).toBe(1);

    board.handleSetupRingClick(1, 0);
    board.handleClick(0, 0);

    pos = board.getHistoryPosition();
    expect(pos.current).toBe(2);
    expect(pos.total).toBe(2);

    board.handleSetupRingClick(2, 0);
    board.handleClick(1, 0);

    pos = board.getHistoryPosition();
    expect(pos.current).toBe(3);
    expect(pos.total).toBe(3);

    board.undo();
    pos = board.getHistoryPosition();
    expect(pos.current).toBe(2);
    expect(pos.total).toBe(3);
  });
});

describe('YinshBoard - Clone preserves history and notation', () => {
  test('clone preserves stateHistory and historyIndex', () => {
    const board = createEmptyBoard();
    board.handleSetupRingClick(1, 0);
    board.handleClick(0, 0);

    const cloned = board.clone();
    expect(cloned.canUndo()).toBe(true);
    expect(cloned.getHistoryPosition()).toEqual(board.getHistoryPosition());
  });

  test('clone preserves notation/move history', () => {
    const board = createEmptyBoard();
    board.handleSetupRingClick(1, 0);
    board.handleClick(0, 0);

    const cloned = board.clone();
    expect(cloned.getMoveHistory().length).toBe(1);
    expect(cloned.getMoveHistory()).toEqual(board.getMoveHistory());
  });

  test('undo works on cloned board', () => {
    const board = createEmptyBoard();
    board.handleSetupRingClick(1, 0);
    board.handleClick(0, 0);

    const cloned = board.clone();
    expect(cloned.canUndo()).toBe(true);
    cloned.undo();
    expect(countPieces(cloned, 'ring')).toBe(0);
  });

  test('clone history is independent from original', () => {
    const board = createEmptyBoard();
    board.handleSetupRingClick(1, 0);
    board.handleClick(0, 0);

    const cloned = board.clone();
    cloned.handleSetupRingClick(2, 0);
    cloned.handleClick(1, 0);

    // Original should not be affected
    expect(board.getMoveHistory().length).toBe(1);
    expect(cloned.getMoveHistory().length).toBe(2);
  });
});

describe('YinshBoard - Serialization for Web Worker', () => {
  test('serializeState returns all required fields', () => {
    const board = createBoardWithSetup([
      { player: 1, positions: [[0, 0], [1, 0], [2, 0], [-1, 0], [-2, 0]] },
      { player: 2, positions: [[0, 1], [1, 1], [2, 1], [-1, 1], [-2, 1]] }
    ]);
    const serialized = board.serializeState();

    expect(serialized).toHaveProperty('boardState');
    expect(serialized).toHaveProperty('gamePhase');
    expect(serialized).toHaveProperty('currentPlayer');
    expect(serialized).toHaveProperty('ringsPlaced');
    expect(serialized).toHaveProperty('scores');
    expect(serialized).toHaveProperty('selectedRing');
    expect(serialized).toHaveProperty('validMoves');
    expect(serialized).toHaveProperty('rows');
    expect(serialized).toHaveProperty('nextTurnPlayer');
    expect(serialized).toHaveProperty('rowResolutionQueue');
    expect(serialized).toHaveProperty('pendingRowsAfterRingRemoval');
    expect(serialized).toHaveProperty('winner');
    expect(serialized).toHaveProperty('selectedSetupRing');
  });

  test('fromSerializedState reconstructs board correctly', () => {
    const board = createBoardWithSetup([
      { player: 1, positions: [[0, 0], [1, 0], [2, 0], [-1, 0], [-2, 0]] },
      { player: 2, positions: [[0, 1], [1, 1], [2, 1], [-1, 1], [-2, 1]] }
    ]);

    // Add some state to test
    board.scores = { 1: 1, 2: 0 };
    board.selectedRing = [0, 0];
    board.validMoves = [[1, 0], [2, 0]];

    const serialized = board.serializeState();
    const restored = YinshBoard.fromSerializedState(serialized);

    expect(restored.gamePhase).toBe(board.gamePhase);
    expect(restored.currentPlayer).toBe(board.currentPlayer);
    expect(restored.ringsPlaced).toEqual(board.ringsPlaced);
    expect(restored.scores).toEqual(board.scores);
    expect(restored.selectedRing).toEqual(board.selectedRing);
    expect(restored.validMoves).toEqual(board.validMoves);
  });

  test('serialization preserves board state', () => {
    const board = createBoardWithSetup([
      { player: 1, positions: [[0, 0], [1, 0], [2, 0], [-1, 0], [-2, 0]] },
      { player: 2, positions: [[0, 1], [1, 1], [2, 1], [-1, 1], [-2, 1]] }
    ]);

    // Add some markers directly
    board.boardState['0,2'] = { type: 'marker', player: 1 };
    board.boardState['1,2'] = { type: 'marker', player: 2 };

    const serialized = board.serializeState();
    const restored = YinshBoard.fromSerializedState(serialized);

    // Verify board state is identical
    expect(Object.keys(restored.boardState).length).toBe(Object.keys(board.boardState).length);

    for (const key in board.boardState) {
      expect(restored.boardState[key]).toEqual(board.boardState[key]);
    }
  });

  test('serialization handles game state with scores', () => {
    const board = createBoardWithSetup([
      { player: 1, positions: [[0, 0], [1, 0], [2, 0], [-1, 0], [-2, 0]] },
      { player: 2, positions: [[0, 1], [1, 1], [2, 1], [-1, 1], [-2, 1]] }
    ]);

    // Simulate a game in progress with scores
    board.scores = { 1: 2, 2: 1 };

    const serialized = board.serializeState();
    const restored = YinshBoard.fromSerializedState(serialized);

    expect(restored.scores).toEqual({ 1: 2, 2: 1 });
    expect(restored.gamePhase).toBe('play');
  });

  test('serialization round-trip preserves game logic', () => {
    const board = createBoardWithSetup([
      { player: 1, positions: [[0, 0], [1, 0], [2, 0], [-1, 0], [-2, 0]] },
      { player: 2, positions: [[0, 1], [1, 1], [2, 1], [-1, 1], [-2, 1]] }
    ]);

    // Make a move - select ring
    board.handleClick(0, 0);
    const validMovesBefore = [...board.validMoves];

    // Serialize and restore
    const serialized = board.serializeState();
    const restored = YinshBoard.fromSerializedState(serialized);

    // Verify game logic still works
    expect(restored.validMoves).toEqual(validMovesBefore);
    expect(restored.selectedRing).toEqual([0, 0]);

    // Should be able to continue the game
    expect(restored.gamePhase).toBe('play');
    expect(restored.currentPlayer).toBe(1);
  });
});
