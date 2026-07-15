// puzzleCoach.test.js — staged hints and fail coaching for puzzles (#24):
// no-spoiler escalation, refutation-grounded fail text, payload shapes, and
// the keyless template routing through requestCommentary.

import { hintFor, buildHintPayload, describePuzzleFail, buildFailPayload, MAX_HINT_STAGE } from './puzzleCoach.js';
import { requestCommentary } from './coachClient.js';

const BACK_RANK = {
  id: 'm1-back-rank',
  fen: '6k1/5ppp/8/8/8/8/5PPP/R5K1 w - - 0 1',
  theme: 'Back-rank mate',
  hint: 'The king is trapped by its own pawns.',
  solution: ['a1a8'],
};

describe('hintFor', () => {
  test('stage 1 gives only the theme hint', () => {
    expect(hintFor(BACK_RANK, 1, BACK_RANK.fen)).toBe('The king is trapped by its own pawns.');
    expect(MAX_HINT_STAGE).toBe(2);
  });

  test('stage 2 names the key piece and square, never the move', () => {
    const h = hintFor(BACK_RANK, 2, BACK_RANK.fen);
    expect(h).toContain('rook');
    expect(h).toContain('a1');
    expect(h).not.toContain('a8'); // destination stays secret
  });

  test('stage 2 mid-line (fen moved on) degrades to a theme nudge', () => {
    const h = hintFor(BACK_RANK, 2, '6k1/5ppp/8/8/8/8/5PPP/3R2K1 w - - 0 1');
    expect(h).toContain('Back-rank mate');
    expect(h).not.toContain('d1');
  });

  test('no stored solution degrades to the theme hint', () => {
    const p = { ...BACK_RANK, solution: undefined };
    expect(hintFor(p, 2, p.fen)).toBe(p.hint);
  });
});

describe('buildHintPayload', () => {
  test('carries only what the stage allows', () => {
    const payload = buildHintPayload(BACK_RANK, 1, BACK_RANK.fen);
    expect(payload).toMatchObject({ kind: 'puzzle-hint', stage: 1, theme: 'Back-rank mate' });
    expect(payload.fen).toBe(BACK_RANK.fen);
    expect(JSON.stringify(payload)).not.toContain('a1a8'); // solution never leaves
  });
});

describe('describePuzzleFail / buildFailPayload', () => {
  test('explains via the refutation and re-points at the theme, no solution', () => {
    const text = describePuzzleFail({
      movePlayed: { san: 'Kh1' },
      refutationPv: ['Rd8+', 'Rxd8', 'Qxd8#'],
      theme: 'Back-rank mate',
    });
    expect(text).toContain('Kh1');
    expect(text).toContain('Rd8+');
    expect(text).toContain('back-rank mate');
  });

  test('stays coherent with no refutation line', () => {
    const text = describePuzzleFail({ movePlayed: { san: 'Kh1' }, refutationPv: [], theme: 'Fork' });
    expect(text).toContain("Kh1 doesn't work");
    expect(text).toContain('fork');
  });

  test('buildFailPayload converts the engine pv to SAN from fenAfter', () => {
    const startFen = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
    const afterE4 = 'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1';
    const payload = buildFailPayload({
      puzzle: { theme: 'Fork' },
      fen: startFen,
      fenAfter: afterE4,
      playedSan: 'e4',
      analysisAfter: { lines: [{ pv: ['e7e5', 'g1f3'] }] },
    });
    expect(payload).toMatchObject({ kind: 'puzzle-fail', movePlayed: { san: 'e4' }, theme: 'Fork' });
    expect(payload.refutationPv).toEqual(['e5', 'Nf3']);
  });
});

describe('requestCommentary keyless routing', () => {
  afterEach(() => localStorage.clear());

  test('puzzle-hint falls back to the deterministic hint text', async () => {
    const { text, source } = await requestCommentary({ kind: 'puzzle-hint', hint: 'Theme: fork.' });
    expect(source).toBe('template');
    expect(text).toBe('Theme: fork.');
  });

  test('puzzle-fail falls back to the refutation template', async () => {
    const { text, source } = await requestCommentary({
      kind: 'puzzle-fail',
      movePlayed: { san: 'Qe2' },
      refutationPv: ['Nxe2'],
      theme: 'Pin',
    });
    expect(source).toBe('template');
    expect(text).toContain("Qe2 doesn't work");
    expect(text).toContain('Nxe2');
  });
});
