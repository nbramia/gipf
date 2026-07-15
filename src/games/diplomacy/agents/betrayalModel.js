// Betrayal / decision model for the Diplomacy agents (PR3 of [AI Negotiation]).
//
// Given the persisted diplomatic state, decide — per standing agreement — whether
// the power HONORS or BREAKS it, then assemble the strategic-intent object the
// [Tactical AI] consumes. Deterministic and pure: no network, no LLM, no React.
// (The conversational LLM shapes intent indirectly through the trust/deal state
// that PR2 writes; the actual honor-vs-stab call is made here by cold math so it
// is testable and reproducible.)
//
// Decision rule per agreement involving `power` and `partner`:
//   honorScore = effectiveTrust(partner) * W_trust
//   breakScore = payoffGain(breaking) * W_payoff - reputationCost(partner) * W_rep
//   BREAK iff breakScore > honorScore + MARGIN
// Reputation is the cost of stabbing (it discounts the break payoff), not a tax
// on honouring — a clean record makes the first stab expensive, as below.
//
// effectiveTrust (#44) blends the mechanical ledger trust with the LLM
// scratchpad's self-reported trust, LEDGER-DOMINANT (W_LEDGER > W_SCRATCH), so the
// model's private "thinking" steers the decision but can't override a verifiable
// betrayal. The scratchpad also adds deal-less hostile powers to `targets`.
//
// reputationCost(partner) scales with how treacherous the power has already been
// toward that partner (its broken/kept ledger), weighted by the trust deltas, so
// a power that has burned a partner before pays less marginal reputation to do it
// again — but a clean reputation makes the first stab expensive.

import { POWERS, baseProvince } from '../DiplomacyBoard.js';
import {
  getTrust,
  getLedger,
  getAgreementsFor,
  getScratchpad,
  agreementPartner,
} from './diplomaticState.js';
import { TRUST_DELTAS } from './trustModel.js';

// Named, tunable decision weights (exported for tests + downstream tuning).
export const W_TRUST = 1.0;   // weight on trusting an ally (favors honoring)
export const W_REP = 0.7;     // weight on reputational cost of betrayal (discounts the break payoff)
export const W_PAYOFF = 1.0;  // weight on the tactical gain from breaking
export const MARGIN = 0.15;   // breaking must clear honoring by this much

// Trust-blend weights (#44): the verifiable kept/broken-promise LEDGER dominates;
// the LLM scratchpad's self-reported trust is a bounded secondary adjustment, so
// a hallucinated "I trust you" can never override a partner who actually stabbed.
// W_LEDGER > W_SCRATCH by construction; they sum to 1 so the blend stays in [-1,1].
export const W_LEDGER = 0.7;
export const W_SCRATCH = 0.3;

function clamp(x, lo, hi) {
  return Math.max(lo, Math.min(hi, x));
}

// Effective trust toward `partner`: the ledger-derived trust blended with the
// power's own scratchpad disposition (if any), ledger-dominant. Falls back to
// pure ledger trust when no scratchpad note about the partner exists.
export function effectiveTrust(state, power, partner) {
  const ledgerTrust = getTrust(state, power, partner);
  const d = scratchpadDisposition(state, power, partner);
  if (!d || typeof d.trust !== 'number') return ledgerTrust;
  return clamp(W_LEDGER * ledgerTrust + W_SCRATCH * d.trust, -1, 1);
}

// The power's persisted disposition toward one partner ({ trust, stance, intent,
// note }), or null if none recorded. Pure read.
function scratchpadDisposition(state, power, partner) {
  const scratchpad = state ? getScratchpad(state, power) : null;
  if (!scratchpad || !scratchpad.dispositions) return null;
  const d = scratchpad.dispositions[partner];
  return d && typeof d === 'object' ? d : null;
}

// True if the power's scratchpad marks `partner` as hostile enough to press them
// even absent a standing deal: an explicit 'enemy' stance, or a 'rival' stance
// paired with a clearly hostile intent. Conservative + deterministic.
const HOSTILE_INTENT = /\b(stab|attack|invade|destroy|crush|betray|eliminate|take .* from|seize)\b/i;
function scratchpadMarksHostile(d) {
  if (!d) return false;
  if (d.stance === 'enemy') return true;
  if (d.stance === 'rival' && typeof d.intent === 'string' && HOSTILE_INTENT.test(d.intent)) return true;
  return false;
}

