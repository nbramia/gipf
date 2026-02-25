// ZertzBoard.js
// A pure logic class for handling Zertz state and rules (no React)

export default class ZertzBoard {
  // Game constants
  static MARBLE_COUNTS = { white: 6, grey: 8, black: 10 };
  static WIN_CONDITIONS = [
    { white: 3, grey: 3, black: 3 },  // Mixed set
    { white: 4, grey: 0, black: 0 },  // White dominance
    { white: 0, grey: 5, black: 0 },  // Grey dominance
    { white: 0, grey: 0, black: 6 },  // Black dominance
  ];
  static DIRECTIONS = [
    [1, 0],   // East
    [-1, 0],  // West
    [0, 1],   // Southeast
    [0, -1],  // Northwest
    [1, -1],  // Northeast
    [-1, 1],  // Southwest
  ];

  /**
   * Generate the 37 valid axial coordinate pairs for a regular hex with side=4
   * Valid positions: all (q, r) where max(|q|, |r|, |q+r|) <= 3
   */
  static generateValidPositions() {
    const positions = [];
    for (let q = -3; q <= 3; q++) {
      for (let r = -3; r <= 3; r++) {
        if (Math.max(Math.abs(q), Math.abs(r), Math.abs(q + r)) <= 3) {
          positions.push([q, r]);
        }
      }
    }
    return positions;
  }

  constructor({
    skipInitialHistory = false
  } = {}) {
    // Board structure: which positions still have rings
    this.rings = new Set();
    ZertzBoard.generateValidPositions().forEach(([q, r]) => {
      this.rings.add(this._toKey(q, r));
    });

    // Marbles on the board: key -> color ('white'|'grey'|'black')
    this.marbles = {};

    // Shared pool of marbles not yet placed
    this.pool = { ...ZertzBoard.MARBLE_COUNTS };

    // Captured marbles per player: { white: n, grey: n, black: n }
    this.captures = {
      1: { white: 0, grey: 0, black: 0 },
      2: { white: 0, grey: 0, black: 0 },
    };

    this.currentPlayer = 1;
    this.gamePhase = 'place-marble'; // 'place-marble' | 'remove-ring' | 'capture' | 'game-over'
    this.winner = null;
    this.winConditionMet = null;

    // Selected marble color for placement
    this.selectedColor = null;

    // Capture sub-state
    this.jumpingMarble = null; // key of marble currently mid-jump-sequence
    this.captureStarted = false; // true once a jump has been executed in current capture turn

    // Move history for undo/redo
    this.stateHistory = [];
    this.historyIndex = -1;
    this.maxHistoryLength = 100;

    if (!skipInitialHistory) {
      this._captureState();
    }
  }

  // --- Utility ---

  _toKey(q, r) {
    return `${q},${r}`;
  }

  _fromKey(key) {
    return key.split(',').map(Number);
  }

  _getNeighborKey(key, direction) {
    const [q, r] = this._fromKey(key);
    return this._toKey(q + direction[0], r + direction[1]);
  }

  // --- Pool / Placement ---

  /**
   * Get total marbles remaining in pool
   */
  getPoolTotal() {
    return this.pool.white + this.pool.grey + this.pool.black;
  }

  /**
   * Check if player must place from own captures (pool empty)
   */
  _mustPlaceFromCaptures() {
    return this.getPoolTotal() === 0;
  }

  /**
   * Get available colors the current player can place
   */
  getAvailableColors() {
    if (this._mustPlaceFromCaptures()) {
      const caps = this.captures[this.currentPlayer];
      return ['white', 'grey', 'black'].filter(c => caps[c] > 0);
    }
    return ['white', 'grey', 'black'].filter(c => this.pool[c] > 0);
  }

  /**
   * Select a marble color for placement
   */
  selectMarbleColor(color) {
    if (this.gamePhase !== 'place-marble') return;
    if (!this.getAvailableColors().includes(color)) return;
    this.selectedColor = color;
  }

  /**
   * Get all rings without marbles (valid placement targets)
   */
  getValidPlacements() {
    const placements = [];
    for (const key of this.rings) {
      if (!this.marbles[key]) {
        placements.push(key);
      }
    }
    return placements;
  }

