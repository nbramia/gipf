// RicochetBoard.js
// Pure rules/state engine for solo Ricochet Robots. No React, no UI.
//
// The board (walls, targets, diagonal barriers) is generated from the seed and
// config and is immutable. The mutable state is the robot cells (four, or five
// with the black robot), the round in progress and the history.
//
// Bounce rule: the published game says a robot must ricochet at least once, so
// a target a robot could reach directly cannot be claimed. We implement that the
// way DriftingDroids does: rounds whose optimal solution is a single move are
// never dealt (see engine/rounds.js), so here any stop on the target solves it.

import {
  ROBOTS, ALL_ROBOTS, DIRS, DIR_INDEX, centerCellsOf, makeLayout, slideCells, waypoints,
} from './engine/geometry.js';
import { generateBoard } from './engine/generator.js';
import { normalizeConfig, DEFAULT_CONFIG } from './engine/config.js';

export { ROBOTS, ALL_ROBOTS, DIRS, DEFAULT_CONFIG };

export default class RicochetBoard {
  // `config` ({ size: 16 | 12, fifthRobot, diagonals }; default 16 / false / false)
  // picks the board variant. `walls`, `targets`, `barriers` and `robots` override
  // the generated board / random start; they exist for hand-built layouts in
  // tests and scripts (a hand-built `walls` array also fixes the size).
  constructor({
    seed = 1, skipInitialHistory = false, walls = null, targets = null, robots = null,
    config = null, barriers = null,
  } = {}) {
    this.seed = seed;
    const cfg = normalizeConfig(config);
    if (walls && walls.length !== cfg.size * cfg.size) {
      cfg.size = Math.round(Math.sqrt(walls.length));
      if (cfg.size !== 12 && cfg.size !== 16) throw new Error(`Unsupported wall array of ${walls.length} cells`);
    }
    this.config = cfg;
    this.size = cfg.size;
    this.cells = cfg.size * cfg.size;
    const generated = walls && targets ? null : generateBoard(seed, cfg);
    this.walls = walls ? Uint8Array.from(walls) : generated.walls;
    this.targets = (targets || generated.targets).map(t => ({ ...t }));
    this.barriers = (barriers || (generated ? generated.barriers : [])).map(b => ({ ...b }));
    this._layout = makeLayout(this.size, this.walls, this.barriers);
    // Robot names in order; black (the fifth robot) is last.
    this.robotNames = cfg.fifthRobot ? ALL_ROBOTS : ROBOTS;

    // PRNG state lives on the board (and in the serialized state) so tie-breaks
    // and robot placement continue the same stream after a restore.
    this.rngState = (seed + 0x5bd1e995) >>> 0;

    this.robots = robots ? { ...robots } : this._placeRobots();
    this.roundStart = { ...this.robots };
    this.currentTargetId = null;
    this.claimed = [];
    this.moves = [];
    this.solved = false;

    this.stateHistory = [];
    this.historyIndex = -1;
    this.maxHistoryLength = 200;
    this._skipHistory = false;

    if (!skipInitialHistory) this._captureState();
  }

  // ---- randomness ----------------------------------------------------------

  // Next value in [0, 1) from the board's own serializable stream.
  random() {
    this.rngState = (this.rngState + 0x6D2B79F5) >>> 0;
    let n = this.rngState;
    n = Math.imul(n ^ (n >>> 15), n | 1);
    n ^= n + Math.imul(n ^ (n >>> 7), n | 61);
    return ((n ^ (n >>> 14)) >>> 0) / 4294967296;
  }

  // One distinct cell per robot (black last) that is not a target, a barrier or
  // the centre block.
  _placeRobots() {
    const blocked = new Set([
      ...centerCellsOf(this.size), ...this.targets.map(t => t.cell), ...this.barriers.map(b => b.cell),
    ]);
    const free = [];
    for (let c = 0; c < this.cells; c++) if (!blocked.has(c)) free.push(c);
    const robots = {};
    for (const name of this.robotNames) {
      const i = Math.floor(this.random() * free.length);
      robots[name] = free.splice(i, 1)[0];
    }
    return robots;
  }

  // ---- accessors -----------------------------------------------------------

  getTarget(id = this.currentTargetId) {
    return id == null ? null : this.targets[id];
  }

  isSolved() {
    return this.solved;
  }

  // Cells held by every robot except `except` (a slide may pass its own start).
  _occupied(except = null) {
    const occ = new Uint8Array(this.cells);
    for (const name of this.robotNames) if (name !== except) occ[this.robots[name]] = 1;
    return occ;
  }

  // Every cell `robot` moves through sliding `dir`, start first and stop last, or
  // null if the move is illegal (blocked at once, or a barrier loop).
  _route(robot, dir, occ = this._occupied(robot)) {
    return slideCells(this._layout, this.robots[robot], DIR_INDEX[dir], this.robotNames.indexOf(robot), occ);
  }

  // Where `robot` would stop sliding `dir` ('N'|'E'|'S'|'W') from where it is now;
  // its own cell when the move is illegal.
  getDestination(robot, dir) {
    if (!this.robotNames.includes(robot) || !DIRS.includes(dir)) return null;
    const route = this._route(robot, dir);
    return route ? route[route.length - 1] : this.robots[robot];
  }

  // The slide as drawn: [start, each cell where the robot turned off a barrier,
  // stop], or null if the move is illegal. Without barriers this is [start, stop].
  getSlidePath(robot, dir) {
    if (!this.robotNames.includes(robot) || !DIRS.includes(dir)) return null;
    const route = this._route(robot, dir);
    return route ? waypoints(route) : null;
  }

