// Turn controller for Diplomacy ([Negotiation Loop] PR1).
//
// A UI-level state machine that ties every prior piece into one playable loop:
//
//   negotiation -> orders -> resolving -> retreats -> winter -> (next) negotiation
//
// The NEGOTIATION phase is UI-only (it precedes each engine *-orders phase and is
// NOT an engine phase — DiplomacyBoard.js is never modified). During negotiation
// the human chats with any AI power (ChatPanel) and the AI↔AI orchestrator
// (runNegotiationPhase) runs its bounded private rounds, evolving the hidden
// diplomatic state. "Proceed to orders" advances; the human then enters only
// their own power's orders while AI powers' orders are computed via
// intentBinding.bindOrders using betrayalModel.decideStrategicIntent per AI power
// plus the tactical getOrders (off-thread via the worker where available, with a
// main-thread fallback). After adjudication the honored/broken signal is fed to
// the trust model exactly once.
//
// Mirrors Catan's AI-loop discipline: an `isBusy` ref guards re-entrancy, async
// work is wrapped so no rejection ever breaks the turn, and every phase has a
// deterministic exit (full no-key / all-failure fallback to no-intent tactical
// orders -> hold). Never stalls; never emits illegal orders (intentBinding only
// returns orders that survive the engine's sanitizer for the acting power).

import { useCallback, useEffect, useRef, useState } from 'react';
import DiplomacyBoard from '../DiplomacyBoard.js';
import * as aiPlayer from '../engine/aiPlayer.js';
import { decideStrategicIntent } from '../agents/betrayalModel.js';
import { bindOrders, bindRetreats, bindAdjustments, reconcileHonored } from '../agents/intentBinding.js';
import { updateTrustAfterAdjudication } from '../agents/trustModel.js';
import { runNegotiationPhase } from '../agents/negotiator.js';
import { askAgent, hasApiKey } from '../agents/agentClient.js';
import { serializeBoardContext } from '../agents/serializeContext.js';

// Hard caps so a phase always terminates even if every AI call hangs/fails.
// The hidden AI↔AI rounds (~8 calls/turn, never read by the human) run on the
// cheaper Haiku model; human-facing replies/outreach keep the endpoint default
// (Sonnet) for stronger, more believable negotiation.
const AI_TO_AI_MODEL = 'claude-haiku-4-5-20251001';
const NEGOTIATION_OPTIONS = { maxRounds: 2, maxPairsPerRound: 4, aiModel: AI_TO_AI_MODEL };

// AI powers in the controller config (everything not 'human').
function aiPowersOf(controllers, board) {
  const alive = new Set(board.getPowerIds());
  return Object.keys(controllers || {})
    .filter((p) => controllers[p] === 'AI' && alive.has(p));
}

// Build the strategic intents for every AI power from the hidden diplomatic
// state. Pure + synchronous; a thrown decision never aborts the loop.
function decideIntents(board, diplomaticState, aiPowers) {
  const intents = {};
  for (const power of aiPowers) {
    try {
      intents[power] = decideStrategicIntent({ board, state: diplomaticState, power });
    } catch (_) {
      intents[power] = null; // no-intent fallback for this power
    }
  }
  return intents;
}

// A `getOrders(board, power, options)` adapter for intentBinding that runs the
// tactical search off-thread via the worker when supported, falling back to the
// main-thread engine. Worker calls are serialized (one in-flight callback) and
// each carries that power's own `options` (intent + difficulty), so per-power
// intent is honored even off-thread.
function makeGetOrders({ workerSupported, computeOrders }) {
  return function getOrders(board, power, options = {}) {
    if (workerSupported && computeOrders) {
      return new Promise((resolve) => {
        let settled = false;
        const finish = (orders) => {
          if (settled) return;
          settled = true;
          resolve({ orders: orders || [] });
        };
        try {
          computeOrders(
            board.serializeState(),
            [power],
            options,
            (data) => finish((data && data.byPower && data.byPower[power]) || []),
            // On worker error fall back to the main-thread engine.
            () => {
              aiPlayer.getOrders(board, power, options).then(finish).catch(() => finish([]));
            }
          );
        } catch (_) {
          aiPlayer.getOrders(board, power, options).then(finish).catch(() => finish([]));
        }
      });
    }
    return aiPlayer.getOrders(board, power, options);
  };
}

