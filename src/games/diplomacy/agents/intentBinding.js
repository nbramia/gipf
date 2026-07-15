// Intent binding for the Diplomacy agents ([Intent Binding]).
//
// This is the integration layer that turns each AI power's STRATEGIC INTENT
// (from [AI Negotiation], `decideStrategicIntent` / validated by
// strategicIntent.js) into concrete, legal ORDERS via the [Tactical AI] engine
// (`engine/aiPlayer.js` `getOrders`) -- then closes the loop by reporting which
// committed deals were actually honored after adjudication, so the trust model
// can update on real plays rather than stated intent.
//
// Pure orchestration: it only calls the injected `getOrders` and the
// `DiplomacyBoard` public API (`clone`, `applyMove`, read-only getters). It does
// NOT reimplement search or negotiation, does NOT edit `DiplomacyBoard.js`, and
// touches no React / network / Anthropic key. Every function is deterministic
// and testable with a stubbed `getOrders`.
//
// ---------------------------------------------------------------------------
// The two FIXED contracts this sits between
// ---------------------------------------------------------------------------
//
// [Tactical AI]  engine/aiPlayer.js:
//     getOrders(board, power, { intent, difficulty }) -> Promise<{ orders: [...] }>
//   (Returns a per-power FRAGMENT object `{ orders: [...] }`. We normalize both
//    that shape and a bare array defensively.)
//
// Strategic-intent object (per-power, per-turn):
//     { power, allies:[power], targets:[power],
//       supportDeals:[{ from: loc, to: loc }],   // from = mover loc, to = dest;
//                                                 // from===to => support-hold
//       dmz:[province], betrayals:[{ type, partner }] }
//
// Precedence (documented): betrayals > supportDeals > allies > targets/dmz.

import { baseProvince } from '../DiplomacyBoard.js';

// ---------------------------------------------------------------------------
// fragment normalization
// ---------------------------------------------------------------------------

// `getOrders` (and `getRetreats`/`getAdjustments`) return a fragment object
// `{ orders: [...] }`. Accept that, a bare array, or null/undefined.
function ordersFromFragment(fragment) {
  if (Array.isArray(fragment)) return fragment;
  if (fragment && Array.isArray(fragment.orders)) return fragment.orders;
  return [];
}

function retreatsFromFragment(fragment) {
  if (Array.isArray(fragment)) return fragment;
  if (fragment && Array.isArray(fragment.retreats)) return fragment.retreats;
  return [];
}

function adjustmentsFromFragment(fragment) {
  if (Array.isArray(fragment)) return fragment;
  if (fragment && Array.isArray(fragment.adjustments)) return fragment.adjustments;
  return [];
}

// ---------------------------------------------------------------------------
// intent helpers
// ---------------------------------------------------------------------------

function emptyIntent() {
  return { allies: [], targets: [], supportDeals: [], dmz: [], betrayals: [] };
}

// True iff `intent` carries no actionable content (treated the same as missing).
function isEmptyIntent(intent) {
  if (!intent || typeof intent !== 'object') return true;
  return (
    (intent.allies || []).length === 0 &&
    (intent.targets || []).length === 0 &&
    (intent.supportDeals || []).length === 0 &&
    (intent.dmz || []).length === 0 &&
    (intent.betrayals || []).length === 0
  );
}

// The power being supported by a deal is the owner of the unit at the deal's
// `from` (the mover, for support-move; the holder, for support-hold). Returns
// null when no unit sits there.
function dealPartner(board, deal) {
  const occupant = board.unitAt(baseProvince(deal.from));
  return occupant ? occupant.power : null;
}

// Set of partner powers this turn's betrayals break against.
function betrayedPartners(intent) {
  return new Set((intent.betrayals || []).map((b) => b && b.partner).filter(Boolean));
}

// The committed support deals: in `supportDeals` and NOT betrayed. A deal is
// betrayed when its partner (the supported power) is in `betrayals` -- this is
// how betrayal precedence is applied even when the same deal also appears in
// `supportDeals` (contradictory intent resolves to betrayal). Conflicting deals
// (two committed supports targeting the same supporting unit) are resolved later
// in `injectCommittedSupports` by keeping the first in stable order.
function committedDeals(board, intent) {
  const betrayed = betrayedPartners(intent);
  const out = [];
  for (const deal of intent.supportDeals || []) {
    if (!deal || typeof deal.from !== 'string' || typeof deal.to !== 'string') continue;
    const partner = dealPartner(board, deal);
    if (partner && betrayed.has(partner)) continue; // betrayal precedence
    out.push(deal);
  }
  return out;
}

