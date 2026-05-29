import { classifyMove, centipawnLoss, formatEval, toPerspective, MATE_SCORE } from './classify';

describe('classify — toPerspective', () => {
  test('white keeps sign, black flips it', () => {
    expect(toPerspective(50, 'w')).toBe(50);
    expect(toPerspective(50, 'b')).toBe(-50);
  });
});

describe('classify — classifyMove', () => {
  test('the top engine move is always Best', () => {
    expect(classifyMove({ bestEvalWhite: 30, playedEvalWhite: 30, moverColor: 'w', wasTopMove: true })).toBe('best');
  });

  test('a tiny loss is excellent/good, a large loss is a blunder (white)', () => {
    expect(classifyMove({ bestEvalWhite: 30, playedEvalWhite: 20, moverColor: 'w', wasTopMove: false })).toBe('excellent');
    expect(classifyMove({ bestEvalWhite: 30, playedEvalWhite: -10, moverColor: 'w', wasTopMove: false })).toBe('good');
    expect(classifyMove({ bestEvalWhite: 30, playedEvalWhite: -80, moverColor: 'w', wasTopMove: false })).toBe('inaccuracy');
    expect(classifyMove({ bestEvalWhite: 30, playedEvalWhite: -250, moverColor: 'w', wasTopMove: false })).toBe('mistake');
    expect(classifyMove({ bestEvalWhite: 30, playedEvalWhite: -500, moverColor: 'w', wasTopMove: false })).toBe('blunder');
  });

  test('loss is measured from the mover’s perspective (black)', () => {
    // White-POV eval went from -30 (good for black) to +400 (bad for black):
    // from black's perspective that's a loss of ~430 cp → blunder.
    expect(classifyMove({ bestEvalWhite: -30, playedEvalWhite: 400, moverColor: 'b', wasTopMove: false })).toBe('blunder');
  });

  test('throwing away a forced mate is a blunder', () => {
    expect(classifyMove({ bestEvalWhite: MATE_SCORE - 3, playedEvalWhite: -3000, moverColor: 'w', wasTopMove: false })).toBe('blunder');
  });
});

describe('classify — centipawnLoss', () => {
  test('non-negative and symmetric to perspective', () => {
    expect(centipawnLoss({ bestEvalWhite: 30, playedEvalWhite: -70, moverColor: 'w' })).toBe(100);
    expect(centipawnLoss({ bestEvalWhite: 30, playedEvalWhite: 30, moverColor: 'w' })).toBe(0);
  });
});

describe('classify — formatEval', () => {
  test('formats centipawns and mate', () => {
    expect(formatEval(140)).toBe('+1.4');
    expect(formatEval(-30)).toBe('-0.3');
    expect(formatEval(0)).toBe('0.0');
    expect(formatEval(99997, 3)).toBe('M3');
    expect(formatEval(-99998, -2)).toBe('-M2');
  });
});
