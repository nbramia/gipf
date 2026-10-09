import { renderHook, act } from '@testing-library/react';
import useSolverWorker from './useSolverWorker';
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
const idOf = (worker) => worker.postMessage.mock.calls.slice(-1)[0][0].requestId;
const reply = (worker, requestId, type = 'result') => act(() => {
  worker.onmessage({ data: { type, requestId, data: { round: { targetId: 1 } }, error: 'boom' } });
});

test('a late reply through an abandoned worker is ignored, even with a matching id', () => {
  const { result } = renderHook(() => useSolverWorker());
  const first = jest.fn(); const firstErr = jest.fn(); const second = jest.fn(); const secondErr = jest.fn();
  act(() => result.current.requestRound({}, 3, first, firstErr));
  const abandoned = workers[0];
  const firstId = idOf(abandoned);
  act(() => result.current.requestRound({}, 3, second, secondErr));
  expect(abandoned.terminate).toHaveBeenCalledTimes(1);
  const current = workers[workers.length - 1];
  expect(current).not.toBe(abandoned);

  reply(abandoned, firstId);
  reply(abandoned, idOf(current));
  reply(abandoned, firstId, 'error');
  act(() => abandoned.onerror({ message: 'late' }));
  expect(first).not.toHaveBeenCalled();
  expect(firstErr).not.toHaveBeenCalled();
  expect(second).not.toHaveBeenCalled();
  expect(secondErr).not.toHaveBeenCalled();

  reply(current, idOf(current));
  reply(current, idOf(current));
  expect(second).toHaveBeenCalledTimes(1);
  expect(second).toHaveBeenCalledWith({ targetId: 1 });
});

test('a reply after unmount is dropped', () => {
  const { result, unmount } = renderHook(() => useSolverWorker());
  const ok = jest.fn(); const err = jest.fn();
  act(() => result.current.requestRound({}, 3, ok, err));
  const worker = workers[0];
  const id = idOf(worker);
  unmount();
  expect(worker.terminate).toHaveBeenCalled();
  reply(worker, id);
  expect(ok).not.toHaveBeenCalled();
  expect(err).not.toHaveBeenCalled();
});
