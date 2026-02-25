// YinshBoard.js
// A pure logic class for handling Yinsh state and rules (no React)

import YinshNotation from './YinshNotation.js';

export default class YinshBoard {
  // Game constants
  static RINGS_PER_PLAYER = 5;
  static MARKERS_IN_ROW = 5;
  static RINGS_TO_WIN = 3;
  static DIRECTIONS = [
    [1, 0],   // East
    [-1, 0],  // West
    [0, 1],   // Southeast
    [0, -1],  // Northwest
    [-1, 1],  // Southwest
    [1, -1]   // Northeast
  ];

  constructor({
    initialBoardState = {},
    initialPhase = 'setup',
    initialPlayer = 1,
    player1RingsPlaced = 0,
    player2RingsPlaced = 0,
    player1Score = 0,
    player2Score = 0,
    useRandomSetup = false,
    skipInitialHistory = false  // For test helpers that manually set up board state
  } = {}) {
    // Core game state
    this.boardState = { ...initialBoardState };
    this.gamePhase = initialPhase;
    this.currentPlayer = initialPlayer;
    this.ringsPlaced = {
      1: player1RingsPlaced,
      2: player2RingsPlaced
    };
    this.scores = {
      1: player1Score,
      2: player2Score
    };
    this.selectedRing = null;
    this.validMoves = [];
    this.rows = [];
    this.nextTurnPlayer = null;

    // For row-removal phases (new iterative resolution system)
    this.rowResolutionQueue = []; // Array of {player, rows}
    this.pendingRowsAfterRingRemoval = false; // Flag to check rows after ring removal

    // If we want random setup:
    if (useRandomSetup && this.gamePhase === 'setup') {
      // Immediately place random rings and set the game to 'play'
      this._placeRandomRings();
      this.gamePhase = 'play';
      this.currentPlayer = 1;
    }

    this.winner = null;  // Track winner
    this.selectedSetupRing = null;  // For setup phase ring selection

    // Game notation tracking
    this.notation = new YinshNotation();
    this.enableLogging = false;  // Disabled to prevent console spam

    // Move history for undo/redo
    this.stateHistory = [];  // Array of complete state snapshots
    this.historyIndex = -1;  // Current position in history (-1 = no history yet)
    this.maxHistoryLength = 50;  // Limit history to prevent memory issues

    // Capture initial state (unless manually constructed for testing)
    if (!skipInitialHistory) {
      this._captureState();
    }
  }

  // --- Utility / Board Generation ---
  static generateGridPoints() {
    const points = [];
    for (let q = -5; q <= 5; q++) {
      const r1 = Math.max(-5, -q - 5);
      const r2 = Math.min(5, -q + 5);
      for (let r = r1; r <= r2; r++) {
        // Exclude corner points if that's part of your design
        if (
          (q === -5 && r === -5) || 
          (q === 5 && r === -5)  || 
          (q === -5 && r === 5)  ||
          (q === 5 && r === 5)   ||
          (q === 0 && r === -5)  ||
          (q === 0 && r === 5)   ||
          (q === -5 && r === 0)  ||
          (q === 5 && r === 0)
        ) {
          continue;
        }
        points.push([q, r]);
      }
    }
    return points;
  }

  clone() {
    // Returns a deep copy of the entire board object
    const newBoard = new YinshBoard({
      initialBoardState: JSON.parse(JSON.stringify(this.boardState)),
      initialPhase: this.gamePhase,
      initialPlayer: this.currentPlayer,
      player1RingsPlaced: this.ringsPlaced[1],
      player2RingsPlaced: this.ringsPlaced[2],
      player1Score: this.scores[1],
      player2Score: this.scores[2],
      skipInitialHistory: true
    });
    newBoard.selectedRing = this.selectedRing ? [...this.selectedRing] : null;
    newBoard.validMoves = this.validMoves.map(m => [...m]);
    newBoard.rows = JSON.parse(JSON.stringify(this.rows));
    newBoard.nextTurnPlayer = this.nextTurnPlayer;
    newBoard.rowResolutionQueue = JSON.parse(JSON.stringify(this.rowResolutionQueue));
    newBoard.pendingRowsAfterRingRemoval = this.pendingRowsAfterRingRemoval;
    newBoard.winner = this.winner;
    newBoard.selectedSetupRing = this.selectedSetupRing ? {...this.selectedSetupRing} : null;
    newBoard.stateHistory = this.stateHistory.map(s => JSON.parse(JSON.stringify(s)));
    newBoard.historyIndex = this.historyIndex;
    newBoard.notation = this.notation.clone();
    newBoard.enableLogging = this.enableLogging;
    newBoard.maxHistoryLength = this.maxHistoryLength;
    return newBoard;
  }

