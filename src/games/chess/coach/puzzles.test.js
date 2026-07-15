import { Chess } from 'chess.js';
import {
  PUZZLES,
  getPuzzle,
  puzzlesForDifficulty,
  budgetPliesFor,
  evaluatePuzzleMove,
  evaluateSolutionMove,
  DIFFICULTY_TO_MATE_IN,
} from './puzzles';
import { searchMate } from './mateSolver';

const applyUci = (game, uci) =>
  game.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci.length > 4 ? uci[4] : undefined });

describe('puzzles — data integrity (solver-verified)', () => {
  test('every mate-in-1/2 puzzle is a sound forced mate of its stated depth', () => {
    // Mate-in-3 positions are excluded: the exhaustive depth-5 proof takes
    // seconds per position, so it runs offline at authoring time. Their
    // soundness is still verified below via the stored line + key check.
    for (const p of PUZZLES.filter((x) => x.mateIn <= 2)) {
      const game = new Chess(p.fen); // throws on an illegal FEN
      const res = searchMate(game, budgetPliesFor(p.mateIn));
      expect(res).not.toBeNull();
      // The shortest forced mate equals the stated length (in plies).
      expect(res.dist).toBe(budgetPliesFor(p.mateIn));
    }
  });

  test('every puzzle carries a rating and a stored solution that mates on schedule', () => {
    for (const p of PUZZLES) {
      expect(typeof p.rating).toBe('number');
      expect(p.solution).toHaveLength(budgetPliesFor(p.mateIn));
      const game = new Chess(p.fen);
      for (const uci of p.solution) expect(applyUci(game, uci)).toBeTruthy();
      expect(game.isCheckmate()).toBe(true);
    }
  });

  test('mate-in-3: the key move keeps a forced mate against every defense', () => {
    for (const p of PUZZLES.filter((x) => x.mateIn === 3)) {
      const game = new Chess(p.fen);
      applyUci(game, p.solution[0]);
      for (const r of game.moves({ verbose: true })) {
        game.move(r);
        expect(searchMate(game, 3)).not.toBeNull();
        game.undo();
      }
    }
  });

  test('ids are unique and all three tiers are populated', () => {
    const ids = PUZZLES.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(PUZZLES.some((p) => p.mateIn === 1)).toBe(true);
    expect(PUZZLES.some((p) => p.mateIn === 2)).toBe(true);
    expect(PUZZLES.some((p) => p.mateIn === 3)).toBe(true);
  });
});

describe('puzzles — difficulty mapping', () => {
  test('maps each tier to a mate length and returns matching puzzles', () => {
    expect(DIFFICULTY_TO_MATE_IN.beginner).toBe(1);
    expect(DIFFICULTY_TO_MATE_IN.intermediate).toBe(2);
    expect(DIFFICULTY_TO_MATE_IN.master).toBe(3);
    expect(puzzlesForDifficulty('beginner').every((p) => p.mateIn === 1)).toBe(true);
    expect(puzzlesForDifficulty('intermediate').every((p) => p.mateIn === 2)).toBe(true);
    expect(puzzlesForDifficulty('master').every((p) => p.mateIn === 3)).toBe(true);
    expect(puzzlesForDifficulty('master').length).toBeGreaterThan(0);
  });
});

describe('puzzles — evaluateSolutionMove (scripted UCI lines)', () => {
  const line = getPuzzle('m2-queen-b'); // ['c6b6','c8b8','d1d8'] used as a script

  test('the exact solution move advances the script and plays the reply', () => {
    const r = evaluateSolutionMove(line.fen, line.solution, 'c6', 'b6');
    expect(r).toMatchObject({ legal: true, correct: true, solved: false });
    expect(r.reply.san).toBe('Kb8');
    expect(r.solution).toEqual(['d1d8']);
    // Finishing move mates.
    const r2 = evaluateSolutionMove(r.fenAfter, r.solution, 'd1', 'd8');
    expect(r2).toMatchObject({ legal: true, correct: true, solved: true });
  });

  test('a non-solution move fails; an off-script checkmate still wins', () => {
    const wrong = evaluateSolutionMove(line.fen, line.solution, 'd1', 'd2');
    expect(wrong).toMatchObject({ legal: true, correct: false, solved: false });

    const kiss = getPuzzle('m1-kiss'); // stored key f6e7, but f6h8 also mates
    const alt = evaluateSolutionMove(kiss.fen, kiss.solution, 'f6', 'h8');
    expect(alt).toMatchObject({ legal: true, correct: true, solved: true });
  });

  test('reports illegal moves', () => {
    expect(evaluateSolutionMove(line.fen, line.solution, 'c6', 'c8').legal).toBe(false);
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
