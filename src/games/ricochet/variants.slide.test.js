// Slide rules on hand-built boards: diagonal barriers and the black robot.

import { buildBoard, FAR } from './testHelpers.js';
import { cellOf } from './engine/geometry.js';

const at = (r, c, size = 16) => cellOf(r, c, size);
const DIAG = { size: 16, fifthRobot: false, diagonals: true };
const DIAG5 = { size: 16, fifthRobot: true, diagonals: true };

// red alone on the board (others parked in corners), a barrier, nothing else.
const withBarrier = ({ robot = [10, 1], orient = '/', color = 'green', walls = [], extra = {}, config = DIAG } = {}) =>
  buildBoard({
    config,
    walls,
    barriers: [[10, 5, orient, color]],
    robots: { red: robot, ...FAR, ...extra },
    target: { at: [3, 3], color: 'red' },
  });

describe('same colour passes straight through', () => {
  test.each(['/', '\\'])('a red robot ignores a red %s barrier', orient => {
    const board = withBarrier({ orient, color: 'red' });
    expect(board.getDestination('red', 'E')).toBe(at(10, 15));
    expect(board.getSlidePath('red', 'E')).toEqual([at(10, 1), at(10, 15)]);
  });

  test('a different colour is deflected by the same barrier', () => {
    const board = withBarrier({ orient: '/', color: 'red', robot: [10, 1], extra: {} });
    // green parked in the corner, moved next to the barrier row for the check
    const b2 = buildBoard({
      config: DIAG,
      barriers: [[10, 5, '/', 'red']],
      robots: { red: [3, 3], green: [10, 1], blue: FAR.blue, yellow: FAR.yellow },
      target: { at: [3, 4], color: 'green' },
    });
    expect(board.getDestination('red', 'E')).toBe(at(10, 15));
    expect(b2.getDestination('green', 'E')).toBe(at(0, 5));
  });
});

describe('deflection', () => {
  // [orientation, heading, start, where the robot ends]
  const CASES = [
    ['/', 'E', [10, 1], [0, 5]],
    ['/', 'N', [14, 5], [10, 15]],
    ['/', 'W', [10, 12], [15, 5]],
    ['/', 'S', [2, 5], [10, 0]],
    ['\\', 'E', [10, 1], [15, 5]],
    ['\\', 'N', [14, 5], [10, 0]],
    ['\\', 'W', [10, 12], [0, 5]],
    ['\\', 'S', [2, 5], [10, 15]],
  ];

  test.each(CASES)('%s barrier, robot heading %s', (orient, dir, start, end) => {
    const board = withBarrier({ orient, robot: start });
    expect(board.getDestination('red', dir)).toBe(at(...end));
    expect(board.getSlidePath('red', dir)).toEqual([at(...start), at(10, 5), at(...end)]);
    const record = board.applyMove({ robot: 'red', dir });
    expect(record).toMatchObject({ robot: 'red', dir, from: at(...start), to: at(...end) });
    expect(record.path).toEqual([at(...start), at(10, 5), at(...end)]);
    // a deflection is not an extra move
    expect(board.moves).toHaveLength(1);
    expect(board.robots.red).toBe(at(...end));
  });

  test('two deflections in one slide are still one move', () => {
    const board = buildBoard({
      config: DIAG,
      barriers: [[10, 5, '/', 'green'], [4, 5, '\\', 'green']],
      robots: { red: [10, 1], ...FAR },
      target: { at: [3, 3], color: 'red' },
    });
    // E -> N at (10,5), N -> W at (4,5), then west along row 4 to the wall
    expect(board.getSlidePath('red', 'E')).toEqual([at(10, 1), at(10, 5), at(4, 5), at(4, 0)]);
    board.applyMove({ robot: 'red', dir: 'E' });
    expect(board.moves).toHaveLength(1);
  });

  test('other robots block a slide after a deflection', () => {
    const board = withBarrier({ orient: '/', robot: [10, 1], extra: { yellow: [4, 5] } });
    expect(board.getDestination('red', 'E')).toBe(at(5, 5));
  });

  test('boards without barriers still report [start, stop] and no path on the record', () => {
    const board = buildBoard({ robots: { red: [5, 5], ...FAR }, target: { at: [3, 3], color: 'red' } });
    expect(board.getSlidePath('red', 'W')).toEqual([at(5, 5), at(5, 0)]);
    expect(board.applyMove({ robot: 'red', dir: 'W' })).toEqual({ robot: 'red', dir: 'W', from: at(5, 5), to: at(5, 0) });
  });
});