  /**
   * Serialize board state for Web Worker transfer
   * Excludes notation and stateHistory (not needed for AI computation)
   */
  serializeState() {
    return {
      boardState: this.boardState,
      gamePhase: this.gamePhase,
      currentPlayer: this.currentPlayer,
      ringsPlaced: this.ringsPlaced,
      scores: this.scores,
      selectedRing: this.selectedRing,
      validMoves: this.validMoves,
      rows: this.rows,
      nextTurnPlayer: this.nextTurnPlayer,
      rowResolutionQueue: this.rowResolutionQueue,
      pendingRowsAfterRingRemoval: this.pendingRowsAfterRingRemoval,
      winner: this.winner,
      selectedSetupRing: this.selectedSetupRing
    };
  }

  /**
   * Reconstruct board from serialized state (for Web Worker)
   * Static method to create a new board instance from serialized data
   */
  static fromSerializedState(serialized) {
    const board = new YinshBoard({
      initialBoardState: serialized.boardState,
      initialPhase: serialized.gamePhase,
      initialPlayer: serialized.currentPlayer,
      player1RingsPlaced: serialized.ringsPlaced[1],
      player2RingsPlaced: serialized.ringsPlaced[2],
      player1Score: serialized.scores[1],
      player2Score: serialized.scores[2],
      skipInitialHistory: true
    });
    board.selectedRing = serialized.selectedRing;
    board.validMoves = serialized.validMoves;
    board.rows = serialized.rows;
    board.nextTurnPlayer = serialized.nextTurnPlayer;
    board.rowResolutionQueue = serialized.rowResolutionQueue;
    board.pendingRowsAfterRingRemoval = serialized.pendingRowsAfterRingRemoval;
    board.winner = serialized.winner;
    board.selectedSetupRing = serialized.selectedSetupRing;
    return board;
  }

  // --- Helper Methods ---

  /**
   * Convert axial coordinates to board key string
   */
  _toKey(q, r) {
    return `${q},${r}`;
  }

  /**
   * Convert board key string to axial coordinates
   */
  _fromKey(key) {
    return key.split(',').map(Number);
  }

  /**
   * Check if coordinates are within valid board bounds
   */
  _isInBounds(q, r) {
    // Check basic range
    if (q < -5 || q > 5) return false;
    if (r < Math.max(-5, -q - 5) || r > Math.min(5, -q + 5)) return false;

    // Check corner exclusions
    const excluded = [
      [-5, -5], [5, -5], [-5, 5], [5, 5],
      [0, -5], [0, 5], [-5, 0], [5, 0]
    ];
    return !excluded.some(([eq, er]) => eq === q && er === r);
  }

  // --- Core Actions / State Updates ---

  startNewGame(useRandomSetup) {
    this.boardState = {};
    this.gamePhase = 'setup';
    this.currentPlayer = 1;
    this.ringsPlaced = { 1: 0, 2: 0 };
    this.scores = { 1: 0, 2: 0 };
    this.selectedRing = null;
    this.validMoves = [];
    this.rows = [];
    this.nextTurnPlayer = null;
    this.rowResolutionQueue = [];
    this.pendingRowsAfterRingRemoval = false;
    this.winner = null;
    this.selectedSetupRing = null;

    // Clear move history
    this.clearHistory();

    if (useRandomSetup) {
      this._placeRandomRings();
      this.gamePhase = 'play';
      this.currentPlayer = 1;
    }
  }

  _placeRandomRings() {
    // Internal helper for random setup
    const newState = {};
    const availablePoints = YinshBoard.generateGridPoints();

    for (let player = 1; player <= 2; player++) {
      let placed = 0;
      while (placed < YinshBoard.RINGS_PER_PLAYER) {
        const randomIndex = Math.floor(Math.random() * availablePoints.length);
        const [q, r] = availablePoints[randomIndex];
        const key = this._toKey(q, r);
        if (!newState[key]) {
          newState[key] = { type: 'ring', player };
          placed++;
        }
        availablePoints.splice(randomIndex, 1);
      }
      this.ringsPlaced[player] = YinshBoard.RINGS_PER_PLAYER;
    }
    this.boardState = newState;
  }

