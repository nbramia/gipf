import { Chess } from 'chess.js';
import { ANALYZE_POSITION_TOOL, runAnalyzePosition, runTool } from './analysisTools';
import { STARTING_FEN } from '../ChessBoard';

// A fake engine: returns a fixed line so we test plumbing, not Stockfish.
// It echoes back the first legal move of the position so assertions are stable.
function fakeAnalyze(fen, { multipv }) {
  const g = new Chess(fen);
  const first = g.moves({ verbose: true })[0];
  const uci = first ? `${first.from}${first.to}${first.promotion || ''}` : 'e2e4';
  return Promise.resolve({
    lines: [{ multipv: 1, scoreCp: 35, mateIn: null, pv: [uci] }].slice(0, multipv),
  });
}

const afterE4 = 'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1';
const ctx = { fenBefore: STARTING_FEN, fenAfter: afterE4 };

describe('analysisTools — schema', () => {
  test('exposes the analyze_position tool with the expected shape', () => {
    expect(ANALYZE_POSITION_TOOL.name).toBe('analyze_position');
    expect(ANALYZE_POSITION_TOOL.input_schema.properties).toHaveProperty('from');
    expect(ANALYZE_POSITION_TOOL.input_schema.properties).toHaveProperty('moves');
    expect(ANALYZE_POSITION_TOOL.input_schema.properties).toHaveProperty('multipv');
  });
});

describe('analysisTools — runAnalyzePosition', () => {
  test('analyzes the "before" position by default', async () => {
    const r = await runAnalyzePosition({ ctx, input: {}, analyze: fakeAnalyze });
    expect(r.from).toBe('before');
    expect(r.movesPlayed).toEqual([]);
    expect(r.sideToMove).toBe('White');
    expect(r.lines.length).toBe(1);
    expect(r.lines[0]).toHaveProperty('move');
    expect(r.lines[0]).toHaveProperty('eval');
  });

  test('analyzes the "after" position when asked', async () => {
    const r = await runAnalyzePosition({ ctx, input: { from: 'after' }, analyze: fakeAnalyze });
    expect(r.from).toBe('after');
    expect(r.sideToMove).toBe('Black');
  });

  test('plays a SAN what-if line before analyzing', async () => {
    const r = await runAnalyzePosition({ ctx, input: { moves: ['Nf3', 'd5'] }, analyze: fakeAnalyze });
    expect(r.movesPlayed).toEqual(['Nf3', 'd5']);
    expect(r.sideToMove).toBe('White');
  });

  test('accepts UCI long-algebraic moves too', async () => {
    const r = await runAnalyzePosition({ ctx, input: { moves: ['g1f3'] }, analyze: fakeAnalyze });
    expect(r.movesPlayed).toEqual(['Nf3']);
  });

  test('returns an error (not a throw) for an illegal what-if move', async () => {
    const r = await runAnalyzePosition({ ctx, input: { moves: ['Nf3', 'Nf3'] }, analyze: fakeAnalyze });
    expect(r.error).toMatch(/not legal/i);
    expect(r.legalSoFar).toEqual(['Nf3']);
  });

  test('clamps multipv into 1..4', async () => {
    const spy = jest.fn(fakeAnalyze);
    await runAnalyzePosition({ ctx, input: { multipv: 99 }, analyze: spy });
    expect(spy.mock.calls[0][1].multipv).toBe(4);
  });

  test('surfaces an engine failure as an error result', async () => {
    const boom = () => Promise.reject(new Error('engine down'));
    const r = await runAnalyzePosition({ ctx, input: {}, analyze: boom });
    expect(r.error).toMatch(/engine down/);
  });
});

describe('analysisTools — runTool dispatch', () => {
  test('routes analyze_position', async () => {
    const r = await runTool('analyze_position', {}, { ctx, analyze: fakeAnalyze });
    expect(r.lines.length).toBe(1);
  });
  test('rejects unknown tools', async () => {
    const r = await runTool('do_something_else', {}, { ctx, analyze: fakeAnalyze });
    expect(r.error).toMatch(/unknown tool/i);
  });
});