// True if the scratchpad marks `partner` as a friend the power means to keep:
// an 'ally' or 'friendly' stance. Used to keep them OUT of targets unless the
// ledger contradicts it.
function scratchpadMarksFriendly(d) {
  return !!d && (d.stance === 'ally' || d.stance === 'friendly');
}

// Normalizing scale for the raw tactical-payoff proxy (board score units are in
// the hundreds; this maps a meaningful gain to roughly [0,1]).
export const PAYOFF_SCALE = 600;

// Reputational cost of betraying `partner`: the trust hit a fresh betrayal lands
// (|broken delta|), discounted by how reliable this power has been toward the
// partner so far. A high kept:broken ratio means a betrayal is more shocking
// (higher cost); a partner already repeatedly betrayed costs little more.
export function reputationCost(state, power, partner) {
  const { kept, broken } = getLedger(state, power, partner);
  const base = Math.abs(TRUST_DELTAS.nonAggressionBroken); // worst-case stab cost
  const total = kept + broken;
  if (total === 0) return base; // unblemished record → full reputational stake
  const reliability = kept / total; // [0,1]
  return base * reliability;
}

// Deal-specific betrayal payoff (#44): how much THIS power gains by breaking THIS
// specific agreement, rather than one global number applied to all deals.
//
// Generate candidate plans, then partition them: the FREE best is the top plan
// overall; the HONOR best is the top plan that stays consistent with the
// agreement (keeps a promised support / avoids DMZ provinces / does not move into
// the partner's occupied centers — a small predicate per agreement type). The
// gain is the score the power forgoes by honoring, scaled and clamped to [0, ∞).
// If no honor-consistent plan exists, the holding plan is the honor baseline so
// the result stays finite and deterministic.
export function payoffOfBreaking(board, power, agreement) {
  if (!board || typeof board.generateCandidatePlans !== 'function' || !agreement) return 0;
  let plans;
  try {
    plans = board.generateCandidatePlans(power, { maxPlans: 16 });
  } catch (_) {
    return 0;
  }
  if (!Array.isArray(plans) || plans.length === 0) return 0;

  const partner = agreementPartner(agreement, power);
  const isHonorConsistent = honorPredicate(board, power, agreement, partner);

  let bestFree = -Infinity;
  let bestHonor = -Infinity;
  for (const plan of plans) {
    const s = typeof plan.score === 'number' ? plan.score : 0;
    if (s > bestFree) bestFree = s;
    if (isHonorConsistent(plan) && s > bestHonor) bestHonor = s;
  }
  if (bestFree === -Infinity) return 0;
  // No honor-consistent plan: hold (no aggressive move) is the honor baseline.
  if (bestHonor === -Infinity) bestHonor = holdingScore(board, power);

  const gain = (bestFree - bestHonor) / PAYOFF_SCALE;
  return gain > 0 ? gain : 0;
}

// Score of the all-hold plan for `power` — the deterministic honor baseline when
// every candidate plan violates the agreement. Sums per-unit hold scores.
function holdingScore(board, power) {
  if (typeof board.getUnitLocations !== 'function' || typeof board.scoreOrder !== 'function') return 0;
  let score = 0;
  for (const unitLoc of board.getUnitLocations(power)) {
    score += board.scoreOrder({ type: 'hold', unitLoc }, power);
  }
  return score;
}

// Build a predicate: does a candidate plan keep `agreement` intact?
//   - dmz:            no order moves INTO any DMZ province.
//   - non-aggression: no order moves INTO a center occupied by the partner.
//   - joint-attack:   same as non-aggression toward the partner (don't attack
//                     the ally; honoring it presses the agreed target, not them).
//   - support:        keep the promised direction — don't move into the partner's
//                     occupied centers (a verifiable, plan-level constraint).
function honorPredicate(board, power, agreement, partner) {
  // Province ids are compared case-insensitively: agreements store lower-case ids
  // (e.g. 'spa') while board move targets are upper-case (e.g. 'SPA').
  const norm = (loc) => baseProvince(loc).toLowerCase();
  const movesInto = (plan, baseSet) =>
    (plan.orders || []).some((o) => o && o.type === 'move' && o.to && baseSet.has(norm(o.to)));

  if (agreement.type === 'dmz') {
    const dmz = new Set((agreement.provinces || []).map(norm));
    return (plan) => !movesInto(plan, dmz);
  }

  // Province bases the partner currently occupies (don't move into them).
  const partnerBases = new Set();
  if (partner && typeof board.getUnitLocations === 'function') {
    for (const loc of board.getUnitLocations(partner)) partnerBases.add(norm(loc));
  }
  return (plan) => !movesInto(plan, partnerBases);
}