  /**
   * Calculate valid moves for a ring at position (q, r)
   *
   * Yinsh movement rules:
   * - Ring moves in straight lines (6 hexagonal directions)
   * - Can land on any empty space if path contains NO markers
   * - If path contains markers, must jump ALL consecutive markers
   *   and land on first empty space immediately after last marker
   * - Cannot jump over other rings
   *
   * @param {number} q - The q coordinate
   * @param {number} r - The r coordinate
   * @returns {Array<[number, number]>} Array of valid destination coordinates
   */
  calculateValidMoves(q, r) {
    const validPositions = [];
    const keyBase = this._toKey(q, r);
    const ringPiece = this.boardState[keyBase];

    // Only rings can move
    if (!ringPiece || ringPiece.type !== 'ring') {
      return validPositions;
    }

    // Check each of the 6 hexagonal directions
    for (const [dq, dr] of YinshBoard.DIRECTIONS) {
      const movesInDirection = this._scanDirectionForMoves(q, r, dq, dr);
      validPositions.push(...movesInDirection);
    }

    return validPositions;
  }

  /**
   * Scan a direction from a ring position to find valid landing spots
   *
   * @private
   * @param {number} startQ - Starting q coordinate
   * @param {number} startR - Starting r coordinate
   * @param {number} dq - Direction delta for q
   * @param {number} dr - Direction delta for r
   * @returns {Array<[number, number]>} Valid landing positions in this direction
   */
  _scanDirectionForMoves(startQ, startR, dq, dr) {
    const validMoves = [];
    let currentQ = startQ + dq;
    let currentR = startR + dr;
    let encounteredMarker = false;

    while (this._isInBounds(currentQ, currentR)) {
      const key = this._toKey(currentQ, currentR);
      const piece = this.boardState[key];

      // Hit another ring - cannot jump over rings, stop scanning
      if (piece?.type === 'ring') {
        break;
      }

      // Hit a marker - must continue until we find empty space
      if (piece?.type === 'marker') {
        encounteredMarker = true;
      }

      // Hit an empty space
      if (!piece) {
        if (encounteredMarker) {
          // After jumping markers, can only land on first empty space
          validMoves.push([currentQ, currentR]);
          break; // Cannot continue past first empty space after markers
        } else {
          // Before any markers, can land on any empty space
          validMoves.push([currentQ, currentR]);
        }
      }

      currentQ += dq;
      currentR += dr;
    }

    return validMoves;
  }

  /**
   * Check for completed rows (5+ consecutive markers of same color)
   * Returns all possible 5-marker subsets from longer rows
   */
  checkForRows(boardStateToCheck = this.boardState) {
    // Check only 3 primary directions (one per axis in hexagonal grid)
    // since we scan bidirectionally, we don't need all 6 directions
    const directions = [
      [1, 0],     // horizontal axis
      [0, 1],     // diagonal axis 1
      [1, -1]     // diagonal axis 2
    ];
    const allPossibleRows = [];

    for (const [pos, piece] of Object.entries(boardStateToCheck)) {
      if (piece?.type !== 'marker') continue;
      const [startQ, startR] = this._fromKey(pos);
      const player = piece.player;

      directions.forEach(([dq, dr]) => {
        // Find the full consecutive line in this direction
        const fullLine = this._findFullLine(startQ, startR, dq, dr, player, boardStateToCheck);

        // If we have 5 or more, generate all possible 5-marker subsets
        if (fullLine.length >= YinshBoard.MARKERS_IN_ROW) {
          for (let i = 0; i <= fullLine.length - YinshBoard.MARKERS_IN_ROW; i++) {
            const subset = fullLine.slice(i, i + YinshBoard.MARKERS_IN_ROW);
            allPossibleRows.push({
              player,
              markers: subset,
              fullLineLength: fullLine.length
            });
          }
        }
      });
    }

    // Deduplicate rows (same exact 5 markers)
    return this._deduplicateRows(allPossibleRows);
  }

  /**
   * Find the full consecutive line of markers in a direction
   */
  _findFullLine(startQ, startR, dq, dr, player, boardState) {
    const line = [[startQ, startR]];

    // Scan forward
    let cQ = startQ + dq;
    let cR = startR + dr;
    while (true) {
      const k = this._toKey(cQ, cR);
      const checkPiece = boardState[k];
      if (checkPiece?.type === 'marker' && checkPiece.player === player) {
        line.push([cQ, cR]);
        cQ += dq;
        cR += dr;
      } else {
        break;
      }
    }

    // Scan backward
    cQ = startQ - dq;
    cR = startR - dr;
    while (true) {
      const k = this._toKey(cQ, cR);
      const checkPiece = boardState[k];
      if (checkPiece?.type === 'marker' && checkPiece.player === player) {
        line.unshift([cQ, cR]);
        cQ -= dq;
        cR -= dr;
      } else {
        break;
      }
    }

    return line;
  }