  /**
   * Place the selected marble on a ring
   */
  placeMarble(q, r) {
    if (this.gamePhase !== 'place-marble') return false;
    if (!this.selectedColor) return false;

    const key = this._toKey(q, r);
    if (!this.rings.has(key) || this.marbles[key]) return false;

    // Place the marble
    this.marbles[key] = this.selectedColor;

    // Decrement from pool or captures
    if (this._mustPlaceFromCaptures()) {
      this.captures[this.currentPlayer][this.selectedColor]--;
    } else {
      this.pool[this.selectedColor]--;
    }

    this.selectedColor = null;

    // Check if placing on the last vacant ring of an isolated group triggers capture
    const isolationCaptures = this._checkIsolationAfterPlace(key);
    if (isolationCaptures.length > 0) {
      this._applyIsolationCaptures(isolationCaptures);
      if (this._checkWinCondition(this.currentPlayer)) {
        this.gamePhase = 'game-over';
        this.winner = this.currentPlayer;
        this._captureState();
        return true;
      }
    }

    // Check all-rings-occupied endgame
    if (this._allRingsOccupied()) {
      this._captureAllRemainingMarbles();
      this.gamePhase = 'game-over';
      this._captureState();
      return true;
    }

    // Transition to remove-ring phase
    const freeRings = this.getFreeRings();
    if (freeRings.length > 0) {
      this.gamePhase = 'remove-ring';
    } else {
      // No free rings to remove, end turn
      this._endTurn();
    }

    this._captureState();
    return true;
  }

  // --- Ring Removal ---

  /**
   * Get all removable (free) rings:
   * - Vacant (no marble)
   * - On the edge (has at least one missing neighbor — can be slid away)
   * Note: Removing a ring CAN disconnect the board; this triggers isolation captures.
   */
  getFreeRings() {
    const free = [];
    for (const key of this.rings) {
      if (this.marbles[key]) continue; // Must be vacant
      if (!this._canSlideAway(key)) continue; // Must be slidable (has a gap wide enough)
      free.push(key);
    }
    return free;
  }

  /**
   * Check if a ring is on the edge (has at least one missing neighbor)
   */
  _isEdgeRing(key) {
    for (const dir of ZertzBoard.DIRECTIONS) {
      const neighborKey = this._getNeighborKey(key, dir);
      if (!this.rings.has(neighborKey)) {
        return true;
      }
    }
    return false;
  }

  /**
   * Check if a ring can physically slide away — requires two consecutive
   * missing neighbors in the circular hex direction ring.
   */
  _canSlideAway(key) {
    // Directions in circular (clockwise) order
    const circularDirs = [
      [1, 0],   // East
      [1, -1],  // Northeast
      [0, -1],  // Northwest
      [-1, 0],  // West
      [-1, 1],  // Southwest
      [0, 1],   // Southeast
    ];

    const present = circularDirs.map(dir => {
      const neighborKey = this._getNeighborKey(key, dir);
      return this.rings.has(neighborKey);
    });

    const count = present.filter(Boolean).length;
    if (count <= 1) return true;

    // Check for two consecutive missing neighbors (wrapping)
    for (let i = 0; i < 6; i++) {
      if (!present[i] && !present[(i + 1) % 6]) {
        return true;
      }
    }
    return false;
  }

  /**
   * Remove a ring from the board
   */
  removeRing(q, r) {
    if (this.gamePhase !== 'remove-ring') return false;

    const key = this._toKey(q, r);
    const freeRings = this.getFreeRings();
    if (!freeRings.includes(key)) return false;

    this.rings.delete(key);

    // Check for isolation captures after ring removal
    const isolationCaptures = this._checkIsolation();
    if (isolationCaptures.length > 0) {
      this._applyIsolationCaptures(isolationCaptures);
      if (this._checkWinCondition(this.currentPlayer)) {
        this.gamePhase = 'game-over';
        this.winner = this.currentPlayer;
        this._captureState();
        return true;
      }
    }

    // Check all-rings-occupied endgame after ring removal
    if (this._allRingsOccupied()) {
      this._captureAllRemainingMarbles();
      this.gamePhase = 'game-over';
      this._captureState();
      return true;
    }

    this._endTurn();
    this._captureState();
    return true;
  }

  // --- Capture Mechanics ---

  /**
   * Scan all marbles on the board for any that can make a valid jump.
   * Returns array of keys of marbles that can capture.
   */
  getAvailableCaptures() {
    const capturable = [];
    for (const key of Object.keys(this.marbles)) {
      if (this.getJumpTargets(key).length > 0) {
        capturable.push(key);
      }
    }
    return capturable;
  }

