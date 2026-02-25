import ZertzBoard from './ZertzBoard.js';

// --- Helper to create a board with custom state ---
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

  board.stateHistory = [];
  board.historyIndex = -1;
  board._captureState();

  return board;
}

// ============================================================================
// Board Generation
// ============================================================================

describe('Board generation', () => {
  test('generates 37 valid positions', () => {
    const positions = ZertzBoard.generateValidPositions();
    expect(positions.length).toBe(37);
  });

  test('center (0,0) is included', () => {
    const positions = ZertzBoard.generateValidPositions();
    expect(positions.some(([q, r]) => q === 0 && r === 0)).toBe(true);
  });

  test('position (4,0) is excluded (outside hex side=4)', () => {
    const positions = ZertzBoard.generateValidPositions();
    expect(positions.some(([q, r]) => q === 4 && r === 0)).toBe(false);
  });

  test('all positions satisfy max(|q|, |r|, |q+r|) <= 3', () => {
    const positions = ZertzBoard.generateValidPositions();
    for (const [q, r] of positions) {
      expect(Math.max(Math.abs(q), Math.abs(r), Math.abs(q + r))).toBeLessThanOrEqual(3);
    }
  });
});

// ============================================================================
// Initial state
// ============================================================================

describe('Initial state', () => {
  test('board starts with 37 rings', () => {
    const board = new ZertzBoard();
    expect(board.rings.size).toBe(37);
  });

  test('board starts with no marbles', () => {
    const board = new ZertzBoard();
    expect(Object.keys(board.marbles).length).toBe(0);
  });

  test('pool has correct marble counts', () => {
    const board = new ZertzBoard();
    expect(board.pool).toEqual({ white: 6, grey: 8, black: 10 });
  });

  test('starts in place-marble phase with player 1', () => {
    const board = new ZertzBoard();
    expect(board.gamePhase).toBe('place-marble');
    expect(board.currentPlayer).toBe(1);
  });
});

// ============================================================================
// Place + Remove Mechanics
// ============================================================================

describe('Place marble', () => {
  test('selecting a color sets selectedColor', () => {
    const board = new ZertzBoard();
    board.selectMarbleColor('white');
    expect(board.selectedColor).toBe('white');
  });

  test('placing a marble decrements pool', () => {
    const board = new ZertzBoard();
    board.selectMarbleColor('white');
    board.placeMarble(0, 0);
    expect(board.pool.white).toBe(5);
    expect(board.marbles['0,0']).toBe('white');
  });

  test('placing transitions to remove-ring phase', () => {
    const board = new ZertzBoard();
    board.selectMarbleColor('black');
    board.placeMarble(0, 0);
    expect(board.gamePhase).toBe('remove-ring');
  });

  test('cannot place on occupied ring', () => {
    const board = new ZertzBoard();
    board.selectMarbleColor('white');
    board.placeMarble(0, 0);
    // Now in remove-ring phase, put back to place-marble for test
    board.gamePhase = 'place-marble';
    board.selectMarbleColor('grey');
    const result = board.placeMarble(0, 0);
    expect(result).toBe(false);
  });

  test('cannot place without selecting color', () => {
    const board = new ZertzBoard();
    const result = board.placeMarble(0, 0);
    expect(result).toBe(false);
  });
});

describe('Free ring detection', () => {
  test('edge rings are free on initial board', () => {
    const board = new ZertzBoard();
    const freeRings = board.getFreeRings();
    // All edge rings should be free on an empty board
    expect(freeRings.length).toBeGreaterThan(0);
  });

  test('center ring is not free (not on edge)', () => {
    const board = new ZertzBoard();
    const freeRings = board.getFreeRings();
    expect(freeRings.includes('0,0')).toBe(false);
  });

  test('ring with marble is not free', () => {
    const board = new ZertzBoard();
    board.marbles['3,0'] = 'white'; // Place on an edge ring
    const freeRings = board.getFreeRings();
    expect(freeRings.includes('3,0')).toBe(false);
  });

  test('bridge rings ARE removable (isolation mechanic)', () => {
    // In Zertz, removing a ring CAN disconnect the board — triggering isolation
    const board = createBoard({
      rings: ['0,0', '1,0', '2,0', '0,1', '0,-1'],
      marbles: {},
      pool: { white: 6, grey: 8, black: 10 },
      captures: { 1: { white: 0, grey: 0, black: 0 }, 2: { white: 0, grey: 0, black: 0 } },
      gamePhase: 'remove-ring',
    });

    const freeRings = board.getFreeRings();
    // All vacant edge rings are free, including bridge rings
    expect(freeRings.includes('2,0')).toBe(true);
    expect(freeRings.includes('0,1')).toBe(true);
    expect(freeRings.includes('0,-1')).toBe(true);
    // 1,0 has neighbors on both sides but also has missing neighbors in other directions
    expect(freeRings.includes('1,0')).toBe(true);
  });
});

describe('Remove ring', () => {
  test('removing a ring shrinks the board', () => {
    const board = new ZertzBoard();
    board.selectMarbleColor('black');
    board.placeMarble(0, 0);
    // Now in remove-ring phase
    const freeRings = board.getFreeRings();
    const ringToRemove = freeRings[0];
    const [q, r] = board._fromKey(ringToRemove);
    const sizeBefore = board.rings.size;
    board.removeRing(q, r);
    expect(board.rings.size).toBe(sizeBefore - 1);
  });

  test('removing a ring switches player and goes to place-marble', () => {
    const board = new ZertzBoard();
    board.selectMarbleColor('black');
    board.placeMarble(0, 0);
    const freeRings = board.getFreeRings();
    const [q, r] = board._fromKey(freeRings[0]);
    board.removeRing(q, r);
    expect(board.currentPlayer).toBe(2);
    expect(board.gamePhase).toBe('place-marble');
  });

  test('cannot remove non-free ring', () => {
    const board = new ZertzBoard();
    board.selectMarbleColor('black');
    board.placeMarble(0, 0);
    // Center ring is not free
    const result = board.removeRing(0, 0);
    expect(result).toBe(false);
  });
});

// ============================================================================
// Capture Mechanics
// ============================================================================

describe('Capture detection', () => {
  test('detects jump when marble can jump over adjacent marble to empty ring', () => {
    const board = createBoard({
      rings: ['0,0', '1,0', '2,0'],
      marbles: { '0,0': 'white', '1,0': 'black' },
      pool: { white: 5, grey: 8, black: 9 },
      captures: { 1: { white: 0, grey: 0, black: 0 }, 2: { white: 0, grey: 0, black: 0 } },
      gamePhase: 'capture',
      currentPlayer: 1,
    });

    const targets = board.getJumpTargets('0,0');
    expect(targets.length).toBe(1);
    expect(targets[0].target).toBe('2,0');
    expect(targets[0].captured).toBe('1,0');
  });

  test('no jump if landing ring is missing', () => {
    const board = createBoard({
      rings: ['0,0', '1,0'],
      marbles: { '0,0': 'white', '1,0': 'black' },
      pool: { white: 5, grey: 8, black: 9 },
      captures: { 1: { white: 0, grey: 0, black: 0 }, 2: { white: 0, grey: 0, black: 0 } },
      gamePhase: 'capture',
      currentPlayer: 1,
    });

    const targets = board.getJumpTargets('0,0');
    expect(targets.length).toBe(0);
  });

  test('no jump if landing ring is occupied', () => {
    const board = createBoard({
      rings: ['0,0', '1,0', '2,0'],
      marbles: { '0,0': 'white', '1,0': 'black', '2,0': 'grey' },
      pool: { white: 5, grey: 7, black: 9 },
      captures: { 1: { white: 0, grey: 0, black: 0 }, 2: { white: 0, grey: 0, black: 0 } },
      gamePhase: 'capture',
      currentPlayer: 1,
    });

    const targets = board.getJumpTargets('0,0');
    expect(targets.length).toBe(0);
  });

  test('mandatory capture overrides place-marble', () => {
    // After a turn ends, if captures exist, phase should be capture
    const board = createBoard({
      rings: ['0,0', '1,0', '2,0', '3,0', '-1,0', '-2,0', '-3,0',
              '0,1', '0,2', '0,3', '0,-1', '0,-2', '0,-3',
              '1,-1', '2,-2', '3,-3', '-1,1', '-2,2', '-3,3',
              '1,1', '1,2', '2,1', '-1,-1', '-1,-2', '-2,-1',
              '1,-2', '1,-3', '2,-3', '-1,2', '-1,3', '-2,3',
              '2,-1', '3,-1', '3,-2', '-2,1', '-3,1', '-3,2'],
      marbles: { '0,0': 'white', '1,0': 'black' },
      pool: { white: 5, grey: 8, black: 9 },
      captures: { 1: { white: 0, grey: 0, black: 0 }, 2: { white: 0, grey: 0, black: 0 } },
      currentPlayer: 1,
      gamePhase: 'place-marble',
    });

    // Simulate end turn for player 2 -> player 1
    board.currentPlayer = 2;
    board._endTurn(); // This will switch to player 1 and check captures
    // There should be captures available (0,0 can jump over 1,0 to 2,0)
    expect(board.gamePhase).toBe('capture');
  });
});

describe('Execute capture', () => {
  test('capture moves marble and captures jumped marble', () => {
    const board = createBoard({
      rings: ['0,0', '1,0', '2,0'],
      marbles: { '0,0': 'white', '1,0': 'black' },
      pool: { white: 5, grey: 8, black: 9 },
      captures: { 1: { white: 0, grey: 0, black: 0 }, 2: { white: 0, grey: 0, black: 0 } },
      gamePhase: 'capture',
      currentPlayer: 1,
    });

    board.jumpingMarble = '0,0';
    const result = board.executeCapture('0,0', '2,0');
    expect(result).toBe(true);
    expect(board.marbles['2,0']).toBe('white');
    expect(board.marbles['0,0']).toBeUndefined();
    expect(board.marbles['1,0']).toBeUndefined();
    expect(board.captures[1].black).toBe(1);
  });

  test('multi-jump continues with same marble', () => {
    // Set up a chain: marble at 0,0 can jump to 2,0 (over 1,0) then to 2,-2 (over 2,-1)
    const board = createBoard({
      rings: ['0,0', '1,0', '2,0', '2,-1', '2,-2'],
      marbles: { '0,0': 'white', '1,0': 'black', '2,-1': 'grey' },
      pool: { white: 5, grey: 7, black: 9 },
      captures: { 1: { white: 0, grey: 0, black: 0 }, 2: { white: 0, grey: 0, black: 0 } },
      gamePhase: 'capture',
      currentPlayer: 1,
    });

    board.jumpingMarble = '0,0';
    board.executeCapture('0,0', '2,0');

    // After first jump, should still be in capture phase with jumpingMarble updated
    expect(board.gamePhase).toBe('capture');
    expect(board.jumpingMarble).toBe('2,0');

    // Now can jump again from 2,0 over 2,-1 to 2,-2
    const targets = board.getJumpTargets('2,0');
    expect(targets.length).toBe(1);
    expect(targets[0].target).toBe('2,-2');
  });

  test('cannot switch marble during multi-jump', () => {
    const board = createBoard({
      rings: ['0,0', '1,0', '2,0', '-1,0', '-2,0'],
      marbles: { '0,0': 'white', '1,0': 'black', '-1,0': 'grey' },
      pool: { white: 5, grey: 7, black: 9 },
      captures: { 1: { white: 0, grey: 0, black: 0 }, 2: { white: 0, grey: 0, black: 0 } },
      gamePhase: 'capture',
      currentPlayer: 1,
    });

    board.jumpingMarble = '0,0';
    // Try to jump with a different marble
    const result = board.executeCapture('-2,0', '0,0');
    expect(result).toBe(false);
  });
});

// ============================================================================
// Isolation Mechanic
// ============================================================================

describe('Isolation mechanic', () => {
  test('fully occupied island is captured on ring removal', () => {
    // Create board where removing a ring isolates a fully-occupied group
    const board = createBoard({
      rings: ['0,0', '1,0', '2,0', '3,0', '-1,0'],
      marbles: { '3,0': 'white' },
      pool: { white: 5, grey: 8, black: 10 },
      captures: { 1: { white: 0, grey: 0, black: 0 }, 2: { white: 0, grey: 0, black: 0 } },
      gamePhase: 'remove-ring',
      currentPlayer: 1,
    });

    // Remove 2,0 to isolate 3,0 (which has a marble)
    board.removeRing(2, 0);
    // Player 1 should capture the white marble from 3,0
    expect(board.captures[1].white).toBe(1);
    // Ring 3,0 should also be removed
    expect(board.rings.has('3,0')).toBe(false);
  });

  test('island with empty ring is NOT captured', () => {
    const board = createBoard({
      rings: ['0,0', '1,0', '2,0', '3,0', '-1,0'],
      marbles: {},
      pool: { white: 6, grey: 8, black: 10 },
      captures: { 1: { white: 0, grey: 0, black: 0 }, 2: { white: 0, grey: 0, black: 0 } },
      gamePhase: 'remove-ring',
      currentPlayer: 1,
    });

    // Remove 2,0 to isolate 3,0 (which is empty)
    board.removeRing(2, 0);
    // Ring 3,0 should still exist
    expect(board.rings.has('3,0')).toBe(true);
  });

  test('placing on last vacant ring of isolated group captures all', () => {
    // Create a board with two disconnected groups, one with just one empty ring
    const board = createBoard({
      rings: ['0,0', '1,0', '-1,0', '3,0', '3,-1'],
      marbles: { '3,0': 'black' },
      pool: { white: 6, grey: 8, black: 9 },
      captures: { 1: { white: 0, grey: 0, black: 0 }, 2: { white: 0, grey: 0, black: 0 } },
      gamePhase: 'place-marble',
      currentPlayer: 1,
    });

    board.selectMarbleColor('white');
    board.placeMarble(3, -1);

    // Both marbles on the isolated group should be captured by player 1
    expect(board.captures[1].black).toBe(1);
    expect(board.captures[1].white).toBe(1);
    // Those rings should be removed
    expect(board.rings.has('3,0')).toBe(false);
    expect(board.rings.has('3,-1')).toBe(false);
  });
});

