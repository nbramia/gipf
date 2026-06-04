// Per-power diplomatic state for the Diplomacy agents (PR1 of [AI Negotiation]).
//
// This is the persisted, cross-turn memory of WHO trusts whom, WHAT deals stand,
// and WHICH promises were kept or broken. It is the foundation the negotiation
// orchestrator (PR2) writes into and the betrayal model (PR3) reads from.
//
// Pure logic only: no React, no network, no localStorage, no cross-game imports.
// Every mutator returns a NEW state object and never mutates its input, so the
// state can live in React state / be serialized alongside the board without the
// usual clone-or-bust footguns.
//
// Schema (version 1 — load-bearing contract, see issue #28):
//   {
//     version: 1,
//     humanPower: 'england',
//     relations:  { 'france>germany': { trust: 0.42, lastUpdatedPhase: 'Fall 1902' } },
//     agreements: [ { id, type, ... } ],          // standing, durable deals
//     promises:   [ { id, type, from, to, expectedOrder, madePhase, actingPower } ],
//     promiseLedger: { 'france>germany': { kept: 3, broken: 1 } },
//     scratchpads: { france: <scratchpad> },        // last private disposition per power
//     summaries:   { 'austria~france': '...' }       // one-line per-channel memory
//   }
//
// `scratchpads` and `summaries` (issue #44) carry the conversational layer's
// memory forward across negotiation phases without an extra LLM call: an agent's
// own scratchpad (from api/diplomacyAgent.js) and a brief self-emitted channel
// summary are persisted here and re-injected into the next phase's prompts.
//
// `relations` holds one entry for EVERY ordered pair of alive powers (so both
// 'france>germany' and 'germany>france' exist) seeded at trust 0. The pair key
// is directional: 'A>B' is A's trust toward B.

import { POWERS } from '../DiplomacyBoard.js';

export const STATE_VERSION = 1;

// Directional relation key: A's trust toward B.
export function relationKey(from, to) {
  return `${from}>${to}`;
}

// Build the seed state for a new game. Seeds a relations entry for every ordered
// pair of ALIVE powers (board.getPowerIds()) at trust 0, with empty agreements,
// promises, and ledger. `humanPower` is validated against POWERS.
export function createDiplomaticState({ board, humanPower } = {}) {
  if (!board || typeof board.getPowerIds !== 'function') {
    throw new Error('createDiplomaticState requires a board with getPowerIds()');
  }
  if (humanPower != null && !POWERS.includes(humanPower)) {
    throw new Error(`createDiplomaticState: humanPower '${humanPower}' is not a valid power`);
  }

  const alive = board.getPowerIds();
  const relations = {};
  for (const from of alive) {
    for (const to of alive) {
      if (from === to) continue;
      relations[relationKey(from, to)] = { trust: 0, lastUpdatedPhase: null };
    }
  }

  return {
    version: STATE_VERSION,
    humanPower: humanPower || null,
    relations,
    agreements: [],
    promises: [],
    promiseLedger: {},
    scratchpads: {},
    summaries: {},
  };
}

// --- pure helpers -----------------------------------------------------------

// Deep-clone via structured JSON. The state is plain JSON by construction, so
// this is a faithful, decoupled copy with no shared references to the input.
function cloneState(state) {
  return JSON.parse(JSON.stringify(state));
}

let promiseSeq = 0;
let agreementSeq = 0;

// Stable-ish unique id. Tests pass an explicit id where determinism matters; the
// counter only fills the gap for ad-hoc callers.
function nextId(prefix) {
  const seq = prefix === 'p' ? ++promiseSeq : ++agreementSeq;
  return `${prefix}${seq}`;
}

// --- mutators (return NEW state) --------------------------------------------

// Record a promise made during negotiation. A promise is a SPECIFIC, verifiable
// commitment to issue a particular order next turn (e.g. support germany's
// mun->ruh). It carries the acting power explicitly because orderHistory units
// are mutated and do not store power — trust diffing keys off `actingPower`.
//
// promise = { type, from, to, expectedOrder, madePhase, actingPower, id? }
//   - type: 'support' (the only verifiable promise type today)
//   - from/to: the directional pair the promise is between
//   - expectedOrder: the order `actingPower` is expected to issue (order shape)
//   - actingPower: the power that must issue `expectedOrder` (usually `from`)
export function recordPromise(state, promise = {}) {
  const next = cloneState(state);
  const actingPower = promise.actingPower || promise.from || null;
  next.promises.push({
    id: promise.id || nextId('p'),
    type: promise.type || 'support',
    from: promise.from || null,
    to: promise.to || null,
    expectedOrder: promise.expectedOrder ? { ...promise.expectedOrder } : null,
    madePhase: promise.madePhase || null,
    actingPower,
  });
  return next;
}