  /**
   * Remove duplicate rows that have the same exact 5 markers
   */
  _deduplicateRows(rows) {
    const seen = new Set();
    const unique = [];

    for (const row of rows) {
      // Create a unique key for this set of 5 markers
      const key = row.markers
        .map(([q, r]) => `${q},${r}`)
        .sort()
        .join('|');

      if (!seen.has(key)) {
        seen.add(key);
        unique.push(row);
      }
    }

    return unique;
  }

  /**
   * Start the next row resolution from the queue
   * This implements the iterative row resolution system
   */
  _startNextRowResolution() {
    if (this.rowResolutionQueue.length === 0) {
      // All rows resolved, return to play phase
      this.gamePhase = 'play';
      this.currentPlayer = this.nextTurnPlayer;
      this.nextTurnPlayer = null;
      this.rows = [];
      return;
    }

    // Get the next player who needs to resolve rows
    const { player, rows } = this.rowResolutionQueue[0];
    this.currentPlayer = player;
    this.rows = rows;
    this.gamePhase = 'remove-row';
  }

  /**
   * Flip all markers along the path from start to destination
   *
   * When a ring moves, it flips all markers it jumps over to the opposite color.
   * This method validates the path and flips the markers.
   *
   * @private
   * @param {number} selectedQ - Starting q coordinate
   * @param {number} selectedR - Starting r coordinate
   * @param {number} destQ - Destination q coordinate
   * @param {number} destR - Destination r coordinate
   * @param {Object} boardState - The board state to modify
   * @returns {Array<[number, number]>} Array of flipped marker positions
   * @throws {Error} If the path is not a valid straight line
   */
  _flipMarkersAlongPath(selectedQ, selectedR, destQ, destR, boardState) {
    const flippedMarkers = [];

    // Calculate direction
    const dq = Math.sign(destQ - selectedQ);
    const dr = Math.sign(destR - selectedR);

    // Validate this is a straight line in a valid hexagonal direction
    // In hexagonal coordinates, valid moves have:
    // - One coordinate changes, other stays same: (dq=±1,dr=0) or (dq=0,dr=±1)
    // - Both change in opposite directions: (dq=±1,dr=∓1)
    const isValidDirection =
      (dq === 0 && Math.abs(dr) === 1) ||  // Vertical
      (dr === 0 && Math.abs(dq) === 1) ||  // Horizontal
      (Math.abs(dq) === 1 && Math.abs(dr) === 1 && dq !== dr); // Diagonal

    if (!isValidDirection) {
      throw new Error(
        `Invalid path: not a straight hexagonal line from (${selectedQ},${selectedR}) to (${destQ},${destR})`
      );
    }

    // Flip all markers along the path (exclusive of start and end positions)
    let currentQ = selectedQ + dq;
    let currentR = selectedR + dr;

    while (currentQ !== destQ || currentR !== destR) {
      const key = this._toKey(currentQ, currentR);
      const piece = boardState[key];

      if (piece?.type === 'marker') {
        // Flip the marker to opposite player
        boardState[key] = {
          type: 'marker',
          player: piece.player === 1 ? 2 : 1
        };
        flippedMarkers.push([currentQ, currentR]);
      }

      currentQ += dq;
      currentR += dr;
    }

    return flippedMarkers;
  }

  removeMarkers(markers) {
    // Remove the given marker coordinates from this.boardState
    const newState = { ...this.boardState };
    markers.forEach(([mq, mr]) => {
      delete newState[this._toKey(mq, mr)];
    });
    this.boardState = newState;
  }

  removeRing(q, r) {
    // Removes the ring from the board
    const key = this._toKey(q, r);
    if (!this.boardState[key]) return;
    const ringPlayer = this.boardState[key].player;
    delete this.boardState[key];
    this.scores[ringPlayer] += 1;
  }

  isGameOver() {
    if (this.scores[1] === YinshBoard.RINGS_TO_WIN) return 1; // White wins
    if (this.scores[2] === YinshBoard.RINGS_TO_WIN) return 2; // Black wins
    return null; // Not finished
  }