  /**
   * For a specific marble, list valid jump destinations.
   * Returns array of { target: key, captured: key, direction: [dq, dr] }
   */
  getJumpTargets(marbleKey) {
    const targets = [];
    const [q, r] = this._fromKey(marbleKey);

    for (const dir of ZertzBoard.DIRECTIONS) {
      const adjKey = this._toKey(q + dir[0], r + dir[1]);
      const landKey = this._toKey(q + dir[0] * 2, r + dir[1] * 2);

      // Adjacent must have a marble
      if (!this.marbles[adjKey]) continue;
      // Landing must be a ring without a marble
      if (!this.rings.has(landKey)) continue;
      if (this.marbles[landKey]) continue;

      targets.push({
        target: landKey,
        captured: adjKey,
        direction: dir,
      });
    }
    return targets;
  }

  /**
   * Execute a jump capture
   */
  executeCapture(fromKey, targetKey) {
    if (this.gamePhase !== 'capture') return false;

    const targets = this.getJumpTargets(fromKey);
    const jump = targets.find(t => t.target === targetKey);
    if (!jump) return false;

    // If there's already a jumping marble, must continue with same marble
    if (this.jumpingMarble && this.jumpingMarble !== fromKey) return false;

    // Move the marble
    const color = this.marbles[fromKey];
    delete this.marbles[fromKey];
    this.marbles[targetKey] = color;
    this.captureStarted = true;

    // Capture the jumped marble
    const capturedColor = this.marbles[jump.captured];
    delete this.marbles[jump.captured];
    this.captures[this.currentPlayer][capturedColor]++;

    // Check win after capture
    if (this._checkWinCondition(this.currentPlayer)) {
      this.gamePhase = 'game-over';
      this.winner = this.currentPlayer;
      this.jumpingMarble = null;
      this._captureState();
      return true;
    }

    // Check for multi-jump from new position
    const furtherJumps = this.getJumpTargets(targetKey);
    if (furtherJumps.length > 0) {
      // Must continue jumping with this marble
      this.jumpingMarble = targetKey;
      this._captureState();
      return true;
    }

    // No more jumps, end capture turn
    this.jumpingMarble = null;
    this._endTurn();
    this._captureState();
    return true;
  }

  // --- Turn Management ---

  /**
   * End the current turn, switch player, determine next phase.
   */
  _endTurn() {
    this.currentPlayer = this.currentPlayer === 1 ? 2 : 1;
    this.jumpingMarble = null;
    this.captureStarted = false;
    this.selectedColor = null;

    // Check if the next player has mandatory captures
    const captures = this.getAvailableCaptures();
    if (captures.length > 0) {
      this.gamePhase = 'capture';
    } else {
      // Check if player can place (has colors available and has vacant rings)
      const availableColors = this.getAvailableColors();
      const vacantRings = this.getValidPlacements();
      if (availableColors.length === 0 || vacantRings.length === 0) {
        // Player cannot place -- game ends, opponent wins by default
        this.gamePhase = 'game-over';
        this.winner = this.currentPlayer === 1 ? 2 : 1;
        return;
      }
      this.gamePhase = 'place-marble';
    }
  }

  // --- Isolation Mechanic ---

  /**
   * Find all connected components of remaining rings using BFS
   */
  _findConnectedComponents() {
    const visited = new Set();
    const components = [];

    for (const key of this.rings) {
      if (visited.has(key)) continue;

      const component = new Set();
      const queue = [key];
      visited.add(key);

      while (queue.length > 0) {
        const current = queue.shift();
        component.add(current);
        for (const dir of ZertzBoard.DIRECTIONS) {
          const neighbor = this._getNeighborKey(current, dir);
          if (this.rings.has(neighbor) && !visited.has(neighbor)) {
            visited.add(neighbor);
            queue.push(neighbor);
          }
        }
      }
      components.push(component);
    }

    return components;
  }