// Record (or replace) a standing agreement: a durable, typed deal that persists
// until dropped or violated. Types: 'support' | 'dmz' | 'non-aggression' |
// 'joint-attack'. Shape varies by type; we store it verbatim plus an id.
//   - support:        { from, to }
//   - dmz:            { parties:[a,b], provinces:[...] }
//   - non-aggression: { parties:[a,b] }
//   - joint-attack:   { parties:[a,b], target }
// If an agreement with the same id exists it is replaced (idempotent upsert).
export function recordAgreement(state, agreement = {}) {
  const next = cloneState(state);
  const id = agreement.id || nextId('a');
  const entry = { ...agreement, id };
  const idx = next.agreements.findIndex((a) => a.id === id);
  if (idx >= 0) next.agreements[idx] = entry;
  else next.agreements.push(entry);
  return next;
}

// Remove a standing agreement by id. Returns new state (no-op if absent).
export function dropAgreement(state, id) {
  const next = cloneState(state);
  next.agreements = next.agreements.filter((a) => a.id !== id);
  return next;
}

// Persist a power's latest private scratchpad (the disposition object from the
// agent endpoint). Returns new state. A null/undefined scratchpad clears it; any
// other value is stored verbatim (the endpoint already validated its shape).
export function setScratchpad(state, power, scratchpad) {
  if (!power || typeof power !== 'string') return state;
  const next = cloneState(state);
  if (!next.scratchpads || typeof next.scratchpads !== 'object') next.scratchpads = {};
  if (scratchpad == null) {
    delete next.scratchpads[power];
  } else {
    next.scratchpads[power] = scratchpad;
  }
  return next;
}

// Persist a brief one-line conversation summary for a channel. Returns new state.
// Empty / non-string / oversized (> 200 chars) text is ignored (no-op) so a bad
// agent emission never corrupts the carried memory.
export function setSummary(state, channelId, text) {
  if (!channelId || typeof channelId !== 'string') return state;
  if (typeof text !== 'string' || !text.trim() || text.length > 200) return state;
  const next = cloneState(state);
  if (!next.summaries || typeof next.summaries !== 'object') next.summaries = {};
  next.summaries[channelId] = text.trim();
  return next;
}

// --- getters (read-only, never mutate) --------------------------------------

// A's trust toward B in [-1,1]; 0 if the pair has no relation entry.
export function getTrust(state, from, to) {
  const rel = state.relations[relationKey(from, to)];
  return rel ? rel.trust : 0;
}

// Ledger {kept,broken} for A toward B; zeros if none recorded yet.
export function getLedger(state, from, to) {
  return state.promiseLedger[relationKey(from, to)] || { kept: 0, broken: 0 };
}

// A power's persisted private scratchpad, or null if none recorded yet.
export function getScratchpad(state, power) {
  return (state.scratchpads && state.scratchpads[power]) || null;
}

// The carried one-line summary for a channel, or '' if none recorded yet.
export function getSummary(state, channelId) {
  return (state.summaries && state.summaries[channelId]) || '';
}

// All standing agreements that involve `power` (as a party / from / to).
export function getAgreementsFor(state, power) {
  return state.agreements.filter((a) => agreementInvolves(a, power));
}

// All recorded (not-yet-verified) promises whose acting power is `power`.
export function getPromisesBy(state, power) {
  return state.promises.filter((p) => p.actingPower === power);
}

// True if an agreement involves `power` (handles both `parties` and from/to).
export function agreementInvolves(agreement, power) {
  if (Array.isArray(agreement.parties)) return agreement.parties.includes(power);
  return agreement.from === power || agreement.to === power;
}

// The other party of a two-party agreement relative to `power` (null if none).
export function agreementPartner(agreement, power) {
  if (Array.isArray(agreement.parties)) {
    return agreement.parties.find((p) => p !== power) || null;
  }
  if (agreement.from === power) return agreement.to;
  if (agreement.to === power) return agreement.from;
  return null;
}
