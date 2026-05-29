import { moveSoundKind } from './sound';

describe('sound — moveSoundKind', () => {
  test('game over takes priority', () => {
    expect(moveSoundKind({ flags: 'c' }, true, true)).toBe('end');
  });
  test('check beats capture', () => {
    expect(moveSoundKind({ flags: 'c' }, true, false)).toBe('check');
  });
  test('capture detected from c/e flags', () => {
    expect(moveSoundKind({ flags: 'c' }, false, false)).toBe('capture');
    expect(moveSoundKind({ flags: 'e' }, false, false)).toBe('capture');
  });
  test('plain move otherwise', () => {
    expect(moveSoundKind({ flags: 'n' }, false, false)).toBe('move');
    expect(moveSoundKind(null, false, false)).toBe('move');
  });
});