  /**
   * Check isolation after ring removal.
   * Returns array of { keys: Set, marbles: Object } for islands to capture.
   */
  _checkIsolation() {
    const components = this._findConnectedComponents();
    if (components.length <= 1) return [];

    // Find the largest component
    let maxSize = 0;
    for (const comp of components) {
      if (comp.size > maxSize) maxSize = comp.size;
    }

    const isolationCaptures = [];

    for (const comp of components) {
      // For equal-size splits, evaluate both; for unequal, only non-largest
      if (comp.size === maxSize && components.filter(c => c.size === maxSize).length === 1) {
        continue; // This is the unique largest — skip it
      }
      // Check if ALL rings in this component have marbles
      let allOccupied = true;
      const capturedMarbles = {};
      for (const key of comp) {
        if (!this.marbles[key]) {
          allOccupied = false;
          break;
        }
        capturedMarbles[key] = this.marbles[key];
      }
      if (allOccupied && comp.size > 0) {
        isolationCaptures.push({ keys: comp, marbles: capturedMarbles });
      }
    }

    return isolationCaptures;
  }

  /**
   * Check isolation specifically after placing a marble.
   * Placing on the last vacant ring of an isolated group triggers capture.
   */
  _checkIsolationAfterPlace(placedKey) {
    const components = this._findConnectedComponents();
    if (components.length <= 1) {
      // Single component -- check if it's fully occupied
      const comp = components[0];
      if (comp) {
        let allOccupied = true;
        const capturedMarbles = {};
        for (const key of comp) {
          if (!this.marbles[key]) {
            allOccupied = false;
            break;
          }
          capturedMarbles[key] = this.marbles[key];
        }
        // Don't capture the entire board just because it's full
        // That's handled by _allRingsOccupied
      }
      return [];
    }

    // Multiple components exist — check non-main components for full occupation
    let maxSize = 0;
    for (const comp of components) {
      if (comp.size > maxSize) maxSize = comp.size;
    }

    const isolationCaptures = [];

    for (const comp of components) {
      if (comp.size === maxSize && components.filter(c => c.size === maxSize).length === 1) {
        continue;
      }

      let allOccupied = true;
      const capturedMarbles = {};
      for (const key of comp) {
        if (!this.marbles[key]) {
          allOccupied = false;
          break;
        }
        capturedMarbles[key] = this.marbles[key];
      }
      if (allOccupied && comp.size > 0) {
        isolationCaptures.push({ keys: comp, marbles: capturedMarbles });
      }
    }

    return isolationCaptures;
  }

  /**
   * Apply isolation captures -- remove rings and add marbles to player's captures
   */
  _applyIsolationCaptures(isolationCaptures) {
    for (const { keys, marbles: capturedMarbles } of isolationCaptures) {
      for (const key of keys) {
        const color = capturedMarbles[key];
        if (color) {
          this.captures[this.currentPlayer][color]++;
          delete this.marbles[key];
        }
        this.rings.delete(key);
      }
    }
  }

  // --- Win Conditions ---

  /**
   * Check if a player has met any win condition
   */
  _checkWinCondition(player) {
    const caps = this.captures[player];
    for (const condition of ZertzBoard.WIN_CONDITIONS) {
      let met = true;
      for (const color of ['white', 'grey', 'black']) {
        if (condition[color] > 0 && caps[color] < condition[color]) {
          met = false;
          break;
        }
      }
      if (met) {
        this.winConditionMet = condition;
        return true;
      }
    }
    return false;
  }

  /**
   * Check if all remaining rings have marbles (endgame trigger)
   */
  _allRingsOccupied() {
    if (this.rings.size === 0) return false;
    for (const key of this.rings) {
      if (!this.marbles[key]) return false;
    }
    return true;
  }

  /**
   * When all rings are occupied, the player who placed last captures everything
   */
  _captureAllRemainingMarbles() {
    for (const key of Object.keys(this.marbles)) {
      const color = this.marbles[key];
      this.captures[this.currentPlayer][color]++;
    }
    this.marbles = {};

    if (this._checkWinCondition(this.currentPlayer)) {
      this.winner = this.currentPlayer;
    }
    // else: winner stays null → draw
  }

  // --- Main Click Handler ---

  /**
   * Handle a click on a board position. Dispatches based on game phase.
   */
  handleClick(q, r) {
    if (this.gamePhase === 'game-over') return;

    const key = this._toKey(q, r);

    if (this.gamePhase === 'place-marble') {
      if (!this.selectedColor) return;
      this.placeMarble(q, r);
      return;
    }

    if (this.gamePhase === 'remove-ring') {
      this.removeRing(q, r);
      return;
    }

    if (this.gamePhase === 'capture') {
      this._handleCaptureClick(key);
      return;
    }
  }

