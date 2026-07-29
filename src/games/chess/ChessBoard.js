// ChessBoard.js — pure game logic for the Chess game (no React).
//
// Wraps chess.js for rule enforcement and exposes the same Board-class shape
// the rest of the GIPF suite uses: an internal source of truth, undo/redo via a
// position stack, and clone() so the React layer can re-render immutably.
//
// The UI never reaches into chess.js directly — it goes through this class.

import { Chess } from 'chess.js';

export const STARTING_FEN =
  'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

export default class ChessBoard {
  constructor(fen) {
    this.chess = new Chess(fen || undefined);
    // Position history as FEN strings; positions[0] is the start position.
    this.positions = [this.chess.fen()];
    // Verbose move objects aligned so moves[i] produced positions[i + 1].
    this.moves = [];
    // Index into positions of the currently displayed position.
    this.pointer = 0;
  }

  // --- Current-state accessors -------------------------------------------

  fen() {
    return this.chess.fen();
  }

  // 'w' | 'b'
  turn() {
    return this.chess.turn();
  }

  // 8x8 array (rank 8 first) of {type,color,square} | null — for custom rendering.
  board() {
    return this.chess.board();
  }

  // Verbose legal moves from a square, e.g. [{from,to,promotion,flags,san}, ...]
  legalMovesFrom(square) {
    return this.chess.moves({ square, verbose: true });
  }

  // All verbose legal moves for the side to move.
  allLegalMoves() {
    return this.chess.moves({ verbose: true });
  }

  // Square of the king in check, or null.
  checkedKingSquare() {
    if (!this.chess.isCheck()) return null;
    const turn = this.chess.turn();
    for (const row of this.chess.board()) {
      for (const piece of row) {
        if (piece && piece.type === 'k' && piece.color === turn) {
          return piece.square;
        }
      }
    }
    return null;
  }

  lastMove() {
    return this.pointer > 0 ? this.moves[this.pointer - 1] : null;
  }

  // --- Status -------------------------------------------------------------

  isCheck() {
    return this.chess.isCheck();
  }

  isGameOver() {
    return this.chess.isGameOver();
  }

  // Returns a structured result describing how (and if) the game ended.
  result() {
    if (!this.chess.isGameOver()) return null;
    if (this.chess.isCheckmate()) {
      // The side to move has been mated, so the other side won.
      const winner = this.chess.turn() === 'w' ? 'black' : 'white';
      return { over: true, type: 'checkmate', winner };
    }
    if (this.chess.isStalemate()) {
      return { over: true, type: 'stalemate', winner: null };
    }
    if (this.chess.isThreefoldRepetition()) {
      return { over: true, type: 'threefold', winner: null };
    }
    if (this.chess.isInsufficientMaterial()) {
      return { over: true, type: 'insufficient', winner: null };
    }
    if (this.chess.isDraw()) {
      // chess.js lumps the 50-move rule into isDraw().
      return { over: true, type: 'fifty-move', winner: null };
    }
    return { over: true, type: 'draw', winner: null };
  }

  // --- Mutation -----------------------------------------------------------

  // Attempts a move. Returns the verbose move object on success, null if illegal.
  // `promotion` is only used when the move is a pawn promotion.
  move(from, to, promotion = 'q') {
    let mv;
    try {
      mv = this.chess.move({ from, to, promotion });
    } catch (e) {
      // chess.js throws on illegal moves; treat as a rejected move.
      return null;
    }
    if (!mv) return null;
    // A new move from a rewound position discards the redo branch.
    if (this.pointer < this.positions.length - 1) {
      this.positions = this.positions.slice(0, this.pointer + 1);
      this.moves = this.moves.slice(0, this.pointer);
    }
    this.positions.push(this.chess.fen());
    this.moves.push(mv);
    this.pointer += 1;
    return mv;
  }

  // Whether a from->to move would be a promotion (pawn reaching last rank).
  isPromotion(from, to) {
    const legal = this.chess.moves({ square: from, verbose: true });
    return legal.some((m) => m.to === to && m.flags.includes('p'));
  }

  // --- Undo / redo --------------------------------------------------------

  canUndo() {
    return this.pointer > 0;
  }

  canRedo() {
    return this.pointer < this.positions.length - 1;
  }

  undo() {
    if (!this.canUndo()) return false;
    this.pointer -= 1;
    this.chess.load(this.positions[this.pointer]);
    return true;
  }

  redo() {
    if (!this.canRedo()) return false;
    this.pointer += 1;
    this.chess.load(this.positions[this.pointer]);
    return true;
  }

  // --- History / notation -------------------------------------------------

  // SAN list up to the current pointer, e.g. ['e4','e5','Nf3'].
  sanHistory() {
    return this.moves.slice(0, this.pointer).map((m) => m.san);
  }

  // PGN for the moves played so far.
  //
  // NB: this deliberately does NOT delegate to `this.chess.pgn()`. `clone()`
  // rebuilds the internal chess.js instance from the *current FEN*, so that
  // instance has no move list — asking it for a PGN yields a bare
  // [SetUp]/[FEN] header and zero moves. Since the UI clones on every move,
  // that made both PGN export and game persistence lose the whole game.
  // Replay from the recorded history instead.
  pgn() {
    const start = this.positions[0];
    const fresh = start === STARTING_FEN ? new Chess() : new Chess(start);
    for (const m of this.moves.slice(0, this.pointer)) {
      fresh.move({ from: m.from, to: m.to, promotion: m.promotion });
    }
    return fresh.pgn();
  }

  // Loads a PGN, rebuilding the position/move stacks. Returns true on success.
  loadPgn(pgn) {
    const fresh = new Chess();
    try {
      fresh.loadPgn(pgn);
    } catch (e) {
      return false;
    }
    const verbose = fresh.history({ verbose: true });
    const replay = new Chess();
    this.positions = [replay.fen()];
    this.moves = [];
    for (const m of verbose) {
      const applied = replay.move({ from: m.from, to: m.to, promotion: m.promotion });
      this.positions.push(replay.fen());
      this.moves.push(applied);
    }
    this.pointer = this.moves.length;
    this.chess = replay;
    return true;
  }

  // --- Cloning ------------------------------------------------------------

  clone() {
    const copy = new ChessBoard(this.positions[this.pointer]);
    copy.positions = [...this.positions];
    copy.moves = [...this.moves];
    copy.pointer = this.pointer;
    copy.chess.load(this.positions[this.pointer]);
    return copy;
  }
}
