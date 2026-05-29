import { winPercent, moveAccuracy, accuracyFromCpLoss, summarizeAccuracy } from './accuracy';

describe('accuracy — winPercent', () => {
  test('even position is ~50%', () => {
    expect(Math.round(winPercent(0))).toBe(50);
  });
  test('large advantage approaches 100, large deficit approaches 0', () => {
    expect(winPercent(1000)).toBeGreaterThan(90);
    expect(winPercent(-1000)).toBeLessThan(10);
  });
});

describe('accuracy — moveAccuracy / accuracyFromCpLoss', () => {
  test('a perfect move (no win drop) is ~100%', () => {
    expect(moveAccuracy(0)).toBeGreaterThan(99);
    expect(accuracyFromCpLoss(0)).toBeGreaterThan(99);
  });
  test('bigger centipawn loss yields lower accuracy, monotonically', () => {
    const a0 = accuracyFromCpLoss(0);
    const a50 = accuracyFromCpLoss(50);
    const a300 = accuracyFromCpLoss(300);
    expect(a0).toBeGreaterThan(a50);
    expect(a50).toBeGreaterThan(a300);
    expect(a300).toBeGreaterThanOrEqual(0);
  });
});

describe('accuracy — summarizeAccuracy', () => {
  test('aggregates per side with counts and rounded accuracy', () => {
    const moves = [
      { moverColor: 'w', cpLoss: 0, classification: 'best' },
      { moverColor: 'b', cpLoss: 400, classification: 'blunder' },
      { moverColor: 'w', cpLoss: 20, classification: 'good' },
      { moverColor: 'b', cpLoss: 0, classification: 'best' },
    ];
    const r = summarizeAccuracy(moves);
    expect(r.white.moves).toBe(2);
    expect(r.black.moves).toBe(2);
    expect(r.white.counts.best).toBe(1);
    expect(r.white.counts.good).toBe(1);
    expect(r.black.counts.blunder).toBe(1);
    // White played near-perfectly; should out-accuracy Black who blundered.
    expect(r.white.accuracy).toBeGreaterThan(r.black.accuracy);
  });

  test('no moves yields null accuracy', () => {
    const r = summarizeAccuracy([]);
    expect(r.white.accuracy).toBeNull();
    expect(r.black.moves).toBe(0);
  });
});
