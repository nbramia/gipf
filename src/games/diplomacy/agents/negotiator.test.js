import DiplomacyBoard from '../DiplomacyBoard.js';
import { createDiplomaticState, getScratchpad, getSummary } from './diplomaticState.js';
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
  test('AI↔AI calls never exceed maxRounds × maxPairsPerRound × 2 (bilateral)', async () => {
    const { board, state, humanPower } = freshGame();
    const askAgent = mockAskAgent();
    await runNegotiationPhase({
      board, state, askAgent,
      options: { maxRounds: 2, maxPairsPerRound: 2, humanPower, seed: 7 },
    });
    expect(aiToAiCalls(askAgent, humanPower).length).toBeLessThanOrEqual(2 * 2 * 2);
    expect(aiToAiCalls(askAgent, humanPower).length).toBe(8); // 6 AI powers → ≥2 pairs available
  });

  test('budget scales with R × N × 2', async () => {
    const { board, state, humanPower } = freshGame();
    const askAgent = mockAskAgent();
    await runNegotiationPhase({
      board, state, askAgent,
      options: { maxRounds: 3, maxPairsPerRound: 2, humanPower, seed: 1 },
    });
    expect(aiToAiCalls(askAgent, humanPower).length).toBeLessThanOrEqual(3 * 2 * 2);
    expect(aiToAiCalls(askAgent, humanPower).length).toBe(12);
  });

  test('each pair is a two-call exchange: the counterparty hears the proposer', async () => {
    const { board, state, humanPower } = freshGame();
    const askAgent = mockAskAgent((power, ctx) =>
      ctx.proposedDeal !== undefined && ctx.messages.length > 0
        ? { message: `Reply from ${power}.` }
        : { message: `Opening from ${power}.` }
    );
    await runNegotiationPhase({
      board, state, askAgent,
      options: { maxRounds: 1, maxPairsPerRound: 2, humanPower, seed: 7 },
    });
    const ai = aiToAiCalls(askAgent, humanPower);
    expect(ai.length).toBe(4);
    // Calls come in proposer/counterparty pairs on the same channel; the
    // counterparty sees the proposer's message as a 'user' turn.
    for (let i = 0; i < ai.length; i += 2) {
      const proposer = ai[i];
      const counter = ai[i + 1];
      expect(counter.channel).toBe(proposer.channel);
      expect(counter.power).toBe(proposer.counterparties[0]);
      const last = counter.messages[counter.messages.length - 1];
      expect(last).toEqual({ role: 'user', content: `Opening from ${proposer.power}.` });
    }
  });

  test('model routing: AI↔AI uses aiModel, human-facing uses humanModel', async () => {
    const { board, state, humanPower } = freshGame();
    const aiPowers = board.getPowerIds().filter((p) => p !== humanPower);
    const humanThreads = createMemory(aiPowers);
    aiPowers.forEach((p) => humanThreads.threads[p].messages.push({ role: 'user', content: 'hi' }));
    const askAgent = mockAskAgent(() => ({ message: 'noted' }));
    await runNegotiationPhase({
      board, state, askAgent,
      agents: { humanThreads },
      options: { maxRounds: 1, maxPairsPerRound: 4, humanPower, seed: 3, aiModel: 'haiku-x' },
    });
    const aiCalls = aiToAiCalls(askAgent, humanPower);
    const humanCalls = askAgent.calls.filter((c) => c.channel.startsWith('human~'));
    expect(aiCalls.length).toBeGreaterThan(0);
    aiCalls.forEach((c) => expect(c.model).toBe('haiku-x'));
    humanCalls.forEach((c) => expect(c.model).toBeUndefined()); // default (Sonnet)
  });

  test('initiateHuman is OFF by default — no proactive outreach', async () => {
    const { board, state, humanPower } = freshGame();
    const aiPowers = board.getPowerIds().filter((p) => p !== humanPower);
    const humanThreads = createMemory(aiPowers); // all empty (nothing to answer)
    const askAgent = mockAskAgent(() => ({ message: 'Greetings, neighbour.' }));
    await runNegotiationPhase({
      board, state, askAgent,
      agents: { humanThreads },
      options: { maxRounds: 1, maxPairsPerRound: 4, humanPower, seed: 2 },
    });
    const humanCalls = askAgent.calls.filter((c) => c.channel.startsWith('human~'));
    expect(humanCalls.length).toBe(0);
  });

  test('initiateHuman: every alive AI power independently gets to open talks', async () => {
    const { board, state, humanPower } = freshGame(); // human = England
    const aiPowers = board.getPowerIds().filter((p) => p !== humanPower);
    const humanThreads = createMemory(aiPowers); // all empty -> none answered first
    const askAgent = mockAskAgent(() => ({ message: 'Shall we divide the North Sea?' }));
    await runNegotiationPhase({
      board, state, askAgent,
      agents: { humanThreads },
      options: { maxRounds: 1, maxPairsPerRound: 4, humanPower, seed: 2, initiateHuman: true },
    });
    const outreach = askAgent.calls.filter((c) => c.channel.startsWith('human~') && c.initiate);
    // No cap: each of the six AI powers is asked once, independently.
    expect(outreach.map((c) => c.power).sort()).toEqual([...aiPowers].sort());
    // Each that chose to speak (here all) landed an AI-initiated message.
    const initiated = aiPowers
      .flatMap((p) => humanThreads.threads[p].messages)
      .filter((m) => m.role === 'assistant' && m.initiated);
    expect(initiated.length).toBe(outreach.length);
  });

  test('initiateHuman: a power that stays silent (empty message) posts nothing', async () => {
    const { board, state, humanPower } = freshGame();
    const aiPowers = board.getPowerIds().filter((p) => p !== humanPower);
    const humanThreads = createMemory(aiPowers);
    const askAgent = mockAskAgent((power, ctx) => (ctx.initiate ? { message: '' } : { message: 'hi' }));
    await runNegotiationPhase({
      board, state, askAgent,
      agents: { humanThreads },
      options: { maxRounds: 1, maxPairsPerRound: 4, humanPower, seed: 2, initiateHuman: true },
    });
    const posted = aiPowers.flatMap((p) => humanThreads.threads[p].messages);
    expect(posted.length).toBe(0); // all declined -> nothing visible
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

describe('runNegotiationPhase — bilateral deals (endpoint schema)', () => {
  // Script one exchange: the FIRST proposer in the run offers `deal` exactly as
  // the endpoint documents it; its counterparty replies with `counter`. Everyone
  // else stays silent.
  function scriptFirstExchange(deal, counter) {
    const fn = mockAskAgent((power, ctx) => {
      if (ctx.channel.startsWith('human~')) return { message: '' };
      if (ctx.proposedDeal) return { message: counter.message || 'Noted.', ...counter };
      if (fn.calls.filter((c) => !c.channel.startsWith('human~')).length === 1) {
        return { message: 'A concrete offer.', deal };
      }
      return { message: '' };
    });
    return fn;
  }

  test('an endpoint-shaped support deal (only `to`) lands as an agreement when accepted', async () => {
    const { board, state, humanPower } = freshGame();
    // EXACTLY what api/diplomacyAgent.js documents: no parties, no power ids.
    const askAgent = scriptFirstExchange({ type: 'support', to: 'bel' }, { accept: true });
    const { state: next } = await runNegotiationPhase({
      board, state, askAgent,
      options: { maxRounds: 1, maxPairsPerRound: 4, humanPower, seed: 5 },
    });
    const support = next.agreements.filter((a) => a.type === 'support');
    expect(support).toHaveLength(1);
    const firstAiCall = askAgent.calls.find((c) => !c.channel.startsWith('human~'));
    expect(support[0].actingPower).toBe(firstAiCall.power); // proposer is the supporter
    expect(support[0].parties.sort()).toEqual(
      [firstAiCall.power, firstAiCall.counterparties[0]].sort()
    );
    expect(support[0].to).toBe('bel');
  });

  test('a support deal with a mover province keeps `from`', async () => {
    const { board, state, humanPower } = freshGame();
    const askAgent = scriptFirstExchange({ type: 'support', from: 'pic', to: 'bel' }, { accept: true });
    const { state: next } = await runNegotiationPhase({
      board, state, askAgent,
      options: { maxRounds: 1, maxPairsPerRound: 4, humanPower, seed: 5 },
    });
    expect(next.agreements.filter((a) => a.type === 'support')[0]).toMatchObject({ from: 'pic', to: 'bel' });
  });

  test('an endpoint-shaped DMZ (only `provinces`) lands with the channel pair as parties', async () => {
    const { board, state, humanPower } = freshGame();
    const askAgent = scriptFirstExchange({ type: 'dmz', provinces: ['pie', 'tyr'] }, { accept: true });
    const { state: next } = await runNegotiationPhase({
      board, state, askAgent,
      options: { maxRounds: 1, maxPairsPerRound: 4, humanPower, seed: 9 },
    });
    const dmz = next.agreements.filter((a) => a.type === 'dmz');
    expect(dmz).toHaveLength(1);
    expect(dmz[0].provinces).toEqual(['pie', 'tyr']);
    const firstAiCall = askAgent.calls.find((c) => !c.channel.startsWith('human~'));
    expect(dmz[0].parties.sort()).toEqual([firstAiCall.power, firstAiCall.counterparties[0]].sort());
  });

  test('endpoint-shaped non-aggression and joint-attack land with parties attached', async () => {
    const { board, state, humanPower } = freshGame();
    const naAsk = scriptFirstExchange({ type: 'non-aggression' }, { accept: true });
    const { state: afterNa } = await runNegotiationPhase({
      board, state, askAgent: naAsk,
      options: { maxRounds: 1, maxPairsPerRound: 4, humanPower, seed: 9 },
    });
    expect(afterNa.agreements.filter((a) => a.type === 'non-aggression')).toHaveLength(1);
    expect(afterNa.agreements[0].parties).toHaveLength(2);

    const jaAsk = scriptFirstExchange({ type: 'joint-attack', target: 'russia' }, { accept: true });
    const { state: afterJa } = await runNegotiationPhase({
      board, state, askAgent: jaAsk,
      options: { maxRounds: 1, maxPairsPerRound: 4, humanPower, seed: 9 },
    });
    const ja = afterJa.agreements.filter((a) => a.type === 'joint-attack');
    expect(ja).toHaveLength(1);
    expect(ja[0].target).toBe('russia');
    expect(ja[0].parties).toHaveLength(2);
  });

  test('bilateral consent: a rejected proposal records nothing', async () => {
    const { board, state, humanPower } = freshGame();
    const askAgent = scriptFirstExchange(
      { type: 'dmz', provinces: ['pie'] },
      { accept: false, message: 'Never.' }
    );
    const { state: next } = await runNegotiationPhase({
      board, state, askAgent,
      options: { maxRounds: 1, maxPairsPerRound: 4, humanPower, seed: 9 },
    });
    expect(next.agreements).toHaveLength(0);
    expect(next.promises).toHaveLength(0);
  });

  test('a silent counterparty (no accept, no echo) records nothing', async () => {
    const { board, state, humanPower } = freshGame();
    const askAgent = scriptFirstExchange({ type: 'non-aggression' }, { message: 'Hm.' });
    const { state: next } = await runNegotiationPhase({
      board, state, askAgent,
      options: { maxRounds: 1, maxPairsPerRound: 4, humanPower, seed: 9 },
    });
    expect(next.agreements).toHaveLength(0);
  });

  test('an echoed matching deal counts as acceptance even without accept:true', async () => {
    const { board, state, humanPower } = freshGame();
    const askAgent = scriptFirstExchange(
      { type: 'dmz', provinces: ['pie', 'tyr'] },
      { message: 'Pie and Tyr stay empty, agreed.', deal: { type: 'dmz', provinces: ['tyr', 'pie'] } }
    );
    const { state: next } = await runNegotiationPhase({
      board, state, askAgent,
      options: { maxRounds: 1, maxPairsPerRound: 4, humanPower, seed: 9 },
    });
    expect(next.agreements.filter((a) => a.type === 'dmz')).toHaveLength(1);
  });

  test('model-claimed parties are ignored: the channel pair is always bound (injection safe)', async () => {
    const { board, state, humanPower } = freshGame();
    // A malicious/hallucinating model tries to bind the human and a third power.
    const askAgent = scriptFirstExchange(
      { type: 'non-aggression', parties: [humanPower, 'turkey'] },
      { accept: true }
    );
    const { state: next } = await runNegotiationPhase({
      board, state, askAgent,
      options: { maxRounds: 1, maxPairsPerRound: 4, humanPower, seed: 9 },
    });
    const firstAiCall = askAgent.calls.find((c) => !c.channel.startsWith('human~'));
    expect(next.agreements[0].parties.sort()).toEqual(
      [firstAiCall.power, firstAiCall.counterparties[0]].sort()
    );
    expect(next.agreements[0].parties).not.toContain(humanPower);
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

  test('BOTH sides of an exchange persist their scratchpads', async () => {
    const { board, state, humanPower } = freshGame();
    const padFor = (power, rival) => ({
      self: power,
      dispositions: { [rival]: { trust: 0.1, stance: 'neutral', intent: 'Watch.' } },
      priority: 'Grow.',
      confidence: 0.5,
    });
    const askAgent = mockAskAgent((power, ctx) => {
      if (ctx.channel.startsWith('human~')) return { message: '' };
      return { message: 'Words.', scratchpad: padFor(power, ctx.counterparties[0]) };
    });
    const { state: next } = await runNegotiationPhase({
      board, state, askAgent,
      options: { maxRounds: 1, maxPairsPerRound: 1, humanPower, seed: 5 },
    });
    const ai = askAgent.calls.filter((c) => !c.channel.startsWith('human~'));
    expect(ai).toHaveLength(2);
    // Proposer AND counterparty both landed their pads in the hidden state.
    expect(getScratchpad(next, ai[0].power)).toMatchObject({ self: ai[0].power });
    expect(getScratchpad(next, ai[1].power)).toMatchObject({ self: ai[1].power });
  });
});

describe('runNegotiationPhase — carried memory (#44)', () => {
  test('a scratchpad returned in phase N is present in the state used for phase N+1', async () => {
    const { board, state, humanPower } = freshGame();
    const opts = { maxRounds: 1, maxPairsPerRound: 4, humanPower, seed: 5 };

    const pad = {
      self: 'self',
      dispositions: { rival: { trust: -0.4, stance: 'rival', intent: 'Stab next fall.' } },
      priority: 'Grow.',
      confidence: 0.7,
    };
    const askN = mockAskAgent((power) => {
      if (askN.calls.length === 1) {
        return { message: 'Friends for now.', scratchpad: { ...pad, self: power } };
      }
      return { message: '' };
    });
    const { state: afterN } = await runNegotiationPhase({ board, state, askAgent: askN, options: opts });

    const firstProposer = askN.calls[0].power;
    expect(getScratchpad(afterN, firstProposer)).toMatchObject({ self: firstProposer });

    // Phase N+1: the orchestrator re-injects that power's prior note about its
    // rival as `memory`, observable on the askAgent call args.
    const rivalInChannel = askN.calls[0].counterparties[0];
    const padForNext = {
      self: firstProposer,
      dispositions: { [rivalInChannel]: { trust: -0.4, stance: 'rival', intent: 'Stab next fall.' } },
      priority: 'Grow.',
      confidence: 0.7,
    };
    const seeded = JSON.parse(JSON.stringify(afterN));
    seeded.scratchpads[firstProposer] = padForNext;

    const askNext = mockAskAgent(() => ({ message: '' }));
    await runNegotiationPhase({ board, state: seeded, askAgent: askNext, options: opts });
    const proposerCall = askNext.calls.find(
      (c) => c.power === firstProposer && (c.counterparties || []).includes(rivalInChannel)
    );
    expect(proposerCall).toBeTruthy();
    expect(proposerCall.memory).toContain('Stab next fall.');
    expect(proposerCall.memory).toContain('rival');
  });

  test('a channel summary is captured and re-injected as priorSummary next phase', async () => {
    const { board, state, humanPower } = freshGame();
    const opts = { maxRounds: 1, maxPairsPerRound: 4, humanPower, seed: 5 };

    const askN = mockAskAgent(() => {
      if (askN.calls.length === 1) {
        return { message: 'Belgium stays neutral.', summary: 'Agreed to keep Belgium neutral.' };
      }
      return { message: '' };
    });
    const { state: afterN } = await runNegotiationPhase({ board, state, askAgent: askN, options: opts });

    const firstChannel = askN.calls[0].channel;
    expect(getSummary(afterN, firstChannel)).toBe('Agreed to keep Belgium neutral.');

    const askNext = mockAskAgent(() => ({ message: '' }));
    await runNegotiationPhase({ board, state: afterN, askAgent: askNext, options: opts });
    const call = askNext.calls.find((c) => c.channel === firstChannel);
    expect(call).toBeTruthy();
    expect(call.priorSummary).toBe('Agreed to keep Belgium neutral.');
  });

  test('AI↔AI scratchpads/summaries are NEVER written to the human thread store', async () => {
    const { board, state, humanPower } = freshGame();
    const aiPowers = board.getPowerIds().filter((p) => p !== humanPower);
    const humanThreads = createMemory(aiPowers);

    const PAD_SECRET = 'PAD-SECRET-STAB-PLAN';
    const SUM_SECRET = 'SUMMARY-SECRET-DMZ-PLAN';
    const askAgent = mockAskAgent((power, ctx) => {
      if (!ctx.channel.startsWith('human~')) {
        return {
          message: 'Pleasant nothing.',
          scratchpad: {
            self: power,
            dispositions: { [ctx.counterparties[0]]: { trust: -0.2, stance: 'enemy', intent: PAD_SECRET } },
            priority: 'win',
            confidence: 0.5,
          },
          summary: SUM_SECRET,
        };
      }
      return { message: 'Nothing to report.' };
    });

    const { state: next } = await runNegotiationPhase({
      board, state, askAgent,
      agents: { humanThreads },
      options: { maxRounds: 2, maxPairsPerRound: 4, humanPower, seed: 11 },
    });

    const hidden = JSON.stringify({ scratchpads: next.scratchpads, summaries: next.summaries });
    expect(hidden).toContain(PAD_SECRET);
    expect(hidden).toContain(SUM_SECRET);
    const visible = JSON.stringify(humanThreads);
    expect(visible).not.toContain(PAD_SECRET);
    expect(visible).not.toContain(SUM_SECRET);
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