// Threat list from the board: rival powers pressing this power, derived from
// supply-center standing (the leader and anyone bigger than us is a threat).
// Used so a power with no agreements still produces sensible targets. Returns
// powers other than `power` that are alive and at least as large as it.
function boardThreats(board, power) {
  if (!board || typeof board.getPowerIds !== 'function') return [];
  const alive = board.getPowerIds().filter((p) => p !== power);
  const own = typeof board.getSupplyCount === 'function' ? board.getSupplyCount(power) : 0;
  const leader = typeof board.getLeader === 'function' ? board.getLeader() : null;
  const threats = alive.filter((p) => {
    const c = typeof board.getSupplyCount === 'function' ? board.getSupplyCount(p) : 0;
    return c >= own;
  });
  // Ensure the leader is always considered a threat (even at a tie it's listed).
  if (leader && leader.power !== power && !threats.includes(leader.power)) {
    threats.push(leader.power);
  }
  return threats.sort();
}

// A unit of `partner` that can move into `toProvince` this turn (the attack we'd
// support when honouring a "I'll support your move into T" deal). null if none.
// Case-insensitive: negotiated deals may store lower-case province ids.
function partnerMoverInto(board, partner, toProvince) {
  if (!board || !partner || !toProvince || typeof board.getUnitLocations !== 'function') return null;
  const target = baseProvince(toProvince).toUpperCase();
  for (const loc of board.getUnitLocations(partner)) {
    const targets = typeof board.getMoveTargets === 'function' ? board.getMoveTargets(loc) : [];
    if (targets.some((t) => baseProvince(t).toUpperCase() === target)) return loc;
  }
  return null;
}

