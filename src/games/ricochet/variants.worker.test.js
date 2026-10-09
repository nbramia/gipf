// The real solver.worker.js message handler (rounds.js not mocked) deals rounds
// for every config from serialized state, exactly as chooseNextRound does.

import RicochetBoard from './RicochetBoard.js';
import { chooseNextRound } from './engine/rounds.js';
import { CONFIGS, configKey } from './engine/config.js';
import './engine/solver.worker.js';

describe.each(CONFIGS.map(c => [configKey(c), c]))('worker, config %s', (_name, config) => {
  test('replies with the round chooseNextRound deals for the same state', () => {
    const board = new RicochetBoard({ seed: 8, config });
    const posted = [];
    globalThis.postMessage = msg => posted.push(msg);
    globalThis.onmessage({
      data: { type: 'next', requestId: 3, data: { boardState: board.serializeState(), desiredLength: 3, timeLimitMs: 2000 } },
    });
    expect(posted).toHaveLength(1);
    expect(posted[0].type).toBe('result');
    expect(posted[0].requestId).toBe(3);
    const expected = chooseNextRound(RicochetBoard.fromSerializedState(board.serializeState()), 3, { timeLimitMs: 2000 });
    expect(posted[0].data.round).toEqual(expected);
    // and the dealt solution is playable on this variant
    const b = board.clone();
    b.startRound(expected.targetId);
    for (const m of expected.solution) expect(b.applyMove(m)).toBeTruthy();
    expect(b.isSolved()).toBe(true);
  });
});
