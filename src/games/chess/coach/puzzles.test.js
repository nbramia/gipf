import { Chess } from 'chess.js';
import { PUZZLES, getPuzzle, checkSolution } from './puzzles';

describe('puzzles — data integrity', () => {
  test('every bundled puzzle is a unique, legal mate-in-1', () => {
    for (const p of PUZZLES) {
      const game = new Chess(p.fen); // throws if FEN is illegal
      // The stored solution must be legal and deliver mate.
      const g = new Chess(p.fen);
      const mv = g.move({
        from: p.solution.slice(0, 2),
        to: p.solution.slice(2, 4),
        promotion: p.solution[4],
      });
      expect(mv).not.toBeNull();
      expect(g.isCheckmate()).toBe(true);

      // It must be the ONLY mate-in-1 in the position (unambiguous solve).
      let mateCount = 0;
      for (const cand of game.moves({ verbose: true })) {
        const t = new Chess(p.fen);
        t.move(cand);
        if (t.isCheckmate()) mateCount += 1;
      }
      expect(mateCount).toBe(1);
    }
  });

  test('ids are unique', () => {
    const ids = PUZZLES.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe('puzzles — checkSolution', () => {
  test('accepts the correct mating move', () => {
    const p = getPuzzle('back-rank');
    const r = checkSolution(p, 'a1', 'a8');
    expect(r).toMatchObject({ legal: true, solved: true, mate: true });
    expect(r.played).toBe('Ra8#');
  });

  test('rejects a legal but non-solving move', () => {
    const p = getPuzzle('back-rank');
    const r = checkSolution(p, 'g1', 'h1'); // legal king move, not the solution
    expect(r.legal).toBe(true);
    expect(r.solved).toBe(false);
    expect(r.mate).toBe(false);
  });

  test('reports illegal moves', () => {
    const p = getPuzzle('back-rank');
    const r = checkSolution(p, 'a1', 'a5'); // blocked? a-file is open; pick truly illegal
    // a1a5 is actually legal (open file). Use a knight-style illegal rook move.
    const r2 = checkSolution(p, 'a1', 'b3');
    expect(r2.legal).toBe(false);
    expect(r2.solved).toBe(false);
    // sanity: the legal-but-not-solution still isn't a solve
    expect(r.solved).toBe(false);
  });

  test('getPuzzle returns null for unknown id', () => {
    expect(getPuzzle('nope')).toBeNull();
  });
});
