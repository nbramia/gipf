// Deterministic trust update for the Diplomacy agents (PR1 of [AI Negotiation]).
//
// After each movement adjudication, diff the promises a power made during
// negotiation against what its units ACTUALLY did this turn (board.orderHistory[0])
// and move trust accordingly. Verified promises are cleared; durable promises are
// promoted to standing agreements. Pure: no React, no network, no LLM.
//
// Why the acting power is stored on the promise: `board.orderHistory[k].orders`
// is keyed by unit LOCATION and the unit objects are mutated each turn and do not
// carry their owning power. So a promise like "france supports germany's mun->ruh"
// can only be attributed correctly if we recorded which power (france) was on the
// hook — we detect kept/broken off that recorded `actingPower`, never by guessing
// ownership from the post-adjudication board.

import { baseProvince } from '../DiplomacyBoard.js';
import {
  relationKey,
  recordAgreement,
  getLedger,
} from './diplomaticState.js';

// Trust deltas (tunable). Centralized so PR3's reputation-cost model reuses the
// exact same magnitudes. A single kept support (+0.15) is intentionally smaller
// than a broken one (-0.40) so cheap promises can't be farmed for trust.
export const TRUST_DELTAS = {
  supportKept: 0.15,
  supportBroken: -0.4,
  nonAggressionBroken: -0.5,
  jointAttackHonored: 0.2, // applied mutually to both parties
};

const TRUST_MIN = -1;
const TRUST_MAX = 1;

function clampTrust(t) {
  return Math.max(TRUST_MIN, Math.min(TRUST_MAX, t));
}

// Normalize a location to its base province, case-insensitively. Promises are
// recorded from negotiation (often lower-case province ids, per the issue
// schema) while the engine keys orders by upper-case province id; comparing on
// an upper-cased base makes the diff robust to either convention.
function normBase(loc) {
  const base = baseProvince(loc);
  return typeof base === 'string' ? base.toUpperCase() : base;
}

// Did `actingPower` actually issue the support order this promise required?
// `expectedOrder` is the order shape recorded at negotiation time, e.g.
//   { type: 'support-move', unitLoc: 'bur', from: 'mun', to: 'ruh' }
//   { type: 'support-hold', unitLoc: 'bur', target: 'mun' }
// We match against the resolved orders by unit location, comparing on base
// provinces so a coast suffix (e.g. STP/sc) never causes a false mismatch.
function supportPromiseKept(expectedOrder, orders) {
  if (!expectedOrder || !orders) return false;
  const actual = orders[expectedOrder.unitLoc];
  if (!actual || actual.type !== expectedOrder.type) return false;

  if (expectedOrder.type === 'support-move') {
    return (
      normBase(actual.from) === normBase(expectedOrder.from) &&
      normBase(actual.to) === normBase(expectedOrder.to)
    );
  }
  if (expectedOrder.type === 'support-hold') {
    return normBase(actual.target) === normBase(expectedOrder.target);
  }
  return false;
}

// Apply a directional trust delta and return a fresh relations object. Seeds the
// relation entry if it is missing (e.g. a power revived since state creation).
function bumpTrust(relations, from, to, delta, phase) {
  const key = relationKey(from, to);
  const prev = relations[key] || { trust: 0, lastUpdatedPhase: null };
  return {
    ...relations,
    [key]: { trust: clampTrust(prev.trust + delta), lastUpdatedPhase: phase },
  };
}

// Increment a ledger counter (kept|broken) for a directional pair.
function bumpLedger(ledger, from, to, field) {
  const key = relationKey(from, to);
  const prev = ledger[key] || { kept: 0, broken: 0 };
  return { ...ledger, [key]: { ...prev, [field]: prev[field] + 1 } };
}

// Did `actingPower` move a unit into any province the partner occupied at the
// start of this turn, or into a DMZ province? Used for non-aggression / DMZ
// violation detection. Partner occupancy is read from the PRE-adjudication board
// snapshot captured in the order set (orders are keyed by the mover's location),
// while DMZ provinces come straight off the agreement.
function violatedNonAggression(actingPower, agreement, orders, partnerOccupied, phase) {
  // Find every move issued this turn and check its destination base province.
  const dmz = agreement.type === 'dmz' && Array.isArray(agreement.provinces)
    ? new Set(agreement.provinces.map(normBase))
    : new Set();

  for (const order of Object.values(orders)) {
    if (!order || order.type !== 'move' || !order.to) continue;
    const dest = normBase(order.to);
    if (dmz.has(dest)) return true;
    if (partnerOccupied.has(dest)) return true;
  }
  return false;
}

