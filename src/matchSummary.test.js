import { describeSnapshot, gameLabel } from './matchSummary.js';

test('names the game from the registry', () => {
  expect(gameLabel('yinsh')).toBe('YINSH');
  expect(gameLabel('unlisted')).toBe('UNLISTED');
});
test('describes saved time, turn and phase without decoding', () => {
  const text = describeSnapshot({ updatedAt: Date.UTC(2026, 0, 2, 12), state: { currentPlayer: 2, gamePhase: 'remove-ring' } });
  expect(text).toMatch(/^Saved /);
  expect(text).toContain('Player 2 to move');
  expect(text).toContain('remove a ring');
});
test('counts chess moves and tolerates missing or unreadable values', () => {
  expect(describeSnapshot({ updatedAt: 1, state: { pgn: '1. e4 e5 2. Nf3' } })).toContain('2 moves');
  expect(describeSnapshot({ updatedAt: 0, state: { pgn: '' } })).toBe('Saved time unknown · no moves yet');
  expect(describeSnapshot(null)).toBe('No match saved');
  expect(describeSnapshot({ unreadable: 'x' })).toMatch(/Unreadable/);
});
