import { parseInfoLine, parseBestMove, splitUciMove, collectMultiPV, chooseWeakenedMove } from './uci';

describe('uci — parseInfoLine', () => {
  test('parses depth, multipv, cp score (white to move)', () => {
    const line = 'info depth 18 seldepth 24 multipv 1 score cp 35 nodes 100 pv e2e4 e7e5 g1f3';
    const r = parseInfoLine(line, 'w');
    expect(r).toMatchObject({ depth: 18, multipv: 1, scoreCp: 35, mateIn: null });
    expect(r.pv).toEqual(['e2e4', 'e7e5', 'g1f3']);
  });

  test('negates cp score when black is to move (normalise to white POV)', () => {
    const r = parseInfoLine('info depth 12 multipv 1 score cp 50 pv d7d5', 'b');
    expect(r.scoreCp).toBe(-50);
  });

  test('parses a mate score and encodes magnitude', () => {
    const r = parseInfoLine('info depth 20 multipv 1 score mate 3 pv f6f7 g8h8 f7f8', 'w');
    expect(r.mateIn).toBe(3);
    expect(r.scoreCp).toBeGreaterThan(90000);
  });

  test('mate for black (white to move, getting mated) is negative', () => {
    const r = parseInfoLine('info depth 20 multipv 1 score mate -2 pv a1a2', 'w');
    expect(r.mateIn).toBe(-2);
    expect(r.scoreCp).toBeLessThan(-90000);
  });

  test('returns null for non-info and for infostring/currmove-only lines', () => {
    expect(parseInfoLine('readyok', 'w')).toBeNull();
    expect(parseInfoLine('info string NNUE evaluation using ...', 'w')).toBeNull();
    expect(parseInfoLine('info depth 1 currmove e2e4 currmovenumber 1', 'w')).toBeNull();
  });
});

describe('uci — parseBestMove', () => {
  test('extracts the best move, ignoring ponder', () => {
    expect(parseBestMove('bestmove e2e4 ponder e7e5')).toBe('e2e4');
    expect(parseBestMove('bestmove g1f3')).toBe('g1f3');
  });
  test('handles promotion moves and (none)', () => {
    expect(parseBestMove('bestmove e7e8q')).toBe('e7e8q');
    expect(parseBestMove('bestmove (none)')).toBeNull();
    expect(parseBestMove('info depth 1')).toBeNull();
  });
});

describe('uci — splitUciMove', () => {
  test('splits a normal move', () => {
    expect(splitUciMove('e2e4')).toEqual({ from: 'e2', to: 'e4', promotion: undefined });
  });
  test('splits a promotion move', () => {
    expect(splitUciMove('a7a8q')).toEqual({ from: 'a7', to: 'a8', promotion: 'q' });
  });
  test('returns null for garbage', () => {
    expect(splitUciMove('xx')).toBeNull();
    expect(splitUciMove(null)).toBeNull();
  });
});

describe('uci — chooseWeakenedMove', () => {
  // Four candidate lines (White POV): best +60, then +30, +10, and a blunder −300.
  const lines = [
    { multipv: 1, scoreCp: 60, pv: ['e2e4'] },
    { multipv: 2, scoreCp: 30, pv: ['d2d4'] },
    { multipv: 3, scoreCp: 10, pv: ['g1f3'] },
    { multipv: 4, scoreCp: -300, pv: ['b1a3'] }, // hangs material
  ];

  test('plays best when the deviation roll fails (rand ≥ pOff)', () => {
    const mv = chooseWeakenedMove(lines, 'w', { windowCp: 50, pOff: 0.4 }, () => 0.9);
    expect(mv).toBe('e2e4');
  });

  test('never picks a move outside the centipawn window (no piece-hanging)', () => {
    // Deviation roll succeeds (pOff=1); selection roll = 0.999 lands on the worst
    // in-window candidate, which must still be within 40cp of best (+60).
    const mv = chooseWeakenedMove(lines, 'w', { windowCp: 40, pOff: 1 }, () => 0.999);
    expect(['e2e4', 'd2d4']).toContain(mv); // +60 and +30 only; +10 (50cp off) and −300 excluded
    expect(mv).not.toBe('b1a3');
  });

  test('a wider window admits more candidates but still excludes the blunder', () => {
    const seen = new Set();
    for (let i = 0; i < 20; i += 1) {
      const r = i / 20; // 0 … 0.95
      seen.add(chooseWeakenedMove(lines, 'w', { windowCp: 60, pOff: 1 }, () => r));
    }
    expect(seen.has('g1f3')).toBe(true); // +10 is now within 60cp of best
    expect(seen.has('b1a3')).toBe(false); // the −300 blunder is never selected
  });

  test('normalises by side to move (black POV)', () => {
    // White-POV scores; for Black the best mover-score is the most negative cp.
    const blackLines = [
      { multipv: 1, scoreCp: -40, pv: ['e7e5'] }, // best for Black
      { multipv: 2, scoreCp: 200, pv: ['g8f6'] }, // terrible for Black
    ];
    const mv = chooseWeakenedMove(blackLines, 'b', { windowCp: 50, pOff: 1 }, () => 0);
    expect(mv).toBe('e7e5');
  });

  test('returns null when no line has a usable pv', () => {
    expect(chooseWeakenedMove([{ multipv: 1, scoreCp: 10, pv: [] }], 'w', { windowCp: 50, pOff: 1 })).toBeNull();
    expect(chooseWeakenedMove([], 'w', { windowCp: 50, pOff: 1 })).toBeNull();
  });
});

describe('uci — collectMultiPV', () => {
  test('keeps the deepest line per multipv index, sorted', () => {
    const infos = [
      parseInfoLine('info depth 8 multipv 1 score cp 20 pv e2e4', 'w'),
      parseInfoLine('info depth 8 multipv 2 score cp 10 pv d2d4', 'w'),
      parseInfoLine('info depth 12 multipv 1 score cp 30 pv e2e4 e7e5', 'w'),
      parseInfoLine('info depth 12 multipv 2 score cp 15 pv d2d4 d7d5', 'w'),
    ];
    const out = collectMultiPV(infos);
    expect(out).toHaveLength(2);
    expect(out[0].multipv).toBe(1);
    expect(out[0].depth).toBe(12);
    expect(out[0].scoreCp).toBe(30);
    expect(out[1].multipv).toBe(2);
    expect(out[1].depth).toBe(12);
  });
});
