// Negotiation orchestrator for the Diplomacy agents (PR2 of [AI Negotiation]).
//
// Each negotiation phase, this runs a bounded number of PRIVATE pairwise
// conversations among the AI powers (and conducts each AI's side of its thread
// with the human), extracts any concrete deals into the diplomatic state, and
// returns the AI↔AI transcripts keyed by channel — SEPARATE from the
// human-visible thread store, which it never touches with AI↔AI text.
//
// Runs client-side, off the render path (it is async and pure of React). The LLM
// call is injected as `askAgent` so tests can mock it (no real key in CI); in the
// app this is the reused agent endpoint via agentClient.js. Pair selection is
// deterministic given a seed, and the number of AI↔AI calls is hard-capped at
// maxRounds × maxPairsPerRound × 2 (each pair is a bilateral two-call exchange:
// proposer, then counterparty — a deal binds only on the counterparty's consent).

import {
  POWERS,
  PROVINCES,
  ARMY_ADJACENCY,
  FLEET_ADJACENCY,
  baseProvince,
} from '../DiplomacyBoard.js';
import {
  recordAgreement,
  getTrust,
  setScratchpad,
  setSummary,
  getScratchpad,
  getSummary,
} from './diplomaticState.js';

// --- deterministic RNG (mulberry32) -----------------------------------------
// Seeded so pair selection / tie-breaking is reproducible across runs.
function makeRng(seed) {
  let a = (typeof seed === 'number' ? seed : hashString(String(seed ?? 0))) >>> 0;
  return function rng() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hashString(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

// --- geography --------------------------------------------------------------

// Base provinces a power's units occupy this turn.
function occupiedBases(board, power) {
  const set = new Set();
  for (const { loc } of board.getUnits(power)) set.add(baseProvince(loc));
  return set;
}

// All base provinces reachable in one step from `base` by either unit type.
function neighborsOf(base) {
  const out = new Set();
  for (const adj of ARMY_ADJACENCY[base] || []) out.add(baseProvince(adj));
  for (const adj of FLEET_ADJACENCY[base] || []) out.add(baseProvince(adj));
  return out;
}

// True if two powers are geographic neighbors: a province one occupies is
// adjacent to (or shared with) a province the other occupies.
function areNeighbors(board, a, b) {
  const aBases = occupiedBases(board, a);
  const bBases = occupiedBases(board, b);
  for (const base of aBases) {
    if (bBases.has(base)) return true;
    for (const n of neighborsOf(base)) if (bBases.has(n)) return true;
  }
  return false;
}

// Contested supply centers near a pair (centers either could press): a province
// that is a supply center and adjacent to BOTH powers' footprints.
function contestedCentersBetween(board, a, b) {
  const aReach = reach(board, a);
  const bReach = reach(board, b);
  let count = 0;
  for (const base of aReach) {
    if (PROVINCES[base]?.supply && bReach.has(base)) count++;
  }
  return count;
}

function reach(board, power) {
  const out = new Set();
  for (const base of occupiedBases(board, power)) {
    out.add(base);
    for (const n of neighborsOf(base)) out.add(n);
  }
  return out;
}

// --- pair selection ---------------------------------------------------------

// Score a candidate AI↔AI pair. Higher = more worth talking. Priorities:
//   (a) geographic neighbors, (b) high tension (low trust + contested centers),
//   (c) allies maintaining deals (some positive trust). Deterministic.
function scorePair(board, state, a, b) {
  let score = 0;
  if (areNeighbors(board, a, b)) score += 100;
  const contested = contestedCentersBetween(board, a, b);
  score += contested * 25;
  const trustAB = getTrust(state, a, b);
  const trustBA = getTrust(state, b, a);
  const avgTrust = (trustAB + trustBA) / 2;
  // Low trust between neighbors = high tension worth negotiating.
  score += (1 - avgTrust) * 30;
  // Allies with standing deals get a smaller maintenance bump.
  const hasDeal = state.agreements.some(
    (ag) => agreementBetween(ag, a, b)
  );
  if (hasDeal && avgTrust > 0) score += 20;
  return score;
}

function agreementBetween(agreement, a, b) {
  if (Array.isArray(agreement.parties)) {
    return agreement.parties.includes(a) && agreement.parties.includes(b);
  }
  return (
    (agreement.from === a && agreement.to === b) ||
    (agreement.from === b && agreement.to === a)
  );
}

// Pick up to `limit` distinct AI↔AI pairs, highest score first, deterministic
// given the seed (rng only breaks exact ties). Dead powers excluded by caller.
function selectPairs(board, state, aiPowers, limit, rng) {
  const pairs = [];
  for (let i = 0; i < aiPowers.length; i++) {
    for (let j = i + 1; j < aiPowers.length; j++) {
      const a = aiPowers[i];
      const b = aiPowers[j];
      pairs.push({ a, b, score: scorePair(board, state, a, b), jitter: rng() });
    }
  }
  pairs.sort((x, y) => y.score - x.score || x.jitter - y.jitter || keyOf(x).localeCompare(keyOf(y)));
  return pairs.slice(0, limit);
}

function keyOf(pair) {
  return `${pair.a}|${pair.b}`;
}

// --- deal extraction --------------------------------------------------------

// Parse a structured deal proposal from an agent reply. Only a constrained,
// explicit `deal` field is honored — free text never auto-creates an agreement
// (prompt-injection mitigation). Returns the raw deal or null; normalization
// (party binding) happens at the RECORDING site so a model can never bind
// powers outside its own channel.
//
// Deal shapes as the endpoint (api/diplomacyAgent.js) documents them:
//   { type:'support', from?, to }        from/to are PROVINCES (mover, target)
//   { type:'dmz', provinces:[...] }
//   { type:'non-aggression' }
//   { type:'joint-attack', target }      target is a power id
function extractDeal(reply) {
  if (!reply || typeof reply !== 'object') return null;
  const deal = reply.deal;
  if (!deal || typeof deal !== 'object' || Array.isArray(deal)) return null;
  if (typeof deal.type !== 'string') return null;
  return deal;
}

// Record a counterparty-accepted deal, normalized against the channel context:
// parties are ALWAYS the two channel powers (whatever the model claimed), and a
// support deal is recorded as an agreement whose actingPower is the PROPOSER
// (the power that verbally committed to issue the support). `from` — the
// supported mover's province — is kept when the model supplied it; otherwise
// decideStrategicIntent resolves the mover from the live board at intent time.
// Ids are stable per channel+type so a renegotiated deal replaces its
// predecessor instead of accumulating (mirrors foldDealIntoState).
function recordDeal(state, deal, { proposer, counterparty, channel, phase }) {
  const parties = [proposer, counterparty];
  const id = `ai-${channel}-${deal.type}`;
  if (deal.type === 'support') {
    if (!deal.to) return state;
    return recordAgreement(state, {
      id,
      type: 'support',
      parties,
      actingPower: proposer,
      from: typeof deal.from === 'string' ? deal.from : null,
      to: deal.to,
      phase,
    });
  }
  if (deal.type === 'dmz') {
    if (!Array.isArray(deal.provinces) || deal.provinces.length === 0) return state;
    return recordAgreement(state, { id, type: 'dmz', parties, provinces: deal.provinces, phase });
  }
  if (deal.type === 'non-aggression') {
    return recordAgreement(state, { id, type: 'non-aggression', parties, phase });
  }
  if (deal.type === 'joint-attack') {
    if (!deal.target) return state;
    return recordAgreement(state, { id, type: 'joint-attack', parties, target: deal.target, phase });
  }
  return state;
}

// True when two extracted deals are the same arrangement (an echo), so a
// counterparty that restates the proposal in its own `deal` field has accepted
// it even if it forgot the explicit accept flag.
function dealsMatch(a, b) {
  if (!a || !b || a.type !== b.type) return false;
  if (a.type === 'support') {
    return String(a.to).toLowerCase() === String(b.to).toLowerCase();
  }
  if (a.type === 'dmz') {
    const norm = (d) => (Array.isArray(d.provinces) ? d.provinces.map((p) => String(p).toLowerCase()).sort().join(',') : '');
    return norm(a) === norm(b);
  }
  if (a.type === 'joint-attack') return a.target === b.target;
  return a.type === 'non-aggression';
}

// Bilateral consent: the COUNTERPARTY's reply must accept the proposal for it to
// bind — an explicit accept:true, or an echo of the same deal (absent an
// explicit rejection). Silence, a rejection, or an unrelated counter-proposal
// records nothing.
function counterpartyAccepts(reply, proposedDeal) {
  if (!reply || typeof reply !== 'object') return false;
  if (reply.accept === false) return false;
  if (reply.accept === true) return true;
  return dealsMatch(extractDeal(reply), proposedDeal);
}

// --- channel ids ------------------------------------------------------------

// Stable channel id for an AI↔AI pair (sorted so it's order-independent).
function channelId(a, b) {
  return [a, b].sort().join('~');
}

// --- prior-memory injection (#44) -------------------------------------------

// Render a power's persisted disposition toward one rival into a short private
// note line (for re-injection as `memory`). Empty string when nothing is known.
function priorNoteFor(state, power, rival) {
  const scratchpad = getScratchpad(state, power);
  if (!scratchpad || !scratchpad.dispositions) return '';
  const d = scratchpad.dispositions[rival];
  if (!d || typeof d !== 'object') return '';
  const parts = [];
  if (d.stance) parts.push(`stance ${d.stance}`);
  if (typeof d.trust === 'number') parts.push(`trust ${d.trust.toFixed(2)}`);
  if (d.intent) parts.push(`intent: ${d.intent}`);
  if (d.note) parts.push(`note: ${d.note}`);
  return parts.join('; ');
}

// --- orchestrator -----------------------------------------------------------

const DEFAULT_OPTIONS = {
  maxRounds: 2,
  // Each pair is a TWO-call bilateral exchange (proposer + counterparty), so the
  // default pair count is half the old monologue default — same total budget.
  maxPairsPerRound: 2,
  humanPower: null,
  seed: 0,
  // Proactive AI->human outreach (off by default so unit tests / headless runs
  // keep the reply-only behaviour). The app turns it on for the live turn loop.
  // Proactive AI->human outreach: when on, EVERY alive AI power (without a
  // pending human message to answer) independently decides whether it has
  // something to discuss with the human and either opens talks or stays silent
  // (an empty reply). No client-side cap or relevance filter — the agent judges.
  initiateHuman: false,
  // Per-call model routing. The hidden AI↔AI rounds (the bulk of the calls) can
  // run on a cheaper model; human-facing replies/outreach stay on the default.
  // null => the endpoint's default model.
  aiModel: null,
  humanModel: null,
};

// runNegotiationPhase({ board, state, agents, askAgent, options }) -> { state, transcripts }
//
//   board:    live DiplomacyBoard (read-only here).
//   state:    diplomatic state (PR1). Never mutated; a new state is returned.
//   agents:   optional per-power agent context { [power]: { persona, memory, scratchpad } }.
//             `agents.humanThreads` (if present) is the HUMAN-VISIBLE thread store
//             and is NEVER written with AI↔AI text.
//   askAgent: async ({ power, counterparties, channel, boardContext, persona,
//             priorSummary, memory, scratchpad, messages }) ->
//             { reply: { message, scratchpad?, summary? } }. Injected so tests
//             mock it; the app passes the reused endpoint client. The orchestrator
//             folds reply.scratchpad/summary into the returned state (#44).
//   options:  { maxRounds, maxPairsPerRound, humanPower, seed }.
//
// Budget (hard): ≤ maxRounds × maxPairsPerRound × 2 AI↔AI askAgent calls (two
// per pair — proposer and counterparty), plus ≤ 1 askAgent call per AI power for
// its human-thread turn. Dead powers (not in board.getPowerIds()) are never
// selected.
export async function runNegotiationPhase({ board, state, agents = {}, askAgent, options = {} } = {}) {
  if (!board || typeof board.getPowerIds !== 'function') {
    throw new Error('runNegotiationPhase requires a board');
  }
  if (typeof askAgent !== 'function') {
    throw new Error('runNegotiationPhase requires an askAgent function');
  }

  const opts = { ...DEFAULT_OPTIONS, ...options };
  const human = opts.humanPower || (state && state.humanPower) || null;
  const phase = typeof board.getPhaseLabel === 'function' ? board.getPhaseLabel() : null;

  const alive = board.getPowerIds();
  const aiPowers = alive.filter((p) => p !== human);

  const rng = makeRng(opts.seed);
  // AI↔AI transcripts: { [channelId]: [{ round, power, counterparty, message }] }.
  const transcripts = {};
  let nextState = state;

  // One side of an AI↔AI exchange: ask `power` in its channel with `rival`,
  // append the visible line to the private transcript, and persist the power's
  // scratchpad + the channel summary into the hidden diplomatic state (never
  // agents.humanThreads — the secrecy invariant). Returns the normalized reply.
  async function speakInChannel(power, rival, { channel, round, proposedDeal }) {
    const ctx = agents[power] || {};
    const res = await askAgent({
      power,
      counterparties: [rival],
      channel,
      round,
      phase,
      model: opts.aiModel || undefined, // hidden AI↔AI rounds: cheaper model
      boardContext: ctx.boardContext || null,
      persona: ctx.persona || null,
      // Carry the conversation forward (#44): the brief per-channel summary and
      // this power's own prior private note about the rival, both from the
      // persisted diplomatic state (never the human-visible store).
      priorSummary: getSummary(nextState, channel),
      memory: priorNoteFor(nextState, power, rival),
      scratchpad: getScratchpad(nextState, power),
      messages: transcriptMessages(transcripts[channel], power),
      // The proposer's structured deal, when answering one: the endpoint renders
      // it as a PENDING PROPOSAL and requires an accept:true/false answer.
      proposedDeal,
    });
    const reply = res && res.reply ? res.reply : res;
    transcripts[channel].push({
      round,
      power,
      counterparty: rival,
      message: messageText(reply),
    });
    if (reply && typeof reply === 'object') {
      if (reply.scratchpad) nextState = setScratchpad(nextState, power, reply.scratchpad);
      if (reply.summary) nextState = setSummary(nextState, channel, reply.summary);
    }
    return reply;
  }

  // 1) AI↔AI rounds (private; never written to the human thread store). Each
  //    pair is a BILATERAL exchange — the proposer speaks, then the counterparty
  //    answers with the proposal in front of it — so a deal binds only with both
  //    sides' words on record, and both sides' private memory evolves.
  for (let round = 0; round < opts.maxRounds; round++) {
    const pairs = selectPairs(board, nextState, aiPowers, opts.maxPairsPerRound, rng);
    for (const { a, b } of pairs) {
      const channel = channelId(a, b);
      if (!transcripts[channel]) transcripts[channel] = [];

      const proposalReply = await speakInChannel(a, b, { channel, round, proposedDeal: null });
      const deal = extractDeal(proposalReply);

      const counterReply = await speakInChannel(b, a, { channel, round, proposedDeal: deal });

      // Record the deal ONLY on the counterparty's consent (accept:true or an
      // echo of the same deal). A counter-proposal in the counterparty's reply
      // is NOT recorded — the pair can confirm it in a later round.
      if (deal && counterpartyAccepts(counterReply, deal)) {
        nextState = recordDeal(nextState, deal, { proposer: a, counterparty: b, channel, phase });
      }
    }
  }

  // 2) Each AI's side of its human↔AI thread: at most ONE call per AI power.
  //    These replies ARE allowed in the human-visible store (they're addressed
  //    to the human); AI↔AI transcripts above never are.
  const humanThreads = agents.humanThreads || null;

  // One AI->human exchange: ask the power, append any visible message to the
  // human-visible thread, and fold its private scratchpad/summary into the hidden
  // state. `initiate` mode lets a power decline (empty message => nothing added).
  async function talkToHuman(power, thread, { initiate }) {
    const ctx = agents[power] || {};
    const humanChannel = `human~${power}`;
    const res = await askAgent({
      power,
      counterparties: [human],
      channel: humanChannel,
      phase,
      model: opts.humanModel || undefined, // human-facing: keep the stronger model
      boardContext: ctx.boardContext || null,
      persona: ctx.persona || null,
      priorSummary: getSummary(nextState, humanChannel),
      memory: priorNoteFor(nextState, power, human),
      scratchpad: getScratchpad(nextState, power),
      messages: Array.isArray(thread.messages) ? thread.messages : [],
      initiate,
    });
    const reply = res && res.reply ? res.reply : res;
    const text = messageText(reply);
    if (text && humanThreads) {
      thread.messages.push({ role: 'assistant', content: text, turn: phase || '', initiated: !!initiate });
      thread.updatedAt = Date.now();
    }
    if (reply && typeof reply === 'object') {
      if (reply.scratchpad) nextState = setScratchpad(nextState, power, reply.scratchpad);
      if (reply.summary) nextState = setSummary(nextState, humanChannel, reply.summary);
    }
    return !!text;
  }

  if (human && humanThreads && humanThreads.threads) {
    const answered = new Set();
    // 2a) Answer any thread where the human spoke last (at most one call each).
    for (const power of aiPowers) {
      const thread = humanThreads.threads[power];
      if (!thread || !Array.isArray(thread.messages) || thread.messages.length === 0) continue;
      if (thread.messages[thread.messages.length - 1].role === 'assistant') continue;
      await talkToHuman(power, thread, { initiate: false });
      answered.add(power);
    }

    // 2b) Proactive outreach: EVERY alive AI power that the human didn't just
    //     address gets to decide, independently, whether it has something to
    //     discuss — it either opens talks or returns an empty message (silent).
    //     No cap, no relevance filter: the agent judges. We only skip a power
    //     that already spoke last and is still awaiting the human's reply, so it
    //     doesn't monologue turn after turn.
    if (opts.initiateHuman) {
      for (const power of aiPowers) {
        if (answered.has(power)) continue;
        if (!humanThreads.threads[power]) {
          humanThreads.threads[power] = { power, messages: [], scratchpad: null, updatedAt: 0 };
        }
        const thread = humanThreads.threads[power];
        const last = thread.messages[thread.messages.length - 1];
        if (last && last.role === 'assistant') continue; // awaiting the human
        await talkToHuman(power, thread, { initiate: true });
      }
    }
  }

  return { state: nextState, transcripts };
}

// Render prior channel transcript into a messages array from `power`'s POV:
// its own lines are 'assistant', the counterparty's are 'user'.
function transcriptMessages(entries, power) {
  return entries.map((e) => ({
    role: e.power === power ? 'assistant' : 'user',
    content: e.message,
  }));
}

// Pull the visible message text out of an agent reply (string or { message }).
function messageText(reply) {
  if (typeof reply === 'string') return reply;
  if (reply && typeof reply.message === 'string') return reply.message;
  return '';
}

// Exported for tests / downstream tools.
export { channelId, selectPairs, extractDeal };

// Keep POWERS reachable for callers that derive AI powers without a board.
export { POWERS };
