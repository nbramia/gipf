// puzzleCoach.test.js — staged hints and fail coaching for puzzles (#24):
// no-spoiler escalation, refutation-grounded fail text, payload shapes, and
// the keyless template routing through requestCommentary.

import {
  hintFor,
  buildHintPayload,
  hintLeaksSolution,
  describePuzzleFail,
  buildFailPayload,
  MAX_HINT_STAGE,
} from './puzzleCoach.js';
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

  test('stage 2 mid-line (fen moved on) explains why it degraded, not just a vague nudge', () => {
    const h = hintFor(BACK_RANK, 2, '6k1/5ppp/8/8/8/8/5PPP/3R2K1 w - - 0 1');
    expect(h).toContain('Back-rank mate');
    expect(h).not.toContain('d1');
    // Must say WHY the hint got vaguer, not just repeat "keep going".
    expect(h.toLowerCase()).toMatch(/different|sound|no longer applies/);
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
  });

  test('carries the solution only as a client-side field, never in the wire-visible hint text', () => {
    const payload = buildHintPayload(BACK_RANK, 1, BACK_RANK.fen);
    expect(payload.solution).toEqual({ uci: 'a1a8', fen: BACK_RANK.fen });
    // The rest of the payload -- what actually gets sent to the server, once
    // coachClient strips `solution` off -- must still never mention it.
    const { solution, ...wireShape } = payload;
    expect(JSON.stringify(wireShape)).not.toContain('a1a8');
  });
});

describe('hintLeaksSolution', () => {
  const solution = { uci: 'a1a8', fen: BACK_RANK.fen };

  test('catches the destination square spelled out on its own', () => {
    expect(hintLeaksSolution('Move your rook to a8 for mate.', solution)).toBe(true);
  });

  test('catches the SAN of the solution move', () => {
    expect(hintLeaksSolution('The winning move is Ra8#.', solution)).toBe(true);
  });

  test('catches the raw UCI form', () => {
    expect(hintLeaksSolution('Play a1a8 to finish it.', solution)).toBe(true);
  });

  test('does not flag a safe rephrasing of the theme', () => {
    expect(hintLeaksSolution('Your rook can deliver a back-rank mate here.', solution)).toBe(false);
  });

  test('does not false-positive on incidental substrings (e.g. "back")', () => {
    expect(hintLeaksSolution('Look at what is happening on the back rank.', solution)).toBe(false);
  });

  test('is false when there is no solution to check against', () => {
    expect(hintLeaksSolution('Play a1a8.', null)).toBe(false);
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

describe('requestCommentary spoiler guard (puzzle-hint, with an API key set)', () => {
  const solution = { uci: 'a1a8', fen: BACK_RANK.fen };

  beforeEach(() => {
    localStorage.setItem('gipfApiKey', 'test-key');
  });
  afterEach(() => {
    localStorage.clear();
    global.fetch = undefined;
  });

  test('discards a Claude hint that names the solution and falls back to the template', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ commentary: 'Push your rook all the way to a8 for mate.' }),
    });
    const payload = buildHintPayload(BACK_RANK, 1, BACK_RANK.fen);
    const { text, source } = await requestCommentary(payload);
    expect(source).toBe('template');
    expect(text).toBe(payload.hint);
  });

  test('accepts a Claude hint that stays within the allowed theme', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ commentary: "Look for the mate along the enemy's back rank." }),
    });
    const payload = buildHintPayload(BACK_RANK, 1, BACK_RANK.fen);
    const { text, source } = await requestCommentary(payload);
    expect(source).toBe('claude');
    expect(text).toBe("Look for the mate along the enemy's back rank.");
  });

  test('never sends the solution to the server', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ commentary: 'Look at the back rank.' }),
    });
    const payload = buildHintPayload(BACK_RANK, 1, BACK_RANK.fen);
    await requestCommentary(payload);
    const body = global.fetch.mock.calls[0][1].body;
    expect(body).not.toContain('a1a8');
  });
});
