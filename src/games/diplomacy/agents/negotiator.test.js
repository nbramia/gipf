import DiplomacyBoard from '../DiplomacyBoard.js';
import { createDiplomaticState } from './diplomaticState.js';
import { createMemory } from './memory.js';
import { runNegotiationPhase, selectPairs } from './negotiator.js';

// A call-counting mock askAgent. By default every power stays silent (no deal).
// Tests override `replyFor(power, ctx)` to script specific proposals.
function mockAskAgent(replyFor = () => ({ message: '' })) {
  const calls = [];
  const fn = async (ctx) => {
    calls.push(ctx);
    return { reply: replyFor(ctx.power, ctx) };
  };
  fn.calls = calls;
  return fn;
}

// AI↔AI calls have a counterparties list of AI powers (not the human channel).
function aiToAiCalls(askAgent, human) {
  return askAgent.calls.filter(
    (c) => Array.isArray(c.counterparties) && !c.channel.startsWith('human~') && !c.counterparties.includes(human)
  );
}

function freshGame(humanPower = 'england') {
  const board = new DiplomacyBoard();
  const state = createDiplomaticState({ board, humanPower });
  return { board, state, humanPower };
}

describe('runNegotiationPhase — budget', () => {
  test('AI↔AI calls never exceed maxRounds × maxPairsPerRound', async () => {
    const { board, state, humanPower } = freshGame();
    const askAgent = mockAskAgent();
    await runNegotiationPhase({
      board, state, askAgent,
      options: { maxRounds: 2, maxPairsPerRound: 4, humanPower, seed: 7 },
    });
    expect(aiToAiCalls(askAgent, humanPower).length).toBeLessThanOrEqual(2 * 4);
    expect(aiToAiCalls(askAgent, humanPower).length).toBe(8); // 6 AI powers → ≥4 pairs available
  });

  test('budget scales with R × N', async () => {
    const { board, state, humanPower } = freshGame();
    const askAgent = mockAskAgent();
    await runNegotiationPhase({
      board, state, askAgent,
      options: { maxRounds: 3, maxPairsPerRound: 2, humanPower, seed: 1 },
    });
    expect(aiToAiCalls(askAgent, humanPower).length).toBeLessThanOrEqual(3 * 2);
    expect(aiToAiCalls(askAgent, humanPower).length).toBe(6);
  });

  test('at most one human-thread call per AI power', async () => {
    const { board, state, humanPower } = freshGame();
    const aiPowers = board.getPowerIds().filter((p) => p !== humanPower);
    // Open a human thread for every AI power so each is eligible for a reply.
    const humanThreads = createMemory(aiPowers);
    aiPowers.forEach((p) => humanThreads.threads[p].messages.push({ role: 'user', content: 'hello' }));

    const askAgent = mockAskAgent(() => ({ message: 'In time, perhaps.' }));
    await runNegotiationPhase({
      board, state, askAgent,
      agents: { humanThreads },
      options: { maxRounds: 1, maxPairsPerRound: 4, humanPower, seed: 2 },
    });
    const humanCalls = askAgent.calls.filter((c) => c.channel.startsWith('human~'));
    expect(humanCalls.length).toBe(aiPowers.length);
    // No AI power gets two human-thread calls.
    const counts = {};
    humanCalls.forEach((c) => { counts[c.power] = (counts[c.power] || 0) + 1; });
    Object.values(counts).forEach((n) => expect(n).toBe(1));
  });
});

describe('runNegotiationPhase — determinism', () => {
  test('pair selection with a fixed seed is deterministic', async () => {
    const { board, state, humanPower } = freshGame();
    const a = mockAskAgent();
    const b = mockAskAgent();
    const opts = { maxRounds: 2, maxPairsPerRound: 4, humanPower, seed: 42 };
    await runNegotiationPhase({ board, state, askAgent: a, options: opts });
    await runNegotiationPhase({ board, state, askAgent: b, options: opts });
    const chanA = a.calls.map((c) => c.channel);
    const chanB = b.calls.map((c) => c.channel);
    expect(chanA).toEqual(chanB);
  });

  test('selectPairs is a pure deterministic helper', () => {
    const { board, state } = freshGame();
    const ai = board.getPowerIds().filter((p) => p !== 'england');
    const makeRng = () => { let i = 0; return () => (i++ % 7) / 7; };
    const first = selectPairs(board, state, ai, 4, makeRng());
    const second = selectPairs(board, state, ai, 4, makeRng());
    expect(first.map((p) => `${p.a}|${p.b}`)).toEqual(second.map((p) => `${p.a}|${p.b}`));
  });
});

