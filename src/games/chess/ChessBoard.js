// ChessBoard.js — pure game logic for the Chess game (no React).
//
// Wraps chess.js for rule enforcement and exposes the same Board-class shape
// the app's other games use: an internal source of truth, undo/redo via a
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
    // Result declared by an imported PGN ('white'|'black'|'draw'|null). Carried
    // in the PGN's Result header so a saved import stays finished on resume.
    this.declared = null;
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

  // Whether `color` ('w'|'b') could still checkmate, which a win on time
  // requires (FIDE 6.9). Same material rules as lichess/scalachess: a bare king
  // cannot; a lone knight can only with the opponent holding something other
  // than a queen; bishops all on one colour can only against an opposing pawn,
  // knight, or bishop of the opposite colour; anything else can.
  canWinOnTime(color) {
    const own = { p: 0, n: 0, major: 0, bishopColors: new Set() };
    const opp = { p: 0, n: 0, r: 0, b: 0, bishopColors: new Set() };
    const rows = this.chess.board();
    for (let r = 0; r < rows.length; r += 1) {
      for (let c = 0; c < rows[r].length; c += 1) {
        const sq = rows[r][c];
        if (!sq || sq.type === 'k') continue;
        const squareColor = (r + c) % 2;
        if (sq.color === color) {
          if (sq.type === 'p') own.p += 1;
          else if (sq.type === 'n') own.n += 1;
          else if (sq.type === 'b') own.bishopColors.add(squareColor);
          else own.major += 1; // rook or queen
        } else if (sq.type === 'p') opp.p += 1;
        else if (sq.type === 'n') opp.n += 1;
        else if (sq.type === 'r') opp.r += 1;
        else if (sq.type === 'b') opp.bishopColors.add(squareColor);
      }
    }
    const bishops = own.bishopColors.size;
    if (own.p > 0 || own.major > 0) return true;
    if (own.n === 0 && bishops === 0) return false;
    if (own.n >= 2 || bishops >= 2) return true; // two knights, or bishops on both colours
    if (own.n === 1 && bishops === 1) return true;
    if (own.n === 1) {
      // Lone knight: mate needs the opponent's own pieces to block, other than a queen.
      return opp.p + opp.n + opp.r + opp.bishopColors.size > 0;
    }
    // Same-coloured bishops only.
    const [ownColor] = [...own.bishopColors];
    return opp.p > 0 || opp.n > 0 || [...opp.bishopColors].some((x) => x !== ownColor);
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
    this.declared = null;
    this.pointer -= 1;
    this._rebuildHistory();
    return true;
  }

  redo() {
    if (!this.canRedo()) return false;
    this.pointer += 1;
    this._rebuildHistory();
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
    if (this.declared) {
      fresh.header('Result', this.declared === 'white' ? '1-0' : this.declared === 'black' ? '0-1' : '1/2-1/2');
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
    const replay = new Chess(fresh.getHeaders().FEN || undefined);
    this.positions = [replay.fen()];
    this.moves = [];
    for (const m of verbose) {
      const applied = replay.move({ from: m.from, to: m.to, promotion: m.promotion });
      this.positions.push(replay.fen());
      this.moves.push(applied);
    }
    this.pointer = this.moves.length;
    this.chess = replay;
    const declared = { '1-0': 'white', '0-1': 'black', '1/2-1/2': 'draw' }[fresh.getHeaders().Result];
    this.declared = declared || null;
    return true;
  }

  // FEN alone loses repetition history. Rebuild the engine from the recorded
  // start and moves whenever UI cloning or undo/redo changes the live instance.
  _rebuildHistory() {
    const replay = new Chess(this.positions[0]);
    for (const move of this.moves.slice(0, this.pointer)) {
      replay.move({ from: move.from, to: move.to, promotion: move.promotion });
    }
    this.chess = replay;
  }

  // --- Cloning ------------------------------------------------------------

  clone() {
    const copy = new ChessBoard(this.positions[this.pointer]);
    copy.positions = [...this.positions];
    copy.moves = [...this.moves];
    copy.pointer = this.pointer;
    copy.declared = this.declared;
    copy._rebuildHistory();
    return copy;
  }
}
