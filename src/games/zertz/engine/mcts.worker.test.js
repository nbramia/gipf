import { ValueNetwork } from './valueNetwork';
import { MCTS } from './mcts';
jest.mock('./valueNetwork', () => ({ ValueNetwork: jest.fn() }));
jest.mock('./mcts', () => ({ MCTS: jest.fn() }));
jest.mock('../ZertzBoard', () => ({ __esModule: true, default: {
  fromSerializedState: jest.fn(state => state),
} }));
let handler, load, getBestMove;
beforeEach(() => {
  load = jest.fn().mockResolvedValue(true);
  ValueNetwork.mockImplementation(() => ({ load }));
  getBestMove = jest.fn().mockResolvedValue({ type: 'place-marble', q: 0, r: 0 });
  MCTS.mockImplementation(() => ({ getBestMove }));
  // Re-evaluate just the worker to start with an empty per-worker model cache.
  jest.isolateModules(() => {
    jest.doMock('./valueNetwork', () => ({ ValueNetwork }));
    jest.doMock('./mcts', () => ({ MCTS }));
    require('./mcts.worker');
    handler = self.onmessage;
  });
  self.postMessage = jest.fn();
});
const compute = (requestId, modelPath = '/gipf/models/zertz-value-v1.onnx') =>
  handler({ data: { type: 'compute', requestId, data: {
    boardState: { gamePhase: 'setup' }, simulations: 1, evaluationMode: 'nn', modelPath,
  } } });
test('successful network is cached and results echo request IDs and actual mode', async () => {
  await compute(12); await compute(13);
  expect(load).toHaveBeenCalledTimes(1);
  expect(load).toHaveBeenCalledWith('/gipf/models/zertz-value-v1.onnx');
  expect(self.postMessage.mock.calls.map(([message]) => message.requestId)).toEqual([12, 13]);
  expect(self.postMessage.mock.calls[0][0].stats.evaluationMode).toBe('nn');
  expect(self.postMessage.mock.calls[0][0].data.rootNode).toBeUndefined();
});
test('failed load falls back honestly, is not cached, and can recover', async () => {
  load.mockResolvedValueOnce(false);
  await compute(21);
  expect(self.postMessage.mock.calls[0][0].stats).toMatchObject({
    evaluationMode: 'heuristic', requestedEvaluationMode: 'nn',
  });
  await compute(22);
  expect(load).toHaveBeenCalledTimes(2);
  expect(self.postMessage.mock.calls[1][0].stats.evaluationMode).toBe('nn');
});
test('separate model paths retain separate successful caches', async () => {
  await compute(1, '/gipf/models/easy.onnx');
  await compute(2, '/gipf/models/expert.onnx');
  await compute(3, '/gipf/models/easy.onnx');
  expect(load).toHaveBeenCalledTimes(2);
});
test('search errors echo their own request ID', async () => {
  getBestMove.mockRejectedValueOnce(new Error('search failed'));
  await compute(99);
  expect(self.postMessage).toHaveBeenCalledWith(expect.objectContaining({
    requestId: 99, type: 'error', error: 'search failed',
  }));
});
