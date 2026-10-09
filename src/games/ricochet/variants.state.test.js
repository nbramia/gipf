// Serialization, restore, round dealing and the helpers the UI relies on, for
// every config.

import RicochetBoard from './RicochetBoard.js';
import { chooseNextRound } from './engine/rounds.js';
import { CONFIGS, DEFAULT_CONFIG, configKey } from './engine/config.js';
import { ALL_ROBOTS, ROBOTS } from './engine/geometry.js';

const roundTrip = board => RicochetBoard.fromSerializedState(JSON.parse(JSON.stringify(board.serializeState())));

describe.each(CONFIGS.map(c => [configKey(c), c]))('config %s', (_name, config) => {
  const fresh = (seed = 3) => new RicochetBoard({ seed, config });

  test('exposes size, robot list and barrier list for the UI', () => {
    const board = fresh();
    expect(board.size).toBe(config.size);
    expect(board.config).toEqual(config);
    expect(board.robotNames).toEqual(config.fifthRobot ? ALL_ROBOTS : ROBOTS);
    expect(Object.keys(board.robots)).toEqual(board.robotNames);
    expect(board.barriers).toHaveLength(config.diagonals ? (config.size === 16 ? 8 : 4) : 0);
    expect(board.walls).toHaveLength(config.size * config.size);
  });

  test('serialize -> JSON -> restore round-trips mid-round, history included', () => {
    const board = fresh();
    const round = chooseNextRound(board, 3, { timeLimitMs: 2000 });
    expect(round.targetId).toBeDefined();
    board.startRound(round.targetId);
    // play the first moves of the optimal line, stopping before the solve
    for (const m of round.solution.slice(0, -1)) expect(board.applyMove(m)).toBeTruthy();
    expect(board.moves.length).toBeGreaterThan(0);
    expect(board.isSolved()).toBe(false);

    const restored = roundTrip(board);
    expect(restored.serializeState()).toEqual(board.serializeState());
    expect(restored.config).toEqual(config);
    expect(restored.barriers).toEqual(board.barriers);
    expect(restored.robotNames).toEqual(board.robotNames);
    expect(restored.getStateHash()).toBe(board.getStateHash());

    // the restored board plays on identically
    const last = round.solution[round.solution.length - 1];
    expect(restored.applyMove(last)).toEqual(board.applyMove(last));
    expect(restored.isSolved()).toBe(true);
    expect(restored.serializeState()).toEqual(board.serializeState());

    // undo/redo survive the trip
    expect(restored.undo()).toBe(true);
    expect(restored.isSolved()).toBe(false);
    expect(restored.config).toEqual(config);
    expect(restored.redo()).toBe(true);
    expect(restored.isSolved()).toBe(true);
  });

  test('clone and startNewGame keep the variant', () => {
    const board = fresh();
    expect(board.clone().config).toEqual(config);
    board.startNewGame(99);
    expect(board.config).toEqual(config);
    expect(board.size).toBe(config.size);
    expect(Object.keys(board.robots)).toHaveLength(config.fifthRobot ? 5 : 4);
    expect(board.barriers.length > 0).toBe(config.diagonals);
  });

  test('chooseNextRound deals a solvable round in this config', () => {
    const board = fresh(11);
    const round = chooseNextRound(board, 4, { timeLimitMs: 2000 });
    expect(round.needsNewBoard).toBeUndefined();
    expect(round.length).toBeGreaterThanOrEqual(2);
    board.startRound(round.targetId);
    for (const m of round.solution) expect(board.applyMove(m)).toBeTruthy();
    expect(board.isSolved()).toBe(true);
    expect(board.moves).toHaveLength(round.length);
  });

  test('a board restored from state deals the same round as the original', () => {
    const board = fresh(5);
    const a = chooseNextRound(board.clone(), 3, { timeLimitMs: 2000 });
    const b = chooseNextRound(roundTrip(board), 3, { timeLimitMs: 2000 });
    expect(b).toEqual(a);
  });
});

describe('old saves', () => {
  test('a serialized state with no config or barriers restores as the default board', () => {
    const board = new RicochetBoard({ seed: 21 });
    board.startRound(2);
    const state = JSON.parse(JSON.stringify(board.serializeState()));
    delete state.config;
    delete state.barriers;
    // stored history entries from before the variants have no config either
    state.stateHistory = state.stateHistory.map(s => {
      const parsed = JSON.parse(s);
      delete parsed.config;
      delete parsed.barriers;
      return JSON.stringify(parsed);
    });

    const restored = RicochetBoard.fromSerializedState(state);
    expect(restored.config).toEqual(DEFAULT_CONFIG);
    expect(restored.size).toBe(16);
    expect(restored.barriers).toEqual([]);
    expect(restored.robotNames).toEqual(ROBOTS);
    expect(restored.currentTargetId).toBe(2);
    expect(restored.getStateHash()).toBe(board.getStateHash());
    expect(restored.undo()).toBe(true);
    expect(restored.config).toEqual(DEFAULT_CONFIG);
  });

  test('the default constructor is the default config', () => {
    const board = new RicochetBoard({ seed: 4 });
    expect(board.config).toEqual(DEFAULT_CONFIG);
    expect(Object.keys(board.robots)).toEqual(ROBOTS);
    expect(board.barriers).toEqual([]);
  });
});