  // Every (robot, direction) that actually moves the robot. Empty once solved
  // or before a round has started.
  getLegalMoves() {
    if (this.currentTargetId == null || this.solved) return [];
    const moves = [];
    for (const robot of this.robotNames) {
      const occ = this._occupied(robot);
      for (let d = 0; d < 4; d++) {
        if (this._route(robot, DIRS[d], occ)) moves.push({ robot, dir: DIRS[d] });
      }
    }
    return moves;
  }

  // ---- play ----------------------------------------------------------------

  // Returns the move record {robot, dir, from, to}, or false if illegal. On a
  // board with diagonal barriers the record also has `path`, the slide's corner
  // points (see getSlidePath).
  applyMove({ robot, dir } = {}) {
    if (this.currentTargetId == null || this.solved) return false;
    if (!this.robotNames.includes(robot) || !DIRS.includes(dir)) return false;
    const from = this.robots[robot];
    const route = this._route(robot, dir);
    if (!route) return false;
    const to = route[route.length - 1];

    this.robots[robot] = to;
    const record = { robot, dir, from, to };
    if (this._layout.diag !== null) record.path = waypoints(route);
    this.moves.push(record);

    const target = this.targets[this.currentTargetId];
    // The vortex takes any robot, black included; black never claims a colour.
    const claimant = target.color == null ? robot : target.color;
    if (robot === claimant && to === target.cell) {
      this.solved = true;
      this.claimed.push(target.id);
    }
    this._captureState();
    return record;
  }

  // Deals `targetId` from the robots' current cells (they stay where the last
  // round ended).
  startRound(targetId) {
    const target = this.targets[targetId];
    if (!target) throw new Error(`Unknown target ${targetId}`);
    if (this.claimed.includes(targetId)) throw new Error(`Target ${targetId} is already claimed`);
    this.currentTargetId = targetId;
    this.roundStart = { ...this.robots };
    this.moves = [];
    this.solved = false;
    this._captureState();
  }

  // Puts the robots back on the round's start cells and clears its moves.
  resetRound() {
    if (this.currentTargetId == null) return;
    this.robots = { ...this.roundStart };
    this.moves = [];
    if (this.solved) {
      this.claimed = this.claimed.filter(id => id !== this.currentTargetId);
      this.solved = false;
    }
    this._captureState();
  }

  // Fresh board for a new seed in the same variant; keeps nothing else.
  startNewGame(seed = Date.now()) {
    Object.assign(this, new RicochetBoard({ seed, config: this.config }));
  }

  // ---- hashing / serialization / history -----------------------------------

  getStateHash() {
    const robots = this.robotNames.map(r => this.robots[r]).join(',');
    return `${this.seed}|${robots}|${this.currentTargetId}|${this.claimed.join(',')}|${this.solved ? 1 : 0}`;
  }

  serializeState() {
    return {
      seed: this.seed,
      config: { ...this.config },
      walls: Array.from(this.walls),
      targets: this.targets.map(t => ({ ...t })),
      barriers: this.barriers.map(b => ({ ...b })),
      rngState: this.rngState,
      robots: { ...this.robots },
      roundStart: { ...this.roundStart },
      currentTargetId: this.currentTargetId,
      claimed: [...this.claimed],
      moves: this.moves.map(m => ({ ...m })),
      solved: this.solved,
      stateHistory: [...this.stateHistory],
      historyIndex: this.historyIndex,
      maxHistoryLength: this.maxHistoryLength,
    };
  }

  static fromSerializedState(state) {
    const board = new RicochetBoard({
      seed: state.seed,
      skipInitialHistory: true,
      walls: state.walls,
      targets: state.targets,
      robots: state.robots,
      config: state.config, // absent in saves from before the variants: the default board
      barriers: state.barriers || [],
    });
    board.rngState = state.rngState;
    board.roundStart = { ...state.roundStart };
    board.currentTargetId = state.currentTargetId;
    board.claimed = [...state.claimed];
    board.moves = state.moves.map(m => ({ ...m }));
    board.solved = !!state.solved;
    board.stateHistory = [...(state.stateHistory || [])];
    board.historyIndex = state.historyIndex ?? -1;
    board.maxHistoryLength = state.maxHistoryLength || 200;
    return board;
  }

  clone() {
    return RicochetBoard.fromSerializedState(this.serializeState());
  }

  _captureState() {
    if (this._skipHistory) return;
    const state = this.serializeState();
    state.stateHistory = [];
    state.historyIndex = -1;

    if (this.historyIndex < this.stateHistory.length - 1) {
      this.stateHistory = this.stateHistory.slice(0, this.historyIndex + 1);
    }
    this.stateHistory.push(JSON.stringify(state));
    if (this.stateHistory.length > this.maxHistoryLength) {
      this.stateHistory.shift();
    }
    this.historyIndex = this.stateHistory.length - 1;
  }

  canUndo() {
    return this.historyIndex > 0;
  }

  canRedo() {
    return this.historyIndex < this.stateHistory.length - 1;
  }

  undo() {
    if (!this.canUndo()) return false;
    this.historyIndex--;
    this._restoreFromHistory();
    return true;
  }

  redo() {
    if (!this.canRedo()) return false;
    this.historyIndex++;
    this._restoreFromHistory();
    return true;
  }

  _restoreFromHistory() {
    const parsed = JSON.parse(this.stateHistory[this.historyIndex]);
    parsed.stateHistory = this.stateHistory;
    parsed.historyIndex = this.historyIndex;
    Object.assign(this, RicochetBoard.fromSerializedState(parsed));
  }
}