export default function useDiplomacyTurn({
  board,
  setBoard,
  controllers,
  humanPower,
  difficultyBudget,
  diplomaticState,
  setDiplomaticState,
  personas,
  conversations,
  setConversations,
  workerSupported,
  computeOrders,
  onPhaseSettled,
}) {
  // The UI phase machine. Engine phases (orders/retreats/winter) are reflected
  // from board.phase; 'negotiation' and 'resolving' are pure UI states.
  const [uiPhase, setUiPhase] = useState('negotiation');
  const [isBusy, setIsBusy] = useState(false);
  const [progress, setProgress] = useState('');
  const busyRef = useRef(false); // re-entrancy guard (mirrors Catan's isAiThinking)

  // Strategic intents for the AI powers this orders phase. Captured when orders
  // are computed and re-used by reconcileHonored after adjudication.
  const intentsRef = useRef(null);

  const getOrders = useCallback(
    () => makeGetOrders({ workerSupported, computeOrders }),
    [workerSupported, computeOrders]
  );

  // Whenever the engine lands on a *-orders phase that the UI machine hasn't yet
  // gated behind negotiation, drop back into negotiation first.
  useEffect(() => {
    if (board.phase === 'game-over') {
      setUiPhase('game-over');
      return;
    }
    if (board.isRetreatPhase()) {
      setUiPhase('retreats');
    } else if (board.isWinterPhase()) {
      setUiPhase('winter');
    }
    // Orders/negotiation transitions are driven explicitly by the controls below,
    // not by this effect, so a manual "Proceed to orders" isn't undone.
  }, [board.phase, board]); // board identity changes on every clone()

  const settle = useCallback(
    (nextUiPhase, nextState) => {
      if (onPhaseSettled) {
        onPhaseSettled({
          uiPhase: nextUiPhase,
          diplomaticState: nextState !== undefined ? nextState : diplomaticState,
        });
      }
    },
    [onPhaseSettled, diplomaticState]
  );

  // ----- negotiation phase -----

  // Run the bounded AI↔AI negotiation for the turn: evolve the hidden diplomatic
  // state, let AI powers answer any open human threads, AND let the most-relevant
  // neighbours proactively open talks with the human (initiateHuman). New AI→human
  // messages land in the shared `conversations` store, which is refreshed so the
  // chat panel and its unread indicator update. Returns the next state. With no
  // key the orchestrator still completes (askAgent returns empty replies).
  const runNegotiation = useCallback(async () => {
    if (busyRef.current) return diplomaticState;
    busyRef.current = true;
    setIsBusy(true);
    setProgress('The powers are conferring…');
    let nextState = diplomaticState;
    try {
      const agents = {};
      const aiPowers = aiPowersOf(controllers, board);
      for (const power of aiPowers) {
        agents[power] = {
          persona: personas ? personas[power] : null,
          boardContext: safeContext(board, power),
        };
      }
      // The human-visible thread store is passed so AI powers can answer open
      // human threads and open new ones — AI↔AI transcripts stay OUT of it.
      if (conversations) agents.humanThreads = conversations;

      const result = await runNegotiationPhase({
        board,
        state: diplomaticState,
        agents,
        askAgent,
        options: { ...NEGOTIATION_OPTIONS, humanPower, initiateHuman: true },
      });
      if (result && result.state) nextState = result.state;
    } catch (_) {
      // Any failure: keep the prior diplomatic state, continue.
    }

    if (setDiplomaticState) setDiplomaticState(nextState);
    // runNegotiationPhase mutates the thread store in place; hand the component a
    // fresh reference so React re-renders the chat + unread badges.
    if (setConversations && conversations) {
      setConversations({ threads: { ...conversations.threads } });
    }
    busyRef.current = false;
    setIsBusy(false);
    setProgress('');
    settle('negotiation', nextState);
    return nextState;
  }, [board, controllers, personas, conversations, setConversations, diplomaticState, setDiplomaticState, humanPower, settle]);

  // ----- orders phase: compute AI orders, merge human orders, adjudicate -----

  // Compute the AI powers' orders (intent-bound, off-thread where possible) and
  // return ordersByPower for the AI powers. Never throws.
  const computeAiOrders = useCallback(async () => {
    const aiPowers = aiPowersOf(controllers, board);
    const intents = decideIntents(board, diplomaticState, aiPowers);
    intentsRef.current = intents;
    try {
      return await bindOrders(board, intents, getOrders(), { difficulty: difficultyBudget.difficulty });
    } catch (_) {
      // Total failure -> every AI power holds (always legal).
      const fallback = {};
      for (const power of aiPowers) {
        fallback[power] = board.getUnitLocations(power).map((unitLoc) => ({ type: 'hold', unitLoc }));
      }
      return fallback;
    }
  }, [board, controllers, diplomaticState, difficultyBudget, getOrders]);

  // Submit the orders phase. `humanOrdersByPower` maps each human power to its
  // entered orders (an object keyed by unitLoc or an array). AI orders are
  // computed here. Adjudicates, feeds trust, advances to the resulting phase.
  const submitOrders = useCallback(
    async (humanOrdersByPower) => {
      if (busyRef.current || !board.isOrdersPhase()) return;
      busyRef.current = true;
      setIsBusy(true);
      setUiPhase('resolving');
      setProgress('Resolving orders…');

      const aiOrders = await computeAiOrders();

      // Merge: human powers from the UI (default hold), AI powers from binding.
      const ordersByPower = {};
      for (const power of board.powers) {
        if (controllers[power] === 'human') {
          const entered = (humanOrdersByPower && humanOrdersByPower[power]) || {};
          const list = Array.isArray(entered) ? entered : Object.values(entered);
          ordersByPower[power] = board
            .getUnitLocations(power)
            .map((loc) => byLoc(list, loc) || { type: 'hold', unitLoc: loc });
        } else if (aiOrders[power]) {
          ordersByPower[power] = aiOrders[power];
        }
      }

      const working = board.clone();
      working.applyMove({ type: 'orders', ordersByPower });

      // Feed honored/broken to the trust model exactly once for this orders phase.
      let nextState = diplomaticState;
      try {
        const intents = intentsRef.current || {};
        reconcileHonored(working, intents); // computed for symmetry / side-effect-free
        const actingPowers = Object.keys(intents);
        nextState = updateTrustAfterAdjudication(diplomaticState, working, { actingPowers });
      } catch (_) {
        nextState = diplomaticState;
      }
      if (setDiplomaticState) setDiplomaticState(nextState);

      setBoard(working);
      const nextUi = working.phase === 'game-over'
        ? 'game-over'
        : working.isRetreatPhase()
          ? 'retreats'
          : working.isWinterPhase()
            ? 'winter'
            : 'negotiation';
      setUiPhase(nextUi);
      busyRef.current = false;
      setIsBusy(false);
      setProgress('');
      settle(nextUi, nextState);
    },
    [board, controllers, computeAiOrders, diplomaticState, setBoard, setDiplomaticState, settle]
  );

  // ----- retreat phase -----

  const submitRetreats = useCallback(
    async (humanRetreatsByPower) => {
      if (busyRef.current || !board.isRetreatPhase()) return;
      busyRef.current = true;
      setIsBusy(true);
      setProgress('Resolving retreats…');

      const aiPowers = aiPowersOf(controllers, board);
      const intents = decideIntents(board, diplomaticState, aiPowers);
      let aiRetreats = {};
      try {
        aiRetreats = await bindRetreats(board, intents, getOrders(), { difficulty: difficultyBudget.difficulty });
      } catch (_) {
        aiRetreats = {};
      }

      const retreatsByPower = {};
      for (const entry of board.pendingRetreats) {
        const power = entry.unit.power;
        if (!retreatsByPower[power]) retreatsByPower[power] = [];
        if (controllers[power] === 'human') {
          const human = (humanRetreatsByPower && humanRetreatsByPower[power]) || {};
          const choice = human[entry.unitLoc];
          const to = !choice || choice === 'DISBAND' ? null : choice;
          retreatsByPower[power].push({ type: 'retreat', unitLoc: entry.unitLoc, to });
        }
      }
      // Merge AI retreats (already legal per pendingRetreats options).
      for (const [power, list] of Object.entries(aiRetreats)) {
        if (controllers[power] === 'human') continue;
        retreatsByPower[power] = (list || []).map((r) => ({ type: 'retreat', ...r }));
      }

      const working = board.clone();
      working.applyMove({ type: 'retreats', retreatsByPower });
      setBoard(working);
      const nextUi = working.phase === 'game-over'
        ? 'game-over'
        : working.isWinterPhase()
          ? 'winter'
          : 'negotiation';
      setUiPhase(nextUi);
      busyRef.current = false;
      setIsBusy(false);
      setProgress('');
      settle(nextUi, diplomaticState);
    },
    [board, controllers, diplomaticState, difficultyBudget, getOrders, setBoard, settle]
  );

  // ----- winter phase -----

  const submitAdjustments = useCallback(
    async (humanAdjustmentsByPower) => {
      if (busyRef.current || !board.isWinterPhase()) return;
      busyRef.current = true;
      setIsBusy(true);
      setProgress('Resolving adjustments…');

      const aiPowers = aiPowersOf(controllers, board);
      const intents = decideIntents(board, diplomaticState, aiPowers);
      let aiAdj = {};
      try {
        aiAdj = await bindAdjustments(board, intents, getOrders(), { difficulty: difficultyBudget.difficulty });
      } catch (_) {
        aiAdj = {};
      }

      const adjustmentsByPower = {};
      for (const power of board.powers) {
        if (controllers[power] === 'human') {
          adjustmentsByPower[power] = (humanAdjustmentsByPower && humanAdjustmentsByPower[power]) || [];
        } else {
          adjustmentsByPower[power] = aiAdj[power] || [];
        }
      }

      const working = board.clone();
      working.applyMove({ type: 'adjustments', adjustmentsByPower });
      setBoard(working);
      const nextUi = working.phase === 'game-over' ? 'game-over' : 'negotiation';
      setUiPhase(nextUi);
      busyRef.current = false;
      setIsBusy(false);
      setProgress('');
      settle(nextUi, diplomaticState);
    },
    [board, controllers, diplomaticState, difficultyBudget, getOrders, setBoard, settle]
  );

  // Move from negotiation to order entry (the human's explicit "Proceed"). The
  // AI↔AI negotiation now runs automatically when the negotiation phase begins
  // (runNegotiation), so this just advances — it never blocks on AI calls.
  const proceedToOrders = useCallback(() => {
    if (busyRef.current) return;
    setUiPhase('orders');
    settle('orders', diplomaticState);
  }, [settle, diplomaticState]);

  // Re-enter the saved UI phase on load (called by the game on mount-restore).
  const restoreUiPhase = useCallback((phase) => {
    if (phase) setUiPhase(phase);
  }, []);

  return {
    uiPhase,
    setUiPhase,
    isBusy,
    progress,
    runNegotiation,
    proceedToOrders,
    submitOrders,
    submitRetreats,
    submitAdjustments,
    restoreUiPhase,
    hasKey: hasApiKey(),
  };
}

// Find an order for a unit location in a list (matches by base/exact unitLoc).
function byLoc(list, loc) {
  if (!Array.isArray(list)) return null;
  return list.find((o) => o && o.unitLoc === loc) || null;
}

// serializeBoardContext throws without a power; guard it so a missing power can't
// abort negotiation setup.
function safeContext(board, power) {
  try {
    return serializeBoardContext(board, { power });
  } catch (_) {
    return null;
  }
}

export { makeGetOrders, decideIntents };
