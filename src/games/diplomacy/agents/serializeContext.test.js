import DiplomacyBoard, { POWERS } from '../DiplomacyBoard.js';
import { serializeBoardContext } from './serializeContext.js';

describe('serializeBoardContext', () => {
  test('initial position enumerates 22 units and 34 supply centers', () => {
    const board = new DiplomacyBoard();
    const ctx = serializeBoardContext(board, { power: 'france' });

    // 22 units on the board at the opening; 34 supply centers in play.
    expect(ctx.unitTotal).toBe(22);
    expect(ctx.supplyCenterTotal).toBe(34);

    // Cross-check the per-power unit tally matches the board-wide total.
    const summedUnits = ctx.you.units + ctx.rivals.reduce((sum, r) => sum + r.units, 0);
    expect(summedUnits).toBe(22);
  });

  test("France's own 3 centers and 3 units appear", () => {
    const board = new DiplomacyBoard();
    const ctx = serializeBoardContext(board, { power: 'france' });

    expect(ctx.you.power).toBe('france');
    expect(ctx.you.centers).toBe(3);
    expect(ctx.you.units).toBe(3);
    expect(ctx.you.centerList).toHaveLength(3);
    expect(ctx.you.unitList).toHaveLength(3);
    expect(ctx.you.centerList).toEqual(expect.arrayContaining(['PAR', 'MAR', 'BRE']));
  });

  test('lists every other power as a rival with counts', () => {
    const board = new DiplomacyBoard();
    const ctx = serializeBoardContext(board, { power: 'france' });

    expect(ctx.rivals).toHaveLength(POWERS.length - 1);
    expect(ctx.rivals.map((r) => r.power)).not.toContain('france');
    ctx.rivals.forEach((r) => {
      expect(typeof r.centers).toBe('number');
      expect(typeof r.units).toBe('number');
      expect(typeof r.neighbor).toBe('boolean');
    });
  });

  test('flags powers within reach as neighbors and distant ones as not', () => {
    const board = new DiplomacyBoard();
    const ctx = serializeBoardContext(board, { power: 'france' });
    // England (across the Channel) and Germany are within France's sphere; Turkey
    // (the far corner) is not.
    expect(ctx.rivals.find((r) => r.power === 'england').neighbor).toBe(true);
    expect(ctx.rivals.find((r) => r.power === 'germany').neighbor).toBe(true);
    expect(ctx.rivals.find((r) => r.power === 'turkey').neighbor).toBe(false);
  });

  test('includes phase metadata for the opening turn', () => {
    const board = new DiplomacyBoard();
    const ctx = serializeBoardContext(board, { power: 'france' });
    expect(ctx.phase).toBe('Spring 1901 orders');
    expect(ctx.season).toBe('spring');
    expect(ctx.year).toBe(1901);
    expect(Array.isArray(ctx.recentResults)).toBe(true);
  });

  test('throws without a power', () => {
    const board = new DiplomacyBoard();
    expect(() => serializeBoardContext(board, {})).toThrow();
  });
});