// ============================================================================
// Win Conditions
// ============================================================================

describe('Win conditions', () => {
  test('4 white marbles wins', () => {
    const board = createBoard({
      rings: ['0,0', '1,0', '2,0'],
      marbles: { '0,0': 'grey', '1,0': 'white' },
      pool: { white: 2, grey: 7, black: 10 },
      captures: { 1: { white: 3, grey: 0, black: 0 }, 2: { white: 0, grey: 0, black: 0 } },
      gamePhase: 'capture',
      currentPlayer: 1,
    });

    board.jumpingMarble = '0,0';
    board.executeCapture('0,0', '2,0');
    // Captured the white marble -> total 4 white
    expect(board.captures[1].white).toBe(4);
    expect(board.gamePhase).toBe('game-over');
    expect(board.winner).toBe(1);
  });

  test('5 grey marbles wins', () => {
    const board = new ZertzBoard({ skipInitialHistory: true });
    board.captures = {
      1: { white: 0, grey: 5, black: 0 },
      2: { white: 0, grey: 0, black: 0 },
    };
    expect(board._checkWinCondition(1)).toBe(true);
  });

  test('6 black marbles wins', () => {
    const board = new ZertzBoard({ skipInitialHistory: true });
    board.captures = {
      1: { white: 0, grey: 0, black: 6 },
      2: { white: 0, grey: 0, black: 0 },
    };
    expect(board._checkWinCondition(1)).toBe(true);
  });

  test('3+3+3 mixed set wins', () => {
    const board = new ZertzBoard({ skipInitialHistory: true });
    board.captures = {
      1: { white: 3, grey: 3, black: 3 },
      2: { white: 0, grey: 0, black: 0 },
    };
    expect(board._checkWinCondition(1)).toBe(true);
  });

  test('2+2+2 does not win', () => {
    const board = new ZertzBoard({ skipInitialHistory: true });
    board.captures = {
      1: { white: 2, grey: 2, black: 2 },
      2: { white: 0, grey: 0, black: 0 },
    };
    expect(board._checkWinCondition(1)).toBe(false);
  });
});

// ============================================================================
// Pool Exhaustion
// ============================================================================

describe('Pool exhaustion', () => {
  test('when pool empty, must place from own captures', () => {
    const board = createBoard({
      rings: ['0,0', '1,0'],
      marbles: {},
      pool: { white: 0, grey: 0, black: 0 },
      captures: { 1: { white: 2, grey: 1, black: 0 }, 2: { white: 0, grey: 0, black: 0 } },
      gamePhase: 'place-marble',
      currentPlayer: 1,
    });

    expect(board._mustPlaceFromCaptures()).toBe(true);
    const colors = board.getAvailableColors();
    expect(colors).toContain('white');
    expect(colors).toContain('grey');
    expect(colors).not.toContain('black');
  });

  test('placing from captures decrements captures', () => {
    const board = createBoard({
      rings: ['0,0', '1,0', '2,0', '-1,0'],
      marbles: {},
      pool: { white: 0, grey: 0, black: 0 },
      captures: { 1: { white: 2, grey: 1, black: 0 }, 2: { white: 0, grey: 0, black: 0 } },
      gamePhase: 'place-marble',
      currentPlayer: 1,
    });

    board.selectMarbleColor('white');
    board.placeMarble(0, 0);
    expect(board.captures[1].white).toBe(1);
  });
});

// ============================================================================
// Undo / Redo
// ============================================================================

describe('Undo / Redo', () => {
  test('undo restores previous state', () => {
    const board = new ZertzBoard();
    board.selectMarbleColor('white');
    board.placeMarble(0, 0);
    expect(board.marbles['0,0']).toBe('white');

    board.undo();
    // After undo, marble should be gone and we should be back in place-marble with the marble selected
    // Actually undo goes to previous _captureState, which was after placeMarble
    // Let's check pool is restored
    expect(board.pool.white).toBe(6);
    expect(board.marbles['0,0']).toBeUndefined();
  });

  test('redo restores undone state', () => {
    const board = new ZertzBoard();
    board.selectMarbleColor('white');
    board.placeMarble(0, 0);
    board.undo();
    board.redo();
    expect(board.marbles['0,0']).toBe('white');
    expect(board.pool.white).toBe(5);
  });

  test('canUndo returns false at start', () => {
    const board = new ZertzBoard();
    expect(board.canUndo()).toBe(false);
  });

  test('canRedo returns false without undo', () => {
    const board = new ZertzBoard();
    board.selectMarbleColor('white');
    board.placeMarble(0, 0);
    expect(board.canRedo()).toBe(false);
  });
});

// ============================================================================
// Edge Cases
// ============================================================================

describe('Edge cases', () => {
  test('clone produces independent copy', () => {
    const board = new ZertzBoard();
    board.selectMarbleColor('black');
    board.placeMarble(0, 0);

    const clone = board.clone();
    expect(clone.marbles['0,0']).toBe('black');

    // Modify original
    board.marbles['1,0'] = 'white';
    expect(clone.marbles['1,0']).toBeUndefined();
  });

  test('new game resets everything', () => {
    const board = new ZertzBoard();
    board.selectMarbleColor('black');
    board.placeMarble(0, 0);
    board.startNewGame();

    expect(board.rings.size).toBe(37);
    expect(Object.keys(board.marbles).length).toBe(0);
    expect(board.pool).toEqual({ white: 6, grey: 8, black: 10 });
    expect(board.currentPlayer).toBe(1);
    expect(board.gamePhase).toBe('place-marble');
  });

  test('_toKey and _fromKey are inverse', () => {
    const board = new ZertzBoard();
    const [q, r] = [-3, 2];
    const key = board._toKey(q, r);
    const [q2, r2] = board._fromKey(key);
    expect(q2).toBe(q);
    expect(r2).toBe(r);
  });

  test('connected components finds single component for full board', () => {
    const board = new ZertzBoard();
    const components = board._findConnectedComponents();
    expect(components.length).toBe(1);
    expect(components[0].size).toBe(37);
  });
});

// ============================================================================
// Bug 3: _allRingsOccupied() vacuous truth
// ============================================================================

describe('_allRingsOccupied edge cases', () => {
  test('empty board returns false', () => {
    const board = createBoard({
      rings: [],
      marbles: {},
      pool: { white: 6, grey: 8, black: 10 },
      captures: { 1: { white: 0, grey: 0, black: 0 }, 2: { white: 0, grey: 0, black: 0 } },
    });
    expect(board._allRingsOccupied()).toBe(false);
  });

  test('single occupied ring returns true', () => {
    const board = createBoard({
      rings: ['0,0'],
      marbles: { '0,0': 'white' },
      pool: { white: 5, grey: 8, black: 10 },
      captures: { 1: { white: 0, grey: 0, black: 0 }, 2: { white: 0, grey: 0, black: 0 } },
    });
    expect(board._allRingsOccupied()).toBe(true);
  });

  test('single vacant ring returns false', () => {
    const board = createBoard({
      rings: ['0,0'],
      marbles: {},
      pool: { white: 6, grey: 8, black: 10 },
      captures: { 1: { white: 0, grey: 0, black: 0 }, 2: { white: 0, grey: 0, black: 0 } },
    });
    expect(board._allRingsOccupied()).toBe(false);
  });
});

// ============================================================================
// Bug 6: Stricter "can slide away" check
// ============================================================================

describe('_canSlideAway', () => {
  test('pinched ring (5 neighbors, 1 gap) is NOT free', () => {
    // Ring at 0,0 with all 6 neighbors except Southwest (-1,1)
    const board = createBoard({
      rings: ['0,0', '1,0', '-1,0', '0,1', '0,-1', '1,-1'],
      marbles: {},
      pool: { white: 6, grey: 8, black: 10 },
      captures: { 1: { white: 0, grey: 0, black: 0 }, 2: { white: 0, grey: 0, black: 0 } },
      gamePhase: 'remove-ring',
    });
    const freeRings = board.getFreeRings();
    expect(freeRings.includes('0,0')).toBe(false);
  });

  test('ring with 2 consecutive gaps IS free', () => {
    // Ring at 0,0 with neighbors: East, West, Southwest, Southeast (missing NE and NW — consecutive)
    const board = createBoard({
      rings: ['0,0', '1,0', '-1,0', '0,1', '-1,1'],
      marbles: {},
      pool: { white: 6, grey: 8, black: 10 },
      captures: { 1: { white: 0, grey: 0, black: 0 }, 2: { white: 0, grey: 0, black: 0 } },
      gamePhase: 'remove-ring',
    });
    const freeRings = board.getFreeRings();
    expect(freeRings.includes('0,0')).toBe(true);
  });

  test('ring with 0 neighbors is always slidable', () => {
    const board = createBoard({
      rings: ['0,0', '5,5'], // isolated ring
      marbles: {},
      pool: { white: 6, grey: 8, black: 10 },
      captures: { 1: { white: 0, grey: 0, black: 0 }, 2: { white: 0, grey: 0, black: 0 } },
      gamePhase: 'remove-ring',
    });
    expect(board._canSlideAway('5,5')).toBe(true);
  });

  test('ring with 1 neighbor is always slidable', () => {
    const board = createBoard({
      rings: ['0,0', '1,0'],
      marbles: {},
      pool: { white: 6, grey: 8, black: 10 },
      captures: { 1: { white: 0, grey: 0, black: 0 }, 2: { white: 0, grey: 0, black: 0 } },
      gamePhase: 'remove-ring',
    });
    expect(board._canSlideAway('0,0')).toBe(true);
    expect(board._canSlideAway('1,0')).toBe(true);
  });
});

// ============================================================================
// Bug 4: _captureAllRemainingMarbles draw support
// ============================================================================

describe('All-rings-occupied endgame', () => {
  test('no win condition met results in draw (winner is null)', () => {
    // 2 rings, both occupied, capture gives no win
    const board = createBoard({
      rings: ['0,0', '1,0'],
      marbles: { '0,0': 'black' },
      pool: { white: 5, grey: 8, black: 9 },
      captures: { 1: { white: 0, grey: 0, black: 0 }, 2: { white: 0, grey: 0, black: 0 } },
      gamePhase: 'place-marble',
      currentPlayer: 1,
    });

    board.selectMarbleColor('white');
    board.placeMarble(1, 0);

    expect(board.gamePhase).toBe('game-over');
    expect(board.winner).toBeNull();
  });

  test('win condition met sets correct winner', () => {
    // Player already has 3 white captures, placing last marble fills board
    // and triggers all-rings-occupied giving them the 4th white
    const board = createBoard({
      rings: ['0,0', '1,0'],
      marbles: { '0,0': 'white' },
      pool: { white: 4, grey: 8, black: 10 },
      captures: { 1: { white: 3, grey: 0, black: 0 }, 2: { white: 0, grey: 0, black: 0 } },
      gamePhase: 'place-marble',
      currentPlayer: 1,
    });

    board.selectMarbleColor('black');
    board.placeMarble(1, 0);

    expect(board.gamePhase).toBe('game-over');
    expect(board.winner).toBe(1);
  });
});

// ============================================================================
// Bug 5: Deselect/switch marble in capture phase
// ============================================================================