describe('black always deflects', () => {
  test.each(['red', 'green', 'blue', 'yellow'])('through a %s barrier', color => {
    const board = buildBoard({
      config: DIAG5,
      barriers: [[10, 5, '/', color]],
      robots: { red: [2, 2], green: [2, 3], blue: [2, 4], yellow: [2, 6], black: [10, 1] },
      target: { at: [3, 3], color: 'red' },
    });
    expect(board.getDestination('black', 'E')).toBe(at(0, 5));
    expect(board.getSlidePath('black', 'E')).toEqual([at(10, 1), at(10, 5), at(0, 5)]);
  });

  test('while a coloured robot of the same colour goes straight', () => {
    const board = buildBoard({
      config: DIAG5,
      barriers: [[10, 5, '/', 'blue']],
      robots: { red: [2, 2], green: [2, 3], blue: [10, 1], yellow: [2, 6], black: [14, 14] },
      target: { at: [3, 3], color: 'red' },
    });
    expect(board.getDestination('blue', 'E')).toBe(at(10, 15));
  });
});

describe('a robot never stops on a barrier', () => {
  test('a wall just past a pass-through barrier stops it on the cell before', () => {
    const board = buildBoard({
      config: DIAG,
      walls: [[10, 5, 'E']],
      barriers: [[10, 5, '/', 'red']],
      robots: { red: [10, 1], ...FAR },
      target: { at: [3, 3], color: 'red' },
    });
    expect(board.getDestination('red', 'E')).toBe(at(10, 4));
  });

  test('blocked by a wall right after the deflection: stops before the barrier', () => {
    const board = withBarrier({ walls: [[10, 5, 'N']] });
    expect(board.getDestination('red', 'E')).toBe(at(10, 4));
    expect(board.getSlidePath('red', 'E')).toEqual([at(10, 1), at(10, 4)]);
  });

  test('blocked by a robot right after the deflection: stops before the barrier', () => {
    const board = withBarrier({ extra: { yellow: [9, 5] } });
    expect(board.getDestination('red', 'E')).toBe(at(10, 4));
  });

  test('a robot blocked right after its second deflection stops before the second barrier', () => {
    const board = buildBoard({
      config: DIAG,
      walls: [[6, 5, 'W']],
      barriers: [[10, 5, '/', 'green'], [6, 5, '\\', 'green']],
      robots: { red: [10, 1], ...FAR },
      target: { at: [3, 3], color: 'red' },
    });
    // E -> N at (10,5); N -> W at (6,5) is blocked by the wall, so stop at (7,5)
    expect(board.getDestination('red', 'E')).toBe(at(7, 5));
  });

  test('if that cell is the starting cell the move is illegal', () => {
    const board = withBarrier({ robot: [10, 4], walls: [[10, 5, 'N']] });
    expect(board.getDestination('red', 'E')).toBe(at(10, 4));
    expect(board.getSlidePath('red', 'E')).toBeNull();
    expect(board.applyMove({ robot: 'red', dir: 'E' })).toBe(false);
    expect(board.moves).toHaveLength(0);
    expect(board.getLegalMoves()).not.toContainEqual({ robot: 'red', dir: 'E' });
  });

  test('legal moves of other directions are unaffected', () => {
    const board = withBarrier({ robot: [10, 4], walls: [[10, 5, 'N']] });
    expect(board.getLegalMoves()).toContainEqual({ robot: 'red', dir: 'W' });
  });
});