  // --- The Big "Handle Click" method ---
  // This tries to replicate the entire "handleIntersectionClick" logic
  // but stored in the board class. The UI can call board.handleClick(q,r),
  // then re-render with the updated data.
  handleClick(q, r) {
    if (this.gamePhase === 'setup') {
      const key = this._toKey(q, r);

      // Must have a ring selected and be the current player
      if (!this.selectedSetupRing || this.selectedSetupRing.player !== this.currentPlayer) {
        return;
      }

      // Can only place on empty intersection
      if (this.boardState[key]) {
        return;
      }

      // Place the ring
      this.boardState[key] = { type: 'ring', player: this.currentPlayer };
      this.ringsPlaced[this.currentPlayer]++;

      // Log the move
      const notation = this.notation.recordRingPlacement(this.currentPlayer, q, r);
      if (this.enableLogging) {
        const playerSymbol = this.currentPlayer === 1 ? '○' : '●';
        console.log(`${this.notation.currentMoveNumber}. ${playerSymbol} ${notation}`);
      }

      // Switch to other player or end setup
      const otherPlayer = this.currentPlayer === 1 ? 2 : 1;
      if (this.ringsPlaced[1] === YinshBoard.RINGS_PER_PLAYER && this.ringsPlaced[2] === YinshBoard.RINGS_PER_PLAYER) {
        this.gamePhase = 'play';
        this.currentPlayer = 1;
      } else {
        this.currentPlayer = otherPlayer;
      }
      this.selectedSetupRing = null;

      // Capture state for undo
      this._captureState();
      return;
    }

    if (this.gamePhase === 'play') {
      const key = this._toKey(q, r);
      const piece = this.boardState[key];

      if (!this.selectedRing) {
        // No ring selected - attempting to select ring
        if (piece?.type === 'ring') {
          if (piece.player !== this.currentPlayer) {
            return; // Can't select opponent's ring
          }
          // Select the ring and calculate valid moves
          this.selectedRing = [q, r];
          this.validMoves = this.calculateValidMoves(q, r);
        }
        return;
      }

      // A ring is already selected
      if (piece?.type === 'ring') {
        if (piece.player === this.currentPlayer) {
          // Clicking the same ring deselects it
          if (this.selectedRing[0] === q && this.selectedRing[1] === r) {
            this.selectedRing = null;
            this.validMoves = [];
            return;
          }
          // Clicking a different ring of the same player selects it instead
          this.selectedRing = [q, r];
          this.validMoves = this.calculateValidMoves(q, r);
          return;
        }
        return; // Clicking opponent's ring does nothing
      }

      // Attempting to move the selected ring
      if (!this.validMoves.some(([vq, vr]) => vq === q && vr === r)) {
        return;
      }

      // Make the move
      const [selectedQ, selectedR] = this.selectedRing;
      const selectedKey = this._toKey(selectedQ, selectedR);
      const newState = { ...this.boardState };
      
      // Place marker at old position
      newState[selectedKey] = { type: 'marker', player: this.currentPlayer };
      
      // Move ring to new position
      newState[key] = { type: 'ring', player: this.currentPlayer };

      // Count markers before flipping (for logging)
      const markersBefore = Object.values(newState).filter(p => p.type === 'marker').length;

      // Flip markers along the path
      this._flipMarkersAlongPath(selectedQ, selectedR, q, r, newState);

      // Count markers after flipping
      const markersAfter = Object.values(newState).filter(p => p.type === 'marker').length;
      const markersFlipped = Math.abs(markersAfter - markersBefore);

      // Check for completed rows
      const completedRows = this.checkForRows(newState);

      this.boardState = newState;
      this.selectedRing = null;
      this.validMoves = [];

      // Log the ring move
      const notation = this.notation.recordRingMove(
        this.currentPlayer,
        selectedQ, selectedR,
        q, r,
        markersFlipped,
        completedRows.length > 0
      );
      if (this.enableLogging) {
        const playerSymbol = this.currentPlayer === 1 ? '○' : '●';
        console.log(`${this.notation.currentMoveNumber}. ${playerSymbol} ${notation}`);
      }

      if (completedRows.length > 0) {
        // Build the row resolution queue
        // Active player's rows are resolved first, then opponent's rows
        const currentPlayerRows = completedRows.filter(row => row.player === this.currentPlayer);
        const opponentPlayer = this.currentPlayer === 1 ? 2 : 1;
        const opponentRows = completedRows.filter(row => row.player === opponentPlayer);

        this.rowResolutionQueue = [];
        if (currentPlayerRows.length > 0) {
          this.rowResolutionQueue.push({ player: this.currentPlayer, rows: currentPlayerRows });
        }
        if (opponentRows.length > 0) {
          this.rowResolutionQueue.push({ player: opponentPlayer, rows: opponentRows });
        }

        // Store who should play next after all row resolutions
        this.nextTurnPlayer = opponentPlayer;

        // Start resolving the first item in the queue
        this._startNextRowResolution();
      } else {
        // No rows, just switch players
        this.currentPlayer = (this.currentPlayer === 1 ? 2 : 1);
      }

      // Capture state for undo
      this._captureState();
    }

    if (this.gamePhase === 'remove-row') {
      // Find the row being removed
      const row = this.rows.find(row => {
        if (row.markers.length === YinshBoard.MARKERS_IN_ROW) {
          return row.markers.some(([mq, mr]) => mq === q && mr === r);
        } else {
          const firstMarker = row.markers[0];
          const lastMarker = row.markers[row.markers.length - 1];
          return (q === firstMarker[0] && r === firstMarker[1]) ||
                 (q === lastMarker[0] && r === lastMarker[1]);
        }
      });
      if (!row) return;

      // Remove the markers
      const newState = { ...this.boardState };
      row.markers.forEach(([markerQ, markerR]) => {
        delete newState[this._toKey(markerQ, markerR)];
      });
      this.boardState = newState;
      this.rows = [];

      // Log the row removal
      const notation = this.notation.recordRowRemoval(this.currentPlayer, row.markers);
      if (this.enableLogging) {
        const playerSymbol = this.currentPlayer === 1 ? '○' : '●';
        console.log(`${this.notation.currentMoveNumber}. ${playerSymbol} ${notation}`);
      }

      // Check for NEW rows created by marker removal for current player
      const newRows = this.checkForRows();
      const currentPlayerNewRows = newRows.filter(r => r.player === this.currentPlayer);

      if (currentPlayerNewRows.length > 0) {
        // New rows appeared! Add to FRONT of queue for immediate resolution
        this.rowResolutionQueue.unshift({
          player: this.currentPlayer,
          rows: currentPlayerNewRows
        });
        this._startNextRowResolution();
        // Capture state for undo
        this._captureState();
        return;
      }

      // No new rows, proceed to ring removal
      this.pendingRowsAfterRingRemoval = true;
      this.gamePhase = 'remove-ring';

      // Capture state for undo
      this._captureState();
      return;
    }

    if (this.gamePhase === 'remove-ring') {
      const key = this._toKey(q, r);
      const piece = this.boardState[key];
      if (!piece || piece.type !== 'ring' || piece.player !== this.currentPlayer) {
        return;
      }

      // Remove the ring and update score
      delete this.boardState[key];
      this.scores[this.currentPlayer]++;

      // Check if game is over
      const gameWon = this.scores[this.currentPlayer] === YinshBoard.RINGS_TO_WIN;

      // Log the ring removal
      const notation = this.notation.recordRingRemoval(this.currentPlayer, q, r, gameWon);
      if (this.enableLogging) {
        const playerSymbol = this.currentPlayer === 1 ? '○' : '●';
        console.log(`${this.notation.currentMoveNumber}. ${playerSymbol} ${notation}`);

        // If game is won, print the full game log
        if (gameWon) {
          console.log('\n' + this.notation.formatGame(this.scores, this.currentPlayer));
        }
      }

      if (gameWon) {
        this.gamePhase = 'game-over';
        this.winner = this.currentPlayer;
        // Capture final state for undo
        this._captureState();
        return;
      }

      // Check for NEW rows created by ring removal
      const newRows = this.checkForRows();
      const currentPlayerNewRows = newRows.filter(r => r.player === this.currentPlayer);

      if (currentPlayerNewRows.length > 0) {
        // New rows appeared after ring removal! Add to FRONT of queue
        this.rowResolutionQueue.unshift({
          player: this.currentPlayer,
          rows: currentPlayerNewRows
        });
        this.pendingRowsAfterRingRemoval = false;
        this._startNextRowResolution();
        // Capture state for undo
        this._captureState();
        return;
      }

      // Remove the completed queue item
      if (this.pendingRowsAfterRingRemoval && this.rowResolutionQueue.length > 0) {
        this.rowResolutionQueue.shift();
        this.pendingRowsAfterRingRemoval = false;
      }

      // Continue processing queue or return to play
      this._startNextRowResolution();

      // Capture state for undo
      this._captureState();
      return;
    }
  }

