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
//   honorScore = trust(partner) * W_trust  -  reputationCost(partner) * W_rep
//   breakScore = payoffGain(breaking)      *  W_payoff
//   BREAK iff breakScore > honorScore + MARGIN
//
// reputationCost(partner) scales with how treacherous the power has already been
// toward that partner (its broken/kept ledger), weighted by the trust deltas, so
// a power that has burned a partner before pays less marginal reputation to do it
// again — but a clean reputation makes the first stab expensive.

import { POWERS } from '../DiplomacyBoard.js';
import {
  getTrust,
  getLedger,
  getAgreementsFor,
  agreementPartner,
} from './diplomaticState.js';
import { TRUST_DELTAS } from './trustModel.js';

// Named, tunable decision weights (exported for tests + downstream tuning).
export const W_TRUST = 1.0;   // weight on trusting an ally (favors honoring)
export const W_REP = 1.0;     // weight on reputational cost of betrayal
export const W_PAYOFF = 1.0;  // weight on the tactical gain from breaking
export const MARGIN = 0.15;   // breaking must clear honoring by this much

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

// Local tactical-payoff proxy: how much standing this power could gain by NOT
// being bound by its deals — approximated from the best candidate plan's score
// relative to its current footprint. Returns a value in ~[0,1] after scaling.
// Callers may inject `payoff` to override (e.g. a real search signal).
function defaultPayoffGain(board, power) {
  if (!board || typeof board.generateCandidatePlans !== 'function') return 0;
  let plans;
  try {
    plans = board.generateCandidatePlans(power, { maxPlans: 8 });
  } catch (_) {
    return 0;
  }
  if (!Array.isArray(plans) || plans.length === 0) return 0;
  const best = plans.reduce((m, p) => Math.max(m, p.score || 0), 0);
  return best / PAYOFF_SCALE;
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

// decideStrategicIntent({ board, state, power, payoff, seed }) -> strategic intent.
//
//   payoff: optional override for the per-power tactical-gain proxy. Either a
//           number (applied to every agreement) or a function (board, power,
//           agreement) -> number in ~[0,1]. Defaults to a local proxy via
//           generateCandidatePlans/scoreOrder. No randomness unless `seed` given
//           (the decision is deterministic in its inputs regardless).
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
    return defaultPayoffGain(board, power);
  };

  const agreements = state ? getAgreementsFor(state, power) : [];

  for (const agreement of agreements) {
    const partner = agreementPartner(agreement, power);
    if (!partner) continue;

    const trust = state ? getTrust(state, power, partner) : 0;
    const rep = state ? reputationCost(state, power, partner) : 0;
    const gain = payoffOf(agreement);

    const honorScore = trust * W_TRUST - rep * W_REP;
    const breakScore = gain * W_PAYOFF;
    const broken = breakScore > honorScore + MARGIN;

    if (broken) {
      brokenPartners.add(partner);
      betrayals.push({ type: agreement.type, partner });
      targets.add(partner);
    } else {
      honoredPartners.add(partner);
      // Honored deals shape allies / supportDeals / dmz by type.
      if (agreement.type === 'support') {
        allies.add(partner);
        supportDeals.push({ from: agreement.from, to: agreement.to });
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

  // Add board-derived threats so a power with no (or only honored) agreements
  // still has someone to press — but never a current ally.
  for (const t of boardThreats(board, power)) {
    if (!honoredPartners.has(t)) targets.add(t);
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
