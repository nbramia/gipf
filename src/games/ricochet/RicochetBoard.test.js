import RicochetBoard from './RicochetBoard.js';
import { cellOf } from './engine/geometry.js';
import { buildBoard, FAR } from './testHelpers.js';

const at = (r, c) => cellOf(r, c);
const hasMove = (board, robot, dir) =>
  board.getLegalMoves().some(m => m.robot === robot && m.dir === dir);

describe('sliding', () => {
  const target = { at: [3, 3], color: 'red' };

  test('stops at a wall on each side', () => {
    const cases = [
      ['N', [5, 5, 'N'], [5, 5]], // wall on the starting side: cannot move
      ['N', [2, 5, 'N'], [2, 5]],
      ['E', [5, 9, 'E'], [5, 9]],
      ['S', [11, 5, 'S'], [11, 5]],
      ['W', [5, 2, 'W'], [5, 2]],
    ];
    for (const [dir, wall, stop] of cases) {
      const board = buildBoard({ robots: { red: [5, 5], ...FAR }, target, walls: [wall] });
      expect(board.getDestination('red', dir)).toBe(at(...stop));
    }
  });

  test('stops against another robot', () => {
    const board = buildBoard({ robots: { red: [5, 2], green: [5, 9], blue: [15, 15], yellow: [0, 15] }, target });
    expect(board.getDestination('red', 'E')).toBe(at(5, 8));
    expect(board.getDestination('green', 'W')).toBe(at(5, 3));
  });

  test('stops at the centre block', () => {
    const east = buildBoard({ robots: { red: [7, 0], ...FAR }, target });
    expect(east.getDestination('red', 'E')).toBe(at(7, 6));
    const south = buildBoard({ robots: { red: [0, 8], ...FAR }, target });
    expect(south.getDestination('red', 'S')).toBe(at(6, 8));
    const west = buildBoard({ robots: { red: [8, 14], ...FAR }, target });
    expect(west.getDestination('red', 'W')).toBe(at(8, 9));
    const north = buildBoard({ robots: { red: [14, 7], ...FAR }, target });
    expect(north.getDestination('red', 'N')).toBe(at(9, 7));
  });

  test('stops at the board edge', () => {
    const board = buildBoard({ robots: { red: [5, 5], ...FAR }, target });
    expect(board.getDestination('red', 'N')).toBe(at(0, 5));
    expect(board.getDestination('red', 'W')).toBe(at(5, 0));
    expect(board.getDestination('red', 'S')).toBe(at(15, 5));
    expect(board.getDestination('red', 'E')).toBe(at(5, 15));
  });

  test('a zero-distance direction is not legal and is rejected', () => {
    const board = buildBoard({ robots: { red: [0, 0], ...FAR, green: [1, 0] }, target });
    // red in the corner: N and W hit the edge, S is blocked by green
    expect(hasMove(board, 'red', 'N')).toBe(false);
    expect(hasMove(board, 'red', 'W')).toBe(false);
    expect(hasMove(board, 'red', 'S')).toBe(false);
    expect(hasMove(board, 'red', 'E')).toBe(true);
    const before = board.getStateHash();
    expect(board.applyMove({ robot: 'red', dir: 'N' })).toBe(false);
    expect(board.applyMove({ robot: 'red', dir: 'S' })).toBe(false);
    expect(board.getStateHash()).toBe(before);
    expect(board.moves).toHaveLength(0);
  });

  test('rejects non-allowlisted robots and directions without hanging', () => {
    const board = buildBoard({ robots: { red: [5, 5], ...FAR }, target });
    const before = board.getStateHash();
    const bad = [
      { robot: 'red', dir: 'toString' },
      { robot: 'red', dir: '__proto__' },
      { robot: 'red', dir: undefined },
      { robot: 'red', dir: 'n' },
      { robot: 'purple', dir: 'N' },
      { robot: 'toString', dir: 'N' },
      { robot: '__proto__', dir: 'N' },
      { robot: undefined, dir: 'N' },
      {},
    ];
    for (const m of bad) expect(board.applyMove(m)).toBe(false);
    expect(board.applyMove()).toBe(false);
    expect(board.getDestination('red', 'toString')).toBeNull();
    expect(board.getStateHash()).toBe(before);
    expect(board.moves).toHaveLength(0);
  });

  test('getLegalMoves lists exactly the moving directions', () => {
    const board = buildBoard({ robots: { red: [5, 5], ...FAR }, target });
    expect(board.getLegalMoves().filter(m => m.robot === 'red')).toHaveLength(4);
    // a robot in a corner can only go two ways
    expect(board.getLegalMoves().filter(m => m.robot === 'green')).toHaveLength(2);
  });

  test('applyMove records from/to and counts the move', () => {
    const board = buildBoard({ robots: { red: [5, 5], ...FAR }, target });
    const rec = board.applyMove({ robot: 'red', dir: 'W' });
    expect(rec).toEqual({ robot: 'red', dir: 'W', from: at(5, 5), to: at(5, 0) });
    expect(board.moves).toEqual([rec]);
  });
});

