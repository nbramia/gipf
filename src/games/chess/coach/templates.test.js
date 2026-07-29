import { Chess } from 'chess.js';
import { describePlayerMove, describeAiMove } from './templates';

describe('templates — opening "book" handling', () => {
  test('book move WITH master stats describes real practice', () => {
    const text = describePlayerMove({
      classification: 'book',
      movePlayed: { san: 'Nf3' },
      opening: 'Réti Opening',
      openingStats: {
        isBook: true,
        rank: 3,
        sharePct: 8,
        scorePct: 54,
        games: 1200,
        totalGames: 15000,
        alternatives: [{ san: 'e4' }, { san: 'd4' }],
      },
    });
    expect(text).toMatch(/Book/);
    expect(text).toMatch(/Réti Opening/);
    expect(text).toMatch(/master games/);
  });

  test('book move WITHOUT stats (Lichess unreachable) still reads as sound, not a mistake', () => {
    const text = describePlayerMove({
      classification: 'book',
      movePlayed: { san: 'Nf3' },
      opening: 'Réti Opening',
    });
    expect(text).toMatch(/Book/);
    expect(text).toMatch(/sound opening move/i);
    expect(text).not.toMatch(/mistake|inaccuracy|Stronger was/i);
  });

  test('a real blunder is still called out plainly', () => {
    const text = describePlayerMove({
      classification: 'blunder',
      movePlayed: { san: 'Qh5' },
      playedEval: '-3.0',
      bestMove: { san: 'Nf3', eval: '+0.3', pv: ['Nf3', 'd5'] },
    });
    expect(text).toMatch(/Blunder/);
    expect(text).toMatch(/Nf3/);
  });
});

describe('templates — motif-driven commentary (docs/chess-ux-review.md #3.1)', () => {
  function hangingQueenFen() {
    const g = new Chess();
    ['e4', 'e5', 'Qh5', 'Nc6', 'Bc4', 'g6'].forEach((m) => g.move(m));
    return g.fen(); // white to move, fullmove 4 — Qxg6 hangs the queen
  }

  test('names the concrete motif instead of handing the question back', () => {
    const text = describePlayerMove({
      classification: 'blunder',
      movePlayed: { san: 'Qxg6' },
      fen: hangingQueenFen(),
      sideToMove: 'w',
      playedEval: '-8.0',
      bestMove: { san: 'Qf3', eval: '+0.3', pv: ['Qf3', 'Bg7'] },
    });
    expect(text).toMatch(/hanging/i);
    expect(text).toMatch(/queen on g6/);
    expect(text).not.toMatch(/Check what .* left loose/i);
  });

  test('falls back to a (rephrased, non-homework) generic line when no motif is verifiable', () => {
    const text = describePlayerMove({
      classification: 'blunder',
      movePlayed: { san: 'Qh5' },
      playedEval: '-3.0',
      bestMove: { san: 'Nf3', eval: '+0.3', pv: ['Nf3', 'd5'] },
      // no fen -> motifs.js can't verify anything -> must stay silent, not guess
    });
    expect(text).not.toMatch(/Check what .* left loose/i);
  });

  test('splices a positive motif (fork) into commentary for a good move', () => {
    const fen = 'r3kb1r/ppp2ppp/2n5/3N4/8/8/PPP2PPP/R3K2R w KQkq - 0 1';
    const text = describePlayerMove({
      classification: 'best',
      movePlayed: { san: 'Nc7+' },
      fen,
      sideToMove: 'w',
      bestMove: { san: 'Nc7+', pv: ['Nc7+', 'Kd7'] },
    });
    expect(text).toMatch(/knight fork/);
    expect(text).toMatch(/rook on a8/);
  });

  test('varies the "stronger was" sentence skeleton by move number (fullmove from the FEN)', () => {
    const base = {
      classification: 'mistake',
      movePlayed: { san: 'a3' },
      playedEval: '-1.0',
      bestMove: { san: 'Nf3', eval: '+0.2' },
    };
    const texts = new Set(
      [1, 2, 3, 4, 5, 6].map((n) =>
        describePlayerMove({
          ...base,
          fen: `rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 ${n}`,
        })
      )
    );
    expect(texts.size).toBeGreaterThan(1);
  });

  test('surfaces weaknessProfile only sometimes, not on every qualifying move', () => {
    const base = {
      classification: 'blunder',
      movePlayed: { san: 'a3' },
      playedEval: '-3.0',
      bestMove: { san: 'Nf3', eval: '+0.2' },
      weaknessProfile: '2 blunders and 1 mistake captured from recent games, mostly in the middlegame.',
    };
    const withProfile = [3, 6, 9].map((n) =>
      describePlayerMove({ ...base, fen: `8/8/8/8/8/8/8/8 w - - 0 ${n}` })
    );
    const withoutProfile = [1, 2, 4].map((n) =>
      describePlayerMove({ ...base, fen: `8/8/8/8/8/8/8/8 w - - 0 ${n}` })
    );
    expect(withProfile.every((t) => t.includes('This fits a pattern'))).toBe(true);
    expect(withoutProfile.some((t) => !t.includes('This fits a pattern'))).toBe(true);
  });
});

describe('describeAiMove — never asserts something the engine did not find (docs/chess-adversarial-review.md §2)', () => {
  const candidates = [
    { san: 'Nf3', eval: '+0.4', pv: ['Nf3', 'd5'] },
    { san: 'e4', eval: '+0.3', pv: ['e4', 'e5'] },
    { san: 'd4', eval: '+0.2', pv: ['d4', 'd5'] },
  ];

  test('played move IS candidates[0]: claims strongest, uses its own eval', () => {
    const text = describeAiMove({ movePlayed: { san: 'Nf3' }, candidates });
    expect(text).toContain('I played Nf3.');
    expect(text).toContain('+0.4');
    expect(text).toMatch(/strongest/);
  });

  // Weak-tier difficulty (engine/uci.js chooseWeakenedMove) can deliberately
  // sample a move outside MultiPV's top 3, so `candidates` has no entry for
  // the move actually played.
  test('played move is ABSENT from candidates: no substituted eval, no false "strongest" claim', () => {
    const text = describeAiMove({ movePlayed: { san: 'a3' }, candidates });
    expect(text).toContain('I played a3.');
    expect(text).not.toMatch(/strongest/);
    // Must not borrow candidates[0]'s (Nf3's) eval or PV for the unrelated move.
    expect(text).not.toContain('+0.4');
    expect(text).not.toContain('Nf3');
  });
});