  /**
   * Handle clicks during capture phase
   */
  _handleCaptureClick(key) {
    if (this.jumpingMarble) {
      // Before first jump: allow switching selection or deselecting
      if (!this.captureStarted) {
        if (key !== this.jumpingMarble && this.marbles[key] && this.getJumpTargets(key).length > 0) {
          // Switch to a different jumpable marble
          this.jumpingMarble = key;
          this._captureState();
          return;
        }
        if (key === this.jumpingMarble) {
          // Deselect by clicking the same marble
          this.jumpingMarble = null;
          this._captureState();
          return;
        }
      }
      // Normal path: execute capture (mid-sequence or first jump)
      this.executeCapture(this.jumpingMarble, key);
      return;
    }

    // No marble selected yet -- click should select a jumpable marble
    if (this.marbles[key] && this.getJumpTargets(key).length > 0) {
      this.jumpingMarble = key;
      this.captureStarted = false;
      this._captureState();
      return;
    }
  }

  // --- AI Interface ---

  /**
   * Generate a string hash encoding full game state for MCTS transposition table.
   * Format: rings|marbles|pool|captures|player|phase|jumpingMarble
   */
  getStateHash() {
    const ringsSorted = [...this.rings].sort().join(';');
    const marblesSorted = Object.keys(this.marbles).sort()
      .map(k => `${k}:${this.marbles[k][0]}`) // first char: w/g/b
      .join(';');
    const poolStr = `${this.pool.white},${this.pool.grey},${this.pool.black}`;
    const capsStr = `${this.captures[1].white},${this.captures[1].grey},${this.captures[1].black}|${this.captures[2].white},${this.captures[2].grey},${this.captures[2].black}`;
    const jm = this.jumpingMarble || '';
    return `${ringsSorted}|${marblesSorted}|${poolStr}|${capsStr}|${this.currentPlayer}|${this.gamePhase}|${jm}`;
  }

  /**
   * Returns a flat array of move objects for the current phase.
   * This is the method MCTS calls to enumerate branches.
   */
  getLegalMoves() {
    if (this.gamePhase === 'game-over') return [];

    if (this.gamePhase === 'capture') {
      const moves = [];
      if (this.jumpingMarble) {
        // Must continue with the same marble
        const targets = this.getJumpTargets(this.jumpingMarble);
        for (const t of targets) {
          moves.push({
            type: 'capture',
            fromKey: this.jumpingMarble,
            toKey: t.target,
            capturedKey: t.captured,
          });
        }
      } else {
        // Any marble that can jump
        const capturableKeys = this.getAvailableCaptures();
        for (const fromKey of capturableKeys) {
          const targets = this.getJumpTargets(fromKey);
          for (const t of targets) {
            moves.push({
              type: 'capture',
              fromKey,
              toKey: t.target,
              capturedKey: t.captured,
            });
          }
        }
      }
      return moves;
    }

    if (this.gamePhase === 'place-marble') {
      const moves = [];
      const colors = this.getAvailableColors();
      const placements = this.getValidPlacements();
      for (const color of colors) {
        for (const key of placements) {
          const [q, r] = this._fromKey(key);
          moves.push({ type: 'place-marble', color, q, r });
        }
      }
      return moves;
    }

    if (this.gamePhase === 'remove-ring') {
      const freeRings = this.getFreeRings();
      return freeRings.map(key => {
        const [q, r] = this._fromKey(key);
        return { type: 'remove-ring', q, r };
      });
    }

    return [];
  }

  /**
   * Serialize all state fields for Web Worker communication.
   */
  serializeState() {
    return {
      rings: [...this.rings],
      marbles: { ...this.marbles },
      pool: { ...this.pool },
      captures: {
        1: { ...this.captures[1] },
        2: { ...this.captures[2] },
      },
      currentPlayer: this.currentPlayer,
      gamePhase: this.gamePhase,
      winner: this.winner,
      winConditionMet: this.winConditionMet ? { ...this.winConditionMet } : null,
      selectedColor: this.selectedColor,
      jumpingMarble: this.jumpingMarble,
      captureStarted: this.captureStarted,
    };
  }

  /**
   * Reconstruct a board from serialized state (e.g. from Web Worker).
   */
  static fromSerializedState(state) {
    const board = new ZertzBoard({ skipInitialHistory: true });
    board.rings = new Set(state.rings);
    board.marbles = { ...state.marbles };
    board.pool = { ...state.pool };
    board.captures = {
      1: { ...state.captures[1] },
      2: { ...state.captures[2] },
    };
    board.currentPlayer = state.currentPlayer;
    board.gamePhase = state.gamePhase;
    board.winner = state.winner;
    board.winConditionMet = state.winConditionMet ? { ...state.winConditionMet } : null;
    board.selectedColor = state.selectedColor;
    board.jumpingMarble = state.jumpingMarble;
    board.captureStarted = state.captureStarted;
    return board;
  }

