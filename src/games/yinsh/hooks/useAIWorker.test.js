import { renderHook, act } from '@testing-library/react';
import { useAIWorker } from './useAIWorker';
import { createAIWorker } from './createAIWorker';
jest.mock('./createAIWorker', () => ({ createAIWorker: jest.fn() }));
let workers;
beforeEach(() => {
  workers = [];
  createAIWorker.mockImplementation(() => {
    const worker = { postMessage: jest.fn(), terminate: jest.fn() };
    workers.push(worker);
    return worker;
  });
});
const reply = (worker, type = 'result', requestId = worker.postMessage.mock.calls[0][0].requestId) => {
  act(() => worker.onmessage({ data: { requestId, type, data: { move: 'move' }, error: 'old error' } }));
};
test('overlap discards old results and errors, and applies the current request exactly once', () => {
  const { result } = renderHook(() => useAIWorker());
  const oldSuccess = jest.fn(), oldError = jest.fn(), success = jest.fn(), error = jest.fn();
  act(() => result.current.computeMove({}, 1, oldSuccess, oldError));
  const old = workers[0];
  act(() => result.current.computeMove({}, 1, success, error));
  reply(old); reply(old, 'error');
  act(() => old.onerror({ message: 'late fatal error' }));
  expect(old.terminate).toHaveBeenCalledTimes(1);
  expect(oldSuccess).not.toHaveBeenCalled(); expect(oldError).not.toHaveBeenCalled();
  expect(success).not.toHaveBeenCalled(); expect(error).not.toHaveBeenCalled();
  reply(workers[1], 'result', -1);
  expect(success).not.toHaveBeenCalled();
  reply(workers[1]); reply(workers[1]); reply(workers[1], 'error');
  expect(success).toHaveBeenCalledTimes(1); expect(error).not.toHaveBeenCalled();
});
test('cancellation and unmount clear callbacks, including captured late native error handlers', () => {
  const { result, unmount } = renderHook(() => useAIWorker());
  const success = jest.fn(), error = jest.fn();
  act(() => result.current.computeMove({}, 1, success, error));
  act(() => result.current.cancelPending());
  reply(workers[0]); reply(workers[0], 'error');
  act(() => result.current.computeMove({}, 1, success, error));
  unmount();
  reply(workers[1]);
  act(() => workers[1].onerror({ message: 'late error' }));
  expect(success).not.toHaveBeenCalled(); expect(error).not.toHaveBeenCalled();
  expect(workers[1].terminate).toHaveBeenCalledTimes(1);
});
test('current request errors settle exactly once and a later request still works', () => {
  const { result } = renderHook(() => useAIWorker());
  const success = jest.fn(), error = jest.fn();
  act(() => result.current.computeMove({}, 1, success, error));
  reply(workers[0], 'error'); reply(workers[0], 'error');
  expect(error).toHaveBeenCalledTimes(1);
  act(() => result.current.computeMove({}, 1, success, error));
  reply(workers[0], 'result', workers[0].postMessage.mock.calls[1][0].requestId);
  expect(success).toHaveBeenCalledTimes(1);
});
test.each(['', '/gipf'])('default model path respects PUBLIC_URL=%s', prefix => {
  const previous = process.env.PUBLIC_URL;
  process.env.PUBLIC_URL = prefix;
  const { result } = renderHook(() => useAIWorker());
  act(() => result.current.computeMove({}, 1, jest.fn(), jest.fn(), 'nn'));
  expect(workers[0].postMessage.mock.calls[0][0].data.modelPath).toBe(`${prefix}/models/yinsh-value-v1.onnx`);
  process.env.PUBLIC_URL = previous;
});
