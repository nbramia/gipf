import DiplomacyBoard, { baseProvince } from './DiplomacyBoard.js';
import { moveOptionsInto, toggleAdjustment, normalizeAdjustments } from './orderEntry.js';

const key = (o) => JSON.stringify(o);
const build = (unitType, loc) => ({ type: 'build', power: 'england', unitType, loc });

describe('moveOptionsInto', () => {
  test('a fleet in MAO has one option per Spanish coast, so the UI must ask', () => {
    const board = new DiplomacyBoard();
    board.units = { MAO: { power: 'france', type: 'fleet' } };
    const moves = board.getLegalOrdersForUnit('MAO').filter(o => o.type === 'move');
    expect(moveOptionsInto(moves, 'SPA', baseProvince).map(o => o.to).sort()).toEqual(['SPA/nc', 'SPA/sc']);
    expect(moveOptionsInto(moves, 'POR', baseProvince)).toHaveLength(1);
  });
});

describe('toggleAdjustment', () => {
  test('rejects selections beyond the build allowance with a message', () => {
    const first = toggleAdjustment([], build('army', 'EDI'), 1, key, baseProvince);
    expect(first.list).toHaveLength(1);
    const second = toggleAdjustment(first.list, build('army', 'LVP'), 1, key, baseProvince);
    expect(second.list).toEqual(first.list);
    expect(second.error).toMatch(/only build 1 unit/);
  });

  test('a second build in the same home replaces the first', () => {
    const a = toggleAdjustment([], build('army', 'EDI'), 2, key, baseProvince);
    const b = toggleAdjustment(a.list, build('fleet', 'EDI'), 2, key, baseProvince);
    expect(b.error).toBeNull();
    expect(b.list).toEqual([build('fleet', 'EDI')]);
  });

  test('clicking a selected order deselects it', () => {
    const o = { type: 'disband', unitLoc: 'LON' };
    const on = toggleAdjustment([], o, 1, key, baseProvince);
    expect(toggleAdjustment(on.list, o, 1, key, baseProvince).list).toEqual([]);
  });
});

describe('normalizeAdjustments', () => {
  test('trims a restored A EDI + F EDI + F LVP plan to the single build allowed', () => {
    const saved = [build('army', 'EDI'), build('fleet', 'EDI'), build('fleet', 'LVP')];
    const fixed = normalizeAdjustments(saved, 1, key, baseProvince);
    expect(fixed).toHaveLength(1);
    expect(fixed[0].loc).toBe('EDI');
  });
});
