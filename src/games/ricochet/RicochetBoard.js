// RicochetBoard.js
// Pure rules/state engine for solo Ricochet Robots. No React, no UI.
//
// The board (walls, targets) is generated from the seed and is immutable. The
// mutable state is the four robot cells, the round in progress and the history.
//
// Bounce rule: the published game says a robot must ricochet at least once, so
// a target a robot could reach directly cannot be claimed. We implement that the
// way DriftingDroids does: rounds whose optimal solution is a single move are
// never dealt (see engine/rounds.js), so here any stop on the target solves it.

import {
  CELLS, ROBOTS, DIRS, DIR_INDEX, CENTER_CELLS, slide,
} from './engine/geometry.js';
import { generateBoard } from './engine/generator.js';

export { ROBOTS, DIRS };

export default class RicochetBoard {
  // `walls`, `targets` and `robots` override the generated board / random start;
  // they exist for hand-built layouts in tests and scripts.
  constructor({ seed = 1, skipInitialHistory = false, walls = null, targets = null, robots = null } = {}) {
    this.seed = seed;
    const generated = walls && targets ? null : generateBoard(seed);
    this.walls = walls ? Uint8Array.from(walls) : generated.walls;
    this.targets = (targets || generated.targets).map(t => ({ ...t }));

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

  // Four distinct cells that are neither targets nor the centre block.
  _placeRobots() {
    const blocked = new Set([...CENTER_CELLS, ...this.targets.map(t => t.cell)]);
    const free = [];
    for (let c = 0; c < CELLS; c++) if (!blocked.has(c)) free.push(c);
    const robots = {};
    for (const name of ROBOTS) {
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

  _occupied() {
    const occ = new Uint8Array(CELLS);
    for (const name of ROBOTS) occ[this.robots[name]] = 1;
    return occ;
  }

  // Where `robot` would stop sliding `dir` ('N'|'E'|'S'|'W') from where it is now.
  getDestination(robot, dir) {
    if (!ROBOTS.includes(robot) || !DIRS.includes(dir)) return null;
    return slide(this.walls, this.robots[robot], DIR_INDEX[dir], this._occupied());
  }

  // Every (robot, direction) that actually moves the robot. Empty once solved
  // or before a round has started.
  getLegalMoves() {
    if (this.currentTargetId == null || this.solved) return [];
    const occ = this._occupied();
    const moves = [];
    for (const robot of ROBOTS) {
      const from = this.robots[robot];
      for (let d = 0; d < 4; d++) {
        if (slide(this.walls, from, d, occ) !== from) moves.push({ robot, dir: DIRS[d] });
      }
    }
    return moves;
  }

  // ---- play ----------------------------------------------------------------

  // Returns the move record {robot, dir, from, to}, or false if illegal.
  applyMove({ robot, dir } = {}) {
    if (this.currentTargetId == null || this.solved) return false;
    if (!ROBOTS.includes(robot) || !DIRS.includes(dir)) return false;
    const from = this.robots[robot];
    const to = this.getDestination(robot, dir);
    if (to === from) return false;

    this.robots[robot] = to;
    const record = { robot, dir, from, to };
    this.moves.push(record);

    const target = this.targets[this.currentTargetId];
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

  // Fresh board for a new seed; keeps nothing from the old one.
  startNewGame(seed = Date.now()) {
    Object.assign(this, new RicochetBoard({ seed }));
  }

  // ---- hashing / serialization / history -----------------------------------

  getStateHash() {
    const robots = ROBOTS.map(r => this.robots[r]).join(',');
    return `${this.seed}|${robots}|${this.currentTargetId}|${this.claimed.join(',')}|${this.solved ? 1 : 0}`;
  }

  serializeState() {
    return {
      seed: this.seed,
      walls: Array.from(this.walls),
      targets: this.targets.map(t => ({ ...t })),
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