// The exact legal support order for a deal, issued by one of `power`'s units, or
// null if none is legal. support-move when from!==to, support-hold when
// from===to. Legality is verified against `getLegalOrdersForUnit`.
function legalSupportForDeal(board, power, deal) {
  const isHold = baseProvince(deal.from) === baseProvince(deal.to);
  for (const loc of board.getUnitLocations(power)) {
    // The supporting unit is never the supported mover itself.
    if (baseProvince(loc) === baseProvince(deal.from)) continue;
    const legal = board.getLegalOrdersForUnit(loc);
    for (const order of legal) {
      if (isHold) {
        if (order.type === 'support-hold' && baseProvince(order.target) === baseProvince(deal.to)) {
          return { type: 'support-hold', unitLoc: loc, target: order.target };
        }
      } else if (
        order.type === 'support-move' &&
        baseProvince(order.from) === baseProvince(deal.from) &&
        baseProvince(order.to) === baseProvince(deal.to)
      ) {
        return { type: 'support-move', unitLoc: loc, from: order.from, to: order.to };
      }
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// committed-support injection (deal-honoring guarantee)
// ---------------------------------------------------------------------------

// Force the fragment to contain the exact support order for each committed deal
// that is legally fulfillable. A support order never moves/attacks, so injecting
// it can never reintroduce an ally/DMZ violation. Conflicting deals (two
// committed supports that resolve to the same supporting unit) keep the first by
// stable order and drop the rest.
function injectCommittedSupports(board, power, orders, intent) {
  const result = orders.slice();
  const byUnit = new Map();
  for (let i = 0; i < result.length; i++) {
    const order = result[i];
    if (order && order.unitLoc != null) byUnit.set(baseProvince(order.unitLoc), i);
  }
  const claimed = new Set(); // supporting-unit base provinces already used by a deal

  for (const deal of committedDeals(board, intent)) {
    const support = legalSupportForDeal(board, power, deal);
    if (!support) continue; // not legal -> drop silently, never emit illegal
    const base = baseProvince(support.unitLoc);
    if (claimed.has(base)) continue; // conflicting deals: keep first, drop rest
    claimed.add(base);
    const idx = byUnit.get(base);
    if (idx != null) result[idx] = support;
    else {
      result.push(support);
      byUnit.set(base, result.length - 1);
    }
  }
  return result;
}

// ---------------------------------------------------------------------------
// bindOrders
// ---------------------------------------------------------------------------

// For each power in `intentByPower` that has units, call `getOrders` with that
// power's intent, collect the fragments, and inject committed supports. On any
// throw/rejection or empty/contradictory intent, fall back to a no-intent
// `getOrders(board, power, {})`; if that also fails, hold. The result is always
// accepted by `board.clone().applyMove({ type:'orders', ordersByPower })` with no
// illegal orders.
//
// Cross-power coordination is deterministic by construction: each power's intent
// independently names the supports it owes, so a supporter that committed to
// A->X injects the support-move while the mover's own intent/plan keeps the move
// -- the two co-occur in the same `ordersByPower`.
async function bindOrders(board, intentByPower, getOrders, { difficulty } = {}) {
  const ordersByPower = {};
  const powers = Object.keys(intentByPower || {});

  for (const power of powers) {
    if (board.getUnitLocations(power).length === 0) continue;
    const rawIntent = intentByPower[power];
    const useIntent = !isEmptyIntent(rawIntent);

    let orders = null;
    if (useIntent) {
      try {
        // The full intent map rides along so the tactical search predicts each
        // opponent under ITS OWN recorded intent (allies stay unattacked in the
        // forecast, negotiated supports are anticipated).
        const fragment = await getOrders(board, power, { intent: rawIntent, intents: intentByPower, difficulty });
        orders = ordersFromFragment(fragment);
      } catch (_) {
        orders = null; // fall through to no-intent fallback
      }
    }

    if (orders == null) {
      try {
        const fragment = await getOrders(board, power, { difficulty });
        orders = ordersFromFragment(fragment);
      } catch (_) {
        orders = board.getUnitLocations(power).map((unitLoc) => ({ type: 'hold', unitLoc }));
      }
    }

    if (useIntent) {
      orders = injectCommittedSupports(board, power, orders, rawIntent);
    }

    ordersByPower[power] = orders;
  }

  return ordersByPower;
}

// ---------------------------------------------------------------------------
// bindRetreats
// ---------------------------------------------------------------------------

// Score a retreat destination by intent: prefer toward allies, away from
// targets. (DMZ avoidance is handled by the caller's pool selection.) Larger is
// better.
function retreatPreference(board, intent, to) {
  if (!to) return -1000; // disband: last resort
  let score = 0;
  const allies = new Set(intent.allies || []);
  const targets = new Set(intent.targets || []);
  for (const adj of adjacentOwners(board, baseProvince(to))) {
    if (allies.has(adj)) score += 5;
    if (targets.has(adj)) score -= 5;
  }
  return score;
}

// Powers owning a unit adjacent to (or on) `base`. Cheap proximity proxy that
// avoids reaching into board adjacency internals: we just look at who sits on the
// province's current occupants' provinces. Falls back to occupant of `base`.
function adjacentOwners(board, base) {
  const owners = [];
  const occupant = board.unitAt(base);
  if (occupant) owners.push(occupant.power);
  return owners;
}

// Route each dislodged unit of every power in `intentByPower`. Always legal per
// `pendingRetreats[].options`; disband (`to: null`) as fallback. Intent biases
// the choice but never produces an illegal destination.
async function bindRetreats(board, intentByPower, getOrders, opts = {}) {
  const retreatsByPower = {};
  for (const entry of board.pendingRetreats || []) {
    const power = entry.unit.power;
    const intent = intentByPower && intentByPower[power] ? intentByPower[power] : emptyIntent();
    const options = entry.options || [];
    const dmz = new Set((intent.dmz || []).map(baseProvince));
    // Prefer the best non-DMZ option; only fall to a DMZ option if it is the
    // only kind available; disband (to: null) when there is no option at all.
    const nonDmz = options.filter((to) => !dmz.has(baseProvince(to)));
    const pool = nonDmz.length > 0 ? nonDmz : options;
    let best = null;
    let bestScore = -Infinity;
    for (const to of pool) {
      const score = retreatPreference(board, intent, to);
      if (score > bestScore) {
        bestScore = score;
        best = to;
      }
    }
    if (!retreatsByPower[power]) retreatsByPower[power] = [];
    retreatsByPower[power].push({ unitLoc: entry.unitLoc, to: best });
  }
  return retreatsByPower;
}

// ---------------------------------------------------------------------------
// bindAdjustments
// ---------------------------------------------------------------------------

// Builds/disbands per `getAdjustments()`. Intent may bias which home to build in
// or which unit to keep, but the output always stays within
// `buildCount`/`disbandCount` and uses only `getLegalAdjustmentOrders`.
async function bindAdjustments(board, intentByPower, getOrders, opts = {}) {
  const adjustmentsByPower = {};
  const adjustments = board.getAdjustments();

  for (const power of Object.keys(intentByPower || {})) {
    const info = adjustments[power];
    if (!info) continue;
    const intent = intentByPower[power] || emptyIntent();
    const legal = board.getLegalAdjustmentOrders(power);

    if (info.delta > 0 && info.buildCount > 0) {
      // Builds: bias away from DMZ provinces, dedupe by base province so a
      // split-coast home yields at most one build, then take buildCount.
      const dmz = new Set((intent.dmz || []).map(baseProvince));
      const ranked = legal
        .filter((o) => o.type === 'build')
        .map((o, i) => ({ o, i, penalized: dmz.has(baseProvince(o.loc)) }))
        .sort((a, b) => (a.penalized === b.penalized ? a.i - b.i : a.penalized ? 1 : -1));
      const selected = [];
      const usedBase = new Set();
      for (const { o } of ranked) {
        const base = baseProvince(o.loc);
        if (usedBase.has(base)) continue;
        usedBase.add(base);
        selected.push(o);
        if (selected.length >= info.buildCount) break;
      }
      adjustmentsByPower[power] = selected;
    } else if (info.delta < 0 && info.disbandCount > 0) {
      // Disbands: keep units nearer allies; disband the rest, up to disbandCount.
      const allies = new Set(intent.allies || []);
      const ranked = legal
        .filter((o) => o.type === 'disband')
        .map((o, i) => ({ o, i, keep: nearAlly(board, allies, o.unitLoc) }))
        // Disband the LEAST-kept first (keep=false sorts before keep=true).
        .sort((a, b) => (a.keep === b.keep ? a.i - b.i : a.keep ? 1 : -1));
      adjustmentsByPower[power] = ranked.slice(0, info.disbandCount).map((r) => r.o);
    } else {
      adjustmentsByPower[power] = [];
    }
  }

  return adjustmentsByPower;
}

function nearAlly(board, allies, loc) {
  if (allies.size === 0) return false;
  const occupant = board.unitAt(baseProvince(loc));
  return !!occupant && allies.has(occupant.power);
}

// ---------------------------------------------------------------------------
// reconcileHonored
// ---------------------------------------------------------------------------

// AFTER adjudication, compute which committed support deals were honored vs.
// broken, from `board.orderHistory[0]`. A deal is HONORED if its support order
// was actually issued (present in `orderHistory[0].orders`) and not in
// `resolved.cutSupports`. It is BROKEN if it was committed but the support is
// absent, was a declared betrayal, or was issued but CUT.
//
// (Trust-update math lives in [AI Negotiation]; this only emits honored/broken.)
function reconcileHonored(board, intentByPower) {
  const result = {};
  const record = (board.orderHistory && board.orderHistory[0]) || null;
  const issued = (record && record.orders) || {};
  const cutSupports = new Set((record && record.resolved && record.resolved.cutSupports) || []);

  for (const power of Object.keys(intentByPower || {})) {
    const intent = intentByPower[power];
    if (!intent) {
      result[power] = { honored: [], broken: [] };
      continue;
    }
    const betrayed = betrayedPartners(intent);
    const honored = [];
    const broken = [];

    for (const deal of intent.supportDeals || []) {
      if (!deal || typeof deal.from !== 'string' || typeof deal.to !== 'string') continue;
      const partner = dealPartner(board, deal);
      // A betrayed deal is broken regardless of what was issued.
      if (partner && betrayed.has(partner)) {
        broken.push(deal);
        continue;
      }
      // Find an issued support order by this power matching the deal.
      const match = findIssuedSupport(board, power, issued, deal);
      if (!match) {
        broken.push(deal); // committed but absent
      } else if (cutSupports.has(match.loc)) {
        broken.push(deal); // issued but cut
      } else {
        honored.push(deal);
      }
    }

    result[power] = { honored, broken };
  }

  return result;
}

// Among the issued orders `{[loc]: order}`, find one owned by `power` that is the
// support order for `deal`. Returns { loc, order } or null. Ownership is taken
// from the post-adjudication board would be unreliable (the unit may have moved),
// so we instead match the support order's shape against the deal and trust that
// the binding only issued the power's own supports.
function findIssuedSupport(board, power, issued, deal) {
  const isHold = baseProvince(deal.from) === baseProvince(deal.to);
  for (const [loc, order] of Object.entries(issued)) {
    if (!order) continue;
    if (isHold) {
      if (order.type === 'support-hold' && baseProvince(order.target) === baseProvince(deal.to)) {
        if (orderBelongsTo(board, power, loc)) return { loc, order };
      }
    } else if (
      order.type === 'support-move' &&
      baseProvince(order.from) === baseProvince(deal.from) &&
      baseProvince(order.to) === baseProvince(deal.to)
    ) {
      if (orderBelongsTo(board, power, loc)) return { loc, order };
    }
  }
  return null;
}

// True iff the unit that issued the order at `loc` belonged to `power`. After
// adjudication a unit at `loc` may have been dislodged or replaced, so consult
// the pre-resolution snapshot in `orderHistory[0].retreats` when the live board
// no longer has our unit there; otherwise trust the live occupant. A supporting
// unit never moves, so in the common (uncut, surviving) case the live occupant
// is still ours.
function orderBelongsTo(board, power, loc) {
  const live = board.unitAt(baseProvince(loc));
  if (live) return live.power === power;
  // Unit gone (dislodged): check the recorded dislodged list.
  const record = board.orderHistory && board.orderHistory[0];
  const dislodged = (record && record.resolved && record.resolved.dislodged) || [];
  const hit = dislodged.find((d) => baseProvince(d.unitLoc) === baseProvince(loc));
  return !!hit && hit.unit.power === power;
}

export { bindOrders, bindRetreats, bindAdjustments, reconcileHonored };
