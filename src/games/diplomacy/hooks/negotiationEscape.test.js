// The human must never be locked out of orders by the AI conferring round:
// proceeding abandons the round (late replies are discarded, nothing settles back
// into 'negotiation'), and a spent time budget ends the round with what it has.

import { renderHook, act } from '@testing-library/react';
import DiplomacyBoard from '../DiplomacyBoard.js';
import useDiplomacyTurn, { NEGOTIATION_BUDGET_MS } from './useDiplomacyTurn.js';

const pending = [];

// A negotiator stand-in that makes one agent call and writes any reply into the
// shared human thread store, like the real orchestrator does.
jest.mock('../agents/negotiator.js', () => ({
  runNegotiationPhase: async ({ state, agents, askAgent }) => {
    const res = await askAgent({ power: 'france' });
    const text = res && res.reply && res.reply.message;
    if (text) agents.humanThreads.threads.france.messages.push({ role: 'assistant', content: text });
    return { state: { ...state, touched: true }, transcripts: {} };
  },
}));

jest.mock('../agents/agentClient.js', () => ({
  askAgent: () => new Promise((resolve) => pending.push(resolve)),
  hasApiKey: () => true,
}));

const CONTROLLERS = {
  austria: 'AI', england: 'human', france: 'AI', germany: 'AI', italy: 'AI', russia: 'AI', turkey: 'AI',
};

function setup() {
  const conversations = { threads: { france: { messages: [] } } };
  const onPhaseSettled = jest.fn();
  const setDiplomaticState = jest.fn();
  const hook = renderHook(() =>
    useDiplomacyTurn({
      board: new DiplomacyBoard(),
      setBoard: jest.fn(),
      controllers: CONTROLLERS,
      humanPower: 'england',
      difficultyBudget: { difficulty: 'normal' },
      diplomaticState: { base: true },
      setDiplomaticState,
      personas: null,
      conversations,
      setConversations: jest.fn(),
      workerSupported: false,
      computeOrders: null,
      onPhaseSettled,
      initialUiPhase: 'negotiation',
    })
  );
  return { hook, conversations, onPhaseSettled, setDiplomaticState };
}

beforeEach(() => {
  pending.length = 0;
  jest.useFakeTimers();
});
afterEach(() => jest.useRealTimers());

test('proceeding mid-round goes to orders and discards the late reply', async () => {
  const { hook, conversations, onPhaseSettled, setDiplomaticState } = setup();

  let round;
  act(() => { round = hook.result.current.runNegotiation(); });
  expect(hook.result.current.isBusy).toBe(true);
  expect(pending).toHaveLength(1);

  act(() => { hook.result.current.proceedToOrders(); });
  expect(hook.result.current.isBusy).toBe(false);
  expect(hook.result.current.uiPhase).toBe('orders');
  expect(onPhaseSettled).toHaveBeenLastCalledWith(expect.objectContaining({ uiPhase: 'orders' }));

  // The abandoned call finally answers.
  await act(async () => { pending[0]({ reply: { message: 'Too late.' } }); await round; });
  expect(conversations.threads.france.messages).toEqual([]);
  expect(setDiplomaticState).not.toHaveBeenCalled();
  expect(onPhaseSettled.mock.calls.every(([arg]) => arg.uiPhase === 'orders')).toBe(true);
  expect(hook.result.current.uiPhase).toBe('orders');
});

test('a spent budget ends the round and ignores the stalled call', async () => {
  const { hook, conversations, onPhaseSettled } = setup();

  let round;
  act(() => { round = hook.result.current.runNegotiation(); });
  await act(async () => { jest.advanceTimersByTime(NEGOTIATION_BUDGET_MS + 1); await round; });

  expect(hook.result.current.isBusy).toBe(false);
  expect(onPhaseSettled).toHaveBeenLastCalledWith(expect.objectContaining({ uiPhase: 'negotiation' }));

  await act(async () => { pending[0]({ reply: { message: 'Late.' } }); });
  expect(conversations.threads.france.messages).toEqual([]);
});
