/**
 * Yinsh Notation System
 *
 * Similar to chess notation, provides a compact way to record Yinsh games.
 *
 * NOTATION FORMAT:
 *
 * Setup Phase:
 *   R@[q,r]      - Ring placed at position (q,r)
 *   Example: R@[0,0], R@[-3,2]
 *
 * Play Phase:
 *   R[q,r]->[q,r]           - Ring moved
 *   R[q,r]->[q,r]xN         - Ring moved, N markers flipped
 *   R[q,r]->[q,r]+          - Ring moved, row formed (will be removed)
 *   R[q,r]->[q,r]xN+        - Ring moved, N markers flipped, row formed
 *
 * Row Removal:
 *   Row[[q,r],[q,r],[q,r],[q,r],[q,r]]  - 5 markers removed in a row
 *
 * Ring Removal:
 *   -R[q,r]+     - Ring removed, +1 point
 *   -R[q,r]++    - Ring removed, game won (3 points total)
 *
 * Special Symbols:
 *   x  - Markers flipped (followed by count)
 *   +  - Point scored
 *   ++ - Game won
 */

export default class YinshNotation {
  constructor() {
    this.moveHistory = [];
    this.currentMoveNumber = 0;
  }

  /**
   * Format a position as [q,r]
   */
  static formatPosition(q, r) {
    return `[${q},${r}]`;
  }

  /**
   * Parse a position string "[q,r]" back to [q, r]
   */
  static parsePosition(posStr) {
    const match = posStr.match(/\[(-?\d+),(-?\d+)\]/);
    if (!match) return null;
    return [parseInt(match[1]), parseInt(match[2])];
  }

  /**
   * Record a ring placement (setup phase)
   * @param {number} player - Player number (1 or 2)
   * @param {number} q - Axial q coordinate
   * @param {number} r - Axial r coordinate
   * @returns {string} - Notation string
   */
  recordRingPlacement(player, q, r) {
    const notation = `R@${YinshNotation.formatPosition(q, r)}`;
    this.moveHistory.push({
      moveNumber: ++this.currentMoveNumber,
      player,
      type: 'placement',
      notation,
      from: null,
      to: [q, r]
    });
    return notation;
  }

  /**
   * Record a ring move (play phase)
   * @param {number} player - Player number
   * @param {number} fromQ - Starting q coordinate
   * @param {number} fromR - Starting r coordinate
   * @param {number} toQ - Ending q coordinate
   * @param {number} toR - Ending r coordinate
   * @param {number} markersFlipped - Number of markers flipped (0 if none)
   * @param {boolean} rowFormed - Whether this move formed a row
   * @returns {string} - Notation string
   */
  recordRingMove(player, fromQ, fromR, toQ, toR, markersFlipped = 0, rowFormed = false) {
    let notation = `R${YinshNotation.formatPosition(fromQ, fromR)}->${YinshNotation.formatPosition(toQ, toR)}`;

    // Add markers flipped
    if (markersFlipped > 0) {
      notation += `x${markersFlipped}`;
    }

    // Add row formed indicator
    if (rowFormed) {
      notation += '+';
    }

    this.moveHistory.push({
      moveNumber: ++this.currentMoveNumber,
      player,
      type: 'move',
      notation,
      from: [fromQ, fromR],
      to: [toQ, toR],
      markersFlipped,
      rowFormed
    });

    return notation;
  }

  /**
   * Record a row removal
   * @param {number} player - Player number
   * @param {Array<Array<number>>} row - Array of 5 positions [[q,r], [q,r], ...]
   * @returns {string} - Notation string
   */
  recordRowRemoval(player, row) {
    const positions = row.map(([q, r]) => YinshNotation.formatPosition(q, r)).join(',');
    const notation = `Row[${positions}]`;

    this.moveHistory.push({
      moveNumber: ++this.currentMoveNumber,
      player,
      type: 'row-removal',
      notation,
      row
    });

    return notation;
  }

  /**
   * Record a ring removal (scoring)
   * @param {number} player - Player number
   * @param {number} q - Ring position q
   * @param {number} r - Ring position r
   * @param {boolean} gameWon - Whether this wins the game
   * @returns {string} - Notation string
   */
  recordRingRemoval(player, q, r, gameWon = false) {
    const notation = `-R${YinshNotation.formatPosition(q, r)}${gameWon ? '++' : '+'}`;

    this.moveHistory.push({
      moveNumber: ++this.currentMoveNumber,
      player,
      type: 'ring-removal',
      notation,
      position: [q, r],
      gameWon
    });

    return notation;
  }

  /**
   * Get the last move notation
   */
  getLastMove() {
    return this.moveHistory.length > 0
      ? this.moveHistory[this.moveHistory.length - 1]
      : null;
  }

  /**
   * Get all moves as notation strings
   */
  getAllMoves() {
    return this.moveHistory.map(m => m.notation);
  }

  /**
   * Get full move history with details
   */
  getHistory() {
    return this.moveHistory;
  }

  /**
   * Format the entire game as a readable string
   * @param {Object} finalScores - {1: score, 2: score}
   * @param {number} winner - Winner player number (or null)
   */
  formatGame(finalScores = {1: 0, 2: 0}, winner = null) {
    const lines = [];
    lines.push('=====================================');
    lines.push('       YINSH GAME NOTATION');
    lines.push('=====================================\n');

    // Group moves by player turns
    let setupPhase = true;
    let currentSection = 'Setup Phase';
    lines.push(`--- ${currentSection} ---`);

    this.moveHistory.forEach((move, index) => {
      // Detect phase changes
      if (setupPhase && move.type !== 'placement') {
        setupPhase = false;
        currentSection = 'Play Phase';
        lines.push(`\n--- ${currentSection} ---`);
      }

      // Format move with move number and player
      const playerSymbol = move.player === 1 ? '○' : '●';
      const moveStr = `${move.moveNumber}. ${playerSymbol} ${move.notation}`;
      lines.push(moveStr);
    });

    // Add game result
    lines.push('\n=====================================');
    lines.push('          GAME RESULT');
    lines.push('=====================================');
    lines.push(`Player 1 (○): ${finalScores[1] || 0} points`);
    lines.push(`Player 2 (●): ${finalScores[2] || 0} points`);

    if (winner) {
      const winnerSymbol = winner === 1 ? '○' : '●';
      lines.push(`\n🏆 Winner: Player ${winner} ${winnerSymbol}`);
    } else {
      lines.push('\nGame in progress');
    }

    lines.push('=====================================');

    return lines.join('\n');
  }

  /**
   * Export game to compact notation (one line)
   */
  exportCompact() {
    return this.moveHistory.map(m => m.notation).join(' ');
  }

  /**
   * Import game from compact notation
   */
  importCompact(notationString) {
    this.moveHistory = [];
    this.currentMoveNumber = 0;

    // TODO: Parse notation string and reconstruct moves
    // This would require more complex parsing logic
  }

  /**
   * Clear the move history
   */
  clear() {
    this.moveHistory = [];
    this.currentMoveNumber = 0;
  }

  /**
   * Clone the notation
   */
  clone() {
    const cloned = new YinshNotation();
    cloned.moveHistory = JSON.parse(JSON.stringify(this.moveHistory));
    cloned.currentMoveNumber = this.currentMoveNumber;
    return cloned;
  }
}
