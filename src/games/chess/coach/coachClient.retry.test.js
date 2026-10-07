import { requestCommentary, runThreadTurn } from './coachClient';
import { movedPieceNextMoves } from './legalMoves';

const json = (status, body) => ({ ok: status < 400, status, json: async () => body });

describe('coachClient — 504 handling', () => {
  beforeEach(() => {
    localStorage.setItem('playApiKey', 'test-key');
  });
  afterEach(() => {
    localStorage.clear();
    delete global.fetch;
  });

  test('commentary retries once after a 504 and uses the result', async () => {
    global.fetch = jest
      .fn()
      .mockResolvedValueOnce(json(504, { error: 'upstream_timeout' }))
      .mockResolvedValueOnce(json(200, { commentary: 'ok' }));
    const out = await requestCommentary({ kind: 'ai-move', fen: 'x', movePlayed: { san: 'e5' } });
    expect(global.fetch).toHaveBeenCalledTimes(2);
    expect(out).toEqual({ text: 'ok', source: 'claude' });
  });

  test('commentary falls back to the template after two 504s', async () => {
    global.fetch = jest.fn().mockResolvedValue(json(504, {}));
    const out = await requestCommentary({ kind: 'ai-move', fen: 'x', movePlayed: { san: 'e5' } });
    expect(global.fetch).toHaveBeenCalledTimes(2);
    expect(out.source).toBe('template');
  });

  test('thread turn retries a 504 once, then reports a timeout message', async () => {
    global.fetch = jest.fn().mockResolvedValue(json(504, {}));
    const out = await runThreadTurn({ context: {}, history: [], question: 'why?', analyze: jest.fn() });
    expect(global.fetch).toHaveBeenCalledTimes(2);
    expect(out.error).toBe('upstream');
    expect(out.text).toMatch(/too long/);
  });
});

describe('movedPieceNextMoves', () => {
  test('lists only legal knight destinations (no e5/h5 from e4)', () => {
    const before = 'rnbqkb1r/pppp1ppp/5n2/4p3/2B1P3/5N2/PPPP1PPP/RNBQK2R b KQkq - 0 3';
    const moves = movedPieceNextMoves(before, 'Nxe4');
    expect(moves).toEqual(expect.arrayContaining(['Nf6', 'Nd6', 'Ng5']));
    expect(moves.join(' ')).not.toMatch(/Ne5|Nh5|Nh4/);
    moves.forEach((m) => expect(m.startsWith('N')).toBe(true));
  });

  test('returns no moves after a checking move (no king capture)', () => {
    const before = 'r1bqkbnr/pppp1ppp/2n5/4p3/2B1P3/8/PPPP1PPP/RNBQK1NR w KQkq - 2 3';
    expect(movedPieceNextMoves(before, 'Bxf7+')).toEqual([]);
  });
});
