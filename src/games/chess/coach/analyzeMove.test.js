import { pvToSan, lineToCandidate, buildMovePayload } from './analyzeMove';
import { STARTING_FEN } from '../ChessBoard';

describe('analyzeMove — pvToSan', () => {
  test('converts a UCI pv to SAN from the start position', () => {
    const san = pvToSan(STARTING_FEN, ['e2e4', 'e7e5', 'g1f3']);
    expect(san).toEqual(['e4', 'e5', 'Nf3']);
  });
  test('stops cleanly at an illegal pv move', () => {
    const san = pvToSan(STARTING_FEN, ['e2e4', 'e2e4']); // 2nd is illegal now
    expect(san).toEqual(['e4']);
  });
  test('handles an empty / missing pv', () => {
    expect(pvToSan(STARTING_FEN, [])).toEqual([]);
    expect(pvToSan(STARTING_FEN, undefined)).toEqual([]);
  });
});

describe('analyzeMove — lineToCandidate', () => {
  test('maps an engine line to a display candidate', () => {
    const cand = lineToCandidate(STARTING_FEN, { multipv: 1, scoreCp: 40, mateIn: null, pv: ['e2e4', 'e7e5'] });
    expect(cand.san).toBe('e4');
    expect(cand.eval).toBe('+0.4');
    expect(cand.evalWhite).toBe(40);
    expect(cand.pv).toEqual(['e4', 'e5']);
  });
});

describe('analyzeMove — buildMovePayload', () => {
  const analysisBefore = {
    lines: [
      { multipv: 1, scoreCp: 30, mateIn: null, pv: ['e2e4', 'e7e5'] },
      { multipv: 2, scoreCp: 20, mateIn: null, pv: ['d2d4', 'd7d5'] },
    ],
  };

  test('flags the top move as Best and surfaces real candidates', () => {
    const payload = buildMovePayload({
      fenBefore: STARTING_FEN,
      fenAfter: 'rnbqkbnr/pppp1ppp/8/4p3/4P3/8/PPPP1PPP/RNBQKBNR w KQkq - 0 2',
      movePlayedSan: 'e4',
      moverColor: 'w',
      analysisBefore,
      analysisAfter: { lines: [{ multipv: 1, scoreCp: 30, mateIn: null, pv: ['e7e5'] }] },
      kind: 'player-move',
    });
    expect(payload.classification).toBe('best');
    expect(payload.candidates).toHaveLength(2);
    expect(payload.candidates[0].san).toBe('e4');
    expect(payload.candidates[1].san).toBe('d4');
    expect(payload.bestMove.san).toBe('e4');
  });

  test('classifies a weak move using the post-move eval', () => {
    const payload = buildMovePayload({
      fenBefore: STARTING_FEN,
      fenAfter: STARTING_FEN, // eval source is analysisAfter below
      movePlayedSan: 'a3',
      moverColor: 'w',
      analysisBefore,
      // After the move White's eval collapsed → big loss from white's POV.
      analysisAfter: { lines: [{ multipv: 1, scoreCp: -300, mateIn: null, pv: ['e7e5'] }] },
      kind: 'player-move',
    });
    expect(payload.classification).toBe('blunder');
    expect(payload.bestMove.san).toBe('e4');
    expect(payload.evalAfter).toBe('-3.0');
  });

  test('carries the learning goal through when provided', () => {
    const payload = buildMovePayload({
      fenBefore: STARTING_FEN,
      fenAfter: STARTING_FEN,
      movePlayedSan: 'e4',
      moverColor: 'w',
      analysisBefore,
      analysisAfter: analysisBefore,
      kind: 'ai-move',
      learningGoal: 'Italian Game',
    });
    expect(payload.learningGoal).toBe('Italian Game');
    expect(payload.kind).toBe('ai-move');
  });
});

describe('analyzeMove — captured piece', () => {
  const build = (fenBefore, san) =>
    buildMovePayload({ fenBefore, fenAfter: fenBefore, movePlayedSan: san, moverColor: 'b', kind: 'ai-move' });

  test('Nxe4 after 1.e4 e5 2.Nf3 Nf6 3.Bc4 captured a pawn', () => {
    const fen = 'rnbqkb1r/pppp1ppp/5n2/4p3/2B1P3/5N2/PPPP1PPP/RNBQK2R b KQkq - 3 3';
    expect(build(fen, 'Nxe4').captured).toBe('pawn');
  });
  test('en passant captures a pawn', () => {
    const fen = 'rnbqkbnr/ppp1p1pp/8/3pPp2/8/8/PPPP1PPP/RNBQKBNR w KQkq f6 0 3';
    expect(build(fen, 'exf6').captured).toBe('pawn');
  });
  test('a quiet move has no captured field; promotion is reported', () => {
    expect('captured' in build(STARTING_FEN, 'e4')).toBe(false);
    const p = build('8/P6k/8/8/8/8/8/K7 w - - 0 1', 'a8=Q');
    expect(p.promotion).toBe('queen');
    expect('captured' in p).toBe(false);
  });
});
