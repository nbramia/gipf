import RicochetBoard from '../RicochetBoard.js';
import { chooseNextRound } from './rounds.js';
import './solver.worker.js';

jest.mock('./rounds.js', () => ({ chooseNextRound: jest.fn() }));

const post = (data) => globalThis.onmessage({
  data: { type: 'next', requestId: 7, data: { boardState: new RicochetBoard({ seed: 1 }).serializeState(), desiredLength: 4, ...data } },
});

beforeEach(() => {
  chooseNextRound.mockReturnValue({ needsNewBoard: true });
  globalThis.postMessage = jest.fn();
});

test('each target gets a short solve limit so a slow device cannot stall dealing', () => {
  post({});
  expect(chooseNextRound).toHaveBeenCalledTimes(1);
  const [, desired, options] = chooseNextRound.mock.calls[0];
  expect(desired).toBe(4);
  expect(options.timeLimitMs).toBe(400);
  expect(globalThis.postMessage).toHaveBeenCalledWith({ type: 'result', requestId: 7, data: { round: { needsNewBoard: true } } });
});

test('an explicit limit still wins', () => {
  post({ timeLimitMs: 50 });
  expect(chooseNextRound.mock.calls[0][2].timeLimitMs).toBe(50);
});
