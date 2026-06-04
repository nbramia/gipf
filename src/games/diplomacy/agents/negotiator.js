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
// maxRounds × maxPairsPerRound.

import {
  POWERS,
  PROVINCES,
  ARMY_ADJACENCY,
  FLEET_ADJACENCY,
  baseProvince,
} from '../DiplomacyBoard.js';
import {
  recordPromise,
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
// (prompt-injection mitigation). Returns a normalized deal or null.
//
// Accepted deal shapes (mirroring the diplomatic-state agreement/promise types):
//   { type:'support', from, to, expectedOrder, durable? }   -> promise
//   { type:'dmz', parties:[a,b], provinces:[...] }           -> agreement
//   { type:'non-aggression', parties:[a,b] }                 -> agreement
//   { type:'joint-attack', parties:[a,b], target }           -> agreement
function extractDeal(reply) {
  if (!reply || typeof reply !== 'object') return null;
  const deal = reply.deal;
  if (!deal || typeof deal !== 'object' || Array.isArray(deal)) return null;
  if (typeof deal.type !== 'string') return null;
  return deal;
}

// Apply an extracted deal to the state, returning the new state. Support deals
// become promises (verifiable next turn) tagged with the acting power; the rest
// become standing agreements. `accepted` powers are the channel participants, so
// a deal is only recorded when the counterparty did not reject it.
function applyDeal(state, deal, { phase }) {
  if (deal.type === 'support') {
    if (!deal.from || !deal.to) return state;
    return recordPromise(state, {
      type: 'support',
      from: deal.from,
      to: deal.to,
      actingPower: deal.actingPower || deal.from,
      expectedOrder: deal.expectedOrder || null,
      madePhase: phase,
      durable: !!deal.durable,
    });
  }
  if (deal.type === 'dmz') {
    if (!Array.isArray(deal.parties) || !Array.isArray(deal.provinces)) return state;
    return recordAgreement(state, {
      type: 'dmz',
      parties: deal.parties,
      provinces: deal.provinces,
      phase,
    });
  }
  if (deal.type === 'non-aggression') {
    if (!Array.isArray(deal.parties)) return state;
    return recordAgreement(state, { type: 'non-aggression', parties: deal.parties, phase });
  }
  if (deal.type === 'joint-attack') {
    if (!Array.isArray(deal.parties) || !deal.target) return state;
    return recordAgreement(state, {
      type: 'joint-attack',
      parties: deal.parties,
      target: deal.target,
      phase,
    });
  }
  return state;
}

// True if a reply from the counterparty rejects the proposal (so no deal lands).
function isAccepted(reply) {
  if (!reply || typeof reply !== 'object') return false;
  // Explicit rejection wins; otherwise an echoed `deal` counts as acceptance.
  if (reply.accept === false) return false;
  return reply.accept === true || !!reply.deal;
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

const DEFAULT_OPTIONS = { maxRounds: 2, maxPairsPerRound: 4, humanPower: null, seed: 0 };

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
// Budget (hard): ≤ maxRounds × maxPairsPerRound AI↔AI askAgent calls, plus ≤ 1
// askAgent call per AI power for its human-thread turn. Dead powers (not in
// board.getPowerIds()) are never selected.
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

  // 1) AI↔AI rounds (private; never written to the human thread store).
  for (let round = 0; round < opts.maxRounds; round++) {
    const pairs = selectPairs(board, nextState, aiPowers, opts.maxPairsPerRound, rng);
    for (const { a, b } of pairs) {
      const channel = channelId(a, b);
      if (!transcripts[channel]) transcripts[channel] = [];

      // Proposer speaks first, then the counterparty replies (one askAgent call
      // each — but both count toward the AI↔AI budget, so we make a SINGLE call
      // representing the pair's exchange to honor ≤ maxRounds×maxPairsPerRound).
      const aCtx = agents[a] || {};
      const proposal = await askAgent({
        power: a,
        counterparties: [b],
        channel,
        round,
        phase,
        boardContext: aCtx.boardContext || null,
        persona: aCtx.persona || null,
        // Carry the conversation forward (#44): the brief per-channel summary and
        // this power's own prior private note about the rival, both from the
        // persisted diplomatic state (never the human-visible store).
        priorSummary: getSummary(nextState, channel),
        memory: priorNoteFor(nextState, a, b),
        scratchpad: getScratchpad(nextState, a),
        messages: transcriptMessages(transcripts[channel], a),
      });

      const proposalReply = proposal && proposal.reply ? proposal.reply : proposal;
      transcripts[channel].push({
        round,
        power: a,
        counterparty: b,
        message: messageText(proposalReply),
      });

      // Persist the proposer's scratchpad + the channel summary so they carry
      // into the next phase. These live ONLY in the hidden diplomatic state —
      // never written to agents.humanThreads (the secrecy invariant).
      if (proposalReply && typeof proposalReply === 'object') {
        if (proposalReply.scratchpad) {
          nextState = setScratchpad(nextState, a, proposalReply.scratchpad);
        }
        if (proposalReply.summary) {
          nextState = setSummary(nextState, channel, proposalReply.summary);
        }
      }

      // Record any concrete, structured deal the proposer offered AND the
      // counterparty implicitly/explicitly accepted (acceptance is the proposer
      // emitting a `deal` field; a separate reject reply would clear it).
      const deal = extractDeal(proposalReply);
      if (deal && isAccepted(proposalReply)) {
        nextState = applyDeal(nextState, deal, { phase });
      }
    }
  }

  // 2) Each AI's side of its human↔AI thread: at most ONE call per AI power.
  //    These replies ARE allowed in the human-visible store (they're addressed
  //    to the human); AI↔AI transcripts above never are.
  const humanThreads = agents.humanThreads || null;
  if (human) {
    for (const power of aiPowers) {
      const ctx = agents[power] || {};
      // Only engage powers that have an open human thread to answer.
      const thread = humanThreads && humanThreads.threads ? humanThreads.threads[power] : null;
      if (!thread || !Array.isArray(thread.messages) || thread.messages.length === 0) continue;
      // Skip if the last message is already from the AI (nothing to answer).
      if (thread.messages[thread.messages.length - 1].role === 'assistant') continue;

      const humanChannel = `human~${power}`;
      const res = await askAgent({
        power,
        counterparties: [human],
        channel: humanChannel,
        phase,
        boardContext: ctx.boardContext || null,
        persona: ctx.persona || null,
        // The human thread carries its own summary + this power's prior note
        // about the human, mirroring the AI↔AI continuity (#44).
        priorSummary: getSummary(nextState, humanChannel),
        memory: priorNoteFor(nextState, power, human),
        scratchpad: getScratchpad(nextState, power),
        messages: thread.messages,
      });
      const reply = res && res.reply ? res.reply : res;
      const text = messageText(reply);
      if (text && humanThreads) {
        thread.messages.push({ role: 'assistant', content: text, turn: phase || '' });
        thread.updatedAt = Date.now();
      }
      // Persist the power's evolving scratchpad (and the human-channel summary)
      // into the HIDDEN state only — the visible text already went to the thread
      // above; the private disposition/summary never touch humanThreads.
      if (reply && typeof reply === 'object') {
        if (reply.scratchpad) nextState = setScratchpad(nextState, power, reply.scratchpad);
        if (reply.summary) nextState = setSummary(nextState, humanChannel, reply.summary);
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