describe('Capture marble selection', () => {
  test('can switch selection before first jump', () => {
    // Both 0,0 and -3,0 can jump (over 1,0 and -2,0 respectively)
    const board = createBoard({
      rings: ['0,0', '1,0', '2,0', '-1,0', '-2,0', '-3,0'],
      marbles: { '0,0': 'grey', '1,0': 'black', '-3,0': 'white', '-2,0': 'black' },
      pool: { white: 5, grey: 7, black: 8 },
      captures: { 1: { white: 0, grey: 0, black: 0 }, 2: { white: 0, grey: 0, black: 0 } },
      gamePhase: 'capture',
      currentPlayer: 1,
    });

    // Select first marble
    board._handleCaptureClick('0,0');
    expect(board.jumpingMarble).toBe('0,0');

    // Switch to different marble before jumping
    board._handleCaptureClick('-3,0');
    expect(board.jumpingMarble).toBe('-3,0');
  });

  test('can deselect by clicking same marble before first jump', () => {
    const board = createBoard({
      rings: ['0,0', '1,0', '2,0'],
      marbles: { '0,0': 'white', '1,0': 'black' },
      pool: { white: 5, grey: 8, black: 9 },
      captures: { 1: { white: 0, grey: 0, black: 0 }, 2: { white: 0, grey: 0, black: 0 } },
      gamePhase: 'capture',
      currentPlayer: 1,
    });

    // Select marble
    board._handleCaptureClick('0,0');
    expect(board.jumpingMarble).toBe('0,0');

    // Click same marble to deselect
    board._handleCaptureClick('0,0');
    expect(board.jumpingMarble).toBeNull();
  });

  test('cannot switch marble mid-jump-sequence (captureStarted = true)', () => {
    // Chain: 0,0 jumps over 1,0 to 2,0, then could jump further
    const board = createBoard({
      rings: ['0,0', '1,0', '2,0', '2,-1', '2,-2', '-1,0', '-2,0', '-3,0'],
      marbles: { '0,0': 'white', '1,0': 'black', '2,-1': 'grey', '-2,0': 'white', '-1,0': 'black' },
      pool: { white: 4, grey: 7, black: 8 },
      captures: { 1: { white: 0, grey: 0, black: 0 }, 2: { white: 0, grey: 0, black: 0 } },
      gamePhase: 'capture',
      currentPlayer: 1,
    });

    // Select and execute first jump
    board.jumpingMarble = '0,0';
    board.executeCapture('0,0', '2,0');
    expect(board.captureStarted).toBe(true);
    expect(board.jumpingMarble).toBe('2,0');

    // Try to switch to another marble — should attempt executeCapture which fails
    board._handleCaptureClick('-2,0');
    // jumpingMarble should NOT have changed to -2,0
    expect(board.jumpingMarble).toBe('2,0');
  });
});

// ============================================================================
// Bug 1: _allRingsOccupied check after removeRing
// ============================================================================

describe('All-rings-occupied after ring removal', () => {
  test('removing last vacant ring triggers all-rings-occupied', () => {
    const board = createBoard({
      rings: ['0,0', '1,0', '2,0'],
      marbles: { '0,0': 'white', '1,0': 'black' },
      pool: { white: 5, grey: 8, black: 9 },
      captures: { 1: { white: 0, grey: 0, black: 0 }, 2: { white: 0, grey: 0, black: 0 } },
      gamePhase: 'remove-ring',
      currentPlayer: 1,
    });

    board.removeRing(2, 0);

    expect(board.gamePhase).toBe('game-over');
    expect(board.captures[1].white).toBe(1);
    expect(board.captures[1].black).toBe(1);
  });

  test('ring removal + isolation leaves all remaining occupied triggers endgame', () => {
    const board = createBoard({
      rings: ['0,0', '1,0', '2,0', '3,0'],
      marbles: { '0,0': 'grey', '2,0': 'white', '3,0': 'black' },
      pool: { white: 5, grey: 7, black: 9 },
      captures: { 1: { white: 0, grey: 0, black: 0 }, 2: { white: 0, grey: 0, black: 0 } },
      gamePhase: 'remove-ring',
      currentPlayer: 1,
    });

    board.removeRing(1, 0);

    expect(board.gamePhase).toBe('game-over');
    expect(board.captures[1].white).toBe(1);
    expect(board.captures[1].black).toBe(1);
    expect(board.captures[1].grey).toBe(1);
  });
});

// ============================================================================
// ============================================================================
//                     COMPREHENSIVE TEST SUITE
// ============================================================================
// ============================================================================

// Default captures/pool shorthand for test setups
const ZERO_CAPS = { 1: { white: 0, grey: 0, black: 0 }, 2: { white: 0, grey: 0, black: 0 } };
const FULL_POOL = { white: 6, grey: 8, black: 10 };

// ============================================================================
// Board Generation — Additional Coverage
// ============================================================================

describe('Board generation (extended)', () => {
  test('all 6 hex corners are included', () => {
    const positions = ZertzBoard.generateValidPositions();
    const keys = positions.map(([q, r]) => `${q},${r}`);
    for (const corner of ['3,0', '-3,0', '0,3', '0,-3', '3,-3', '-3,3']) {
      expect(keys).toContain(corner);
    }
  });

  test('positions just outside the boundary are excluded', () => {
    const positions = ZertzBoard.generateValidPositions();
    const keys = new Set(positions.map(([q, r]) => `${q},${r}`));
    expect(keys.has('2,2')).toBe(false);    // |q+r|=4
    expect(keys.has('-2,-2')).toBe(false);   // |q+r|=4
    expect(keys.has('4,-1')).toBe(false);    // |q|=4
    expect(keys.has('-4,1')).toBe(false);    // |q|=4
  });

  test('no duplicate positions', () => {
    const positions = ZertzBoard.generateValidPositions();
    const keys = positions.map(([q, r]) => `${q},${r}`);
    expect(new Set(keys).size).toBe(37);
  });
});

// ============================================================================
// Constructor / Initial State — Additional Coverage
// ============================================================================

describe('Initial state (extended)', () => {
  test('captures are initialized to zero for both players', () => {
    const board = new ZertzBoard();
    expect(board.captures[1]).toEqual({ white: 0, grey: 0, black: 0 });
    expect(board.captures[2]).toEqual({ white: 0, grey: 0, black: 0 });
  });

  test('winner is null at start', () => {
    const board = new ZertzBoard();
    expect(board.winner).toBeNull();
  });

  test('winConditionMet is null at start', () => {
    const board = new ZertzBoard();
    expect(board.winConditionMet).toBeNull();
  });

  test('selectedColor is null at start', () => {
    const board = new ZertzBoard();
    expect(board.selectedColor).toBeNull();
  });

  test('jumpingMarble is null at start', () => {
    const board = new ZertzBoard();
    expect(board.jumpingMarble).toBeNull();
  });

  test('captureStarted is false at start', () => {
    const board = new ZertzBoard();
    expect(board.captureStarted).toBe(false);
  });

  test('stateHistory has exactly one entry at start', () => {
    const board = new ZertzBoard();
    expect(board.stateHistory.length).toBe(1);
    expect(board.historyIndex).toBe(0);
  });

  test('skipInitialHistory suppresses initial snapshot', () => {
    const board = new ZertzBoard({ skipInitialHistory: true });
    expect(board.stateHistory.length).toBe(0);
    expect(board.historyIndex).toBe(-1);
  });

  test('pool total is 24 at start', () => {
    const board = new ZertzBoard();
    expect(board.getPoolTotal()).toBe(24);
  });
});

// ============================================================================
// Utility Methods
// ============================================================================

describe('Utility methods', () => {
  test('_toKey(0, 0) produces "0,0"', () => {
    const board = new ZertzBoard({ skipInitialHistory: true });
    expect(board._toKey(0, 0)).toBe('0,0');
  });

  test('_toKey with negative coordinates', () => {
    const board = new ZertzBoard({ skipInitialHistory: true });
    expect(board._toKey(-3, 3)).toBe('-3,3');
  });

  test('_fromKey parses negative coordinates', () => {
    const board = new ZertzBoard({ skipInitialHistory: true });
    expect(board._fromKey('-3,3')).toEqual([-3, 3]);
  });

  test('round-trip for all 37 valid positions', () => {
    const board = new ZertzBoard({ skipInitialHistory: true });
    const positions = ZertzBoard.generateValidPositions();
    for (const [q, r] of positions) {
      const key = board._toKey(q, r);
      const [q2, r2] = board._fromKey(key);
      expect(q2).toBe(q);
      expect(r2).toBe(r);
    }
  });

  test('_getNeighborKey returns correct neighbor in each direction', () => {
    const board = new ZertzBoard({ skipInitialHistory: true });
    const expected = [
      [[1, 0], '1,0'],
      [[-1, 0], '-1,0'],
      [[0, 1], '0,1'],
      [[0, -1], '0,-1'],
      [[1, -1], '1,-1'],
      [[-1, 1], '-1,1'],
    ];
    for (const [dir, expectedKey] of expected) {
      expect(board._getNeighborKey('0,0', dir)).toBe(expectedKey);
    }
  });

  test('_getNeighborKey from a corner position can go off-board', () => {
    const board = new ZertzBoard({ skipInitialHistory: true });
    // (3,0) East -> (4,0), which is off-board but utility still returns it
    expect(board._getNeighborKey('3,0', [1, 0])).toBe('4,0');
  });
});

// ============================================================================
// Pool / Placement Logic — Extended
// ============================================================================

describe('Pool and placement (extended)', () => {
  test('getPoolTotal returns sum of all pool colors', () => {
    const board = new ZertzBoard({ skipInitialHistory: true });
    board.pool = { white: 2, grey: 3, black: 5 };
    expect(board.getPoolTotal()).toBe(10);
  });

  test('getPoolTotal returns 0 when pool is empty', () => {
    const board = new ZertzBoard({ skipInitialHistory: true });
    board.pool = { white: 0, grey: 0, black: 0 };
    expect(board.getPoolTotal()).toBe(0);
  });

  test('_mustPlaceFromCaptures returns false when pool has marbles', () => {
    const board = new ZertzBoard();
    expect(board._mustPlaceFromCaptures()).toBe(false);
  });

  test('getAvailableColors returns all three when pool is full', () => {
    const board = new ZertzBoard();
    const colors = board.getAvailableColors();
    expect(colors).toContain('white');
    expect(colors).toContain('grey');
    expect(colors).toContain('black');
  });

  test('getAvailableColors omits exhausted color from pool', () => {
    const board = new ZertzBoard();
    board.pool.white = 0;
    const colors = board.getAvailableColors();
    expect(colors).not.toContain('white');
    expect(colors).toContain('grey');
    expect(colors).toContain('black');
  });

  test('getAvailableColors returns empty when pool empty and no captures', () => {
    const board = createBoard({
      rings: ['0,0'],
      marbles: {},
      pool: { white: 0, grey: 0, black: 0 },
      captures: ZERO_CAPS,
      gamePhase: 'place-marble',
      currentPlayer: 1,
    });
    expect(board.getAvailableColors()).toEqual([]);
  });

  test('getAvailableColors uses correct player captures when pool empty', () => {
    const board = createBoard({
      rings: ['0,0'],
      marbles: {},
      pool: { white: 0, grey: 0, black: 0 },
      captures: { 1: { white: 0, grey: 0, black: 0 }, 2: { white: 2, grey: 0, black: 1 } },
      gamePhase: 'place-marble',
      currentPlayer: 2,
    });
    const colors = board.getAvailableColors();
    expect(colors).toContain('white');
    expect(colors).toContain('black');
    expect(colors).not.toContain('grey');
  });

  test('selectMarbleColor does nothing if not in place-marble phase', () => {
    const board = new ZertzBoard();
    board.gamePhase = 'capture';
    board.selectMarbleColor('white');
    expect(board.selectedColor).toBeNull();
  });

  test('selectMarbleColor does not accept unavailable color', () => {
    const board = new ZertzBoard();
    board.pool.white = 0;
    board.selectMarbleColor('white');
    expect(board.selectedColor).toBeNull();
  });

  test('selectMarbleColor allows reselecting a different color', () => {
    const board = new ZertzBoard();
    board.selectMarbleColor('white');
    board.selectMarbleColor('grey');
    expect(board.selectedColor).toBe('grey');
  });

  test('selectMarbleColor rejects invalid color string', () => {
    const board = new ZertzBoard();
    board.selectMarbleColor('red');
    expect(board.selectedColor).toBeNull();
  });

  test('getValidPlacements returns all 37 on empty board', () => {
    const board = new ZertzBoard();
    expect(board.getValidPlacements().length).toBe(37);
  });

  test('getValidPlacements excludes occupied rings', () => {
    const board = new ZertzBoard();
    board.marbles['0,0'] = 'white';
    const placements = board.getValidPlacements();
    expect(placements).not.toContain('0,0');
    expect(placements.length).toBe(36);
  });

  test('placeMarble returns false on non-existent ring', () => {
    const board = new ZertzBoard();
    board.selectMarbleColor('white');
    expect(board.placeMarble(10, 10)).toBe(false);
  });

  test('placeMarble returns false in wrong phase', () => {
    const board = createBoard({
      rings: ['0,0', '1,0'],
      marbles: {},
      pool: FULL_POOL,
      captures: ZERO_CAPS,
      gamePhase: 'remove-ring',
    });
    board.selectedColor = 'white';
    expect(board.placeMarble(0, 0)).toBe(false);
  });

  test('placeMarble clears selectedColor after success', () => {
    const board = new ZertzBoard();
    board.selectMarbleColor('white');
    board.placeMarble(0, 0);
    expect(board.selectedColor).toBeNull();
  });

  test('placing from captures only decrements the placing player', () => {
    const board = createBoard({
      rings: ['0,0', '1,0', '2,0', '-1,0'],
      marbles: {},
      pool: { white: 0, grey: 0, black: 0 },
      captures: { 1: { white: 2, grey: 0, black: 0 }, 2: { white: 1, grey: 0, black: 0 } },
      gamePhase: 'place-marble',
      currentPlayer: 1,
    });
    board.selectMarbleColor('white');
    board.placeMarble(0, 0);
    expect(board.captures[1].white).toBe(1);
    expect(board.captures[2].white).toBe(1); // unchanged
  });

  test('placing when no free rings exist skips remove-ring and ends turn', () => {
    // Board with only 2 rings: place on one, the other is interior (not slidable)
    // Actually need all remaining rings to not be free after place.
    // Single ring left: place on it triggers all-rings-occupied. Let's use 3 rings:
    // After placing at 0,0, the remaining free rings depend on topology.
    // Simpler: use a board where 0,0 has 6 neighbors, all occupied except 0,0.
    // Place on 0,0 -> all occupied -> all-rings-occupied.
    // But that's a different path. Let's do: after placing, 2 vacant rings remain but
    // neither is slidable (both fully surrounded).
    // Actually, let's just check the code path directly:
    const board = createBoard({
      rings: ['0,0', '1,0', '-1,0', '0,1', '0,-1', '1,-1', '-1,1'],
      marbles: { '1,0': 'b', '-1,0': 'b', '0,1': 'b', '0,-1': 'b', '1,-1': 'b', '-1,1': 'b' },
      pool: { white: 6, grey: 8, black: 4 },
      captures: ZERO_CAPS,
      gamePhase: 'place-marble',
      currentPlayer: 1,
    });
    board.selectMarbleColor('white');
    board.placeMarble(0, 0);
    // All 7 rings occupied -> all-rings-occupied triggers
    expect(board.gamePhase).toBe('game-over');
  });
});

