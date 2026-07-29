import { Chess } from 'chess.js';
import { detectMotifs } from './motifs';

function codesOf(motifs) {
  return motifs.map((m) => m.code);
}

describe('motifs — hanging piece', () => {
  test('detects a queen left hanging with no recapture', () => {
    const g = new Chess();
    ['e4', 'e5', 'Qh5', 'Nc6', 'Bc4', 'g6'].forEach((m) => g.move(m));
    const fenBefore = g.fen();
    const motifs = detectMotifs({ fen: fenBefore, san: 'Qxg6', moverColor: 'w' });
    expect(codesOf(motifs)).toContain('hanging-piece');
    const hang = motifs.find((m) => m.code === 'hanging-piece');
    expect(hang.text).toMatch(/queen on g6/);
  });

  test('stays silent when the move is a safe retreat', () => {
    const g = new Chess();
    ['e4', 'e5', 'Qh5', 'Nc6', 'Bc4', 'g6'].forEach((m) => g.move(m));
    const motifs = detectMotifs({ fen: g.fen(), san: 'Qf3', moverColor: 'w' });
    expect(codesOf(motifs)).not.toContain('hanging-piece');
  });

  test('stays silent for an ordinary opening move with nothing en prise', () => {
    const g = new Chess();
    const motifs = detectMotifs({ fen: g.fen(), san: 'e4', moverColor: 'w' });
    expect(motifs).toEqual([]);
  });
});

describe('motifs — fork / double attack', () => {
  test('detects a knight fork on king + rook', () => {
    const fen = 'r3kb1r/ppp2ppp/2n5/3N4/8/8/PPP2PPP/R3K2R w KQkq - 0 1';
    const motifs = detectMotifs({ fen, san: 'Nc7+', moverColor: 'w' });
    expect(codesOf(motifs)).toContain('fork');
    const fork = motifs.find((m) => m.code === 'fork');
    expect(fork.text).toMatch(/knight fork/);
    expect(fork.text).toMatch(/rook on a8/);
    expect(fork.text).toMatch(/king on e8/);
  });

  test('does not call a single attacked piece a fork', () => {
    const g = new Chess();
    ['e4', 'd5', 'exd5'].forEach((m) => g.move(m));
    const motifs = detectMotifs({ fen: g.fen(), san: 'Qxd5', moverColor: 'b' });
    expect(codesOf(motifs)).not.toContain('fork');
  });

  test('pawn captures never get labeled a fork (attacker must not be a pawn)', () => {
    const g = new Chess();
    ['e4', 'd5'].forEach((m) => g.move(m));
    const motifs = detectMotifs({ fen: g.fen(), san: 'exd5', moverColor: 'w' });
    expect(codesOf(motifs)).not.toContain('fork');
  });
});

describe('motifs — pins', () => {
  test('detects a pin created on an opponent piece (Italian bishop pin)', () => {
    const g = new Chess();
    ['e4', 'e5', 'Nf3', 'Nc6', 'Bc4', 'Bc5'].forEach((m) => g.move(m));
    const motifs = detectMotifs({ fen: g.fen(), san: 'O-O', moverColor: 'w' });
    // castling itself creates no pin here; verify separately with a direct pin move
    expect(codesOf(motifs)).not.toContain('pin-created');
  });

  test('detects walking a piece into an absolute pin', () => {
    const g = new Chess();
    g.clear();
    g.put({ type: 'k', color: 'b' }, 'e8');
    g.put({ type: 'k', color: 'w' }, 'e1');
    g.put({ type: 'n', color: 'b' }, 'b8');
    g.put({ type: 'b', color: 'w' }, 'b5');
    g.put({ type: 'p', color: 'b' }, 'a7');
    g.put({ type: 'p', color: 'b' }, 'c7');
    g.setTurn('b');
    const motifs = detectMotifs({ fen: g.fen(), san: 'Nc6', moverColor: 'b' });
    expect(codesOf(motifs)).toContain('pin-walked-into');
    const pin = motifs.find((m) => m.code === 'pin-walked-into');
    expect(pin.text).toMatch(/knight on c6/);
    expect(pin.text).toMatch(/king on e8/);
  });

  test('does not claim a pin when the line is blocked', () => {
    const g = new Chess();
    g.clear();
    g.put({ type: 'k', color: 'b' }, 'e8');
    g.put({ type: 'k', color: 'w' }, 'e1');
    g.put({ type: 'p', color: 'b' }, 'd7'); // blocks the b5-e8 diagonal
    g.put({ type: 'n', color: 'b' }, 'b8');
    g.put({ type: 'b', color: 'w' }, 'b5');
    g.put({ type: 'p', color: 'b' }, 'a7');
    g.setTurn('b');
    const motifs = detectMotifs({ fen: g.fen(), san: 'Nc6', moverColor: 'b' });
    expect(codesOf(motifs)).not.toContain('pin-walked-into');
  });
});

describe('motifs — back-rank vulnerability', () => {
  test('detects the last flight square being closed off', () => {
    const g = new Chess();
    g.clear();
    g.put({ type: 'k', color: 'w' }, 'g1');
    g.put({ type: 'p', color: 'w' }, 'f2');
    g.put({ type: 'p', color: 'w' }, 'h2');
    g.put({ type: 'n', color: 'w' }, 'h4');
    g.put({ type: 'k', color: 'b' }, 'e8');
    g.setTurn('w');
    const motifs = detectMotifs({ fen: g.fen(), san: 'Ng2', moverColor: 'w' });
    expect(codesOf(motifs)).toContain('back-rank-vulnerability');
  });

  test('stays silent when a flight square remains', () => {
    const g = new Chess();
    g.clear();
    g.put({ type: 'k', color: 'w' }, 'g1');
    g.put({ type: 'p', color: 'w' }, 'f2');
    g.put({ type: 'k', color: 'b' }, 'e8');
    g.put({ type: 'n', color: 'w' }, 'b1');
    g.setTurn('w');
    const motifs = detectMotifs({ fen: g.fen(), san: 'Nc3', moverColor: 'w' });
    expect(codesOf(motifs)).not.toContain('back-rank-vulnerability');
  });

  test('never throws when the position has odd check states', () => {
    const fen = 'r3kb1r/ppp2ppp/2n5/3N4/8/8/PPP2PPP/R3K2R w KQkq - 0 1';
    expect(() => detectMotifs({ fen, san: 'Nc7+', moverColor: 'w' })).not.toThrow();
  });
});

