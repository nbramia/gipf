import { describePlayerMove } from './templates';

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