describe('solving a round', () => {
  test('stopping on the target solves it', () => {
    const board = buildBoard({ robots: { red: [5, 0], ...FAR }, target: { at: [5, 15], color: 'red' } });
    expect(board.isSolved()).toBe(false);
    board.applyMove({ robot: 'red', dir: 'E' });
    expect(board.isSolved()).toBe(true);
    expect(board.claimed).toEqual([0]);
  });

  test('sliding through the target does not solve it', () => {
    const board = buildBoard({ robots: { red: [5, 0], ...FAR }, target: { at: [5, 9], color: 'red' } });
    board.applyMove({ robot: 'red', dir: 'E' });
    expect(board.robots.red).toBe(at(5, 15));
    expect(board.isSolved()).toBe(false);
    expect(board.claimed).toEqual([]);
  });

  test('a coloured target accepts only its own colour', () => {
    const board = buildBoard({
      robots: { red: [0, 0], green: [5, 0], blue: [15, 15], yellow: [0, 15] },
      target: { at: [5, 15], color: 'red' },
    });
    board.applyMove({ robot: 'green', dir: 'E' });
    expect(board.robots.green).toBe(at(5, 15));
    expect(board.isSolved()).toBe(false);
    expect(board.claimed).toEqual([]);
  });

  test('the vortex accepts any robot', () => {
    for (const robot of ['red', 'green', 'blue', 'yellow']) {
      const robots = { red: [0, 0], green: [15, 0], blue: [15, 15], yellow: [0, 15] };
      robots[robot] = [5, 0];
      const board = buildBoard({ robots, target: { at: [5, 15], color: null } });
      board.applyMove({ robot, dir: 'E' });
      expect(board.isSolved()).toBe(true);
    }
  });

  test('no moves once solved', () => {
    const board = buildBoard({ robots: { red: [5, 0], ...FAR }, target: { at: [5, 15], color: 'red' } });
    board.applyMove({ robot: 'red', dir: 'E' });
    expect(board.getLegalMoves()).toEqual([]);
    expect(board.applyMove({ robot: 'red', dir: 'W' })).toBe(false);
  });

  test('startRound rejects claimed and unknown targets; robots stay put', () => {
    const board = new RicochetBoard({ seed: 3 });
    board.startRound(4);
    board.claimed.push(4);
    expect(() => board.startRound(4)).toThrow();
    expect(() => board.startRound(99)).toThrow();
    const robots = { ...board.robots };
    board.startRound(5);
    expect(board.robots).toEqual(robots);
    expect(board.roundStart).toEqual(robots);
  });
});

describe('new board', () => {
  test('robots start on distinct non-target, non-centre cells', () => {
    for (let seed = 1; seed <= 50; seed++) {
      const board = new RicochetBoard({ seed });
      const cells = Object.values(board.robots);
      expect(new Set(cells).size).toBe(4);
      const targetCells = new Set(board.targets.map(t => t.cell));
      for (const c of cells) {
        expect(targetCells.has(c)).toBe(false);
        const row = Math.floor(c / 16);
        const col = c % 16;
        expect(row >= 7 && row <= 8 && col >= 7 && col <= 8).toBe(false);
      }
    }
  });

  test('same seed gives the same board and robots', () => {
    const a = new RicochetBoard({ seed: 42 });
    const b = new RicochetBoard({ seed: 42 });
    expect(a.serializeState()).toEqual(b.serializeState());
  });
});