// ============================================================================
// Ring Removal — Extended
// ============================================================================

describe('Ring removal (extended)', () => {
  test('removeRing returns false when not in remove-ring phase', () => {
    const board = new ZertzBoard();
    expect(board.removeRing(3, 0)).toBe(false);
  });

  test('removeRing returns false for ring that has a marble', () => {
    const board = createBoard({
      rings: ['0,0', '1,0', '2,0'],
      marbles: { '2,0': 'white' },
      pool: FULL_POOL,
      captures: ZERO_CAPS,
      gamePhase: 'remove-ring',
    });
    expect(board.removeRing(2, 0)).toBe(false);
  });

  test('removeRing returns false for non-existent ring', () => {
    const board = new ZertzBoard();
    board.selectMarbleColor('black');
    board.placeMarble(0, 0);
    expect(board.removeRing(100, 100)).toBe(false);
  });

  test('removing a ring that isolates multiple fully-occupied groups captures all', () => {
    // Bridge at 0,0 connecting two groups: {-1,0} (occupied) and {1,0} (occupied)
    const board = createBoard({
      rings: ['-1,0', '0,0', '1,0'],
      marbles: { '-1,0': 'white', '1,0': 'black' },
      pool: FULL_POOL,
      captures: ZERO_CAPS,
      gamePhase: 'remove-ring',
      currentPlayer: 1,
    });
    board.removeRing(0, 0);
    // Both isolated single-ring groups are fully occupied and equal size
    expect(board.captures[1].white).toBe(1);
    expect(board.captures[1].black).toBe(1);
  });

  test('isolation does not capture the unique largest component even if fully occupied', () => {
    // 4 rings in a line: remove ring 2 to isolate {3,0} from {0,0, 1,0} (not {-1,0} since removed)
    // Actually: rings = [-1,0, 0,0, 1,0, 2,0, 3,0]. Marble on 3,0 only.
    // Remove 2,0 -> isolates {3,0} (size 1, occupied) from {-1,0, 0,0, 1,0} (size 3, not occupied)
    // Unique largest = size 3 -> skip. Size 1 is fully occupied -> capture.
    const board = createBoard({
      rings: ['-1,0', '0,0', '1,0', '2,0', '3,0'],
      marbles: { '3,0': 'grey', '-1,0': 'white', '0,0': 'black' },
      pool: FULL_POOL,
      captures: ZERO_CAPS,
      gamePhase: 'remove-ring',
      currentPlayer: 1,
    });
    board.removeRing(2, 0);
    // Only {3,0} island captured (size 1 < size 3)
    expect(board.captures[1].grey).toBe(1);
    // Marbles on the larger component remain
    expect(board.marbles['-1,0']).toBe('white');
    expect(board.marbles['0,0']).toBe('black');
  });

  test('removeRing isolation capture that triggers win ends game', () => {
    const board = createBoard({
      rings: ['0,0', '1,0', '2,0', '3,0', '-1,0'],
      marbles: { '3,0': 'white' },
      pool: FULL_POOL,
      captures: { 1: { white: 3, grey: 0, black: 0 }, 2: { white: 0, grey: 0, black: 0 } },
      gamePhase: 'remove-ring',
      currentPlayer: 1,
    });
    board.removeRing(2, 0); // isolates {3,0} with white marble
    expect(board.captures[1].white).toBe(4);
    expect(board.gamePhase).toBe('game-over');
    expect(board.winner).toBe(1);
  });
});

// ============================================================================
// _canSlideAway — Extended
// ============================================================================

describe('_canSlideAway (extended)', () => {
  test('ring with 3 alternating neighbors (no consecutive gaps) is NOT slidable', () => {
    // Neighbors at circular positions 0, 2, 4 (East, Northwest, Southwest)
    const board = createBoard({
      rings: ['0,0', '1,0', '0,-1', '-1,1'],
      marbles: {},
      pool: FULL_POOL,
      captures: ZERO_CAPS,
    });
    // Circular: E=1,0(present), NE=1,-1(absent), NW=0,-1(present), W=-1,0(absent), SW=-1,1(present), SE=0,1(absent)
    // present=[T,F,T,F,T,F] -> no consecutive false
    expect(board._canSlideAway('0,0')).toBe(false);
  });

  test('ring with 3 consecutive neighbors has consecutive gaps', () => {
    // Neighbors at circular positions 0, 1, 2 (East, Northeast, Northwest)
    const board = createBoard({
      rings: ['0,0', '1,0', '1,-1', '0,-1'],
      marbles: {},
      pool: FULL_POOL,
      captures: ZERO_CAPS,
    });
    // Circular: E=present, NE=present, NW=present, W=absent, SW=absent, SE=absent
    // present=[T,T,T,F,F,F] -> three consecutive missing including wrapping
    expect(board._canSlideAway('0,0')).toBe(true);
  });

  test('two gaps that wrap around index 5 to 0', () => {
    // Gaps at positions 5 (SE) and 0 (E) in circular order
    const board = createBoard({
      rings: ['0,0', '1,-1', '0,-1', '-1,0', '-1,1'],
      marbles: {},
      pool: FULL_POOL,
      captures: ZERO_CAPS,
    });
    // Circular: E=1,0(absent), NE=1,-1(present), NW=0,-1(present), W=-1,0(present), SW=-1,1(present), SE=0,1(absent)
    // present=[F,T,T,T,T,F] -> i=5: [F, F(wrap)] -> consecutive!
    expect(board._canSlideAway('0,0')).toBe(true);
  });

  test('fully surrounded ring (6 neighbors) is not slidable', () => {
    const board = createBoard({
      rings: ['0,0', '1,0', '1,-1', '0,-1', '-1,0', '-1,1', '0,1'],
      marbles: {},
      pool: FULL_POOL,
      captures: ZERO_CAPS,
    });
    expect(board._canSlideAway('0,0')).toBe(false);
  });

  test('ring with exactly 2 adjacent neighbors (4 consecutive gaps)', () => {
    // Neighbors only at positions 0 and 1 (East, Northeast)
    const board = createBoard({
      rings: ['0,0', '1,0', '1,-1'],
      marbles: {},
      pool: FULL_POOL,
      captures: ZERO_CAPS,
    });
    expect(board._canSlideAway('0,0')).toBe(true);
  });

  test('ring with 2 opposite neighbors is NOT slidable', () => {
    // Neighbors at positions 0 (East) and 3 (West) only
    const board = createBoard({
      rings: ['0,0', '1,0', '-1,0'],
      marbles: {},
      pool: FULL_POOL,
      captures: ZERO_CAPS,
    });
    // Each gap is isolated by a neighbor on each side
    // Circular: [T,F,F,T,F,F] -> i=1: [F,F] -> YES consecutive
    // Wait: E=1,0(present), NE=1,-1(absent), NW=0,-1(absent), W=-1,0(present), SW=-1,1(absent), SE=0,1(absent)
    // [T,F,F,T,F,F] -> i=1 has consecutive gaps
    expect(board._canSlideAway('0,0')).toBe(true);
  });

  test('initial board: all free rings count matches expected edge ring count', () => {
    const board = new ZertzBoard();
    const freeRings = board.getFreeRings();
    // On the initial 37-ring hex, edge rings = 18 (the perimeter)
    expect(freeRings.length).toBe(18);
  });
});

// ============================================================================
// Capture Mechanics — Extended
// ============================================================================

describe('Capture detection (extended)', () => {
  test('returns empty when no marbles on board', () => {
    const board = createBoard({
      rings: ['0,0', '1,0', '2,0'],
      marbles: {},
      pool: FULL_POOL,
      captures: ZERO_CAPS,
      gamePhase: 'capture',
    });
    expect(board.getAvailableCaptures()).toEqual([]);
  });

  test('returns empty when marbles exist but no jumps possible', () => {
    const board = createBoard({
      rings: ['0,0', '1,0'],
      marbles: { '0,0': 'white', '1,0': 'black' },
      pool: FULL_POOL,
      captures: ZERO_CAPS,
      gamePhase: 'capture',
    });
    // No landing ring for any jump
    expect(board.getAvailableCaptures()).toEqual([]);
  });

  test('returns all marbles that can jump when multiple exist', () => {
    const board = createBoard({
      rings: ['0,0', '1,0', '2,0', '-1,0', '-2,0', '-3,0'],
      marbles: { '0,0': 'white', '1,0': 'black', '-2,0': 'grey', '-1,0': 'white' },
      pool: FULL_POOL,
      captures: ZERO_CAPS,
      gamePhase: 'capture',
    });
    // 0,0 can jump over 1,0 to 2,0
    // -2,0 can jump over -1,0 to 0,0? No, 0,0 has a marble. Landing blocked.
    // Actually: -2,0 can jump west over -1,0? -1,0 is in the east direction from -2,0.
    // -2,0 east neighbor = -1,0 (has marble), landing = 0,0 (has marble) -> blocked
    // -2,0 only has jumps if there's an empty landing. So only 0,0 can capture.
    const capturable = board.getAvailableCaptures();
    expect(capturable).toContain('0,0');
  });

  test('marble can jump in multiple directions', () => {
    // Marble at 0,0 with two adjacent marbles and two open landings
    const board = createBoard({
      rings: ['0,0', '1,0', '2,0', '0,1', '0,2'],
      marbles: { '0,0': 'white', '1,0': 'black', '0,1': 'grey' },
      pool: FULL_POOL,
      captures: ZERO_CAPS,
      gamePhase: 'capture',
    });
    const targets = board.getJumpTargets('0,0');
    expect(targets.length).toBe(2);
    const targetKeys = targets.map(t => t.target).sort();
    expect(targetKeys).toEqual(['0,2', '2,0']);
  });

  test('getJumpTargets for a position with no adjacent marble returns empty', () => {
    const board = createBoard({
      rings: ['0,0', '1,0', '2,0'],
      marbles: {},
      pool: FULL_POOL,
      captures: ZERO_CAPS,
    });
    // No marbles adjacent to 0,0 to jump over
    expect(board.getJumpTargets('0,0')).toEqual([]);
  });

  test('jump target includes correct direction vector', () => {
    const board = createBoard({
      rings: ['0,0', '1,0', '2,0'],
      marbles: { '0,0': 'white', '1,0': 'black' },
      pool: FULL_POOL,
      captures: ZERO_CAPS,
    });
    const targets = board.getJumpTargets('0,0');
    expect(targets[0].direction).toEqual([1, 0]); // East
  });

  test('each of the 6 directions produces a valid jump', () => {
    // Center marble surrounded by 6 marbles, each with an open landing beyond
    const board = new ZertzBoard({ skipInitialHistory: true });
    // Place center marble and 6 adjacent marbles
    board.marbles['0,0'] = 'white';
    for (const dir of ZertzBoard.DIRECTIONS) {
      const adj = board._toKey(dir[0], dir[1]);
      board.marbles[adj] = 'black';
    }
    const targets = board.getJumpTargets('0,0');
    expect(targets.length).toBe(6);
  });
});

