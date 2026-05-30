import { Chess } from 'chess.js';
import {
  PUZZLES,
  getPuzzle,
  puzzlesForDifficulty,
  budgetPliesFor,
  evaluatePuzzleMove,
  DIFFICULTY_TO_MATE_IN,
} from './puzzles';
import { searchMate } from './mateSolver';

describe('puzzles — data integrity (solver-verified)', () => {
  test('every puzzle is a sound forced mate of its stated depth', () => {
    for (const p of PUZZLES) {
      const game = new Chess(p.fen); // throws on an illegal FEN
      const res = searchMate(game, budgetPliesFor(p.mateIn));
      expect(res).not.toBeNull();
      // The shortest forced mate equals the stated length (in plies).
      expect(res.dist).toBe(budgetPliesFor(p.mateIn));
    }
  });

  test('ids are unique and the shipped tiers (1 and 2) are populated', () => {
    const ids = PUZZLES.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(PUZZLES.some((p) => p.mateIn === 1)).toBe(true);
    expect(PUZZLES.some((p) => p.mateIn === 2)).toBe(true);
  });
});

describe('puzzles — difficulty mapping', () => {
  test('maps each tier to a mate length and returns matching puzzles', () => {
    expect(DIFFICULTY_TO_MATE_IN.beginner).toBe(1);
    expect(DIFFICULTY_TO_MATE_IN.intermediate).toBe(2);
    expect(DIFFICULTY_TO_MATE_IN.master).toBe(2);
    expect(puzzlesForDifficulty('beginner').every((p) => p.mateIn === 1)).toBe(true);
    expect(puzzlesForDifficulty('intermediate').every((p) => p.mateIn === 2)).toBe(true);
    expect(puzzlesForDifficulty('master').length).toBeGreaterThan(0);
  });
});

describe('puzzles — evaluatePuzzleMove (mate in 1)', () => {
  const p = getPuzzle('m1-back-rank');

  test('accepts the mating move', () => {
    const r = evaluatePuzzleMove(p.fen, budgetPliesFor(1), 'a1', 'a8');
    expect(r).toMatchObject({ legal: true, solved: true, correct: true });
    expect(r.played).toBe('Ra8#');
  });

  test('rejects a legal non-mating move', () => {
    const r = evaluatePuzzleMove(p.fen, budgetPliesFor(1), 'g1', 'h1');
    expect(r.legal).toBe(true);
    expect(r.solved).toBe(false);
    expect(r.correct).toBe(false);
  });

  test('reports illegal moves', () => {
    const r = evaluatePuzzleMove(p.fen, budgetPliesFor(1), 'a1', 'b3');
    expect(r.legal).toBe(false);
  });
});

describe('puzzles — evaluatePuzzleMove (mate in 2 plays out)', () => {
  const p = PUZZLES.find((x) => x.mateIn === 2);

  test('a correct first move keeps the mate and the engine replies', () => {
    const game = new Chess(p.fen);
    const key = searchMate(game, budgetPliesFor(2)).key;
    const r = evaluatePuzzleMove(p.fen, budgetPliesFor(2), key.from, key.to, key.promotion);
    expect(r.legal).toBe(true);
    expect(r.correct).toBe(true);
    expect(r.solved).toBe(false);
    expect(r.reply).toBeTruthy(); // engine defended
    expect(r.budgetPlies).toBe(budgetPliesFor(2) - 2);
    // From the resulting position the player can finish in 1.
    const g2 = new Chess(r.fenAfter);
    expect(searchMate(g2, r.budgetPlies).dist).toBe(1);
  });

  test('a move that throws away the forced mate is not solved', () => {
    const game = new Chess(p.fen);
    const key = searchMate(game, budgetPliesFor(2)).key;
    const other = game
      .moves({ verbose: true })
      .find((m) => m.from !== key.from || m.to !== key.to);
    if (other) {
      const r = evaluatePuzzleMove(p.fen, budgetPliesFor(2), other.from, other.to, other.promotion);
      expect(r.solved).toBe(false);
    }
  });
});