// updateTrustAfterAdjudication(state, board, { actingPowers }) -> new state.
//
// Diffs `state.promises` against `board.orderHistory[0]`, classifies each as
// kept/broken, applies the trust deltas + ledger bumps, clears verified promises,
// and promotes durable promises to agreements. Also penalizes non-aggression /
// DMZ violations for the supplied acting powers.
//
//   actingPowers: the powers whose orders resolved this turn. Required to detect
//                 violations (whose move was it?) since orderHistory doesn't store
//                 power. A move's owner is resolved via each acting power's
//                 promise/agreement record + the order locations they were on.
//
// Pure: the input `state` is never mutated; a brand-new state object is returned.
export function updateTrustAfterAdjudication(state, board, { actingPowers = [] } = {}) {
  const history = Array.isArray(board?.orderHistory) ? board.orderHistory : [];
  const latest = history[0];
  // Nothing to verify against (e.g. retreat/adjustment-only history entry).
  if (!latest || !latest.orders) return state;

  const phase = latest.phase || null;
  const orders = latest.orders;

  let relations = state.relations;
  let promiseLedger = state.promiseLedger;
  const verifiedIds = new Set();
  let next = state; // accumulates agreement promotions via recordAgreement

  // 1) Verify each recorded support promise against the resolved orders.
  for (const promise of state.promises) {
    if (promise.type !== 'support') continue; // only support is order-verifiable
    const actor = promise.actingPower;
    if (!actor || (actingPowers.length && !actingPowers.includes(actor))) continue;

    const kept = supportPromiseKept(promise.expectedOrder, orders);
    const partner = promise.to;
    if (kept) {
      relations = bumpTrust(relations, partner, actor, TRUST_DELTAS.supportKept, phase);
      promiseLedger = bumpLedger(promiseLedger, actor, partner, 'kept');
    } else {
      relations = bumpTrust(relations, partner, actor, TRUST_DELTAS.supportBroken, phase);
      promiseLedger = bumpLedger(promiseLedger, actor, partner, 'broken');
    }
    verifiedIds.add(promise.id);
  }

  // 2) Penalize non-aggression / DMZ violations by acting powers.
  //    Partner occupancy is derived per-agreement from the orders the partner
  //    issued (its move/hold/support unitLoc set marks where it sat this turn).
  for (const agreement of state.agreements) {
    if (agreement.type !== 'non-aggression' && agreement.type !== 'dmz') continue;
    if (!Array.isArray(agreement.parties)) continue;

    for (const actor of agreement.parties) {
      if (actingPowers.length && !actingPowers.includes(actor)) continue;
      const partner = agreement.parties.find((p) => p !== actor);
      if (!partner) continue;

      // Restrict the order set to the actor's units. We can't read power off the
      // mutated board, so the orchestrator stores each acting power's order
      // locations on the agreement (actor>locs). Fall back to the full set keyed
      // by the actor when that map is present.
      const actorOrders = ordersForActor(latest, agreement, actor, orders);
      const partnerOccupied = partnerOccupiedProvinces(latest, agreement, partner);

      if (violatedNonAggression(actor, agreement, actorOrders, partnerOccupied, phase)) {
        relations = bumpTrust(relations, partner, actor, TRUST_DELTAS.nonAggressionBroken, phase);
        promiseLedger = bumpLedger(promiseLedger, actor, partner, 'broken');
      }
    }
  }

  // Rebuild state with updated relations/ledger and verified promises cleared.
  next = {
    ...state,
    relations,
    promiseLedger,
    promises: state.promises.filter((p) => !verifiedIds.has(p.id)),
  };

  // 3) Promote durable promises (kept supports recorded as ongoing) to standing
  //    agreements so a maintained support relationship persists across turns.
  for (const promise of state.promises) {
    if (!verifiedIds.has(promise.id)) continue;
    if (promise.type !== 'support' || !promise.durable) continue;
    if (!supportPromiseKept(promise.expectedOrder, orders)) continue;
    next = recordAgreement(next, {
      type: 'support',
      from: promise.from,
      to: promise.to,
      phase,
    });
  }

  return next;
}

// Per-agreement order locations for an acting power. The orchestrator may attach
// `actorOrderLocs: { [power]: [loc,...] }` to the order-history entry (or the
// agreement) so we can attribute moves without reading power off the board. When
// absent, we conservatively use the full order set (callers in PR1 tests supply
// the locs explicitly via the agreement).
function ordersForActor(historyEntry, agreement, actor, orders) {
  const map =
    (historyEntry && historyEntry.actorOrderLocs) ||
    (agreement && agreement.actorOrderLocs) ||
    null;
  if (map && Array.isArray(map[actor])) {
    const subset = {};
    for (const loc of map[actor]) if (orders[loc]) subset[loc] = orders[loc];
    return subset;
  }
  return orders;
}

// Provinces the partner occupied this turn. From an explicit per-power location
// map when present; otherwise from `agreement.partnerOccupied` (a province list
// the orchestrator recorded at negotiation time).
function partnerOccupiedProvinces(historyEntry, agreement, partner) {
  const map =
    (historyEntry && historyEntry.actorOrderLocs) ||
    (agreement && agreement.actorOrderLocs) ||
    null;
  if (map && Array.isArray(map[partner])) {
    return new Set(map[partner].map(normBase));
  }
  if (Array.isArray(agreement.partnerOccupied)) {
    return new Set(agreement.partnerOccupied.map(normBase));
  }
  return new Set();
}

// Re-export so PR3 imports the ledger getter alongside the deltas if it wants.
export { getLedger };