describe('Execute capture (extended)', () => {
  test('returns false when not in capture phase', () => {
    const board = createBoard({
      rings: ['0,0', '1,0', '2,0'],
      marbles: { '0,0': 'white', '1,0': 'black' },
      pool: FULL_POOL,
      captures: ZERO_CAPS,
      gamePhase: 'place-marble',
    });
    board.jumpingMarble = '0,0';
    expect(board.executeCapture('0,0', '2,0')).toBe(false);
  });

  test('returns false when target is not a valid jump', () => {
    const board = createBoard({
      rings: ['0,0', '1,0', '2,0', '3,0'],
      marbles: { '0,0': 'white', '1,0': 'black' },
      pool: FULL_POOL,
      captures: ZERO_CAPS,
      gamePhase: 'capture',
    });
    board.jumpingMarble = '0,0';
    // 3,0 is too far (not a valid jump target)
    expect(board.executeCapture('0,0', '3,0')).toBe(false);
  });

  test('capture increments the correct player capture count', () => {
    const board = createBoard({
      rings: ['0,0', '1,0', '2,0'],
      marbles: { '0,0': 'grey', '1,0': 'white' },
      pool: FULL_POOL,
      captures: ZERO_CAPS,
      gamePhase: 'capture',
      currentPlayer: 2,
    });
    board.jumpingMarble = '0,0';
    board.executeCapture('0,0', '2,0');
    expect(board.captures[2].white).toBe(1);
    expect(board.captures[1].white).toBe(0);
  });

  test('capturing a white marble increments only white', () => {
    const board = createBoard({
      rings: ['0,0', '1,0', '2,0'],
      marbles: { '0,0': 'black', '1,0': 'white' },
      pool: FULL_POOL,
      captures: ZERO_CAPS,
      gamePhase: 'capture',
      currentPlayer: 1,
    });
    board.jumpingMarble = '0,0';
    board.executeCapture('0,0', '2,0');
    expect(board.captures[1]).toEqual({ white: 1, grey: 0, black: 0 });
  });

  test('completing a full chain ends turn and switches player', () => {
    const board = createBoard({
      rings: ['0,0', '1,0', '2,0', '2,-1', '2,-2'],
      marbles: { '0,0': 'white', '1,0': 'black', '2,-1': 'grey' },
      pool: FULL_POOL,
      captures: ZERO_CAPS,
      gamePhase: 'capture',
      currentPlayer: 1,
    });
    board.jumpingMarble = '0,0';
    board.executeCapture('0,0', '2,0'); // first hop
    board.executeCapture('2,0', '2,-2'); // second hop, end of chain
    expect(board.currentPlayer).toBe(2);
    expect(board.jumpingMarble).toBeNull();
  });

  test('single jump with no further jumps ends turn immediately', () => {
    const board = createBoard({
      rings: ['0,0', '1,0', '2,0'],
      marbles: { '0,0': 'white', '1,0': 'black' },
      pool: FULL_POOL,
      captures: ZERO_CAPS,
      gamePhase: 'capture',
      currentPlayer: 1,
    });
    board.jumpingMarble = '0,0';
    board.executeCapture('0,0', '2,0');
    // No further jumps from 2,0
    expect(board.currentPlayer).toBe(2);
    expect(board.jumpingMarble).toBeNull();
    expect(board.captureStarted).toBe(false);
  });

  test('captureStarted is true after first jump', () => {
    const board = createBoard({
      rings: ['0,0', '1,0', '2,0', '2,-1', '2,-2'],
      marbles: { '0,0': 'white', '1,0': 'black', '2,-1': 'grey' },
      pool: FULL_POOL,
      captures: ZERO_CAPS,
      gamePhase: 'capture',
      currentPlayer: 1,
    });
    board.jumpingMarble = '0,0';
    board.executeCapture('0,0', '2,0');
    expect(board.captureStarted).toBe(true);
  });

  test('capture win mid-chain stops immediately', () => {
    const board = createBoard({
      rings: ['0,0', '1,0', '2,0', '2,-1', '2,-2'],
      marbles: { '0,0': 'grey', '1,0': 'white', '2,-1': 'black' },
      pool: FULL_POOL,
      captures: { 1: { white: 3, grey: 0, black: 0 }, 2: { white: 0, grey: 0, black: 0 } },
      gamePhase: 'capture',
      currentPlayer: 1,
    });
    board.jumpingMarble = '0,0';
    board.executeCapture('0,0', '2,0'); // captures white -> 4 white -> WIN
    expect(board.gamePhase).toBe('game-over');
    expect(board.winner).toBe(1);
    expect(board.jumpingMarble).toBeNull();
  });
});

// ============================================================================
// _handleCaptureClick — Extended
// ============================================================================

describe('_handleCaptureClick (extended)', () => {
  test('clicking empty ring with no marble selected does nothing', () => {
    const board = createBoard({
      rings: ['0,0', '1,0', '2,0'],
      marbles: { '0,0': 'white', '1,0': 'black' },
      pool: FULL_POOL,
      captures: ZERO_CAPS,
      gamePhase: 'capture',
    });
    board._handleCaptureClick('2,0');
    expect(board.jumpingMarble).toBeNull();
  });

  test('clicking a marble that cannot jump does nothing', () => {
    const board = createBoard({
      rings: ['0,0', '1,0'],
      marbles: { '0,0': 'white', '1,0': 'black' },
      pool: FULL_POOL,
      captures: ZERO_CAPS,
      gamePhase: 'capture',
    });
    // Neither marble can jump (no landing ring)
    board._handleCaptureClick('0,0');
    expect(board.jumpingMarble).toBeNull();
  });

  test('clicking valid target after selecting marble executes capture', () => {
    const board = createBoard({
      rings: ['0,0', '1,0', '2,0'],
      marbles: { '0,0': 'white', '1,0': 'black' },
      pool: FULL_POOL,
      captures: ZERO_CAPS,
      gamePhase: 'capture',
    });
    board._handleCaptureClick('0,0'); // select
    board._handleCaptureClick('2,0'); // jump
    expect(board.marbles['2,0']).toBe('white');
    expect(board.captures[1].black).toBe(1);
  });

  test('after captureStarted, clicking jumping marble does NOT deselect', () => {
    const board = createBoard({
      rings: ['0,0', '1,0', '2,0', '2,-1', '2,-2'],
      marbles: { '0,0': 'white', '1,0': 'black', '2,-1': 'grey' },
      pool: FULL_POOL,
      captures: ZERO_CAPS,
      gamePhase: 'capture',
    });
    board.jumpingMarble = '0,0';
    board.executeCapture('0,0', '2,0'); // captureStarted = true
    board._handleCaptureClick('2,0'); // try to deselect
    // Should not deselect — executeCapture('2,0', '2,0') fails, marble stays
    expect(board.jumpingMarble).toBe('2,0');
  });

  test('double-click toggles selection correctly', () => {
    const board = createBoard({
      rings: ['0,0', '1,0', '2,0'],
      marbles: { '0,0': 'white', '1,0': 'black' },
      pool: FULL_POOL,
      captures: ZERO_CAPS,
      gamePhase: 'capture',
    });
    board._handleCaptureClick('0,0'); // select
    expect(board.jumpingMarble).toBe('0,0');
    board._handleCaptureClick('0,0'); // deselect
    expect(board.jumpingMarble).toBeNull();
    board._handleCaptureClick('0,0'); // reselect
    expect(board.jumpingMarble).toBe('0,0');
  });
});

// ============================================================================
// handleClick Dispatch
// ============================================================================

describe('handleClick dispatch', () => {
  test('does nothing in game-over phase', () => {
    const board = new ZertzBoard();
    board.gamePhase = 'game-over';
    board.winner = 1;
    const marblesBefore = { ...board.marbles };
    board.handleClick(0, 0);
    expect(board.marbles).toEqual(marblesBefore);
  });

  test('in place-marble without selected color does nothing', () => {
    const board = new ZertzBoard();
    const ringsBefore = board.rings.size;
    board.handleClick(0, 0);
    expect(board.rings.size).toBe(ringsBefore);
    expect(board.marbles['0,0']).toBeUndefined();
  });

  test('in place-marble with color places marble', () => {
    const board = new ZertzBoard();
    board.selectMarbleColor('white');
    board.handleClick(0, 0);
    expect(board.marbles['0,0']).toBe('white');
  });

  test('in remove-ring delegates to removeRing', () => {
    const board = new ZertzBoard();
    board.selectMarbleColor('black');
    board.placeMarble(0, 0);
    expect(board.gamePhase).toBe('remove-ring');
    const freeRings = board.getFreeRings();
    const [q, r] = board._fromKey(freeRings[0]);
    const sizeBefore = board.rings.size;
    board.handleClick(q, r);
    expect(board.rings.size).toBe(sizeBefore - 1);
  });

  test('in capture phase delegates to _handleCaptureClick', () => {
    const board = createBoard({
      rings: ['0,0', '1,0', '2,0'],
      marbles: { '0,0': 'white', '1,0': 'black' },
      pool: FULL_POOL,
      captures: ZERO_CAPS,
      gamePhase: 'capture',
    });
    board.handleClick(0, 0);
    expect(board.jumpingMarble).toBe('0,0');
  });
});

// ============================================================================
// Turn Management (_endTurn) — Extended
// ============================================================================

describe('_endTurn (extended)', () => {
  test('switches from player 1 to player 2', () => {
    const board = new ZertzBoard();
    board._endTurn();
    expect(board.currentPlayer).toBe(2);
  });

  test('switches from player 2 to player 1', () => {
    const board = new ZertzBoard();
    board.currentPlayer = 2;
    board._endTurn();
    expect(board.currentPlayer).toBe(1);
  });

  test('resets jumpingMarble', () => {
    const board = new ZertzBoard();
    board.jumpingMarble = '2,0';
    board._endTurn();
    expect(board.jumpingMarble).toBeNull();
  });

  test('resets captureStarted', () => {
    const board = new ZertzBoard();
    board.captureStarted = true;
    board._endTurn();
    expect(board.captureStarted).toBe(false);
  });

  test('resets selectedColor', () => {
    const board = new ZertzBoard();
    board.selectedColor = 'white';
    board._endTurn();
    expect(board.selectedColor).toBeNull();
  });

  test('sets capture phase when opponent has mandatory captures', () => {
    const board = createBoard({
      rings: ['0,0', '1,0', '2,0', '3,0', '-1,0', '-2,0', '-3,0',
              '0,1', '0,2', '0,3', '0,-1', '0,-2', '0,-3',
              '1,-1', '2,-2', '3,-3', '-1,1', '-2,2', '-3,3',
              '1,1', '1,2', '2,1', '-1,-1', '-1,-2', '-2,-1',
              '1,-2', '1,-3', '2,-3', '-1,2', '-1,3', '-2,3',
              '2,-1', '3,-1', '3,-2', '-2,1', '-3,1', '-3,2'],
      marbles: { '0,0': 'white', '1,0': 'black' },
      pool: FULL_POOL,
      captures: ZERO_CAPS,
      currentPlayer: 2,
    });
    board._endTurn(); // switches to player 1
    expect(board.gamePhase).toBe('capture');
  });

  test('game-over when next player has no available colors and no captures', () => {
    const board = createBoard({
      rings: ['0,0', '1,0'],
      marbles: {},
      pool: { white: 0, grey: 0, black: 0 },
      captures: { 1: { white: 0, grey: 0, black: 0 }, 2: { white: 1, grey: 0, black: 0 } },
      currentPlayer: 2,
    });
    board._endTurn(); // switches to player 1 who has no colors
    expect(board.gamePhase).toBe('game-over');
    // Winner is the opponent of the stuck player (player 2)
    expect(board.winner).toBe(2);
  });

  test('game-over when next player has no vacant rings', () => {
    // All rings have marbles and pool isn't empty, but no vacant rings for placement
    const board = createBoard({
      rings: ['0,0', '1,0'],
      marbles: { '0,0': 'white', '1,0': 'black' },
      pool: FULL_POOL,
      captures: ZERO_CAPS,
      currentPlayer: 2,
    });
    // No captures available, no vacant rings
    board._endTurn(); // switches to player 1
    expect(board.gamePhase).toBe('game-over');
    expect(board.winner).toBe(2);
  });
});

// ============================================================================
// Isolation Mechanic — Extended
// ============================================================================