  // Accessors (optional) to read from React
  getBoardState() {
    return this.boardState;
  }
  getCurrentPlayer() {
    return this.currentPlayer;
  }
  getGamePhase() {
    return this.gamePhase;
  }
  getRingsPlaced() {
    return this.ringsPlaced;
  }
  getScores() {
    return this.scores;
  }
  getSelectedRing() {
    return this.selectedRing;
  }
  getValidMoves() {
    return this.validMoves;
  }
  getRows() {
    return this.rows;
  }

  getStateHash() {
    // Create an 11x11 array (from -5 to +5 in both dimensions)
    const grid = Array(11).fill(null).map(() => Array(11).fill('.'));
    
    // Fill in pieces using consistent symbols:
    // W/B for white/black rings
    // w/b for white/black markers
    for (const [coord, piece] of Object.entries(this.boardState)) {
      const [q, r] = coord.split(',').map(Number);
      // Convert from -5..5 coordinates to 0..10 array indices
      const x = q + 5;
      const y = r + 5;
      
      const symbol = piece.type === 'ring' 
        ? (piece.player === 1 ? 'W' : 'B')
        : (piece.player === 1 ? 'w' : 'b');
      
      grid[y][x] = symbol;
    }

    // Convert grid to string, row by row
    const boardString = grid.map(row => row.join('')).join('');
    
    // Append current player and scores to make state unique
    return `${boardString}|p${this.currentPlayer}|s${this.scores[1]}${this.scores[2]}|${this.gamePhase}`;
  }