describe('history and persistence', () => {
  function midRound() {
    const board = new RicochetBoard({ seed: 7 });
    board.startRound(2);
    for (let i = 0; i < 4; i++) {
      const moves = board.getLegalMoves();
      board.applyMove(moves[(i * 3) % moves.length]);
    }
    return board;
  }

  test('undo and redo walk the moves exactly', () => {
    const board = midRound();
    const seen = [];
    while (board.canUndo()) {
      seen.push(JSON.stringify([board.robots, board.moves, board.currentTargetId]));
      board.undo();
    }
    expect(board.moves).toHaveLength(0);
    expect(board.currentTargetId).toBeNull();
    expect(board.canRedo()).toBe(true);
    const replay = [];
    while (board.canRedo()) {
      board.redo();
      replay.push(JSON.stringify([board.robots, board.moves, board.currentTargetId]));
    }
    expect([...replay].reverse()).toEqual(seen);
  });

  test('undo restores robots and moves; a new move truncates redo', () => {
    const board = midRound();
    const before = JSON.stringify(board.robots);
    board.applyMove(board.getLegalMoves()[0]);
    expect(board.moves).toHaveLength(5);
    board.undo();
    expect(JSON.stringify(board.robots)).toBe(before);
    expect(board.moves).toHaveLength(4);
    expect(board.canRedo()).toBe(true);
    board.applyMove(board.getLegalMoves()[1]);
    expect(board.canRedo()).toBe(false);
  });

  test('undo of the solving move reopens the round and unclaims the target', () => {
    const board = buildBoard({ robots: { red: [5, 0], ...FAR }, target: { at: [5, 15], color: 'red' } });
    board.applyMove({ robot: 'red', dir: 'E' });
    expect(board.isSolved()).toBe(true);
    board.undo();
    expect(board.isSolved()).toBe(false);
    expect(board.claimed).toEqual([]);
    expect(board.robots.red).toBe(at(5, 0));
  });

  test('resetRound returns to the round start and is undoable', () => {
    const board = midRound();
    const start = { ...board.roundStart };
    const mid = board.serializeState();
    board.resetRound();
    expect(board.robots).toEqual(start);
    expect(board.moves).toEqual([]);
    expect(board.currentTargetId).toBe(2);
    board.undo();
    expect(board.robots).toEqual(mid.robots);
    expect(board.moves).toEqual(mid.moves);
    const { stateHistory, ...rest } = board.serializeState();
    const { stateHistory: before, ...midRest } = mid;
    expect(rest).toEqual(midRest);
    expect(stateHistory.length).toBe(before.length + 1); // the reset stays redoable
  });

  test('resetRound after solving unclaims the target', () => {
    const board = buildBoard({ robots: { red: [5, 0], ...FAR }, target: { at: [5, 15], color: 'red' } });
    board.applyMove({ robot: 'red', dir: 'E' });
    board.resetRound();
    expect(board.claimed).toEqual([]);
    expect(board.isSolved()).toBe(false);
    expect(board.robots.red).toBe(at(5, 0));
  });

  test('serialize -> JSON -> restore preserves state mid-round, history included', () => {
    const board = midRound();
    const restored = RicochetBoard.fromSerializedState(JSON.parse(JSON.stringify(board.serializeState())));
    expect(restored.serializeState()).toEqual(board.serializeState());
    expect(restored.getStateHash()).toBe(board.getStateHash());
    // and the two behave identically afterwards
    const move = board.getLegalMoves()[2];
    expect(restored.applyMove(move)).toEqual(board.applyMove(move));
    expect(restored.serializeState()).toEqual(board.serializeState());
    restored.undo();
    restored.undo();
    board.undo();
    board.undo();
    expect(restored.serializeState()).toEqual(board.serializeState());
  });

  test('clone is independent', () => {
    const board = midRound();
    const copy = board.clone();
    expect(copy.serializeState()).toEqual(board.serializeState());
    copy.applyMove(copy.getLegalMoves()[0]);
    expect(copy.moves).toHaveLength(5);
    expect(board.moves).toHaveLength(4);
    expect(board.stateHistory).not.toBe(copy.stateHistory);
  });

  test('the PRNG stream survives a restore', () => {
    const board = new RicochetBoard({ seed: 9 });
    board.random();
    const restored = RicochetBoard.fromSerializedState(JSON.parse(JSON.stringify(board.serializeState())));
    expect(restored.random()).toBe(board.random());
  });

  test('state hash changes with the position', () => {
    const board = new RicochetBoard({ seed: 5 });
    board.startRound(0);
    const h = board.getStateHash();
    board.applyMove(board.getLegalMoves()[0]);
    expect(board.getStateHash()).not.toBe(h);
  });
});