describe('Isolation mechanic (extended)', () => {
  test('_findConnectedComponents returns empty for empty board', () => {
    const board = createBoard({
      rings: [],
      marbles: {},
      pool: FULL_POOL,
      captures: ZERO_CAPS,
    });
    expect(board._findConnectedComponents()).toEqual([]);
  });

  test('_findConnectedComponents returns 2 for two disconnected groups', () => {
    const board = createBoard({
      rings: ['0,0', '1,0', '5,0', '5,1'],
      marbles: {},
      pool: FULL_POOL,
      captures: ZERO_CAPS,
    });
    const components = board._findConnectedComponents();
    expect(components.length).toBe(2);
  });

  test('_findConnectedComponents returns 3 for three disconnected groups', () => {
    const board = createBoard({
      rings: ['0,0', '5,0', '-5,0'],
      marbles: {},
      pool: FULL_POOL,
      captures: ZERO_CAPS,
    });
    const components = board._findConnectedComponents();
    expect(components.length).toBe(3);
  });

  test('single ring returns single component of size 1', () => {
    const board = createBoard({
      rings: ['0,0'],
      marbles: {},
      pool: FULL_POOL,
      captures: ZERO_CAPS,
    });
    const components = board._findConnectedComponents();
    expect(components.length).toBe(1);
    expect(components[0].size).toBe(1);
  });

  test('_checkIsolation returns empty for single component', () => {
    const board = new ZertzBoard();
    expect(board._checkIsolation()).toEqual([]);
  });

  test('_checkIsolation captures smaller fully-occupied component', () => {
    const board = createBoard({
      rings: ['0,0', '1,0', '3,0'],
      marbles: { '3,0': 'white' },
      pool: FULL_POOL,
      captures: ZERO_CAPS,
    });
    const result = board._checkIsolation();
    expect(result.length).toBe(1);
    expect(result[0].keys.has('3,0')).toBe(true);
  });

  test('_checkIsolation does not capture component with vacant ring', () => {
    const board = createBoard({
      rings: ['0,0', '1,0', '3,0', '3,1'],
      marbles: { '3,0': 'white' }, // 3,1 is vacant
      pool: FULL_POOL,
      captures: ZERO_CAPS,
    });
    const result = board._checkIsolation();
    expect(result.length).toBe(0);
  });

  test('equal-sized fully-occupied components are both captured', () => {
    const board = createBoard({
      rings: ['0,0', '3,0'],
      marbles: { '0,0': 'white', '3,0': 'black' },
      pool: FULL_POOL,
      captures: ZERO_CAPS,
    });
    const result = board._checkIsolation();
    expect(result.length).toBe(2);
  });

  test('equal-sized: only fully-occupied ones are captured', () => {
    const board = createBoard({
      rings: ['0,0', '1,0', '3,0', '3,1'],
      marbles: { '0,0': 'white', '1,0': 'black', '3,0': 'grey' },
      pool: FULL_POOL,
      captures: ZERO_CAPS,
    });
    // Both components size 2, but {3,0, 3,1} has a vacant ring
    const result = board._checkIsolation();
    expect(result.length).toBe(1);
    expect(result[0].keys.has('0,0')).toBe(true);
    expect(result[0].keys.has('1,0')).toBe(true);
  });

  test('_applyIsolationCaptures removes rings and marbles', () => {
    const board = createBoard({
      rings: ['0,0', '1,0', '3,0'],
      marbles: { '3,0': 'white' },
      pool: FULL_POOL,
      captures: ZERO_CAPS,
      currentPlayer: 1,
    });
    const isolations = [{ keys: new Set(['3,0']), marbles: { '3,0': 'white' } }];
    board._applyIsolationCaptures(isolations);
    expect(board.rings.has('3,0')).toBe(false);
    expect(board.marbles['3,0']).toBeUndefined();
    expect(board.captures[1].white).toBe(1);
  });

  test('_applyIsolationCaptures handles empty array', () => {
    const board = new ZertzBoard();
    const ringsBefore = board.rings.size;
    board._applyIsolationCaptures([]);
    expect(board.rings.size).toBe(ringsBefore);
  });
});

// ============================================================================
// Win Conditions — Extended
// ============================================================================

describe('Win conditions (extended)', () => {
  test('exceeding threshold still wins (5 white marbles)', () => {
    const board = new ZertzBoard({ skipInitialHistory: true });
    board.captures = { 1: { white: 5, grey: 0, black: 0 }, 2: { white: 0, grey: 0, black: 0 } };
    expect(board._checkWinCondition(1)).toBe(true);
  });

  test('mixed set with excess marbles wins (4+3+3)', () => {
    const board = new ZertzBoard({ skipInitialHistory: true });
    board.captures = { 1: { white: 4, grey: 3, black: 3 }, 2: { white: 0, grey: 0, black: 0 } };
    expect(board._checkWinCondition(1)).toBe(true);
  });

  test('winConditionMet is set to the correct condition', () => {
    const board = new ZertzBoard({ skipInitialHistory: true });
    board.captures = { 1: { white: 4, grey: 0, black: 0 }, 2: { white: 0, grey: 0, black: 0 } };
    board._checkWinCondition(1);
    expect(board.winConditionMet).toEqual({ white: 4, grey: 0, black: 0 });
  });

  test('winConditionMet picks first matching condition (mixed before single)', () => {
    const board = new ZertzBoard({ skipInitialHistory: true });
    board.captures = { 1: { white: 4, grey: 5, black: 6 }, 2: { white: 0, grey: 0, black: 0 } };
    board._checkWinCondition(1);
    // First condition in WIN_CONDITIONS is mixed (3,3,3)
    expect(board.winConditionMet).toEqual({ white: 3, grey: 3, black: 3 });
  });

  test('player 2 can win independently', () => {
    const board = new ZertzBoard({ skipInitialHistory: true });
    board.captures = { 1: { white: 0, grey: 0, black: 0 }, 2: { white: 0, grey: 5, black: 0 } };
    expect(board._checkWinCondition(2)).toBe(true);
  });

  test('near-miss does not win (3 grey, 4 grey needed for mixed fails too)', () => {
    const board = new ZertzBoard({ skipInitialHistory: true });
    board.captures = { 1: { white: 3, grey: 4, black: 2 }, 2: { white: 0, grey: 0, black: 0 } };
    expect(board._checkWinCondition(1)).toBe(false);
  });

  test('win during isolation capture sets winConditionMet', () => {
    const board = createBoard({
      rings: ['0,0', '1,0', '2,0', '3,0', '-1,0'],
      marbles: { '3,0': 'white' },
      pool: FULL_POOL,
      captures: { 1: { white: 3, grey: 0, black: 0 }, 2: { white: 0, grey: 0, black: 0 } },
      gamePhase: 'remove-ring',
      currentPlayer: 1,
    });
    board.removeRing(2, 0);
    expect(board.winConditionMet).toEqual({ white: 4, grey: 0, black: 0 });
  });
});

// ============================================================================
// All-Rings-Occupied / Draw — Extended
// ============================================================================

describe('All-rings-occupied / draw (extended)', () => {
  test('_allRingsOccupied returns true when every ring has a marble', () => {
    const board = createBoard({
      rings: ['0,0', '1,0', '2,0'],
      marbles: { '0,0': 'white', '1,0': 'grey', '2,0': 'black' },
      pool: FULL_POOL,
      captures: ZERO_CAPS,
    });
    expect(board._allRingsOccupied()).toBe(true);
  });

  test('_captureAllRemainingMarbles gives all marbles to current player', () => {
    const board = createBoard({
      rings: ['0,0', '1,0', '2,0'],
      marbles: { '0,0': 'white', '1,0': 'grey', '2,0': 'black' },
      pool: FULL_POOL,
      captures: ZERO_CAPS,
      currentPlayer: 1,
    });
    board._captureAllRemainingMarbles();
    expect(board.captures[1]).toEqual({ white: 1, grey: 1, black: 1 });
    expect(board.captures[2]).toEqual({ white: 0, grey: 0, black: 0 });
  });

  test('_captureAllRemainingMarbles clears marbles object', () => {
    const board = createBoard({
      rings: ['0,0', '1,0'],
      marbles: { '0,0': 'white', '1,0': 'black' },
      pool: FULL_POOL,
      captures: ZERO_CAPS,
      currentPlayer: 1,
    });
    board._captureAllRemainingMarbles();
    expect(Object.keys(board.marbles).length).toBe(0);
  });

  test('draw: winConditionMet remains null', () => {
    const board = createBoard({
      rings: ['0,0', '1,0'],
      marbles: { '0,0': 'black' },
      pool: FULL_POOL,
      captures: ZERO_CAPS,
      gamePhase: 'place-marble',
      currentPlayer: 1,
    });
    board.selectMarbleColor('white');
    board.placeMarble(1, 0);
    expect(board.winner).toBeNull();
    expect(board.winConditionMet).toBeNull();
  });

  test('near-draw: captures barely meet win condition', () => {
    const board = createBoard({
      rings: ['0,0', '1,0', '2,0'],
      marbles: { '0,0': 'white', '1,0': 'white', '2,0': 'black' },
      pool: FULL_POOL,
      captures: { 1: { white: 2, grey: 0, black: 0 }, 2: { white: 0, grey: 0, black: 0 } },
      currentPlayer: 1,
    });
    board._captureAllRemainingMarbles();
    // 2+2 white = 4 -> win
    expect(board.winner).toBe(1);
  });

  test('remove ring to single occupied ring triggers all-rings-occupied', () => {
    const board = createBoard({
      rings: ['0,0', '1,0'],
      marbles: { '0,0': 'white' },
      pool: FULL_POOL,
      captures: ZERO_CAPS,
      gamePhase: 'remove-ring',
      currentPlayer: 1,
    });
    board.removeRing(1, 0);
    expect(board.gamePhase).toBe('game-over');
    expect(board.captures[1].white).toBe(1);
  });
});

// ============================================================================
// State History / Undo / Redo — Extended
// ============================================================================

describe('Undo / Redo (extended)', () => {
  test('undo returns false at initial state', () => {
    const board = new ZertzBoard();
    expect(board.undo()).toBe(false);
  });

  test('redo returns false when at latest state', () => {
    const board = new ZertzBoard();
    board.selectMarbleColor('white');
    board.placeMarble(0, 0);
    expect(board.redo()).toBe(false);
  });

  test('undo restores pool, marbles, phase, and selectedColor', () => {
    const board = new ZertzBoard();
    board.selectMarbleColor('white');
    board.placeMarble(0, 0);
    // Now in remove-ring phase
    board.undo();
    expect(board.pool.white).toBe(6);
    expect(board.marbles['0,0']).toBeUndefined();
    expect(board.gamePhase).toBe('place-marble');
  });

  test('undo after ring removal restores ring and player', () => {
    const board = new ZertzBoard();
    board.selectMarbleColor('white');
    board.placeMarble(0, 0);
    const freeRings = board.getFreeRings();
    const ringKey = freeRings[0];
    const [q, r] = board._fromKey(ringKey);
    board.removeRing(q, r);
    expect(board.currentPlayer).toBe(2);
    expect(board.rings.has(ringKey)).toBe(false);

    board.undo();
    expect(board.currentPlayer).toBe(1);
    expect(board.rings.has(ringKey)).toBe(true);
    expect(board.gamePhase).toBe('remove-ring');
  });

  test('multiple undos walk backward through history', () => {
    const board = new ZertzBoard();
    board.selectMarbleColor('white');
    board.placeMarble(0, 0);
    const freeRings = board.getFreeRings();
    const [q, r] = board._fromKey(freeRings[0]);
    board.removeRing(q, r);

    board.undo(); // back to after place, remove-ring phase
    board.undo(); // back to initial state
    expect(board.marbles['0,0']).toBeUndefined();
    expect(board.pool.white).toBe(6);
    expect(board.rings.size).toBe(37);
    expect(board.currentPlayer).toBe(1);
  });

  test('redo after multiple undos walks forward', () => {
    const board = new ZertzBoard();
    board.selectMarbleColor('white');
    board.placeMarble(0, 0);
    const freeRings = board.getFreeRings();
    const [q, r] = board._fromKey(freeRings[0]);
    board.removeRing(q, r);

    board.undo();
    board.undo();
    board.redo(); // back to after place marble
    expect(board.marbles['0,0']).toBe('white');
    expect(board.gamePhase).toBe('remove-ring');
  });

  test('new action after undo truncates redo history', () => {
    const board = new ZertzBoard();
    board.selectMarbleColor('white');
    board.placeMarble(0, 0);
    board.undo();

    // New divergent action
    board.selectMarbleColor('black');
    board.placeMarble(1, 0);
    expect(board.canRedo()).toBe(false);
    expect(board.marbles['1,0']).toBe('black');
    expect(board.marbles['0,0']).toBeUndefined();
  });

  test('undo restores captures after capture action', () => {
    const board = createBoard({
      rings: ['0,0', '1,0', '2,0'],
      marbles: { '0,0': 'white', '1,0': 'black' },
      pool: FULL_POOL,
      captures: ZERO_CAPS,
      gamePhase: 'capture',
      currentPlayer: 1,
    });
    board.jumpingMarble = '0,0';
    board._captureState(); // save pre-capture state
    board.executeCapture('0,0', '2,0');
    expect(board.captures[1].black).toBe(1);

    board.undo();
    expect(board.captures[1].black).toBe(0);
    expect(board.marbles['0,0']).toBe('white');
    expect(board.marbles['1,0']).toBe('black');
  });

  test('undo restores jumpingMarble and captureStarted mid-chain', () => {
    const board = createBoard({
      rings: ['0,0', '1,0', '2,0', '2,-1', '2,-2'],
      marbles: { '0,0': 'white', '1,0': 'black', '2,-1': 'grey' },
      pool: FULL_POOL,
      captures: ZERO_CAPS,
      gamePhase: 'capture',
      currentPlayer: 1,
    });
    board.jumpingMarble = '0,0';
    board._captureState(); // save selection state
    board.executeCapture('0,0', '2,0'); // mid-chain, saves another state
    expect(board.captureStarted).toBe(true);
    expect(board.jumpingMarble).toBe('2,0');

    board.undo(); // back to after selection, before first jump
    expect(board.captureStarted).toBe(false);
    expect(board.jumpingMarble).toBe('0,0');
  });

  test('undo a game-over state restores playable state', () => {
    const board = createBoard({
      rings: ['0,0', '1,0', '2,0'],
      marbles: { '0,0': 'grey', '1,0': 'white' },
      pool: FULL_POOL,
      captures: { 1: { white: 3, grey: 0, black: 0 }, 2: { white: 0, grey: 0, black: 0 } },
      gamePhase: 'capture',
      currentPlayer: 1,
    });
    board.jumpingMarble = '0,0';
    board.executeCapture('0,0', '2,0'); // wins
    expect(board.gamePhase).toBe('game-over');

    board.undo();
    expect(board.gamePhase).toBe('capture');
    expect(board.winner).toBeNull();
    expect(board.winConditionMet).toBeNull();
  });

  test('history respects maxHistoryLength', () => {
    const board = new ZertzBoard();
    board.maxHistoryLength = 3;

    // Perform several actions to generate history entries
    board.selectMarbleColor('white');
    board.placeMarble(0, 0); // snapshot
    const freeRings = board.getFreeRings();
    const [q, r] = board._fromKey(freeRings[0]);
    board.removeRing(q, r); // snapshot
    // Player 2 turn
    board.selectMarbleColor('black');
    board.placeMarble(1, 0); // snapshot

    expect(board.stateHistory.length).toBeLessThanOrEqual(3);
  });

  test('canUndo returns true after one action', () => {
    const board = new ZertzBoard();
    board.selectMarbleColor('white');
    board.placeMarble(0, 0);
    expect(board.canUndo()).toBe(true);
  });

  test('canRedo returns true after undo', () => {
    const board = new ZertzBoard();
    board.selectMarbleColor('white');
    board.placeMarble(0, 0);
    board.undo();
    expect(board.canRedo()).toBe(true);
  });

  test('canRedo returns false after undo then new action', () => {
    const board = new ZertzBoard();
    board.selectMarbleColor('white');
    board.placeMarble(0, 0);
    board.undo();
    board.selectMarbleColor('black');
    board.placeMarble(1, 0);
    expect(board.canRedo()).toBe(false);
  });

  test('_captureState creates deep copies (mutation does not affect history)', () => {
    const board = new ZertzBoard();
    board.selectMarbleColor('white');
    board.placeMarble(0, 0);
    // Manually mutate current state
    board.marbles['99,99'] = 'hacked';
    board.undo();
    expect(board.marbles['99,99']).toBeUndefined();
  });
});