  getWinner() {
    return this.winner;
  }

  // Add method to handle setup ring selection
  handleSetupRingClick(player, index) {
    if (this.gamePhase !== 'setup' || this.currentPlayer !== player) {
      return;
    }

    if (this.selectedSetupRing?.player === player && this.selectedSetupRing?.index === index) {
      this.selectedSetupRing = null; // Deselect if clicking same ring
    } else {
      this.selectedSetupRing = { player, index }; // Select new ring
    }
  }

  // Add method to get selectedSetupRing
  getSelectedSetupRing() {
    return this.selectedSetupRing;
  }

  // ============================================================================
  // MOVE HISTORY & UNDO/REDO METHODS
  // ============================================================================

  /**
   * Capture current game state for undo/redo
   * Called after every successful move
   * @private
   */
  _captureState() {
    // If we're in the middle of history (after undo), discard future states
    if (this.historyIndex < this.stateHistory.length - 1) {
      this.stateHistory = this.stateHistory.slice(0, this.historyIndex + 1);
    }

    // Create a snapshot of current state
    const snapshot = {
      boardState: JSON.parse(JSON.stringify(this.boardState)),
      gamePhase: this.gamePhase,
      currentPlayer: this.currentPlayer,
      ringsPlaced: { ...this.ringsPlaced },
      scores: { ...this.scores },
      selectedRing: this.selectedRing ? [...this.selectedRing] : null,
      validMoves: this.validMoves.map(m => [...m]),
      rows: JSON.parse(JSON.stringify(this.rows)),
      nextTurnPlayer: this.nextTurnPlayer,
      rowResolutionQueue: JSON.parse(JSON.stringify(this.rowResolutionQueue)),
      pendingRowsAfterRingRemoval: this.pendingRowsAfterRingRemoval,
      winner: this.winner,
      selectedSetupRing: this.selectedSetupRing ? {...this.selectedSetupRing} : null,
      // Also capture notation state
      notationMoves: [...this.notation.moveHistory],
      notationMoveNumber: this.notation.currentMoveNumber
    };

    this.stateHistory.push(snapshot);
    this.historyIndex++;

    // Limit history size
    if (this.stateHistory.length > this.maxHistoryLength) {
      this.stateHistory.shift();
      this.historyIndex--;
    }
  }

  /**
   * Restore game state from history
   * @private
   */
  _restoreState(snapshot) {
    this.boardState = JSON.parse(JSON.stringify(snapshot.boardState));
    this.gamePhase = snapshot.gamePhase;
    this.currentPlayer = snapshot.currentPlayer;
    this.ringsPlaced = { ...snapshot.ringsPlaced };
    this.scores = { ...snapshot.scores };
    this.selectedRing = snapshot.selectedRing ? [...snapshot.selectedRing] : null;
    this.validMoves = snapshot.validMoves.map(m => [...m]);
    this.rows = JSON.parse(JSON.stringify(snapshot.rows));
    this.nextTurnPlayer = snapshot.nextTurnPlayer;
    this.rowResolutionQueue = JSON.parse(JSON.stringify(snapshot.rowResolutionQueue));
    this.pendingRowsAfterRingRemoval = snapshot.pendingRowsAfterRingRemoval;
    this.winner = snapshot.winner;
    this.selectedSetupRing = snapshot.selectedSetupRing ? {...snapshot.selectedSetupRing} : null;

    // Restore notation state
    this.notation.moveHistory = [...snapshot.notationMoves];
    this.notation.currentMoveNumber = snapshot.notationMoveNumber;
  }