  // --- Clone ---

  clone() {
    const newBoard = new ZertzBoard({ skipInitialHistory: true });
    newBoard.rings = new Set(this.rings);
    newBoard.marbles = { ...this.marbles };
    newBoard.pool = { ...this.pool };
    newBoard.captures = {
      1: { ...this.captures[1] },
      2: { ...this.captures[2] },
    };
    newBoard.currentPlayer = this.currentPlayer;
    newBoard.gamePhase = this.gamePhase;
    newBoard.winner = this.winner;
    newBoard.winConditionMet = this.winConditionMet ? { ...this.winConditionMet } : null;
    newBoard.selectedColor = this.selectedColor;
    newBoard.jumpingMarble = this.jumpingMarble;
    newBoard.captureStarted = this.captureStarted;
    newBoard.stateHistory = this.stateHistory.map(s => JSON.parse(JSON.stringify(s)));
    newBoard.historyIndex = this.historyIndex;
    newBoard.maxHistoryLength = this.maxHistoryLength;
    return newBoard;
  }

  // --- State History / Undo / Redo ---

  _captureState() {
    if (this.historyIndex < this.stateHistory.length - 1) {
      this.stateHistory = this.stateHistory.slice(0, this.historyIndex + 1);
    }

    const snapshot = {
      rings: [...this.rings],
      marbles: { ...this.marbles },
      pool: { ...this.pool },
      captures: {
        1: { ...this.captures[1] },
        2: { ...this.captures[2] },
      },
      currentPlayer: this.currentPlayer,
      gamePhase: this.gamePhase,
      winner: this.winner,
      winConditionMet: this.winConditionMet ? { ...this.winConditionMet } : null,
      selectedColor: this.selectedColor,
      jumpingMarble: this.jumpingMarble,
      captureStarted: this.captureStarted,
    };

    this.stateHistory.push(snapshot);
    this.historyIndex++;

    if (this.stateHistory.length > this.maxHistoryLength) {
      this.stateHistory.shift();
      this.historyIndex--;
    }
  }

  _restoreState(snapshot) {
    this.rings = new Set(snapshot.rings);
    this.marbles = { ...snapshot.marbles };
    this.pool = { ...snapshot.pool };
    this.captures = {
      1: { ...snapshot.captures[1] },
      2: { ...snapshot.captures[2] },
    };
    this.currentPlayer = snapshot.currentPlayer;
    this.gamePhase = snapshot.gamePhase;
    this.winner = snapshot.winner;
    this.winConditionMet = snapshot.winConditionMet ? { ...snapshot.winConditionMet } : null;
    this.selectedColor = snapshot.selectedColor;
    this.jumpingMarble = snapshot.jumpingMarble;
    this.captureStarted = snapshot.captureStarted;
  }

  undo() {
    if (this.historyIndex <= 0) return false;
    this.historyIndex--;
    this._restoreState(this.stateHistory[this.historyIndex]);
    return true;
  }

  redo() {
    if (this.historyIndex >= this.stateHistory.length - 1) return false;
    this.historyIndex++;
    this._restoreState(this.stateHistory[this.historyIndex]);
    return true;
  }

  canUndo() {
    return this.historyIndex > 0;
  }

  canRedo() {
    return this.historyIndex < this.stateHistory.length - 1;
  }

  // --- New Game ---

  startNewGame() {
    this.rings = new Set();
    ZertzBoard.generateValidPositions().forEach(([q, r]) => {
      this.rings.add(this._toKey(q, r));
    });
    this.marbles = {};
    this.pool = { ...ZertzBoard.MARBLE_COUNTS };
    this.captures = {
      1: { white: 0, grey: 0, black: 0 },
      2: { white: 0, grey: 0, black: 0 },
    };
    this.currentPlayer = 1;
    this.gamePhase = 'place-marble';
    this.winner = null;
    this.winConditionMet = null;
    this.selectedColor = null;
    this.jumpingMarble = null;
    this.captureStarted = false;
    this.stateHistory = [];
    this.historyIndex = -1;
    this._captureState();
  }
}
