import { buildMovePayload } from './analyzeMove';
import { describeAiMove, describePlayerMove } from './templates';

describe('buildMovePayload — who moved and legal moves', () => {
  const AFTER_E4 = 'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1';
  const lines = [{ multipv: 1, scoreCp: 30, mateIn: null, pv: ['e7e5'] }];
  const args = {
    fenBefore: AFTER_E4,
    fenAfter: AFTER_E4,
    movePlayedSan: 'e5',
    analysisBefore: { lines },
    analysisAfter: { lines },
  };

  test('engine move: mover is the engine and the student plays the other colour', () => {
    const p = buildMovePayload({ ...args, moverColor: 'b', kind: 'ai-move' });
    expect(p.mover).toBe('engine');
    expect(p.playerColor).toBe('w');
  });

  test('player move: mover is the user and playerColor is the mover', () => {
    const p = buildMovePayload({ ...args, moverColor: 'b', kind: 'player-move' });
    expect(p.mover).toBe('user');
    expect(p.playerColor).toBe('b');
  });

  test('carries legal SAN moves for the position (no knight-to-e5 from e4)', () => {
    const fen = 'rnbqkb1r/pppp1ppp/8/4p3/2B1n3/5N2/PPPP1PPP/RNBQK2R w KQkq - 0 4';
    const p = buildMovePayload({ ...args, fenBefore: fen, fenAfter: fen, moverColor: 'w', kind: 'player-move' });
    expect(p.legalMoves).toContain('Nxe5');
    expect(p.legalMoves).toContain('O-O');
    expect(p.legalMovesAfter.length).toBeGreaterThan(0);
  });

  test('keyless templates are unchanged by the extra fields', () => {
    const p = buildMovePayload({ ...args, moverColor: 'b', kind: 'ai-move' });
    expect(describeAiMove(p)).toMatch(/^I played e5\./);
    const q = buildMovePayload({ ...args, moverColor: 'b', kind: 'player-move' });
    expect(describePlayerMove(q)).toContain('e5');
  });
});