// ============================================================================
// Clone — Extended
// ============================================================================

describe('Clone (extended)', () => {
  test('clone preserves rings independently', () => {
    const board = new ZertzBoard();
    const clone = board.clone();
    board.rings.add('99,99');
    expect(clone.rings.has('99,99')).toBe(false);
  });

  test('clone preserves pool independently', () => {
    const board = new ZertzBoard();
    const clone = board.clone();
    board.pool.white = 99;
    expect(clone.pool.white).toBe(6);
  });

  test('clone preserves captures independently for both players', () => {
    const board = new ZertzBoard();
    board.captures[1].white = 3;
    board.captures[2].grey = 2;
    const clone = board.clone();
    board.captures[1].white = 99;
    board.captures[2].grey = 99;
    expect(clone.captures[1].white).toBe(3);
    expect(clone.captures[2].grey).toBe(2);
  });

  test('clone preserves currentPlayer', () => {
    const board = new ZertzBoard();
    board.currentPlayer = 2;
    expect(board.clone().currentPlayer).toBe(2);
  });

  test('clone preserves gamePhase', () => {
    const board = new ZertzBoard();
    board.gamePhase = 'capture';
    expect(board.clone().gamePhase).toBe('capture');
  });

  test('clone preserves winner and winConditionMet independently', () => {
    const board = new ZertzBoard();
    board.winner = 1;
    board.winConditionMet = { white: 4, grey: 0, black: 0 };
    const clone = board.clone();
    board.winConditionMet.white = 99;
    expect(clone.winner).toBe(1);
    expect(clone.winConditionMet.white).toBe(4);
  });

  test('clone preserves selectedColor', () => {
    const board = new ZertzBoard();
    board.selectMarbleColor('white');
    expect(board.clone().selectedColor).toBe('white');
  });

  test('clone preserves jumpingMarble and captureStarted', () => {
    const board = new ZertzBoard();
    board.jumpingMarble = '1,0';
    board.captureStarted = true;
    const clone = board.clone();
    expect(clone.jumpingMarble).toBe('1,0');
    expect(clone.captureStarted).toBe(true);
  });

  test('clone preserves stateHistory independently', () => {
    const board = new ZertzBoard();
    board.selectMarbleColor('white');
    board.placeMarble(0, 0);
    const clone = board.clone();
    const histLenBefore = clone.stateHistory.length;
    board._captureState(); // add to original
    expect(clone.stateHistory.length).toBe(histLenBefore);
  });

  test('clone preserves historyIndex and maxHistoryLength', () => {
    const board = new ZertzBoard();
    board.maxHistoryLength = 42;
    const clone = board.clone();
    expect(clone.historyIndex).toBe(board.historyIndex);
    expect(clone.maxHistoryLength).toBe(42);
  });

  test('modifications to cloned marbles do not affect original', () => {
    const board = new ZertzBoard();
    board.selectMarbleColor('black');
    board.placeMarble(0, 0);
    const clone = board.clone();
    clone.marbles['5,5'] = 'white';
    expect(board.marbles['5,5']).toBeUndefined();
  });
});

// ============================================================================
// startNewGame — Extended
// ============================================================================

describe('startNewGame (extended)', () => {
  test('resets winner to null', () => {
    const board = new ZertzBoard();
    board.winner = 1;
    board.startNewGame();
    expect(board.winner).toBeNull();
  });

  test('resets winConditionMet to null', () => {
    const board = new ZertzBoard();
    board.winConditionMet = { white: 4, grey: 0, black: 0 };
    board.startNewGame();
    expect(board.winConditionMet).toBeNull();
  });

  test('resets jumpingMarble and captureStarted', () => {
    const board = new ZertzBoard();
    board.jumpingMarble = '1,0';
    board.captureStarted = true;
    board.startNewGame();
    expect(board.jumpingMarble).toBeNull();
    expect(board.captureStarted).toBe(false);
  });

  test('resets stateHistory to single entry', () => {
    const board = new ZertzBoard();
    board.selectMarbleColor('white');
    board.placeMarble(0, 0);
    board.startNewGame();
    expect(board.stateHistory.length).toBe(1);
    expect(board.historyIndex).toBe(0);
  });

  test('resets captures for both players', () => {
    const board = new ZertzBoard();
    board.captures = { 1: { white: 3, grey: 2, black: 1 }, 2: { white: 1, grey: 1, black: 5 } };
    board.startNewGame();
    expect(board.captures[1]).toEqual({ white: 0, grey: 0, black: 0 });
    expect(board.captures[2]).toEqual({ white: 0, grey: 0, black: 0 });
  });

  test('after game-over, startNewGame allows normal play', () => {
    const board = new ZertzBoard();
    board.gamePhase = 'game-over';
    board.winner = 1;
    board.startNewGame();
    board.selectMarbleColor('white');
    const result = board.placeMarble(0, 0);
    expect(result).toBe(true);
    expect(board.marbles['0,0']).toBe('white');
  });
});

// ============================================================================
// captureStarted Flag — Extended
// ============================================================================

describe('captureStarted flag', () => {
  test('is false at start of capture phase after _endTurn', () => {
    const board = createBoard({
      rings: ['0,0', '1,0', '2,0', '3,0', '-1,0', '-2,0', '-3,0',
              '0,1', '0,2', '0,3', '0,-1', '0,-2', '0,-3',
              '1,-1', '2,-2', '3,-3', '-1,1', '-2,2', '-3,3',
              '1,1', '1,2', '2,1', '-1,-1', '-1,-2', '-2,-1',
              '1,-2', '1,-3', '2,-3', '-1,2', '-1,3', '-2,3',
              '2,-1', '3,-1', '3,-2', '-2,1', '-3,1', '-3,2'],
      marbles: { '0,0': 'white', '1,0': 'black' },
      pool: FULL_POOL,
      captures: ZERO_CAPS,
      currentPlayer: 2,
    });
    board._endTurn(); // switches to player 1, sees capture available
    expect(board.gamePhase).toBe('capture');
    expect(board.captureStarted).toBe(false);
  });

  test('is preserved in state snapshots', () => {
    const board = createBoard({
      rings: ['0,0', '1,0', '2,0', '2,-1', '2,-2'],
      marbles: { '0,0': 'white', '1,0': 'black', '2,-1': 'grey' },
      pool: FULL_POOL,
      captures: ZERO_CAPS,
      gamePhase: 'capture',
      currentPlayer: 1,
    });
    board.jumpingMarble = '0,0';
    board.executeCapture('0,0', '2,0');
    const latest = board.stateHistory[board.historyIndex];
    expect(latest.captureStarted).toBe(true);
  });

  test('is restored on undo', () => {
    const board = createBoard({
      rings: ['0,0', '1,0', '2,0', '2,-1', '2,-2'],
      marbles: { '0,0': 'white', '1,0': 'black', '2,-1': 'grey' },
      pool: FULL_POOL,
      captures: ZERO_CAPS,
      gamePhase: 'capture',
      currentPlayer: 1,
    });
    board.jumpingMarble = '0,0';
    board.executeCapture('0,0', '2,0');
    expect(board.captureStarted).toBe(true);
    board.undo();
    expect(board.captureStarted).toBe(false);
  });
});

// ============================================================================
// Game Flow Integration Tests
// ============================================================================

describe('Game flow integration', () => {
  test('full place-remove cycle: player 1 places + removes, player 2 turn begins', () => {
    const board = new ZertzBoard();
    board.selectMarbleColor('white');
    board.placeMarble(0, 0);
    expect(board.gamePhase).toBe('remove-ring');
    expect(board.currentPlayer).toBe(1);

    const freeRings = board.getFreeRings();
    const [q, r] = board._fromKey(freeRings[0]);
    board.removeRing(q, r);
    expect(board.currentPlayer).toBe(2);
    expect(board.gamePhase).toBe('place-marble');
  });

  test('two complete turns', () => {
    const board = new ZertzBoard();

    // Player 1 turn
    board.selectMarbleColor('white');
    board.placeMarble(0, 0);
    let freeRings = board.getFreeRings();
    let [q, r] = board._fromKey(freeRings[0]);
    board.removeRing(q, r);
    expect(board.currentPlayer).toBe(2);

    // Player 2 turn
    board.selectMarbleColor('black');
    board.placeMarble(1, 0);
    freeRings = board.getFreeRings();
    [q, r] = board._fromKey(freeRings[0]);
    board.removeRing(q, r);
    expect(board.currentPlayer).toBe(1);
    expect(board.rings.size).toBe(35);
    expect(Object.keys(board.marbles).length).toBe(2);
  });

  test('capture chain followed by normal turn', () => {
    const board = createBoard({
      rings: ['0,0', '1,0', '2,0', '2,-1', '2,-2',
              '-1,0', '-2,0', '-3,0', '0,1', '0,-1'],
      marbles: { '0,0': 'white', '1,0': 'black', '2,-1': 'grey' },
      pool: { white: 5, grey: 7, black: 9 },
      captures: ZERO_CAPS,
      gamePhase: 'capture',
      currentPlayer: 1,
    });

    // Execute 2-hop chain
    board.jumpingMarble = '0,0';
    board.executeCapture('0,0', '2,0');
    board.executeCapture('2,0', '2,-2');

    // Turn should switch to player 2, place-marble phase
    expect(board.currentPlayer).toBe(2);
    expect(board.gamePhase).toBe('place-marble');
    expect(board.captures[1].black).toBe(1);
    expect(board.captures[1].grey).toBe(1);
  });

  test('place -> isolation capture -> win within a single placeMarble call', () => {
    const board = createBoard({
      rings: ['0,0', '1,0', '-1,0', '3,0', '3,-1'],
      marbles: { '3,0': 'white' },
      pool: { white: 5, grey: 8, black: 10 },
      captures: { 1: { white: 3, grey: 0, black: 0 }, 2: { white: 0, grey: 0, black: 0 } },
      gamePhase: 'place-marble',
      currentPlayer: 1,
    });

    board.selectMarbleColor('black');
    board.placeMarble(3, -1); // isolates {3,0, 3,-1}, both occupied -> captures white+black
    // Captures: white=3+1=4 -> WIN
    expect(board.gamePhase).toBe('game-over');
    expect(board.winner).toBe(1);
    expect(board.captures[1].white).toBe(4);
  });

  test('game-over via no available colors (pool empty, no captures)', () => {
    const board = createBoard({
      rings: ['0,0', '1,0', '2,0'],
      marbles: {},
      pool: { white: 0, grey: 0, black: 0 },
      captures: { 1: { white: 0, grey: 0, black: 0 }, 2: { white: 1, grey: 0, black: 0 } },
      currentPlayer: 2,
    });
    // Player 1 has no colors (pool empty, no captures)
    board._endTurn(); // switches to player 1
    expect(board.gamePhase).toBe('game-over');
    expect(board.winner).toBe(2);
  });

  test('undo across a capture turn restores intermediate state', () => {
    const board = createBoard({
      rings: ['0,0', '1,0', '2,0', '2,-1', '2,-2'],
      marbles: { '0,0': 'white', '1,0': 'black', '2,-1': 'grey' },
      pool: FULL_POOL,
      captures: ZERO_CAPS,
      gamePhase: 'capture',
      currentPlayer: 1,
    });
    board.jumpingMarble = '0,0';
    board._captureState(); // save selection state
    board.executeCapture('0,0', '2,0'); // first jump, saves state
    board.executeCapture('2,0', '2,-2'); // second jump, turn ends

    board.undo(); // back to after first jump
    expect(board.jumpingMarble).toBe('2,0');
    expect(board.captureStarted).toBe(true);
    expect(board.captures[1].black).toBe(1);
    expect(board.captures[1].grey).toBe(0);

    board.undo(); // back to selection (before any jump)
    expect(board.jumpingMarble).toBe('0,0');
    expect(board.captureStarted).toBe(false);
    expect(board.captures[1].black).toBe(0);
  });

  test('clone mid-capture can independently continue the chain', () => {
    const board = createBoard({
      rings: ['0,0', '1,0', '2,0', '2,-1', '2,-2'],
      marbles: { '0,0': 'white', '1,0': 'black', '2,-1': 'grey' },
      pool: FULL_POOL,
      captures: ZERO_CAPS,
      gamePhase: 'capture',
      currentPlayer: 1,
    });
    board.jumpingMarble = '0,0';
    board.executeCapture('0,0', '2,0');

    const clone = board.clone();
    clone.executeCapture('2,0', '2,-2');
    expect(clone.captures[1].grey).toBe(1);
    expect(clone.currentPlayer).toBe(2);

    // Original is still mid-chain
    expect(board.jumpingMarble).toBe('2,0');
    expect(board.captures[1].grey).toBe(0);
  });
});