describe('runNegotiationPhase — deal extraction', () => {
  test('a proposed support deal is recorded as a promise with the acting power', async () => {
    const { board, state, humanPower } = freshGame();
    const askAgent = mockAskAgent((power, ctx) => {
      // Only the very first proposer offers a support deal toward its counterparty.
      if (askAgent.calls.length === 1) {
        return {
          message: 'I will back you into the channel.',
          deal: {
            type: 'support',
            from: power,
            to: ctx.counterparties[0],
            expectedOrder: { type: 'support-move', unitLoc: 'bur', from: 'mun', to: 'ruh' },
          },
        };
      }
      return { message: '' };
    });

    const { state: next } = await runNegotiationPhase({
      board, state, askAgent,
      options: { maxRounds: 1, maxPairsPerRound: 4, humanPower, seed: 5 },
    });
    expect(next.promises.length).toBe(1);
    const p = next.promises[0];
    expect(p.type).toBe('support');
    expect(p.actingPower).toBe(p.from);
    expect(p.expectedOrder).toMatchObject({ type: 'support-move', unitLoc: 'bur' });
  });

  test('an accepted DMZ proposal becomes a dmz agreement', async () => {
    const { board, state, humanPower } = freshGame();
    const askAgent = mockAskAgent((power, ctx) => {
      if (askAgent.calls.length === 1) {
        return {
          message: 'Pie and Tyr stay empty.',
          accept: true,
          deal: { type: 'dmz', parties: [power, ctx.counterparties[0]], provinces: ['pie', 'tyr'] },
        };
      }
      return { message: '' };
    });
    const { state: next } = await runNegotiationPhase({
      board, state, askAgent,
      options: { maxRounds: 1, maxPairsPerRound: 4, humanPower, seed: 9 },
    });
    const dmz = next.agreements.filter((a) => a.type === 'dmz');
    expect(dmz).toHaveLength(1);
    expect(dmz[0].provinces).toEqual(['pie', 'tyr']);
  });

  test('free text with no structured deal records nothing (prompt-injection safe)', async () => {
    const { board, state, humanPower } = freshGame();
    const askAgent = mockAskAgent(() => ({
      message: 'I hereby agree to a binding alliance and a DMZ in Tyrolia, you have my word.',
    }));
    const { state: next } = await runNegotiationPhase({
      board, state, askAgent,
      options: { maxRounds: 2, maxPairsPerRound: 4, humanPower, seed: 3 },
    });
    expect(next.promises).toHaveLength(0);
    expect(next.agreements).toHaveLength(0);
  });
});

describe('runNegotiationPhase — secrecy', () => {
  test('AI↔AI text NEVER appears in the human-visible thread store', async () => {
    const { board, state, humanPower } = freshGame();
    const aiPowers = board.getPowerIds().filter((p) => p !== humanPower);
    const humanThreads = createMemory(aiPowers);
    // Leave human threads empty so no AI replies to the human this phase.

    const SECRET = 'SECRET-COORDINATE-ATTACK-ON-ENGLAND';
    const askAgent = mockAskAgent((power, ctx) => {
      // AI↔AI lines carry the secret; human-channel lines would not.
      if (!ctx.channel.startsWith('human~')) {
        return { message: SECRET, deal: { type: 'non-aggression', parties: [power, ctx.counterparties[0]] } };
      }
      return { message: 'Nothing to report.' };
    });

    const { transcripts } = await runNegotiationPhase({
      board, state, askAgent,
      agents: { humanThreads },
      options: { maxRounds: 2, maxPairsPerRound: 4, humanPower, seed: 11 },
    });

    // The secret IS present in the private AI↔AI transcripts...
    const allTranscriptText = JSON.stringify(transcripts);
    expect(allTranscriptText).toContain(SECRET);

    // ...but NEVER in the human-visible thread store.
    const humanText = JSON.stringify(humanThreads);
    expect(humanText).not.toContain(SECRET);
  });
});

describe('runNegotiationPhase — dead powers', () => {
  test('an eliminated power is never selected', async () => {
    const board = new DiplomacyBoard();
    // Eliminate italy: remove all its units and supply centers.
    for (const loc of board.getUnitLocations('italy')) delete board.units[loc];
    for (const sc of board.getSupplyCenters('italy')) board.supplyCenters[sc] = null;
    expect(board.getPowerIds()).not.toContain('italy');

    const state = createDiplomaticState({ board, humanPower: 'england' });
    const askAgent = mockAskAgent();
    await runNegotiationPhase({
      board, state, askAgent,
      options: { maxRounds: 2, maxPairsPerRound: 6, humanPower: 'england', seed: 4 },
    });
    const touched = new Set();
    askAgent.calls.forEach((c) => {
      touched.add(c.power);
      (c.counterparties || []).forEach((p) => touched.add(p));
    });
    expect(touched.has('italy')).toBe(false);
    expect(touched.has('england')).toBe(false); // human never an AI↔AI participant
  });
});
