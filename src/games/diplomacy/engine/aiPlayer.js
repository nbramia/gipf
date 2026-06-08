// Tactical order-selection AI for Diplomacy.
//
// Diplomacy is a 7-player SIMULTANEOUS-move game with no turn order and no dice,
// so a turn-based PUCT MCTS does not apply. Instead this engine runs a
// best-response / iterative-best-response search that uses the pure
// `DiplomacyBoard` as a forward model: it clones the board, fills predicted
// opponent orders, calls `applyMove`, and evaluates the resulting position.
//
// The board stays pure logic -- everything here touches it only through
// clone()/applyMove() and read-only getters.

import DiplomacyBoard, { baseProvince, orderKey } from '../DiplomacyBoard.js';

const POWERS = DiplomacyBoard.POWERS;

// difficulty -> search budget. Higher difficulty searches more of the power's
// own plans, samples more opponent combinations, and runs more best-response
// rounds.
const DIFFICULTY = {
  easy: { maxPlans: 6, oppPlans: 1, oppSamples: 1, brRounds: 0 },
  normal: { maxPlans: 14, oppPlans: 2, oppSamples: 2, brRounds: 1 },
  hard: { maxPlans: 24, oppPlans: 3, oppSamples: 3, brRounds: 2 },
};

function budgetFor(difficulty) {
  return DIFFICULTY[difficulty] || DIFFICULTY.normal;
}