// decideStrategicIntent({ board, state, power, payoff, seed }) -> strategic intent.
//
//   payoff: optional override for the per-agreement gain-from-breaking. Either a
//           number (applied to every agreement) or a function (board, power,
//           agreement) -> number in ~[0,1]. Defaults to payoffOfBreaking, a
//           DEAL-SPECIFIC proxy (honor-constrained best plan vs. free best plan).
//           Deterministic in its inputs.
export function decideStrategicIntent({ board, state, power, payoff } = {}) {
  if (!power || typeof power !== 'string') {
    throw new Error('decideStrategicIntent requires a power');
  }

  const allies = new Set();
  const targets = new Set();
  const supportDeals = [];
  const dmz = new Set();
  const betrayals = [];
  const honoredPartners = new Set();
  const brokenPartners = new Set();

  const payoffOf = (agreement) => {
    if (typeof payoff === 'number') return payoff;
    if (typeof payoff === 'function') return payoff(board, power, agreement);
    // Per-agreement gain-from-breaking (#44), not one global number.
    return payoffOfBreaking(board, power, agreement);
  };

  const agreements = state ? getAgreementsFor(state, power) : [];
  // Partners with a standing agreement: the scratchpad-only targeting below only
  // applies to powers we have NO deal with (deals are resolved by the loop).
  const partnersWithDeal = new Set();

  for (const agreement of agreements) {
    const partner = agreementPartner(agreement, power);
    if (!partner) continue;
    partnersWithDeal.add(partner);

    // Ledger-dominant blend (#44): mechanical trust adjusted by the scratchpad.
    const trust = state ? effectiveTrust(state, power, partner) : 0;
    const rep = state ? reputationCost(state, power, partner) : 0;
    const gain = payoffOf(agreement);

    // Reputation is the PRICE of stabbing (a clean record makes the first stab
    // expensive), so it discounts the break payoff — it is not a tax on honouring.
    // Trust is the standing draw of the alliance. Break only when the tactical
    // gain, net of reputational cost, beats trust by the margin.
    const honorScore = trust * W_TRUST;
    const breakScore = gain * W_PAYOFF - rep * W_REP;
    // A power whose private read of the partner has turned openly hostile stabs
    // the deal regardless of immediate payoff — you don't keep your word to
    // someone you've decided is an enemy (this is how antagonising a power in
    // talks gets your standing deals with it broken).
    const hostile = state ? scratchpadMarksHostile(scratchpadDisposition(state, power, partner)) : false;
    const broken = hostile || breakScore > honorScore + MARGIN;

    if (broken) {
      brokenPartners.add(partner);
      betrayals.push({ type: agreement.type, partner });
      targets.add(partner);
    } else {
      honoredPartners.add(partner);
      // Honored deals shape allies / supportDeals / dmz by type.
      if (agreement.type === 'support') {
        allies.add(partner);
        // An AI↔AI deal records the SUPPORTER as actingPower; the mover side of
        // that deal owes no support order — it just keeps the ally relationship.
        if (!agreement.actingPower || agreement.actingPower === power) {
          // `from` (the moving unit we back) may be pre-set, or — for a deal
          // struck with another power — resolved now to that partner's unit
          // which can move into the agreed province, so we support THEIR attack.
          let from = agreement.from;
          // Negotiated deals carry a model-supplied mover province: trust it
          // only while the partner actually has a unit there, else re-resolve.
          if (agreement.actingPower && from && board && typeof board.unitAt === 'function') {
            const unit = board.unitAt(baseProvince(from).toUpperCase());
            if (!unit || unit.power !== partner) from = null;
          }
          if (!from && board) from = partnerMoverInto(board, partner, agreement.to);
          if (from && agreement.to) supportDeals.push({ from, to: agreement.to });
        }
      } else if (agreement.type === 'joint-attack') {
        allies.add(partner);
        if (agreement.target) targets.add(agreement.target);
      } else if (agreement.type === 'non-aggression') {
        allies.add(partner);
      } else if (agreement.type === 'dmz') {
        allies.add(partner);
        for (const prov of agreement.provinces || []) dmz.add(prov);
      }
    }
  }

  // A partner can be both honored on one deal and betrayed on another; once
  // betrayed it is a target and must not also be an ally (betrayal dominates).
  for (const p of brokenPartners) {
    allies.delete(p);
    honoredPartners.delete(p);
  }

  // Honoring a non-aggression / DMZ keeps the partner OUT of targets.
  for (const p of honoredPartners) targets.delete(p);

  // Thinking → pipeline (#44): the persisted scratchpad steers targets even with
  // NO standing deal. A hostile stance (enemy, or rival with a hostile intent)
  // toward a deal-less power presses them; a friendly/ally stance keeps them out
  // of targets — unless the ledger contradicts it (ledger dominates).
  const scratchpad = state ? getScratchpad(state, power) : null;
  if (scratchpad && scratchpad.dispositions) {
    for (const partner of Object.keys(scratchpad.dispositions)) {
      if (partner === power || partnersWithDeal.has(partner)) continue;
      const d = scratchpad.dispositions[partner];
      if (scratchpadMarksHostile(d)) {
        targets.add(partner);
        allies.delete(partner);
      } else if (scratchpadMarksFriendly(d)) {
        // Keep a self-declared friend off the target list only when the ledger
        // does not already distrust them (effectiveTrust >= 0).
        if (effectiveTrust(state, power, partner) >= 0) {
          allies.add(partner);
          honoredPartners.add(partner);
          targets.delete(partner);
        }
      }
    }
  }

  // Add board-derived threats so a power with no (or only honored) agreements
  // still has someone to press — but never a current ally.
  for (const t of boardThreats(board, power)) {
    if (!honoredPartners.has(t) && !allies.has(t)) targets.add(t);
  }

  return {
    power,
    allies: [...allies].sort(),
    targets: [...targets].sort(),
    supportDeals,
    dmz: [...dmz],
    betrayals,
  };
}

// Convenience: decide intents for every alive AI power (POWERS minus the human).
export function decideAllIntents({ board, state, humanPower, payoff } = {}) {
  const human = humanPower || (state && state.humanPower) || null;
  const aiPowers = (board && typeof board.getPowerIds === 'function'
    ? board.getPowerIds()
    : POWERS
  ).filter((p) => p !== human);
  const intents = {};
  for (const power of aiPowers) {
    intents[power] = decideStrategicIntent({ board, state, power, payoff });
  }
  return intents;
}
