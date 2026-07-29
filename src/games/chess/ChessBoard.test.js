import ChessBoard, { STARTING_FEN } from './ChessBoard';

describe('ChessBoard — basics', () => {
  test('starts in the standard position with white to move', () => {
    const b = new ChessBoard();
    expect(b.fen()).toBe(STARTING_FEN);
    expect(b.turn()).toBe('w');
    expect(b.isGameOver()).toBe(false);
    expect(b.result()).toBeNull();
  });

  test('legal move generation from a square', () => {
    const b = new ChessBoard();
    const moves = b.legalMovesFrom('e2');
    const targets = moves.map((m) => m.to).sort();
    expect(targets).toEqual(['e3', 'e4']);
  });

  test('plays a legal move and rejects an illegal one', () => {
    const b = new ChessBoard();
    expect(b.move('e2', 'e4')).toMatchObject({ from: 'e2', to: 'e4' });
    expect(b.turn()).toBe('b');
    // e4-e5 is illegal (white already moved; not black's pawn there).
    expect(b.move('e4', 'e5')).toBeNull();
  });

  test('sanHistory tracks played moves', () => {
    const b = new ChessBoard();
    b.move('e2', 'e4');
    b.move('e7', 'e5');
    b.move('g1', 'f3');
    expect(b.sanHistory()).toEqual(['e4', 'e5', 'Nf3']);
  });
});

describe('ChessBoard — special rules', () => {
  test('allows legal king-side castling', () => {
    const b = new ChessBoard('rnbqk2r/pppp1ppp/5n2/2b1p3/2B1P3/5N2/PPPP1PPP/RNBQK2R w KQkq - 4 4');
    const mv = b.move('e1', 'g1');
    expect(mv).not.toBeNull();
    expect(mv.flags).toContain('k'); // king-side castle flag
  });

  test('en passant capture', () => {
    const b = new ChessBoard();
    b.move('e2', 'e4');
    b.move('a7', 'a6');
    b.move('e4', 'e5');
    b.move('d7', 'd5'); // sets up en passant on d6
    const ep = b.move('e5', 'd6');
    expect(ep).not.toBeNull();
    expect(ep.flags).toContain('e'); // en passant flag
  });

  test('promotion: isPromotion detection and underpromotion', () => {
    const b = new ChessBoard('8/P7/8/8/8/8/8/k6K w - - 0 1');
    expect(b.isPromotion('a7', 'a8')).toBe(true);
    const mv = b.move('a7', 'a8', 'n'); // underpromote to knight
    expect(mv).not.toBeNull();
    expect(mv.promotion).toBe('n');
  });

  test('checkmate is reported with the correct winner', () => {
    const b = new ChessBoard();
    // Fool's mate
    b.move('f2', 'f3');
    b.move('e7', 'e5');
    b.move('g2', 'g4');
    b.move('d8', 'h4');
    expect(b.isGameOver()).toBe(true);
    expect(b.result()).toEqual({ over: true, type: 'checkmate', winner: 'black' });
  });

  test('stalemate is a draw', () => {
    const b = new ChessBoard('7k/5Q2/6K1/8/8/8/8/8 b - - 0 1');
    expect(b.result()).toEqual({ over: true, type: 'stalemate', winner: null });
  });

  test('insufficient material is a draw', () => {
    const b = new ChessBoard('8/8/8/4k3/8/4K3/8/8 w - - 0 1');
    expect(b.result()).toMatchObject({ type: 'insufficient', winner: null });
  });

  test('checkedKingSquare returns the king in check', () => {
    const b = new ChessBoard();
    b.move('e2', 'e4');
    b.move('e7', 'e5');
    b.move('f1', 'c4');
    b.move('f8', 'c5');
    b.move('d1', 'h5');
    b.move('g8', 'f6');
    b.move('h5', 'f7'); // Qxf7+ — check (not mate here)
    expect(b.isCheck()).toBe(true);
    expect(b.checkedKingSquare()).toBe('e8');
  });
});

describe('ChessBoard — undo / redo', () => {
  test('undo restores the prior position; redo replays it', () => {
    const b = new ChessBoard();
    b.move('e2', 'e4');
    const afterE4 = b.fen();
    b.move('e7', 'e5');
    expect(b.canUndo()).toBe(true);
    expect(b.undo()).toBe(true);
    expect(b.fen()).toBe(afterE4);
    expect(b.turn()).toBe('b');
    expect(b.canRedo()).toBe(true);
    expect(b.redo()).toBe(true);
    expect(b.turn()).toBe('w');
  });

  test('a new move after undo discards the redo branch', () => {
    const b = new ChessBoard();
    b.move('e2', 'e4');
    b.move('e7', 'e5');
    b.undo(); // back to after e4, black to move
    b.move('c7', 'c5'); // different reply
    expect(b.canRedo()).toBe(false);
    expect(b.sanHistory()).toEqual(['e4', 'c5']);
  });

  test('undo at the start is a no-op', () => {
    const b = new ChessBoard();
    expect(b.canUndo()).toBe(false);
    expect(b.undo()).toBe(false);
  });
});

describe('ChessBoard — PGN and cloning', () => {
  test('pgn export then import round-trips the position', () => {
    const b = new ChessBoard();
    b.move('e2', 'e4');
    b.move('e7', 'e5');
    b.move('g1', 'f3');
    const pgn = b.pgn();
    const fen = b.fen();

    const c = new ChessBoard();
    expect(c.loadPgn(pgn)).toBe(true);
    expect(c.fen()).toBe(fen);
    expect(c.sanHistory()).toEqual(['e4', 'e5', 'Nf3']);
  });

  test('clone is independent of the original', () => {
    const b = new ChessBoard();
    b.move('e2', 'e4');
    const c = b.clone();
    c.move('e7', 'e5');
    // Mutating the clone must not affect the original.
    expect(b.sanHistory()).toEqual(['e4']);
    expect(c.sanHistory()).toEqual(['e4', 'e5']);
  });
});

describe('pgn round-trip after clone', () => {
  test('pgn() keeps the move list once the board has been cloned', () => {
    // Regression: pgn() used to delegate to the internal chess.js instance,
    // which clone() rebuilds from the current FEN — so a cloned board produced
    // a FEN-header-only PGN with no moves, breaking export and persistence.
    let b = new ChessBoard();
    for (const [from, to] of [['e2', 'e4'], ['e7', 'e5'], ['g1', 'f3']]) {
      b.move(from, to);
      b = b.clone();
    }
    const pgn = b.pgn();
    expect(pgn).toContain('1. e4 e5 2. Nf3');

    const restored = new ChessBoard();
    expect(restored.loadPgn(pgn)).toBe(true);
    expect(restored.sanHistory()).toEqual(['e4', 'e5', 'Nf3']);
  });

  test('pgn() from a custom start position keeps the FEN header and the moves', () => {
    const fen = '4k3/8/8/8/8/8/4P3/4K3 w - - 0 1';
    let b = new ChessBoard(fen);
    b.move('e2', 'e4');
    b = b.clone();
    const pgn = b.pgn();
    expect(pgn).toContain(fen);
    expect(pgn).toContain('e4');

    const restored = new ChessBoard();
    expect(restored.loadPgn(pgn)).toBe(true);
    expect(restored.sanHistory()).toEqual(['e4']);
  });
});