// Deterministic, seedable PRNG (mulberry32). When no seed is supplied the engine
// still behaves deterministically because every consumer falls back to a fixed
// seed; randomness here only varies which opponent combinations get sampled.
function makeRng(seed) {
  let a = (seed >>> 0) || 0x9e3779b9;
  return function next() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function resolveSeed(seed, deterministic) {
  if (typeof seed === 'number') return seed;
  if (deterministic) return 12345;
  return 12345; // default deterministic seed: search is reproducible by default
}

// Stable lexical key for a whole plan's order set; used as a tie-breaker.
function planKey(orders) {
  return orders.map(orderKey).sort().join('|');
}

// ---------------------------------------------------------------------------
// intent bias
// ---------------------------------------------------------------------------

const ALLY_ATTACK_PENALTY = 800;
const TARGET_ATTACK_REWARD = 220;
const SUPPORT_DEAL_REWARD = 1200;
const DMZ_PENALTY = 900;

function normalizeIntent(intent) {
  if (!intent) return null;
  return {
    allies: new Set(intent.allies || []),
    targets: new Set(intent.targets || []),
    supportDeals: (intent.supportDeals || []).map(deal => ({ from: deal.from, to: deal.to })),
    dmz: new Set((intent.dmz || []).map(baseProvince)),
  };
}

// Is `order` an attack against (or dislodge-support against) a unit owned by one
// of `powers`? Used both for ally-protection and target-prioritization.
function orderAttacksPower(board, order, powers) {
  if (!powers || powers.size === 0) return false;
  let destBase = null;
  if (order.type === 'move') destBase = baseProvince(order.to);
  else if (order.type === 'support-move') destBase = baseProvince(order.to);
  else return false;
  const occupant = board.unitAt(destBase);
  return !!occupant && powers.has(occupant.power);
}

// Additive intent bias applied to a single order, evaluated against the board
// the order is issued from.
function intentOrderBias(board, order, intent) {
  if (!intent) return 0;
  let bias = 0;
  if (orderAttacksPower(board, order, intent.allies)) bias -= ALLY_ATTACK_PENALTY;
  if (orderAttacksPower(board, order, intent.targets)) bias += TARGET_ATTACK_REWARD;
  if (order.type === 'move' && intent.dmz.has(baseProvince(order.to))) bias -= DMZ_PENALTY;
  if (order.type === 'retreat' && order.to && intent.dmz.has(baseProvince(order.to))) bias -= DMZ_PENALTY;
  return bias;
}

// Reward a plan that fulfils an agreed support deal. A deal {from, to} is
// fulfilled when a unit at `from` issues a support order toward `to` (either
// support-hold of the unit at `to`, or support-move into `to`).
function intentPlanBias(board, orders, intent) {
  if (!intent) return 0;
  let bias = 0;
  for (const order of orders) bias += intentOrderBias(board, order, intent);
  for (const deal of intent.supportDeals) {
    const fulfilled = orders.some(order => {
      if (baseProvince(order.unitLoc) !== baseProvince(deal.from)) return false;
      if (order.type === 'support-hold') return baseProvince(order.target) === baseProvince(deal.to);
      if (order.type === 'support-move') {
        if (baseProvince(order.to) !== baseProvince(deal.to)) return false;
        // Only count a support that backs a REAL move into `to`: either our own
        // unit moving there in this same plan (a coordinated attack), or a unit
        // that isn't ours to plan (a negotiated cross-power support we honour).
        const mover = orders.find(o => baseProvince(o.unitLoc) === baseProvince(order.from));
        if (!mover) return true; // supported unit is another power's — honour it
        return mover.type === 'move' && baseProvince(mover.to) === baseProvince(deal.to);
      }
      return false;
    });
    if (fulfilled) bias += SUPPORT_DEAL_REWARD;
  }
  return bias;
}

// ---------------------------------------------------------------------------
// positional value (forward-model evaluation)
// ---------------------------------------------------------------------------

// Evaluate a resolved position for `power`. The dominant term is center delta
// versus the current leader; secondary terms reward centers owned/threatened,
// dislodgements caused and units kept, and penalize dislodgements suffered.
//
// `dislodged` is the resolution's pending-retreat list (this.pendingRetreats on
// the resolved clone): each entry caused us a unit loss if it's ours, or an
// enemy loss we caused if it's not.
function evaluatePosition(board, power) {
  const myCenters = board.getSupplyCount(power);
  let leaderCenters = 0;
  for (const other of POWERS) {
    if (other === power) continue;
    const c = board.getSupplyCount(other);
    if (c > leaderCenters) leaderCenters = c;
  }
  // Center delta vs. the strongest rival dominates.
  let score = (myCenters - leaderCenters) * 1000;
  score += myCenters * 120;
  score += board.getUnitCount(power) * 30;

  // Centers we threaten (a unit of ours adjacent-occupying a non-owned center).
  for (const loc of board.getUnitLocations(power)) {
    const base = baseProvince(loc);
    const province = DiplomacyBoard.PROVINCES[base];
    if (province?.supply && board.supplyCenters[base] !== power) score += 90;
  }

  // Dislodgements: ours suffered (bad) vs. opponents' caused (good).
  for (const entry of board.pendingRetreats || []) {
    if (entry.unit.power === power) score -= 250;
    else score += 160;
  }

  return score;
}

// ---------------------------------------------------------------------------
// orders-phase best-response search
// ---------------------------------------------------------------------------

// Predict each opponent's likely orders: their own top heuristic plan(s).
// Returns { power -> [plan, plan, ...] } limited to `oppPlans` each.
function predictOpponentPlans(board, power, oppPlans) {
  const predictions = {};
  for (const other of POWERS) {
    if (other === power) continue;
    if (board.getUnitLocations(other).length === 0) {
      predictions[other] = [[]];
      continue;
    }
    const plans = board.generateCandidatePlans(other, { maxPlans: oppPlans });
    predictions[other] = plans.slice(0, oppPlans).map(plan => plan.orders);
  }
  return predictions;
}

// Build `count` opponent-order combinations by sampling one predicted plan per
// opponent. Sample 0 is always every opponent's top plan (the modal forecast);
// extra samples vary one opponent at a time, chosen by the seeded rng so the
// set is reproducible.
function sampleOpponentCombos(predictions, count, rng) {
  const opponents = Object.keys(predictions);
  const top = {};
  for (const o of opponents) top[o] = predictions[o][0] || [];

  const combos = [{ ...top }];
  for (let i = 1; i < count; i++) {
    const combo = { ...top };
    for (const o of opponents) {
      const choices = predictions[o];
      if (choices.length > 1) combo[o] = choices[Math.floor(rng() * choices.length)] || top[o];
    }
    combos.push(combo);
  }
  return combos;
}

// Score one of `power`'s candidate plans by the expected resolved value across
// the sampled opponent combinations (plus this plan's intent bias).
function scorePlanAgainstCombos(board, power, planOrders, combos, intent) {
  let total = 0;
  for (const combo of combos) {
    const clone = board.clone();
    const ordersByPower = { ...combo, [power]: planOrders };
    clone.applyMove({ type: 'orders', ordersByPower });
    total += evaluatePosition(clone, power);
  }
  const avg = total / combos.length;
  return avg + intentPlanBias(board, planOrders, intent);
}

// Pick the best plan for `power` by best-response against fixed opponent combos.
// Returns { orders, score }. Ties broken by plan score then lexical orderKey.
function bestResponse(board, power, ownPlans, combos, intent) {
  let best = null;
  for (const plan of ownPlans) {
    const value = scorePlanAgainstCombos(board, power, plan.orders, combos, intent);
    const key = planKey(plan.orders);
    if (
      !best ||
      value > best.value ||
      (value === best.value && (plan.score || 0) > (best.heur || 0)) ||
      (value === best.value && (plan.score || 0) === (best.heur || 0) && key < best.key)
    ) {
      best = { orders: plan.orders, value, heur: plan.score || 0, key };
    }
  }
  return best || { orders: board.getUnitLocations(power).map(unitLoc => ({ type: 'hold', unitLoc })), value: 0 };
}

// Orders-phase search entry point. Generates the power's candidate plans,
// predicts opponents, samples a bounded set of opponent combinations, and
// best-responds. With brRounds > 0 it runs bounded iterative best-response: each
// round the opponents' current best replaces their predicted top plan, and the
// power best-responds again, converging toward an equilibrium.
function searchOrders(board, power, { intent, difficulty, seed, deterministic }) {
  const budget = budgetFor(difficulty);
  const rng = makeRng(resolveSeed(seed, deterministic));

  if (board.getUnitLocations(power).length === 0) return [];

  const ownPlans = board.generateCandidatePlans(power, { maxPlans: budget.maxPlans });
  // Inject a coherent plan that fulfils each agreed support deal — the beam
  // can't reliably assemble these, so build them explicitly; the deal reward then
  // lets one win when honouring is best. Own-unit movers => a coordinated attack
  // we make; another power's mover => we back THEIR move (a negotiated support).
  for (const deal of (intent && intent.supportDeals) || []) {
    const toBase = baseProvince(deal.to);
    const fromUnit = board.unitAt(baseProvince(deal.from));
    const plan = fromUnit && fromUnit.power === power
      ? board.buildSupportedAttackPlan(power, toBase, { requireSupporter: deal.from })
      : board.buildCrossSupportPlan(power, deal.from, toBase);
    if (plan) ownPlans.unshift(plan);
  }
  const predictions = predictOpponentPlans(board, power, budget.oppPlans);

  // Current best-known orders for each opponent (used by iterative BR).
  const oppBest = {};
  for (const o of Object.keys(predictions)) oppBest[o] = predictions[o][0] || [];

  let combos = sampleOpponentCombos(predictions, budget.oppSamples, rng);
  let result = bestResponse(board, power, ownPlans, combos, intent);

  for (let round = 0; round < budget.brRounds; round++) {
    // Each opponent best-responds to the others' current best plus our latest.
    for (const o of Object.keys(predictions)) {
      if (board.getUnitLocations(o).length === 0) continue;
      const oppPlans = board.generateCandidatePlans(o, { maxPlans: budget.oppPlans });
      const fixed = { ...oppBest, [power]: result.orders };
      const oppCombos = [fixed];
      const oppResult = bestResponse(board, o, oppPlans, oppCombos, null);
      oppBest[o] = oppResult.orders;
    }
    combos = [{ ...oppBest }];
    result = bestResponse(board, power, ownPlans, combos, intent);
  }

  return result.orders;
}

// ---------------------------------------------------------------------------
// retreats + adjustments
// ---------------------------------------------------------------------------

function searchRetreats(board, power, { intent }) {
  const plans = board.generateRetreatPlans(power);
  let best = null;
  for (const plan of plans) {
    let score = plan.score || 0;
    for (const order of plan.retreats) score += intentOrderBias(board, order, intent);
    const key = (plan.retreats || []).map(orderKey).sort().join('|');
    if (!best || score > best.score || (score === best.score && key < best.key)) {
      best = { retreats: plan.retreats, score, key };
    }
  }
  return best ? best.retreats : [];
}

function searchAdjustments(board, power, { intent }) {
  const plans = board.generateAdjustmentPlans(power);
  let best = null;
  for (const plan of plans) {
    let score = plan.score || 0;
    for (const order of plan.adjustments) {
      // Penalize building into a dmz province; builds carry a `loc`.
      if (order.type === 'build' && intent && intent.dmz.has(baseProvince(order.loc))) score -= DMZ_PENALTY;
    }
    const key = (plan.adjustments || []).map(orderKey).sort().join('|');
    if (!best || score > best.score || (score === best.score && key < best.key)) {
      best = { adjustments: plan.adjustments, score, key };
    }
  }
  return best ? best.adjustments : [];
}

// ---------------------------------------------------------------------------
// public async interface
// ---------------------------------------------------------------------------

function normalizeOptions({ intent = null, difficulty = 'normal', seed = null, deterministic = false } = {}) {
  return { intent: normalizeIntent(intent), difficulty, seed, deterministic };
}

async function getOrders(board, power, options = {}) {
  const opts = normalizeOptions(options);
  if (!board.isOrdersPhase()) return { orders: [] };
  // Demote wasted self-supports / unconvoyed sails so the orders read coherently.
  return { orders: board.makeOrdersCoherent(searchOrders(board, power, opts), power) };
}

async function getRetreats(board, power, options = {}) {
  const opts = normalizeOptions(options);
  if (!board.isRetreatPhase()) return { retreats: [] };
  return { retreats: searchRetreats(board, power, opts) };
}

async function getAdjustments(board, power, options = {}) {
  const opts = normalizeOptions(options);
  if (!board.isWinterPhase()) return { adjustments: [] };
  return { adjustments: searchAdjustments(board, power, opts) };
}

export { getOrders, getRetreats, getAdjustments, evaluatePosition };