describe('loops', () => {
  // four green barriers on the corners of a rectangle: E->N at (10,5), N->W at
  // (4,5), W->S at (4,2), S->E at (10,2).
  const LOOP = [[10, 5, '/', 'green'], [4, 5, '\\', 'green'], [4, 2, '/', 'green'], [10, 2, '\\', 'green']];
  const loopBoard = extra => buildBoard({
    config: DIAG,
    barriers: LOOP,
    robots: { red: [10, 3], ...FAR, ...extra },
    target: { at: [1, 1], color: 'red' },
  });

  test('a slide that revisits a (cell, direction) is illegal', () => {
    const board = loopBoard({});
    expect(board.getSlidePath('red', 'E')).toBeNull();
    expect(board.getDestination('red', 'E')).toBe(at(10, 3));
    expect(board.applyMove({ robot: 'red', dir: 'E' })).toBe(false);
    expect(board.moves).toHaveLength(0);
  });

  test('a robot of the barriers\' colour is not looped', () => {
    const board = buildBoard({
      config: DIAG,
      barriers: LOOP,
      robots: { red: [2, 2], green: [10, 3], blue: FAR.blue, yellow: FAR.yellow },
      target: { at: [1, 1], color: 'red' },
    });
    expect(board.getDestination('green', 'E')).toBe(at(10, 15));
  });

  test('another robot on the circuit cuts the loop and the slide is legal', () => {
    const board = loopBoard({ yellow: [6, 5] });
    expect(board.getDestination('red', 'E')).toBe(at(7, 5));
  });

  test('moving away from the circuit is a normal slide', () => {
    const board = loopBoard({});
    expect(board.getDestination('red', 'N')).toBe(at(0, 3));
  });
});

describe('the black robot', () => {
  const config5 = { size: 16, fifthRobot: true, diagonals: false };
  const board5 = ({ black = [5, 8], target, walls = [], robots = {} }) => buildBoard({
    config: config5,
    walls,
    robots: { red: [5, 2], green: [15, 0], blue: [15, 15], yellow: [0, 15], black, ...robots },
    target,
  });

  test('blocks other robots', () => {
    const board = board5({ target: { at: [3, 3], color: 'red' } });
    expect(board.getDestination('red', 'E')).toBe(at(5, 7));
  });

  test('is blocked by other robots', () => {
    const board = board5({ black: [5, 12], robots: { red: [5, 15] }, target: { at: [3, 3], color: 'red' } });
    expect(board.getDestination('black', 'E')).toBe(at(5, 14));
  });

  test('moving it counts as a move and appears in the legal moves', () => {
    const board = board5({ black: [5, 12], target: { at: [3, 3], color: 'red' } });
    expect(board.getLegalMoves().filter(m => m.robot === 'black')).toHaveLength(4);
    board.applyMove({ robot: 'black', dir: 'E' });
    expect(board.moves).toHaveLength(1);
    expect(board.moves[0].robot).toBe('black');
  });

  test('claims the vortex', () => {
    const board = board5({ black: [5, 3], walls: [[5, 10, 'E']], robots: { red: [0, 0] }, target: { at: [5, 10], color: null } });
    board.applyMove({ robot: 'black', dir: 'E' });
    expect(board.robots.black).toBe(at(5, 10));
    expect(board.isSolved()).toBe(true);
    expect(board.claimed).toEqual([0]);
  });

  test('never claims a coloured target', () => {
    for (const color of ['red', 'green', 'blue', 'yellow']) {
      const board = board5({
        black: [5, 3], walls: [[5, 10, 'E']], robots: { red: [0, 0] }, target: { at: [5, 10], color },
      });
      board.applyMove({ robot: 'black', dir: 'E' });
      expect(board.robots.black).toBe(at(5, 10));
      expect(board.isSolved()).toBe(false);
    }
  });

  test('the target\'s own colour still claims it with black on the board', () => {
    const board = board5({ black: [14, 14], walls: [[5, 10, 'E']], target: { at: [5, 10], color: 'red' } });
    board.applyMove({ robot: 'red', dir: 'E' });
    expect(board.isSolved()).toBe(true);
  });

  test('works on the 12x12 board too', () => {
    const board = buildBoard({
      config: { size: 12, fifthRobot: true, diagonals: false },
      robots: { red: [2, 2], green: [11, 0], blue: [11, 11], yellow: [0, 11], black: [3, 1] },
      target: { at: [3, 3], color: 'red' },
    });
    expect(board.size).toBe(12);
    expect(board.getDestination('black', 'E')).toBe(at(3, 11, 12));
    expect(board.getDestination('red', 'S')).toBe(at(11, 2, 12));
  });
});