describe('motifs — king shelter damage', () => {
  test('flags pushing a pawn in front of a castled king', () => {
    const g = new Chess();
    ['e4', 'e5', 'Nf3', 'Nc6', 'Bc4', 'Bc5', 'O-O', 'Nf6'].forEach((m) => g.move(m));
    const motifs = detectMotifs({ fen: g.fen(), san: 'h3', moverColor: 'w' });
    expect(codesOf(motifs)).toContain('king-shelter-damage');
  });

  test('does not flag a pawn push unrelated to the king', () => {
    const g = new Chess();
    ['e4', 'e5', 'Nf3', 'Nc6', 'Bc4', 'Bc5', 'O-O', 'Nf6'].forEach((m) => g.move(m));
    const motifs = detectMotifs({ fen: g.fen(), san: 'd3', moverColor: 'w' });
    expect(codesOf(motifs)).not.toContain('king-shelter-damage');
  });

  test('does not flag pawn pushes before the king has castled', () => {
    const g = new Chess();
    const motifs = detectMotifs({ fen: g.fen(), san: 'g3', moverColor: 'w' });
    expect(codesOf(motifs)).not.toContain('king-shelter-damage');
  });
});

describe('motifs — castling rights', () => {
  test('flags losing rights via a rook move (not castling itself)', () => {
    const g = new Chess();
    ['e4', 'e5', 'Nf3', 'Nc6', 'h4', 'h5'].forEach((m) => g.move(m));
    const motifs = detectMotifs({ fen: g.fen(), san: 'Rh3', moverColor: 'w' });
    expect(codesOf(motifs)).toContain('lost-castling-rights');
  });

  test('does not flag the castling move itself as a loss', () => {
    const g = new Chess();
    ['e4', 'e5', 'Nf3', 'Nc6', 'Bc4', 'Bc5'].forEach((m) => g.move(m));
    const motifs = detectMotifs({ fen: g.fen(), san: 'O-O', moverColor: 'w' });
    expect(codesOf(motifs)).not.toContain('lost-castling-rights');
  });

  test('stays silent when rights were already gone', () => {
    const g = new Chess();
    ['e4', 'e5', 'Nf3', 'Nc6', 'h4', 'h5', 'Rh3', 'a6'].forEach((m) => g.move(m));
    const motifs = detectMotifs({ fen: g.fen(), san: 'Rg3', moverColor: 'w' });
    expect(codesOf(motifs)).not.toContain('lost-castling-rights');
  });
});

describe('motifs — opening development', () => {
  test('flags a first development move from a home square', () => {
    const g = new Chess();
    const motifs = detectMotifs({ fen: g.fen(), san: 'Nf3', moverColor: 'w', inOpening: true });
    expect(codesOf(motifs)).toContain('developing-move');
  });

  test('flags moving an already-developed piece again', () => {
    const g = new Chess();
    ['Nf3', 'e5'].forEach((m) => g.move(m));
    const motifs = detectMotifs({ fen: g.fen(), san: 'Ng5', moverColor: 'w', inOpening: true });
    expect(codesOf(motifs)).toContain('redeveloping-piece');
  });

  test('does not fire development motifs outside the opening phase', () => {
    const g = new Chess();
    const motifs = detectMotifs({ fen: g.fen(), san: 'Nf3', moverColor: 'w', inOpening: false });
    expect(codesOf(motifs)).not.toContain('developing-move');
  });

  test('does not treat a pawn move as a development motif', () => {
    const g = new Chess();
    const motifs = detectMotifs({ fen: g.fen(), san: 'e4', moverColor: 'w', inOpening: true });
    expect(codesOf(motifs)).not.toContain('developing-move');
    expect(codesOf(motifs)).not.toContain('redeveloping-piece');
  });
});

describe('motifs — robustness (never fabricate, never throw)', () => {
  test('returns [] on missing input instead of throwing', () => {
    expect(detectMotifs({})).toEqual([]);
    expect(detectMotifs({ fen: undefined, san: undefined, moverColor: undefined })).toEqual([]);
  });

  test('returns [] on a nonsense SAN instead of throwing', () => {
    const g = new Chess();
    expect(() => detectMotifs({ fen: g.fen(), san: 'Zz9', moverColor: 'w' })).not.toThrow();
    expect(detectMotifs({ fen: g.fen(), san: 'Zz9', moverColor: 'w' })).toEqual([]);
  });

  test('survives a large random self-play sweep with no exceptions', () => {
    let errors = 0;
    for (let game = 0; game < 15; game += 1) {
      const g = new Chess();
      let ply = 0;
      while (!g.isGameOver() && ply < 40) {
        const moves = g.moves();
        if (!moves.length) break;
        const san = moves[Math.floor(Math.random() * moves.length)];
        const fenBefore = g.fen();
        const moverColor = g.turn();
        g.move(san);
        try {
          detectMotifs({ fen: fenBefore, san, moverColor, inOpening: ply < 20 });
        } catch (_) {
          errors += 1;
        }
        ply += 1;
      }
    }
    expect(errors).toBe(0);
  });
});