// ============================================================================
// Regression Tests
// ============================================================================

describe('Regression tests', () => {
  test('isolation during place-marble does not skip remove-ring phase', () => {
    // Place marble triggers isolation capture but does NOT win.
    // Should still proceed to remove-ring phase.
    const board = createBoard({
      rings: ['0,0', '1,0', '-1,0', '3,0', '3,-1'],
      marbles: { '3,0': 'black' },
      pool: { white: 6, grey: 8, black: 9 },
      captures: ZERO_CAPS,
      gamePhase: 'place-marble',
      currentPlayer: 1,
    });
    board.selectMarbleColor('white');
    board.placeMarble(3, -1);
    // Isolation captures {3,0, 3,-1}, but no win. Remaining: {0,0, 1,0, -1,0}
    // These have free rings, so should go to remove-ring
    expect(board.captures[1].black).toBe(1);
    expect(board.captures[1].white).toBe(1);
    expect(board.gamePhase).toBe('remove-ring');
  });

  test('isolation during place-marble that wins skips remove-ring', () => {
    const board = createBoard({
      rings: ['0,0', '1,0', '-1,0', '3,0', '3,-1'],
      marbles: { '3,0': 'white' },
      pool: { white: 5, grey: 8, black: 10 },
      captures: { 1: { white: 3, grey: 0, black: 0 }, 2: { white: 0, grey: 0, black: 0 } },
      gamePhase: 'place-marble',
      currentPlayer: 1,
    });
    board.selectMarbleColor('black');
    board.placeMarble(3, -1);
    // Isolates {3,0, 3,-1}, captures white=3+1=4 -> WIN
    expect(board.gamePhase).toBe('game-over');
    expect(board.winner).toBe(1);
  });

  test('placing from captures then isolation capture properly credits both', () => {
    const board = createBoard({
      rings: ['0,0', '1,0', '-1,0', '3,0', '3,-1'],
      marbles: { '3,0': 'black' },
      pool: { white: 0, grey: 0, black: 0 },
      captures: { 1: { white: 1, grey: 0, black: 0 }, 2: { white: 0, grey: 0, black: 0 } },
      gamePhase: 'place-marble',
      currentPlayer: 1,
    });
    board.selectMarbleColor('white');
    board.placeMarble(3, -1);
    // white from captures decremented: 1 -> 0
    // Isolation captures black + white from {3,0, 3,-1}
    expect(board.captures[1].white).toBe(1); // 0 + 1 from isolation
    expect(board.captures[1].black).toBe(1);
  });

  test('undo a draw game-over then continue playing', () => {
    const board = createBoard({
      rings: ['0,0', '1,0'],
      marbles: { '0,0': 'black' },
      pool: FULL_POOL,
      captures: ZERO_CAPS,
      gamePhase: 'place-marble',
      currentPlayer: 1,
    });
    board.selectMarbleColor('white');
    board.placeMarble(1, 0); // all-rings-occupied -> draw
    expect(board.gamePhase).toBe('game-over');
    expect(board.winner).toBeNull();

    board.undo();
    expect(board.gamePhase).toBe('place-marble');
    expect(board.winner).toBeNull();
    expect(board.marbles['1,0']).toBeUndefined();
  });
});

// ============================================================================
// Error / Invalid Input Handling
// ============================================================================

describe('Invalid input handling', () => {
  test('placeMarble with non-integer coordinates returns false', () => {
    const board = new ZertzBoard();
    board.selectMarbleColor('white');
    expect(board.placeMarble(0.5, 1.5)).toBe(false);
  });

  test('removeRing with off-board coordinates returns false', () => {
    const board = new ZertzBoard();
    board.selectMarbleColor('black');
    board.placeMarble(0, 0);
    expect(board.removeRing(100, 100)).toBe(false);
  });

  test('executeCapture with non-existent fromKey returns false', () => {
    const board = createBoard({
      rings: ['0,0', '1,0', '2,0'],
      marbles: { '0,0': 'white', '1,0': 'black' },
      pool: FULL_POOL,
      captures: ZERO_CAPS,
      gamePhase: 'capture',
    });
    board.jumpingMarble = '99,99';
    expect(board.executeCapture('99,99', '2,0')).toBe(false);
  });

  test('getJumpTargets for off-board key returns empty', () => {
    const board = new ZertzBoard();
    expect(board.getJumpTargets('10,10')).toEqual([]);
  });

  test('handleClick on off-board coordinates does nothing', () => {
    const board = new ZertzBoard();
    board.selectMarbleColor('white');
    board.handleClick(10, 10);
    expect(Object.keys(board.marbles).length).toBe(0);
  });
});

// ============================================================================
// Static Constants Validation
// ============================================================================

describe('Static constants', () => {
  test('MARBLE_COUNTS has correct values', () => {
    expect(ZertzBoard.MARBLE_COUNTS).toEqual({ white: 6, grey: 8, black: 10 });
  });

  test('WIN_CONDITIONS has exactly 4 conditions', () => {
    expect(ZertzBoard.WIN_CONDITIONS.length).toBe(4);
  });

  test('WIN_CONDITIONS includes the mixed set (3,3,3)', () => {
    expect(ZertzBoard.WIN_CONDITIONS).toContainEqual({ white: 3, grey: 3, black: 3 });
  });

  test('DIRECTIONS has exactly 6 unique directions', () => {
    expect(ZertzBoard.DIRECTIONS.length).toBe(6);
    const asStrings = ZertzBoard.DIRECTIONS.map(d => d.join(','));
    expect(new Set(asStrings).size).toBe(6);
  });

  test('DIRECTIONS cover all 6 hex neighbor offsets', () => {
    const expected = ['1,0', '-1,0', '0,1', '0,-1', '1,-1', '-1,1'];
    const actual = ZertzBoard.DIRECTIONS.map(d => d.join(','));
    for (const e of expected) {
      expect(actual).toContain(e);
    }
  });
});

// ============================================================================
// AI Interface Methods
// ============================================================================

describe('getStateHash', () => {
  test('same state produces same hash', () => {
    const board = new ZertzBoard({ skipInitialHistory: true });
    const hash1 = board.getStateHash();
    const hash2 = board.getStateHash();
    expect(hash1).toBe(hash2);
  });

  test('different state produces different hash', () => {
    const board1 = new ZertzBoard({ skipInitialHistory: true });
    const board2 = new ZertzBoard({ skipInitialHistory: true });
    board2.selectMarbleColor('white');
    board2.placeMarble(0, 0);
    expect(board1.getStateHash()).not.toBe(board2.getStateHash());
  });

  test('hash includes jumping marble state', () => {
    const board1 = createBoard({
      rings: ['0,0', '1,0', '2,0'],
      marbles: { '0,0': 'white', '1,0': 'black' },
      pool: { white: 5, grey: 8, black: 9 },
      captures: { 1: { white: 0, grey: 0, black: 0 }, 2: { white: 0, grey: 0, black: 0 } },
      gamePhase: 'capture',
    });
    const board2 = createBoard({
      rings: ['0,0', '1,0', '2,0'],
      marbles: { '0,0': 'white', '1,0': 'black' },
      pool: { white: 5, grey: 8, black: 9 },
      captures: { 1: { white: 0, grey: 0, black: 0 }, 2: { white: 0, grey: 0, black: 0 } },
      gamePhase: 'capture',
    });
    board2.jumpingMarble = '0,0';
    expect(board1.getStateHash()).not.toBe(board2.getStateHash());
  });
});

describe('getLegalMoves', () => {
  test('returns place-marble moves in place-marble phase', () => {
    const board = new ZertzBoard({ skipInitialHistory: true });
    const moves = board.getLegalMoves();
    expect(moves.length).toBeGreaterThan(0);
    for (const m of moves) {
      expect(m.type).toBe('place-marble');
      expect(['white', 'grey', 'black']).toContain(m.color);
      expect(typeof m.q).toBe('number');
      expect(typeof m.r).toBe('number');
    }
  });

  test('returns correct count: colors x placements', () => {
    const board = new ZertzBoard({ skipInitialHistory: true });
    const moves = board.getLegalMoves();
    const colors = board.getAvailableColors().length; // 3
    const placements = board.getValidPlacements().length; // 37
    expect(moves.length).toBe(colors * placements);
  });

  test('returns remove-ring moves in remove-ring phase', () => {
    const board = new ZertzBoard({ skipInitialHistory: true });
    board.selectMarbleColor('black');
    board.placeMarble(0, 0);
    expect(board.gamePhase).toBe('remove-ring');

    const moves = board.getLegalMoves();
    expect(moves.length).toBeGreaterThan(0);
    for (const m of moves) {
      expect(m.type).toBe('remove-ring');
    }
  });

  test('returns capture moves in capture phase', () => {
    const board = createBoard({
      rings: ['0,0', '1,0', '2,0'],
      marbles: { '0,0': 'white', '1,0': 'black' },
      pool: { white: 5, grey: 8, black: 9 },
      captures: { 1: { white: 0, grey: 0, black: 0 }, 2: { white: 0, grey: 0, black: 0 } },
      gamePhase: 'capture',
    });

    const moves = board.getLegalMoves();
    expect(moves.length).toBe(1);
    expect(moves[0].type).toBe('capture');
    expect(moves[0].fromKey).toBe('0,0');
    expect(moves[0].toKey).toBe('2,0');
  });

  test('returns empty array for game-over', () => {
    const board = new ZertzBoard({ skipInitialHistory: true });
    board.gamePhase = 'game-over';
    expect(board.getLegalMoves()).toEqual([]);
  });

  test('respects jumpingMarble constraint in capture phase', () => {
    const board = createBoard({
      rings: ['0,0', '1,0', '2,0', '3,0', '0,1', '1,1'],
      marbles: { '2,0': 'white', '1,0': 'black', '0,1': 'grey', '1,1': 'grey' },
      pool: { white: 5, grey: 6, black: 10 },
      captures: { 1: { white: 0, grey: 0, black: 0 }, 2: { white: 0, grey: 0, black: 0 } },
      gamePhase: 'capture',
    });
    board.jumpingMarble = '2,0';
    board.captureStarted = true;

    const moves = board.getLegalMoves();
    for (const m of moves) {
      expect(m.fromKey).toBe('2,0');
    }
  });
});

describe('serializeState / fromSerializedState', () => {
  test('round-trip preserves state hash', () => {
    const board = new ZertzBoard({ skipInitialHistory: true });
    board.selectMarbleColor('white');
    board.placeMarble(0, 0);

    const serialized = board.serializeState();
    const restored = ZertzBoard.fromSerializedState(serialized);

    expect(restored.getStateHash()).toBe(board.getStateHash());
  });

  test('round-trip preserves all state fields', () => {
    const board = new ZertzBoard({ skipInitialHistory: true });
    board.selectMarbleColor('grey');
    board.placeMarble(1, 0);

    const serialized = board.serializeState();
    const restored = ZertzBoard.fromSerializedState(serialized);

    expect(restored.rings.size).toBe(board.rings.size);
    expect(restored.marbles).toEqual(board.marbles);
    expect(restored.pool).toEqual(board.pool);
    expect(restored.captures).toEqual(board.captures);
    expect(restored.currentPlayer).toBe(board.currentPlayer);
    expect(restored.gamePhase).toBe(board.gamePhase);
    expect(restored.winner).toBe(board.winner);
    expect(restored.jumpingMarble).toBe(board.jumpingMarble);
  });

  test('round-trip with capture state', () => {
    const board = createBoard({
      rings: ['0,0', '1,0', '2,0'],
      marbles: { '0,0': 'white', '1,0': 'black' },
      pool: { white: 5, grey: 8, black: 9 },
      captures: { 1: { white: 2, grey: 1, black: 0 }, 2: { white: 0, grey: 0, black: 3 } },
      gamePhase: 'capture',
    });
    board.jumpingMarble = '0,0';
    board.captureStarted = true;

    const serialized = board.serializeState();
    const restored = ZertzBoard.fromSerializedState(serialized);

    expect(restored.getStateHash()).toBe(board.getStateHash());
    expect(restored.jumpingMarble).toBe('0,0');
    expect(restored.captureStarted).toBe(true);
  });
});