  /**
   * Undo the last move
   * @returns {boolean} True if undo was successful, false if no moves to undo
   */
  undo() {
    if (this.historyIndex <= 0) {
      return false; // No history to undo
    }

    this.historyIndex--;
    this._restoreState(this.stateHistory[this.historyIndex]);
    return true;
  }

  /**
   * Redo a previously undone move
   * @returns {boolean} True if redo was successful, false if no moves to redo
   */
  redo() {
    if (this.historyIndex >= this.stateHistory.length - 1) {
      return false; // No future history to redo
    }

    this.historyIndex++;
    this._restoreState(this.stateHistory[this.historyIndex]);
    return true;
  }

  /**
   * Check if undo is available
   * @returns {boolean}
   */
  canUndo() {
    return this.historyIndex > 0;
  }

  /**
   * Check if redo is available
   * @returns {boolean}
   */
  canRedo() {
    return this.historyIndex < this.stateHistory.length - 1;
  }

  /**
   * Get the current position in history
   * @returns {Object} {current: number, total: number}
   */
  getHistoryPosition() {
    return {
      current: this.historyIndex + 1,
      total: this.stateHistory.length
    };
  }

  /**
   * Clear all history (useful when starting a new game)
   */
  clearHistory() {
    this.stateHistory = [];
    this.historyIndex = -1;
  }

  // ============================================================================
  // GAME NOTATION METHODS
  // ============================================================================

  /**
   * Get the game notation object
   */
  getNotation() {
    return this.notation;
  }

  /**
   * Get all moves as notation strings
   */
  getMoveHistory() {
    return this.notation.getAllMoves();
  }

  /**
   * Get the full formatted game log
   */
  getGameLog() {
    return this.notation.formatGame(this.scores, this.winner);
  }

  /**
   * Print the game log to console
   */
  printGameLog() {
    console.log(this.getGameLog());
  }

  /**
   * Export game in compact notation
   */
  exportNotation() {
    return this.notation.exportCompact();
  }

  /**
   * Enable/disable move logging
   */
  setLogging(enabled) {
    this.enableLogging = enabled;
  }

  deserialize(state) {
    const { boardState, gamePhase, currentPlayer } = state;
    this.boardState = boardState || {};
    this.gamePhase = gamePhase || 'setup';
    this.currentPlayer = currentPlayer || 1;
    this.ringsPlaced = { 1: 0, 2: 0 };
    this.scores = { 1: 0, 2: 0 };
    
    // Count rings placed from boardState
    Object.values(this.boardState).forEach(piece => {
      if (piece.type === 'ring') {
        this.ringsPlaced[piece.player]++;
      }
    });
  }

  getComplexityLevel() {
    // Count pieces on board as a simple complexity metric
    const pieceCount = Object.keys(this.boardState).length;
    return Math.ceil(pieceCount / 5);  // 1 complexity unit per 5 pieces
  }

  /**
   * Load a test position onto the board.
   * @param {Object} pos - Position definition from testPositions.js
   *   { player, rings: {1: [[q,r],...], 2: [...]}, markers: {1: [...], 2: [...]} }
   */
  loadFromPositionData(pos) {
    this.boardState = {};
    this.scores = { 1: 0, 2: 0 };
    this.ringsPlaced = { 1: 0, 2: 0 };
    this.selectedRing = null;
    this.validMoves = [];
    this.rows = [];
    this.nextTurnPlayer = null;
    this.rowResolutionQueue = [];
    this.pendingRowsAfterRingRemoval = false;
    this.winner = null;
    this.selectedSetupRing = null;

    for (const player of [1, 2]) {
      for (const [q, r] of pos.rings[player]) {
        this.boardState[this._toKey(q, r)] = { type: 'ring', player };
        this.ringsPlaced[player]++;
      }
      for (const [q, r] of (pos.markers[player] || [])) {
        this.boardState[this._toKey(q, r)] = { type: 'marker', player };
      }
    }

    this.currentPlayer = pos.player;
    this.gamePhase = 'play';
    this.clearHistory();
    this._captureState();
  }
}
