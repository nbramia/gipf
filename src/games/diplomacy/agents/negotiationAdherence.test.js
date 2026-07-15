// Adherence harness for the AI↔AI negotiation pipeline ([AI Negotiation]).
//
// Drives a headless, ALL-AI multi-year game through the REAL pipeline —
// runNegotiationPhase (mocked askAgent emitting deals in the exact endpoint
// schema) -> diplomatic state -> decideStrategicIntent -> bindOrders (real
// tactical engine) -> applyMove -> reconcileHonored — and measures:
//
//   1. agreements recorded per game year (audit baseline before the bilateral
//      rework: ~0, because endpoint-schema deals were silently dropped), and
//   2. the share of committed support deals that actually appear as issued
//      support orders after adjudication (deal adherence via reconcileHonored).
//
// No React, no network, no key: askAgent is a deterministic mock.

import DiplomacyBoard from '../DiplomacyBoard.js';
import { createDiplomaticState } from './diplomaticState.js';
import { runNegotiationPhase } from './negotiator.js';
import { decideStrategicIntent } from './betrayalModel.js';
import { bindOrders, bindRetreats, bindAdjustments, reconcileHonored } from './intentBinding.js';
import { updateTrustAfterAdjudication } from './trustModel.js';
import * as aiPlayer from '../engine/aiPlayer.js';

// A legal "I support your move into T" deal for this channel, computed from the
// live board in the ENDPOINT's schema (province-level from/to, no parties): the
// mover is one of `mover`'s units, the target reachable by it and supportable by
// one of `supporter`'s units. null when the pair has no such geometry.
function findSupportDeal(board, supporter, mover) {
  for (const loc of board.getUnitLocations(mover)) {
    for (const t of board.getMoveTargets(loc)) {
      const target = t.split('/')[0];
      for (const s of board.getUnitLocations(supporter)) {
        if (s === loc) continue;
        if (board.canSupport(board.units[s].type, s, target)) {
          return { type: 'support', from: loc, to: target };
        }
      }
    }
  }
  return null;
}

// Deterministic agent mock: proposers offer a legal support deal for their
// channel (non-aggression when the pair has no support geometry); counterparties
// accept every pending proposal.
function makeAskAgent(board) {
  return async (ctx) => {
    if (ctx.proposedDeal) return { reply: { message: 'Agreed.', accept: true } };
    const rival = ctx.counterparties[0];
    const deal = findSupportDeal(board, ctx.power, rival) || { type: 'non-aggression' };
    return { reply: { message: 'A concrete offer.', deal } };
  };
}

const ALL_AI = ['austria', 'england', 'france', 'germany', 'italy', 'russia', 'turkey'];

function decideIntents(board, state) {
  const intents = {};
  for (const power of board.getPowerIds()) {
    intents[power] = decideStrategicIntent({ board, state, power });
  }
  return intents;
}

describe('AI↔AI negotiation adherence (headless all-AI game)', () => {
  test('deals record every year and committed supports are issued', async () => {
    const board = new DiplomacyBoard({ maxYears: 1903 });
    let state = createDiplomaticState({ board, humanPower: null });

    const recordedIdsByYear = {}; // year -> Set of agreement ids seen
    let honoredTotal = 0;
    let brokenTotal = 0;
    let committedTotal = 0;
    let crossSupportIssued = 0; // issued support-move orders backing ANOTHER power's unit

    let guard = 0;
    while (guard++ < 24 && board.phase !== 'game-over' && board.year <= 1902) {
      if (board.isOrdersPhase()) {
        // 1) Negotiation with the real orchestrator + scripted endpoint-schema mock.
        const result = await runNegotiationPhase({
          board,
          state,
          askAgent: makeAskAgent(board),
          options: { maxRounds: 2, maxPairsPerRound: 2, humanPower: null, seed: board.year * 10 + (board.season === 'fall' ? 1 : 0) },
        });
        state = result.state;
        const yearIds = recordedIdsByYear[board.year] || (recordedIdsByYear[board.year] = new Set());
        for (const a of state.agreements) yearIds.add(a.id);
        for (const p of state.promises) yearIds.add(p.id);

        // 2) Intents -> orders -> adjudication, exactly as the turn loop does.
        const intents = decideIntents(board, state);
        for (const power of Object.keys(intents)) {
          committedTotal += (intents[power].supportDeals || []).length;
        }
        const ordersByPower = await bindOrders(board, intents, aiPlayer.getOrders, { difficulty: 'easy' });
        expect(board.applyMove({ type: 'orders', ordersByPower })).toBe(true);

        // 3) Post-adjudication adherence via reconcileHonored.
        const outcome = reconcileHonored(board, intents);
        for (const power of Object.keys(outcome)) {
          honoredTotal += outcome[power].honored.length;
          brokenTotal += outcome[power].broken.length;
        }
        // Cross-power coordination: a support-move whose supported mover belongs
        // to a DIFFERENT power (each issued order records its acting power).
        const issued = board.orderHistory[0].orders;
        for (const order of Object.values(issued)) {
          if (order.type !== 'support-move') continue;
          const mover = issued[order.from];
          if (mover && mover.power && order.power && mover.power !== order.power) crossSupportIssued++;
        }

        state = updateTrustAfterAdjudication(state, board, { actingPowers: Object.keys(intents) });
      } else if (board.isRetreatPhase()) {
        const intents = decideIntents(board, state);
        const retreatsByPower = await bindRetreats(board, intents, aiPlayer.getOrders, {});
        expect(board.applyMove({ type: 'retreats', retreatsByPower })).toBe(true);
      } else if (board.isWinterPhase()) {
        const intents = decideIntents(board, state);
        const adjustmentsByPower = await bindAdjustments(board, intents, aiPlayer.getOrders, {});
        expect(board.applyMove({ type: 'adjustments', adjustmentsByPower })).toBe(true);
      }
    }

    const years = Object.keys(recordedIdsByYear);
    const adherence = honoredTotal + brokenTotal > 0 ? honoredTotal / (honoredTotal + brokenTotal) : 0;
    // Surface the metrics in the test output (the audit's reporting requirement).
    // eslint-disable-next-line no-console
    console.log(
      `[adherence] years=${years.length} ` +
      years.map((y) => `${y}:${recordedIdsByYear[y].size} deals`).join(', ') +
      ` | committed support deals=${committedTotal}, honored=${honoredTotal}, broken=${brokenTotal}` +
      ` (adherence ${(adherence * 100).toFixed(0)}%) | cross-power supports issued=${crossSupportIssued}`
    );

    // ≥ 1 agreement recorded per game year (audit baseline: ~0).
    expect(years.length).toBeGreaterThanOrEqual(2);
    for (const y of years) expect(recordedIdsByYear[y].size).toBeGreaterThanOrEqual(1);

    // Deals flow into intents, and ≥70% of committed supports are issued orders.
    expect(honoredTotal + brokenTotal).toBeGreaterThan(0);
    expect(adherence).toBeGreaterThanOrEqual(0.7);
  }, 120000);
});
