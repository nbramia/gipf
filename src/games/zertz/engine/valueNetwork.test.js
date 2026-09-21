import { ValueNetwork } from './valueNetwork';
import * as ort from 'onnxruntime-web';
import Board from '../ZertzBoard';
jest.mock('onnxruntime-web', () => ({
  env: { wasm: {} },
  Tensor: jest.fn(function (type, data, dims) { Object.assign(this, { type, data, dims }); }),
  InferenceSession: { create: jest.fn() },
}));
let session;
beforeEach(() => {
  ort.Tensor.mockImplementation(function (type, data, dims) { Object.assign(this, { type, data, dims }); });
  session = { inputNames: ['board_input', 'meta_input'], outputNames: ['value', 'policy'], run: jest.fn().mockResolvedValue({
    value: { data: [0.25] }, policy: { data: [0.1, 0.9] },
  }), release: jest.fn().mockResolvedValue() };
  ort.InferenceSession.create.mockReset().mockResolvedValue(session);
  jest.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => jest.restoreAllMocks());
test.each([NaN, Infinity, -Infinity])('nonfinite policy %s fails the probe and remains retryable', async invalid => {
  for (const input of ['board_input', 'board_v2_input']) {
    session.inputNames = [input, 'meta_input'];
    const network = new ValueNetwork();
    session.run.mockResolvedValueOnce({ value: { data: [0.25] }, policy: { data: [0, invalid] } });
    expect(await network.load()).toBe(false);
    expect(network.isLoaded()).toBe(false);
    expect(session.release).toHaveBeenCalled();
    expect(await network.load()).toBe(true);
  }
});
test('value-only legacy models still load without policy output', async () => {
  session.outputNames = ['value'];
  session.run.mockResolvedValue({ value: { data: [0.25] } });
  const network = new ValueNetwork();
  expect(await network.load()).toBe(true);
  expect(network.hasPolicy).toBe(false);
});
test.each(['', '/gipf'])('loads and runs the model under PUBLIC_URL=%s', async prefix => {
  const previous = process.env.PUBLIC_URL;
  process.env.PUBLIC_URL = prefix;
  const network = new ValueNetwork();
  expect(await network.load()).toBe(true);
  expect(network.featureVersion).toBe(1);
  expect(ort.InferenceSession.create).toHaveBeenCalledWith(`${prefix}/models/zertz-value-v1.onnx`, { executionProviders: ['wasm'] });
  expect(ort.env.wasm.numThreads).toBe(1);
  expect(await network.evaluatePosition(new Board())).toBe(0.25);
  expect(await network.evaluatePositionWithPolicy(new Board())).toEqual({ value: 0.25, policy: [0.1, 0.9] });
  const feeds = session.run.mock.calls[1][0];
  expect(feeds.board_input.dims).toEqual([1, 5, 7, 7]);
  expect(feeds.meta_input.dims).toEqual([1, 12]);
  process.env.PUBLIC_URL = previous;
});
test('failed fetch is retryable and never marks a network loaded', async () => {
  ort.InferenceSession.create.mockRejectedValueOnce(new Error('404'));
  const network = new ValueNetwork();
  expect(await network.load('/missing.onnx')).toBe(false);
  expect(network.isLoaded()).toBe(false);
  expect(await network.load('/working.onnx')).toBe(true);
  expect(ort.InferenceSession.create).toHaveBeenCalledTimes(2);
});
test('incompatible input or invalid output is released and not cached as working', async () => {
  const network = new ValueNetwork();
  session.run.mockRejectedValueOnce(new Error('wrong feature shape'));
  expect(await network.load()).toBe(false);
  expect(session.release).toHaveBeenCalledTimes(1);
  expect(network.isLoaded()).toBe(false);
  session.run.mockResolvedValueOnce({ value: { data: [NaN] } });
  expect(await network.load()).toBe(false);
  expect(network.isLoaded()).toBe(false);
  expect(await network.load()).toBe(true);
});

test('v2 uses six planes and carries the forced marble into actual inference feeds', async () => {
  session.inputNames = ['board_v2_input', 'meta_input'];
  const network = new ValueNetwork();
  expect(await network.load('/candidate-v2.onnx')).toBe(true);
  expect(network.featureVersion).toBe(2);
  const board = new Board();
  board.gamePhase = 'capture';
  board.marbles['0,0'] = 'white';
  board.jumpingMarble = '0,0';
  await network.evaluatePositionWithPolicy(board);
  const feeds = session.run.mock.calls[1][0];
  expect(feeds.board_v2_input.dims).toEqual([1, 6, 7, 7]);
  expect(feeds.board_v2_input.data[5 * 49 + 24]).toBe(1);
  expect(feeds.board_input).toBeUndefined();
});

test('unknown model schemas fail clearly and release the incompatible session', async () => {
  session.inputNames = ['board_v3_input', 'meta_input'];
  const network = new ValueNetwork();
  expect(await network.load()).toBe(false);
  expect(network.lastError).toContain('Unsupported ZERTZ model input schema');
  expect(network.featureVersion).toBeNull();
  expect(session.run).not.toHaveBeenCalled();
  expect(session.release).toHaveBeenCalledTimes(1);
});
