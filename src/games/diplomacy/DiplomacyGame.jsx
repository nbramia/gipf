// DiplomacyGame.jsx - React UI + SVG rendering for classic Diplomacy.
//
// Full playable loop ([Negotiation Loop]): new-game setup -> per-season
// negotiation (human chat + bounded AI↔AI) -> the human enters only their own
// power's orders while AI powers are computed via intent binding + tactical AI ->
// adjudicate -> retreats -> winter -> next season, vs six AI powers, with full
// versioned save/resume. The turn orchestration lives in useDiplomacyTurn; the
// engine (DiplomacyBoard) stays pure logic, consumed via clone/applyMove/
// serializeState only. All legal options are sourced from the engine — the UI
// never computes adjacency itself.

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import DiplomacyBoard, {
  POWERS,
  POWER_NAMES,
  POWER_SHORT_NAMES,
  POWER_COLORS,
  POWER_ACCENTS,
  PROVINCES,
  baseProvince,
  coastOf,
  formatUnitType,
} from './DiplomacyBoard.js';
import ChatPanel from './agents/ChatPanel.jsx';
import { createMemory } from './agents/memory.js';
import { createDiplomaticState, setScratchpad, recordAgreement } from './agents/diplomaticState.js';
import { PERSONAS } from './agents/personas.js';
import useHasApiKey from './hooks/useApiKey.js';
import useAIWorker from './hooks/useAIWorker.js';
import useDiplomacyTurn from './hooks/useDiplomacyTurn.js';
import DiplomacySetup from './DiplomacySetup.jsx';
import {
  loadSettings,
  saveSettings,
  buildControllers,
  budgetForDifficulty,
} from './diplomacySettings.js';
import { saveGame, loadGame, clearGame } from './diplomacyPersistence.js';
import {
  MAP_VIEWBOX,
  MAP_TRANSFORM,
  PROVINCE_SHAPES,
  UNIT_POS,
  SC_POS,
  LABEL_POS,
} from './mapGeometry.js';
import './diplomacy.css';

// Real-geography map (jDip vector boundaries + piece coordinates). Province
// paths live in the MapLayer space (rendered under MAP_TRANSFORM); units, supply
// stars and labels use the root-space coordinates below.
const VIEW = (() => {
  const [x, y, w, h] = MAP_VIEWBOX.split(/\s+/).map(Number);
  return { x, y, w, h };
})();

const ORDER_TYPE_LABELS = {
  hold: 'Hold',
  move: 'Move',
  'support-hold': 'Support hold',
  'support-move': 'Support move',
  convoy: 'Convoy',
};

// Stable per-render order key for React lists / dedupe.
function pendingKey(order) {
  return JSON.stringify(order);
}

// Where a unit at `loc` sits on the map. Split-coast fleets (e.g. STP/sc) have
// their own coordinate; otherwise fall back to the base province.
function unitPoint(loc) {
  return UNIT_POS[loc] || UNIT_POS[baseProvince(loc)] || null;
}

// Points for a supply-center star drawn at (cx, cy).
function starPoints(cx, cy, outer, inner, n = 5) {
  const pts = [];
  for (let i = 0; i < n * 2; i++) {
    const r = i % 2 === 0 ? outer : inner;
    const a = (Math.PI * i) / n - Math.PI / 2;
    pts.push(`${(cx + r * Math.cos(a)).toFixed(2)},${(cy + r * Math.sin(a)).toFixed(2)}`);
  }
  return pts.join(' ');
}

function provinceLabel(loc) {
  const coast = coastOf(loc);
  return coast ? `${baseProvince(loc)}/${coast}` : loc;
}

// Description for an order, used in the per-power panel and results log.
function describeOrder(order) {
  switch (order.type) {
    case 'hold':
      return `${provinceLabel(order.unitLoc)} holds`;
    case 'move':
      return `${provinceLabel(order.unitLoc)} → ${provinceLabel(order.to)}${order.viaConvoy ? ' (convoy)' : ''}`;
    case 'support-hold':
      return `${provinceLabel(order.unitLoc)} S ${provinceLabel(order.target)}`;
    case 'support-move':
      return `${provinceLabel(order.unitLoc)} S ${provinceLabel(order.from)} → ${provinceLabel(order.to)}`;
    case 'convoy':
      return `${provinceLabel(order.unitLoc)} C ${provinceLabel(order.from)} → ${provinceLabel(order.to)}`;
    default:
      return JSON.stringify(order);
  }
}

// Personas for every power (the persona shape persisted in the save).
function defaultPersonas() {
  return { ...PERSONAS };
}

export default function DiplomacyGame() {
  // ----- one-time mount restore: resume a saved game if one exists -----
  const restoredRef = useRef(null);
  if (restoredRef.current === null) {
    restoredRef.current = safeLoad();
  }
  const restored = restoredRef.current;

  const [settings, setSettings] = useState(loadSettings);
  const [inGame, setInGame] = useState(() => !!restored);

  const [board, setBoardState] = useState(() =>
    restored
      ? DiplomacyBoard.fromSerializedState(restored.board)
      : new DiplomacyBoard({ maxYears: settings.maxYears })
  );
  const [controllers, setControllers] = useState(() =>
    restored && restored.controllers ? restored.controllers : buildControllers(settings.power)
  );
  const [personas, setPersonas] = useState(() =>
    restored && restored.personas ? restored.personas : defaultPersonas()
  );
  // Human-VISIBLE conversation store (memory of the human↔AI chat threads).
  const [conversations, setConversations] = useState(() => {
    if (restored && restored.conversations) return restored.conversations;
    const ai = POWERS.filter((p) => p !== settings.power);
    return createMemory(ai);
  });
  // Hidden AI↔AI diplomatic state — never rendered.
  const [diplomaticState, setDiplomaticState] = useState(() => {
    if (restored && restored.diplomaticState) return restored.diplomaticState;
    const b = restored ? DiplomacyBoard.fromSerializedState(restored.board) : board;
    try {
      return createDiplomaticState({ board: b, humanPower: settings.power });
    } catch (_) {
      return null;
    }
  });

  const humanPower = useMemo(
    () => POWERS.find((p) => controllers[p] === 'human') || settings.power,
    [controllers, settings.power]
  );
  const difficultyBudget = useMemo(() => budgetForDifficulty(settings.difficulty), [settings.difficulty]);

  const [darkMode, setDarkMode] = useState(() => JSON.parse(localStorage.getItem('diplomacyDarkMode') || 'false'));
  const [showOrders, setShowOrders] = useState(() => JSON.parse(localStorage.getItem('diplomacyShowOrders') || 'true'));
  const [showLastMoves, setShowLastMoves] = useState(() => JSON.parse(localStorage.getItem('diplomacyShowLastMoves') || 'true'));
  const [confirmNew, setConfirmNew] = useState(false);
  const [keyPromptDismissed, setKeyPromptDismissed] = useState(false);
  const [logExpanded, setLogExpanded] = useState(false); // Results Log modal
  // Reactive shared-key signal: re-renders this view the instant the key is set
  // or cleared anywhere (this chat, another tab, or another GIPF game), so the
  // negotiation auto-run and the no-key prompt react without a reload.
  const hasKey = useHasApiKey();

  // Order-entry state (human power only). Pending/retreat/build entry is restored
  // from the save so a refresh mid-entry keeps what you typed; the purely visual
  // selection (selectedUnit/orderType) always starts cleared.
  const restoredUi = (restored && restored.uiState) || {};
  const [pendingOrders, setPendingOrders] = useState(() => restoredUi.pendingOrders || {}); // { [unitLoc]: order }
  const [selectedUnit, setSelectedUnit] = useState(null);
  const [orderType, setOrderType] = useState(null);
  // For two-step map targeting of support-move / convoy: the moving unit (base
  // province) whose move is being supported/convoyed; null until picked.
  const [supportFrom, setSupportFrom] = useState(null);
  const [retreatChoices, setRetreatChoices] = useState(() => restoredUi.retreatChoices || {}); // { [unitLoc]: 'DISBAND'|to }
  const [buildOrders, setBuildOrders] = useState(() => restoredUi.buildOrders || {}); // { [power]: order[] }

  const { computeOrders, isSupported: workerSupported } = useAIWorker();

  useEffect(() => localStorage.setItem('diplomacyDarkMode', JSON.stringify(darkMode)), [darkMode]);
  useEffect(() => localStorage.setItem('diplomacyShowOrders', JSON.stringify(showOrders)), [showOrders]);
  useEffect(() => localStorage.setItem('diplomacyShowLastMoves', JSON.stringify(showLastMoves)), [showLastMoves]);
  useEffect(() => {
    if (!logExpanded) return undefined;
    const onKey = (e) => { if (e.key === 'Escape') setLogExpanded(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [logExpanded]);

  const setBoard = useCallback((next) => setBoardState(next), []);

  // Persist the whole game after each phase transition the hook settles.
  const onPhaseSettled = useCallback(
    ({ uiPhase: ph, diplomaticState: ds }) => {
      saveGame({
        board,
        uiPhase: ph,
        controllers,
        personas,
        conversations,
        diplomaticState: ds !== undefined ? ds : diplomaticState,
      });
    },
    [board, controllers, personas, conversations, diplomaticState]
  );

  // The UI phase the turn machine starts in: the saved one on resume (so there's
  // no negotiation->orders transition that would wipe restored order entry).
  const initialUiPhase = (restored && restored.uiPhase) || 'negotiation';
  const turn = useDiplomacyTurn({
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
    initialUiPhase,
  });

  // Reset transient entry state when the phase/turn ACTUALLY changes. Guarded by
  // a signature (not a "skip first run" flag, which StrictMode's double-fired
  // effects defeat) and seeded to the mount signature, so resumed order entry
  // survives — including the restored uiPhase — and only a real gameplay
  // transition clears it.
  const phaseSigRef = useRef(`${board.phase}|${board.year}|${board.season}|${initialUiPhase}`);
  useEffect(() => {
    const sig = `${board.phase}|${board.year}|${board.season}|${turn.uiPhase}`;
    if (sig === phaseSigRef.current) return;
    phaseSigRef.current = sig;
    setPendingOrders({});
    setSelectedUnit(null);
    setOrderType(null);
    setSupportFrom(null);
    setRetreatChoices({});
    setBuildOrders({});
  }, [board.phase, board.year, board.season, turn.uiPhase]);

  // Persist whenever the board, phase, or in-progress order entry changes, so a
  // save always reflects the live game (including not-yet-submitted orders).
  const persistRef = useRef(null);
  persistRef.current = {
    board, uiPhase: turn.uiPhase, controllers, personas, conversations, diplomaticState,
    uiState: { pendingOrders, retreatChoices, buildOrders },
  };
  useEffect(() => {
    if (!inGame) return;
    saveGame(persistRef.current);
  }, [board, turn.uiPhase, inGame, pendingOrders, retreatChoices, buildOrders]);

  // ----- negotiation auto-run + unread tracking -----

  // Auto-run the AI↔AI negotiation (and AI->human outreach) once when a turn's
  // negotiation phase begins. A phase signature guards against re-running; it's
  // seeded from the restored phase so resuming a save doesn't re-confer.
  const phaseSig = `${board.year}-${board.season}-${board.phase}`;
  const negotiatedRef = useRef(restored ? phaseSig : null);
  useEffect(() => {
    if (!inGame || board.phase === 'game-over') return;
    if (!board.isOrdersPhase() || turn.uiPhase !== 'negotiation') return;
    if (!turn.hasKey) return; // no key -> no AI calls; the human can still proceed
    if (negotiatedRef.current === phaseSig) return;
    negotiatedRef.current = phaseSig;
    turn.runNegotiation();
  }, [inGame, phaseSig, board, turn]);

  // Per-power unread = AI messages the human hasn't viewed yet. Seed "seen" from
  // any restored threads so a resume doesn't light up every power.
  const [seenCounts, setSeenCounts] = useState(() => {
    const init = {};
    const threads = (restored && restored.conversations && restored.conversations.threads) || {};
    for (const p of Object.keys(threads)) init[p] = (threads[p].messages || []).length;
    return init;
  });
  const unreadByPower = useMemo(() => {
    const out = {};
    const threads = (conversations && conversations.threads) || {};
    for (const p of Object.keys(threads)) {
      const msgs = threads[p].messages || [];
      // Threads present at mount are seeded into seenCounts (so a resume doesn't
      // light up); threads created later default to 0 seen = all-new = unread.
      const seen = seenCounts[p] != null ? seenCounts[p] : 0;
      out[p] = msgs.slice(seen).filter((m) => m.role === 'assistant').length;
    }
    return out;
  }, [conversations, seenCounts]);
  const totalUnread = useMemo(
    () => Object.values(unreadByPower).reduce((a, b) => a + b, 0),
    [unreadByPower]
  );
  const markThreadRead = useCallback((power) => {
    setSeenCounts((prev) => {
      const len = (conversations && conversations.threads && conversations.threads[power]
        ? conversations.threads[power].messages.length : 0);
      if (prev[power] === len) return prev;
      return { ...prev, [power]: len };
    });
  }, [conversations]);

  // Fold an AI power's private scratchpad (from a human-chat reply) into the
  // shared, persistent diplomatic state — the SAME state of mind the AI↔AI
  // negotiation evolves and the move AI reads. So talking with a power actually
  // shifts how it plays toward you (its real disposition, not its words).
  const foldScratchpadIntoState = useCallback((power, scratchpad) => {
    if (!scratchpad) return;
    setDiplomaticState((ds) => (ds ? setScratchpad(ds, power, scratchpad) : ds));
  }, []);

  // Record a deal a power struck with you in chat as a standing agreement between
  // it and you. It does NOT bind: decideStrategicIntent decides each turn whether
  // to honour or stab it from the power's remembered state of mind (trust +
  // disposition + payoff). One deal per (power,type) — a new one replaces it.
  const foldDealIntoState = useCallback((power, deal) => {
    if (!deal || !power || power === humanPower) return;
    const parties = [power, humanPower];
    const id = `chat-${power}-${humanPower}-${deal.type}`;
    const entry = { id, type: deal.type, parties };
    if (deal.type === 'support') entry.to = deal.to;
    else if (deal.type === 'dmz') entry.provinces = deal.provinces;
    else if (deal.type === 'joint-attack') entry.target = deal.target;
    setDiplomaticState((ds) => (ds ? recordAgreement(ds, entry) : ds));
  }, [humanPower]);

  const phaseLabel = board.getPhaseLabel();
  const leader = board.getLeader();
  const activeUnits = useMemo(() => board.getUnits(humanPower), [board, humanPower]);

  // ----- order construction (human power only; options from the engine) -----
  const legalForSelected = useMemo(() => {
    if (!selectedUnit) return [];
    return board.getLegalOrdersForUnit(selectedUnit);
  }, [board, selectedUnit]);

  const availableTypes = useMemo(() => {
    const types = new Set(legalForSelected.map(o => o.type));
    return ['hold', 'move', 'support-hold', 'support-move', 'convoy'].filter(t => types.has(t));
  }, [legalForSelected]);

  const optionsForType = useMemo(() => {
    if (!selectedUnit || !orderType) return [];
    return legalForSelected.filter(o => o.type === orderType);
  }, [legalForSelected, selectedUnit, orderType]);

  const isOrderEntry = board.isOrdersPhase() && turn.uiPhase === 'orders';
  // The right-hand action panel only appears when there's something to act on;
  // during negotiation it's hidden so the map spans the full remaining width.
  const showActionPanel =
    board.phase === 'game-over' ||
    isOrderEntry ||
    turn.uiPhase === 'resolving' ||
    board.isRetreatPhase() ||
    board.isWinterPhase();

  function selectUnitForOrder(loc) {
    const unit = board.units[loc];
    if (!unit || unit.power !== humanPower || !isOrderEntry) return;
    setSelectedUnit(loc);
    setOrderType(null);
    setSupportFrom(null);
  }

  function setPendingOrder(order) {
    setPendingOrders(prev => ({ ...prev, [order.unitLoc]: order }));
    setSelectedUnit(null);
    setOrderType(null);
    setSupportFrom(null);
  }

  function chooseOrderType(type) {
    setOrderType(type);
    setSupportFrom(null);
    if (type === 'hold') setPendingOrder({ type: 'hold', unitLoc: selectedUnit });
  }

  // Provinces (base ids) that are valid click targets on the map given the
  // current selection + order type. Two-step for support-move / convoy: first
  // the movable units that can be supported, then that mover's destinations.
  const targetBaseFor = (option) => {
    if (orderType === 'support-hold') return baseProvince(option.target);
    return baseProvince(option.to); // move / support-move / convoy destination
  };
  const targetProvinces = useMemo(() => {
    const set = new Set();
    if (!selectedUnit || !orderType || orderType === 'hold') return set;
    if (orderType === 'support-move' || orderType === 'convoy') {
      if (supportFrom == null) {
        optionsForType.forEach(o => set.add(baseProvince(o.from)));
      } else {
        optionsForType
          .filter(o => baseProvince(o.from) === supportFrom)
          .forEach(o => set.add(baseProvince(o.to)));
      }
    } else {
      optionsForType.forEach(o => set.add(targetBaseFor(o)));
    }
    return set;
  }, [selectedUnit, orderType, supportFrom, optionsForType]);

  // A click on province `base` during order entry: finalize a target if we're
  // targeting and it's valid; otherwise (re)select the human's unit there.
  function handleMapClick(base) {
    if (!isOrderEntry) return;
    if (selectedUnit && orderType && orderType !== 'hold') {
      if (orderType === 'move') {
        const opt = optionsForType.find(o => baseProvince(o.to) === base);
        if (opt) { setPendingOrder(opt); return; }
      } else if (orderType === 'support-hold') {
        const opt = optionsForType.find(o => baseProvince(o.target) === base);
        if (opt) { setPendingOrder(opt); return; }
      } else if (orderType === 'support-move' || orderType === 'convoy') {
        if (supportFrom == null) {
          if (optionsForType.some(o => baseProvince(o.from) === base)) { setSupportFrom(base); return; }
        } else {
          const opt = optionsForType.find(o => baseProvince(o.from) === supportFrom && baseProvince(o.to) === base);
          if (opt) { setPendingOrder(opt); return; }
          // Clicked a different mover — switch to supporting that one instead.
          if (optionsForType.some(o => baseProvince(o.from) === base)) { setSupportFrom(base); return; }
        }
      }
    }
    // Not consumed as a target: select the human's own unit at this province.
    const myLoc = board.unitLocAt(base);
    if (myLoc && board.units[myLoc]?.power === humanPower) selectUnitForOrder(myLoc);
  }

  function clearOrderFor(unitLoc) {
    setPendingOrders(prev => {
      const next = { ...prev };
      delete next[unitLoc];
      return next;
    });
  }

  function submitOrders() {
    turn.submitOrders({ [humanPower]: pendingOrders });
  }

  // ----- retreats -----
  function chooseRetreat(unitLoc, value) {
    setRetreatChoices(prev => ({ ...prev, [unitLoc]: value }));
  }
  function submitRetreats() {
    turn.submitRetreats({ [humanPower]: retreatChoices });
  }

  // ----- winter -----
  function toggleBuildOrder(power, order) {
    setBuildOrders(prev => {
      const list = prev[power] || [];
      const key = pendingKey(order);
      const exists = list.some(o => pendingKey(o) === key);
      if (exists) return { ...prev, [power]: list.filter(o => pendingKey(o) !== key) };
      return { ...prev, [power]: [...list, order] };
    });
  }
  function submitAdjustments() {
    turn.submitAdjustments(buildOrders);
  }

  // ----- new game / setup -----
  function startGame(chosen) {
    const next = { ...settings, ...chosen };
    setSettings(next);
    saveSettings(next);
    clearGame();
    const fresh = new DiplomacyBoard({ maxYears: next.maxYears });
    const ctrls = buildControllers(next.power);
    const ai = POWERS.filter((p) => p !== next.power);
    setBoardState(fresh);
    setControllers(ctrls);
    setPersonas(defaultPersonas());
    setConversations(createMemory(ai));
    try {
      setDiplomaticState(createDiplomaticState({ board: fresh, humanPower: next.power }));
    } catch (_) {
      setDiplomaticState(null);
    }
    setConfirmNew(false);
    setKeyPromptDismissed(false);
    turn.setUiPhase('negotiation'); // a fresh game always opens in negotiation
    setInGame(true);
  }

  function returnToSetup() {
    clearGame();
    setConfirmNew(false);
    setInGame(false);
  }

  const adjustments = board.isWinterPhase() ? board.getAdjustments() : null;

  // Pending-order overlays for the human power.
  const overlayOrders = useMemo(() => {
    if (!showOrders) return [];
    return Object.values(pendingOrders).map(order => ({ power: humanPower, order }));
  }, [pendingOrders, showOrders, humanPower]);

  // Previous turn's executed moves, for review on the map (success vs bounced).
  const lastMoveOverlays = useMemo(() => {
    if (!showLastMoves) return [];
    const entry = (board.orderHistory || []).find(e => e && e.orders);
    if (!entry) return [];
    const moveSuccess = (entry.resolved && entry.resolved.moveSuccess) || {};
    return Object.entries(entry.orders)
      .filter(([, o]) => o.type === 'move')
      .map(([loc, o]) => ({ power: o.power, from: o.unitLoc, to: o.to, success: !!moveSuccess[loc] }));
  }, [board, showLastMoves]);

  const showKeyPrompt = !hasKey && !keyPromptDismissed && inGame;

  // ----- setup gate -----
  if (!inGame) {
    return (
      <div className={`game-diplomacy min-h-screen bg-[var(--dip-bg)] font-body ${darkMode ? 'dark' : ''}`}>
        <DiplomacySetup initial={settings} onStart={startGame} />
      </div>
    );
  }

  return (
    <div className={`game-diplomacy min-h-screen bg-[var(--dip-bg)] font-body ${darkMode ? 'dark' : ''}`}>
      {confirmNew && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/50 px-4" onClick={(e) => { if (e.target === e.currentTarget) setConfirmNew(false); }}>
          <div className="dip-modal w-full max-w-sm p-6">
            <h2 className="text-xl font-bold" style={{ color: 'var(--dip-text)' }}>Start a new game?</h2>
            <p className="mt-2 text-sm leading-relaxed" style={{ color: 'var(--dip-text-muted)' }}>
              Your current game will be lost.
            </p>
            <div className="mt-6 flex gap-3">
              <button className="dip-primary-btn flex-1" onClick={returnToSetup}>New Game</button>
              <button className="dip-tool-btn flex-1" onClick={() => setConfirmNew(false)}>Cancel</button>
            </div>
          </div>
        </div>
      )}

      <div className="mx-auto flex min-h-screen w-full max-w-[2200px] flex-col gap-4 px-4 py-4 lg:flex-row lg:px-6">
        {/* ---- Left: header, scoreboard ---- */}
        <aside className="order-3 flex w-full flex-col gap-3 lg:order-1 lg:w-[300px]">
          <div className="dip-panel p-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <Link to="/" className="dip-panel-label hover:opacity-80">GIPF Project</Link>
                <h1 className="dip-title mt-1 text-2xl" style={{ color: 'var(--dip-text)' }}>DIPLOMACY</h1>
              </div>
            </div>
            <div className="dip-phase-banner mt-4">{phaseLabel}</div>
            <div className="dip-last-action mt-2">{board.lastAction}</div>
            <div className="dip-you-line mt-1">
              You are <strong style={{ color: POWER_COLORS[humanPower] }}>{POWER_NAMES[humanPower]}</strong>
            </div>
            {turn.isBusy && turn.progress && (
              <div className="dip-progress mt-2" role="status">{turn.progress}</div>
            )}
            <div className="mt-3 flex flex-wrap gap-2">
              <button className="dip-tool-btn px-3" onClick={() => setConfirmNew(true)} aria-label="Start a new game">New</button>
            </div>
            <div className="mt-3 space-y-2">
              <ToggleRow label="Dark Mode" checked={darkMode} onChange={() => setDarkMode(v => !v)} />
              <ToggleRow label="Show Orders" checked={showOrders} onChange={() => setShowOrders(v => !v)} />
              <ToggleRow label="Show Last Moves" checked={showLastMoves} onChange={() => setShowLastMoves(v => !v)} />
            </div>
          </div>

          {/* Negotiation: the human chats below, then proceeds to enter orders.
              Lives here (not the right column) so the map can use the full width. */}
          {board.phase !== 'game-over' && board.isOrdersPhase() && turn.uiPhase === 'negotiation' && (
            <div className="dip-panel p-4">
              <div className="dip-panel-label mb-2">Negotiation — {phaseLabel}</div>
              {turn.isBusy ? (
                <p className="dip-submit-hint">The powers are conferring privately…</p>
              ) : totalUnread > 0 ? (
                <p className="dip-submit-hint">
                  <span className="dip-notify-pill">{totalUnread}</span>
                  {totalUnread === 1 ? ' a power has' : ' powers have'} reached out — see the
                  Negotiation panel below.
                </p>
              ) : (
                <p className="dip-submit-hint">
                  Talk to the other powers in the Negotiation panel below. When you're ready, proceed —
                  the other powers plan their moves at the same time.
                </p>
              )}
              <div className="mt-3 flex flex-col gap-2">
                {hasKey && (
                  <button
                    className="dip-tool-btn w-full"
                    onClick={turn.runNegotiation}
                    disabled={turn.isBusy}
                    title="Let the AI powers talk among themselves again and reconsider reaching out — useful after you've struck a deal in chat."
                  >
                    {turn.isBusy ? 'Powers conferring…' : 'Let the powers confer again'}
                  </button>
                )}
                <button
                  className="dip-primary-btn w-full"
                  onClick={turn.proceedToOrders}
                  disabled={turn.isBusy}
                >
                  {turn.isBusy ? 'Powers conferring…' : 'Proceed to orders'}
                </button>
              </div>
            </div>
          )}

          {showKeyPrompt && (
            <div className="dip-keyprompt p-4">
              <div className="dip-keyprompt-text">
                Playing without an Anthropic API key: the AI powers still make tactical moves, but
                won't negotiate or chat. Add a key in the Negotiation panel to enable diplomacy.
              </div>
              <button className="dip-keyprompt-dismiss" onClick={() => setKeyPromptDismissed(true)}>Dismiss</button>
            </div>
          )}

          {logExpanded && <div className="dip-chat-backdrop" onClick={() => setLogExpanded(false)} />}
          <div className={`dip-panel p-4 ${logExpanded ? 'dip-log--modal' : ''}`}>
            <div className="dip-chat-titlebar">
              <div className="dip-panel-label">Results Log</div>
              <button
                type="button"
                className="dip-chat-expand"
                onClick={() => setLogExpanded(v => !v)}
                aria-label={logExpanded ? 'Collapse results log' : 'Expand results log'}
              >
                {logExpanded ? '✕ Close' : '⤢ Expand'}
              </button>
            </div>
            <div className="dip-log-feed mt-2">
              {board.orderHistory.length === 0 ? (
                <p className="dip-log-empty">No turn resolved yet.</p>
              ) : (
                board.orderHistory.map((log, i) => (
                  <ResultsLog key={`${log.phase}-${i}`} log={log} board={board} expanded={logExpanded} />
                ))
              )}
            </div>
          </div>

          {/* Negotiation chat: the human talks to the other powers (BYO key).
              Controlled by the shared conversations store so AI-initiated
              messages from the turn's negotiation appear here too. */}
          <div className="dip-panel p-4">
            <ChatPanel
              board={board}
              humanPower={humanPower}
              aiPowers={POWERS.filter(p => p !== humanPower)}
              memory={conversations}
              setMemory={setConversations}
              unreadByPower={unreadByPower}
              onViewThread={markThreadRead}
              onScratchpad={foldScratchpadIntoState}
              onDeal={foldDealIntoState}
            />
          </div>
        </aside>

        {/* ---- Center: scoreboard strip + the map ---- */}
        <main className="order-1 flex min-h-[260px] flex-1 flex-col items-center gap-3 lg:order-2 lg:min-h-[520px]">
          {/* Supply centers, as a compact horizontal strip above the board. */}
          <div className="dip-scorebar" role="list" aria-label="Supply center standings">
            {[...POWERS]
              .map(power => ({ power, centers: board.getSupplyCount(power), units: board.getUnitCount(power) }))
              .sort((a, b) => b.centers - a.centers || a.power.localeCompare(b.power))
              .map(({ power, centers, units }) => (
                <div
                  key={power}
                  role="listitem"
                  className={`dip-score-chip ${leader.power === power ? 'is-leader' : ''} ${power === humanPower ? 'is-you' : ''}`}
                  title={`${POWER_NAMES[power]}: ${centers} supply centers, ${units} units`}
                >
                  <span className="dip-score-swatch" style={{ backgroundColor: POWER_COLORS[power] }} aria-hidden="true" />
                  <span className="dip-score-name">{POWER_SHORT_NAMES[power]}</span>
                  <span className="dip-score-centers">{centers}</span>
                  <span className="dip-score-units">{units}u</span>
                </div>
              ))}
          </div>
          <div className="dip-board-shell">
            {renderMap()}
          </div>
        </main>

        {/* ---- Right: order entry / retreat / winter / game-over. Hidden during
             the negotiation phase so the map takes the full remaining width. ---- */}
        {showActionPanel && (
          <aside className="order-2 flex w-full flex-col gap-3 lg:order-3 lg:w-[340px]">
            {board.phase === 'game-over' && (
              <div className="dip-panel p-4">
                <div className="dip-gameover-banner">
                  {board.winner ? `${POWER_SHORT_NAMES[board.winner]} wins` : 'Game over'}
                </div>
                <p className="mt-2 text-sm" style={{ color: 'var(--dip-text-muted)' }}>
                  {board.winner
                    ? `${POWER_SHORT_NAMES[board.winner]} controls ${board.winningCenters} supply centers.`
                    : 'No decisive winner.'}
                </p>
                <button className="dip-primary-btn mt-4 w-full" onClick={() => setConfirmNew(true)}>New Game</button>
              </div>
            )}

            {board.phase !== 'game-over' && isOrderEntry && renderOrderPanel()}
            {board.phase !== 'game-over' && turn.uiPhase === 'resolving' && (
              <div className="dip-panel p-4">
                <div className="dip-panel-label mb-2">Resolving</div>
                <p className="dip-submit-hint">{turn.progress || 'Resolving orders…'}</p>
              </div>
            )}
            {board.phase !== 'game-over' && board.isRetreatPhase() && renderRetreatPanel()}
            {board.phase !== 'game-over' && board.isWinterPhase() && renderWinterPanel()}
          </aside>
        )}
      </div>
    </div>
  );

  // ============================ render helpers ============================

  function renderMap() {
    const units = board.getUnits();
    return (
      <svg
        className="dip-board-svg"
        viewBox={MAP_VIEWBOX}
        role="img"
        aria-label="Diplomacy map"
      >
        <defs>
          <filter id="dip-piece-shadow" x="-40%" y="-40%" width="180%" height="180%">
            <feDropShadow dx="0" dy="1.5" stdDeviation="1.5" floodOpacity="0.3" />
          </filter>
          <marker id="dip-arrowhead" markerWidth="8" markerHeight="8" refX="6" refY="3" orient="auto">
            <path d="M0,0 L6,3 L0,6 Z" className="dip-arrow-head" />
          </marker>
          {/* Open diamond for support-move: distinct from the filled move arrow. */}
          <marker id="dip-support-diamond" markerWidth="10" markerHeight="10" refX="5" refY="5" orient="auto">
            <path d="M5,1 L9,5 L5,9 L1,5 Z" fill="none" stroke="currentColor" strokeWidth="1.4" />
          </marker>
          {/* Arrowhead for the previous-turn move-review layer (inherits color). */}
          <marker id="dip-lastmove-arrow" markerWidth="7" markerHeight="7" refX="5" refY="3" orient="auto">
            <path d="M0,0 L6,3 L0,6 Z" fill="currentColor" stroke="none" />
          </marker>
          {/* Faint lat/long graticule, painted into the water fill. */}
          <pattern id="dip-sea-pattern" width="84" height="84" patternUnits="userSpaceOnUse">
            <rect width="84" height="84" className="dip-sea-tile" />
            <path d="M84 0 H0 V84" className="dip-sea-grid" />
          </pattern>
        </defs>

        {/* Sea floor behind the whole board. */}
        <rect x={VIEW.x} y={VIEW.y} width={VIEW.w} height={VIEW.h} className="dip-sea-base" />

        {/* Province territories — real jDip boundaries in the MapLayer space. */}
        <g transform={MAP_TRANSFORM}>
          {Object.entries(PROVINCES).map(([id, province]) => {
            const shape = PROVINCE_SHAPES[id];
            if (!shape) return null;
            const owner = province.supply ? board.supplyCenters[id] : null;
            const hasMyUnit = isOrderEntry && board.unitLocAt(id) && board.units[board.unitLocAt(id)]?.power === humanPower;
            const isTarget = isOrderEntry && targetProvinces.has(id);
            const isSupportFrom = supportFrom === id;
            const isSelectable = hasMyUnit || isTarget;
            const isSelected = selectedUnit && baseProvince(selectedUnit) === id;
            return (
              <path
                key={id}
                d={shape}
                className={`dip-province dip-province-${province.type} ${isSelectable ? 'is-selectable' : ''} ${isSelected ? 'is-selected' : ''} ${isTarget ? 'is-target' : ''} ${isSupportFrom ? 'is-support-from' : ''}`}
                style={owner ? { fill: POWER_ACCENTS[owner], stroke: POWER_COLORS[owner] } : undefined}
                onClick={() => handleMapClick(id)}
                role={isSelectable ? 'button' : undefined}
                tabIndex={isSelectable ? 0 : undefined}
                aria-label={isSelectable ? `${isTarget ? 'Target' : 'Select unit at'} ${province.name}` : undefined}
                onKeyDown={isSelectable ? (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); handleMapClick(id); } } : undefined}
              >
                <title>{`${province.name} (${id})${province.supply ? ` — supply center${owner ? `, ${POWER_SHORT_NAMES[owner]}` : ''}` : ''}`}</title>
              </path>
            );
          })}
        </g>

        {/* Supply-center stars + province labels (root space). */}
        {Object.entries(PROVINCES).map(([id, province]) => {
          const label = LABEL_POS[id];
          const owner = province.supply ? board.supplyCenters[id] : null;
          const sc = SC_POS[id];
          return (
            <g key={`lbl-${id}`} pointerEvents="none">
              {province.supply && sc && (
                <g className="dip-supply-badge">
                  <circle cx={sc.x} cy={sc.y} r={12} className="dip-supply-medallion" />
                  <polygon
                    points={starPoints(sc.x, sc.y, 8.5, 3.6)}
                    className={`dip-supply-star ${owner ? 'is-owned' : ''}`}
                    style={owner ? { fill: POWER_COLORS[owner] } : undefined}
                  />
                </g>
              )}
              {label && (
                <text
                  x={label.x}
                  y={label.y}
                  textAnchor="middle"
                  className={`dip-province-label dip-province-label-${province.type}`}
                >
                  {id}
                </text>
              )}
            </g>
          );
        })}

        {/* Previous turn's executed moves (review layer), under the pieces. */}
        {lastMoveOverlays.map((m, i) => {
          const from = unitPoint(m.from);
          const to = unitPoint(m.to);
          if (!from || !to) return null;
          return (
            <line
              key={`lm-${i}`}
              x1={from.x} y1={from.y} x2={to.x} y2={to.y}
              className={`dip-last-move ${m.success ? 'is-success' : 'is-bounced'}`}
              style={{ stroke: POWER_COLORS[m.power], color: POWER_COLORS[m.power] }}
              markerEnd={m.success ? 'url(#dip-lastmove-arrow)' : undefined}
            />
          );
        })}

        {/* Units. Each piece is drawn twice — a light "coin" halo behind the
            coloured body — so it stays legible on any territory colour. Army =
            disc, fleet = boat hull: distinguishable by SHAPE alone (and glyph),
            so they read for colour-blind players too. */}
        {units.map(unit => {
          const pt = unitPoint(unit.loc);
          if (!pt) return null;
          const color = POWER_COLORS[unit.power];
          const isFleet = unit.type === 'fleet';
          // Boat hull centred on pt (flat deck, rounded keel).
          const hull = `M ${pt.x - 15} ${pt.y - 6} L ${pt.x + 15} ${pt.y - 6} L ${pt.x + 10} ${pt.y + 8} Q ${pt.x} ${pt.y + 13} ${pt.x - 10} ${pt.y + 8} Z`;
          return (
            <g key={unit.loc} className="dip-unit-group" filter="url(#dip-piece-shadow)" onClick={() => handleMapClick(baseProvince(unit.loc))}>
              <title>{`${POWER_SHORT_NAMES[unit.power]} ${unit.type} ${provinceLabel(unit.loc)}`}</title>
              {isFleet ? (
                <>
                  <path d={hull} className="dip-unit-halo" />
                  <path d={hull} className="dip-unit dip-unit-fleet" style={{ fill: color }} />
                </>
              ) : (
                <>
                  <circle cx={pt.x} cy={pt.y} r={15} className="dip-unit-halo" />
                  <circle cx={pt.x} cy={pt.y} r={15} className="dip-unit dip-unit-army" style={{ fill: color }} />
                </>
              )}
              <text x={pt.x} y={isFleet ? pt.y + 1 : pt.y} textAnchor="middle" dominantBaseline="central" className="dip-unit-glyph">
                {formatUnitType(unit.type)}
              </text>
            </g>
          );
        })}

        {/* Pending-order overlays */}
        {overlayOrders.map(({ power, order }) => renderOrderOverlay(power, order))}
      </svg>
    );
  }

  function renderOrderOverlay(power, order) {
    const from = unitPoint(order.unitLoc);
    if (!from) return null;
    const color = POWER_COLORS[power];
    const key = `${power}-${pendingKey(order)}`;
    if (order.type === 'move') {
      const to = unitPoint(order.to);
      if (!to) return null;
      return (
        <line
          key={key}
          x1={from.x} y1={from.y} x2={to.x} y2={to.y}
          className="dip-order-arrow"
          style={{ stroke: color }}
          markerEnd="url(#dip-arrowhead)"
        />
      );
    }
    if (order.type === 'support-move' || order.type === 'support-hold' || order.type === 'convoy') {
      const target = unitPoint(order.type === 'support-hold' ? order.target : order.to);
      if (!target) return null;
      // support-move ends in an open diamond; support-hold/convoy do not — so the
      // four overlay kinds (move arrow / support-move diamond / support-hold /
      // convoy wave) all read distinctly even when several overlap.
      const markerEnd = order.type === 'support-move' ? 'url(#dip-support-diamond)' : undefined;
      return (
        <line
          key={key}
          x1={from.x} y1={from.y} x2={target.x} y2={target.y}
          className={`dip-order-support ${order.type === 'convoy' ? 'is-convoy' : ''}`}
          style={{ stroke: color, color }}
          markerEnd={markerEnd}
        />
      );
    }
    return (
      <circle key={key} cx={from.x} cy={from.y} r={24} className="dip-order-hold" style={{ stroke: color }} />
    );
  }

  function renderOrderPanel() {
    const entered = pendingOrders;
    return (
      <>
        <div className="dip-panel p-4">
          <div className="dip-panel-label mb-2">Your Orders — {POWER_SHORT_NAMES[humanPower]}</div>
          <div className="mt-1 dip-unit-list">
            {activeUnits.length === 0 && <p className="dip-log-empty">{POWER_SHORT_NAMES[humanPower]} has no units.</p>}
            {activeUnits.map(unit => {
              const order = entered[unit.loc];
              const isSelected = selectedUnit === unit.loc;
              return (
                <div key={unit.loc} className={`dip-unit-row ${isSelected ? 'is-selected' : ''}`}>
                  <button className="dip-unit-pick" onClick={() => selectUnitForOrder(unit.loc)}>
                    <span className="dip-unit-tag">{formatUnitType(unit.type)} {provinceLabel(unit.loc)}</span>
                    <span className="dip-unit-order">{order ? describeOrder(order) : 'holds (default)'}</span>
                  </button>
                  {order && (
                    <button className="dip-tool-btn px-2" onClick={() => clearOrderFor(unit.loc)} aria-label={`Clear order for ${unit.loc}`}>Clear</button>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {selectedUnit && (
          <div className="dip-panel p-4">
            <div className="dip-panel-label mb-2">{formatUnitType(board.units[selectedUnit].type)} {provinceLabel(selectedUnit)}</div>
            <div className="dip-ordertype-row">
              {availableTypes.map(type => (
                <button
                  key={type}
                  className={`dip-tool-btn ${orderType === type ? 'active' : ''}`}
                  onClick={() => chooseOrderType(type)}
                >
                  {ORDER_TYPE_LABELS[type]}
                </button>
              ))}
            </div>
            {orderType && orderType !== 'hold' && (
              <>
                <p className="dip-target-hint mt-2">
                  {(orderType === 'support-move' || orderType === 'convoy')
                    ? (supportFrom == null
                        ? 'Click the highlighted unit on the map whose move you want to support — or pick from the list.'
                        : <>Now click the highlighted destination for <strong>{supportFrom}</strong>. <button className="dip-linkbtn" onClick={() => setSupportFrom(null)}>change unit</button></>)
                    : 'Click a highlighted province on the map — or pick from the list.'}
                </p>
                <div className="mt-2 dip-target-grid">
                  {optionsForType.length === 0 && <p className="dip-log-empty">No legal targets.</p>}
                  {optionsForType.map(option => (
                    <button
                      key={pendingKey(option)}
                      className="dip-target-btn"
                      onClick={() => setPendingOrder(option)}
                    >
                      {describeOrder(option)}
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>
        )}

        <div className="dip-panel p-4">
          <p className="dip-submit-hint">
            Enter orders for your units, then resolve the turn. Units with no order will hold. The
            other powers move simultaneously.
          </p>
          <button className="dip-primary-btn mt-3 w-full" onClick={submitOrders} disabled={turn.isBusy}>
            {turn.isBusy ? 'Resolving…' : 'Submit Orders'}
          </button>
        </div>
      </>
    );
  }

  function renderRetreatPanel() {
    const humanPending = board.pendingRetreats.filter(p => p.unit.power === humanPower);
    return (
      <div className="dip-panel p-4">
        <div className="dip-panel-label mb-2">Retreats</div>
        {humanPending.length === 0 ? (
          <p className="dip-log-empty">None of your units need to retreat.</p>
        ) : (
          <div className="dip-retreat-list">
            {humanPending.map(pending => {
              const options = board.getRetreatOptions(pending.unitLoc);
              const choice = retreatChoices[pending.unitLoc] || 'DISBAND';
              return (
                <div key={pending.unitLoc} className="dip-retreat-row">
                  <div className="dip-retreat-head">
                    <span className="dip-score-swatch" style={{ backgroundColor: POWER_COLORS[pending.unit.power] }} aria-hidden="true" />
                    {formatUnitType(pending.unit.type)} {provinceLabel(pending.unitLoc)}
                  </div>
                  <div className="dip-target-grid mt-2">
                    {options.map(to => (
                      <button
                        key={to}
                        className={`dip-target-btn ${choice === to ? 'active' : ''}`}
                        onClick={() => chooseRetreat(pending.unitLoc, to)}
                      >
                        → {provinceLabel(to)}
                      </button>
                    ))}
                    <button
                      className={`dip-target-btn ${choice === 'DISBAND' ? 'active' : ''}`}
                      onClick={() => chooseRetreat(pending.unitLoc, 'DISBAND')}
                    >
                      Disband
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
        <button className="dip-primary-btn mt-4 w-full" onClick={submitRetreats} disabled={turn.isBusy}>
          {turn.isBusy ? 'Resolving…' : 'Submit Retreats'}
        </button>
      </div>
    );
  }

  function renderWinterPanel() {
    const adj = adjustments[humanPower];
    const needsAdjust = adj && (adj.buildCount > 0 || adj.disbandCount > 0);
    return (
      <div className="dip-panel p-4">
        <div className="dip-panel-label mb-2">Winter Adjustments</div>
        {!needsAdjust ? (
          <p className="dip-log-empty">You have no builds or disbands this winter.</p>
        ) : (
          <div className="dip-winter-list">
            {(() => {
              const legal = board.getLegalAdjustmentOrders(humanPower);
              const selected = buildOrders[humanPower] || [];
              const need = adj.delta > 0 ? `build ${adj.buildCount}` : `disband ${adj.disbandCount}`;
              return (
                <div className="dip-winter-power">
                  <div className="dip-retreat-head">
                    <span className="dip-score-swatch" style={{ backgroundColor: POWER_COLORS[humanPower] }} aria-hidden="true" />
                    {POWER_SHORT_NAMES[humanPower]} — {need}
                  </div>
                  <div className="dip-target-grid mt-2">
                    {legal.map(order => {
                      const isOn = selected.some(o => pendingKey(o) === pendingKey(order));
                      const label = order.type === 'build'
                        ? `+ ${formatUnitType(order.unitType)} ${provinceLabel(order.loc)}`
                        : `− ${provinceLabel(order.unitLoc)}`;
                      return (
                        <button
                          key={pendingKey(order)}
                          className={`dip-target-btn ${isOn ? 'active' : ''}`}
                          onClick={() => toggleBuildOrder(humanPower, order)}
                        >
                          {label}
                        </button>
                      );
                    })}
                  </div>
                  <p className="dip-winter-count">{selected.length} selected</p>
                </div>
              );
            })()}
          </div>
        )}
        <button className="dip-primary-btn mt-4 w-full" onClick={submitAdjustments} disabled={turn.isBusy}>
          {turn.isBusy ? 'Resolving…' : 'Submit Adjustments'}
        </button>
      </div>
    );
  }
}

// ----- small presentational helpers -----

function safeLoad() {
  try {
    const restored = loadGame();
    if (!restored) return false;
    // Validate the snapshot actually deserializes — a corrupt save must never
    // crash the app on resume; fall back to a fresh setup instead.
    DiplomacyBoard.fromSerializedState(restored.board);
    return restored;
  } catch (_) {
    return false;
  }
}

function ToggleRow({ label, checked, onChange }) {
  return (
    <div className="flex items-center justify-between gap-4">
      <span className="text-sm" style={{ color: 'var(--dip-text)' }}>{label}</span>
      <button
        type="button"
        onClick={onChange}
        role="switch"
        aria-checked={checked}
        aria-label={label}
        className="relative h-6 w-10 rounded-full transition-colors"
        style={{ backgroundColor: checked ? 'var(--dip-toggle-active)' : 'var(--dip-toggle-inactive)' }}
      >
        <span
          className={`absolute top-1 h-4 w-4 rounded-full transition-transform ${checked ? 'translate-x-5' : 'translate-x-1'}`}
          style={{ backgroundColor: '#fff', left: 0 }}
        />
      </button>
    </div>
  );
}

// A faint power-colour tint + left stripe so a row's owner reads at a glance.
function powerRowStyle(power) {
  const c = POWER_COLORS[power];
  if (!c) return undefined;
  return { backgroundColor: `${c}22`, borderLeft: `3px solid ${c}`, paddingLeft: '0.4rem', borderRadius: '4px' };
}

function ResultsLog({ log, expanded }) {
  // Winter entries carry `adjustments` (build/disband strings), not `orders`.
  if (Array.isArray(log.adjustments)) {
    const shortToPower = Object.fromEntries(Object.entries(POWER_SHORT_NAMES).map(([p, n]) => [n, p]));
    return (
      <div className="dip-results">
        <div className="dip-results-phase">{log.phase}</div>
        {log.adjustments.length === 0 ? (
          <div className="dip-results-row dip-results-muted">No builds or disbands.</div>
        ) : (
          log.adjustments.map((line, i) => {
            const name = Object.keys(shortToPower).find(n => line.startsWith(n));
            const p = name ? shortToPower[name] : null;
            return <div key={i} className="dip-results-row" style={p ? powerRowStyle(p) : undefined}><span>{line}</span></div>;
          })
        )}
      </div>
    );
  }

  const resolved = log.resolved || {};
  const moveSuccess = resolved.moveSuccess || {};
  const cutSupports = resolved.cutSupports || [];
  const dislodged = resolved.dislodged || [];
  // Hide plain holds — only show units that actually did something.
  const orders = Object.values(log.orders || {}).filter(o => o.type !== 'hold');
  // Group by power so a turn's moves read power-by-power (sorted by name).
  const groups = [];
  const idx = {};
  for (const o of orders) {
    const key = o.power || '?';
    if (idx[key] == null) { idx[key] = groups.length; groups.push({ power: key, list: [] }); }
    groups[idx[key]].list.push(o);
  }
  groups.sort((a, b) => (POWER_SHORT_NAMES[a.power] || 'z').localeCompare(POWER_SHORT_NAMES[b.power] || 'z'));

  const orderRow = (order, key, power) => {
    let status = '';
    if (order.type === 'move') status = moveSuccess[order.unitLoc] ? 'moved' : 'bounced';
    else if (cutSupports.includes(order.unitLoc)) status = 'support cut';
    return (
      <div key={key} className="dip-results-row" style={powerRowStyle(power)}>
        <span>{describeOrder(order)}</span>
        {status && <span className={`dip-results-tag tag-${status.replace(/\s/g, '-')}`}>{status}</span>}
      </div>
    );
  };

  return (
    <div className="dip-results">
      <div className="dip-results-phase">{log.phase}</div>
      {orders.length === 0 && <div className="dip-results-row dip-results-muted">All units held.</div>}
      {groups.map(g => (
        <div key={g.power} className="dip-results-group">
          {expanded && (
            <div className="dip-results-power" style={{ color: POWER_COLORS[g.power] }}>
              <span className="dip-results-swatch" style={{ backgroundColor: POWER_COLORS[g.power] }} aria-hidden="true" />
              {POWER_NAMES[g.power] || g.power}
            </div>
          )}
          {g.list.map((order, i) => orderRow(order, i, g.power))}
        </div>
      ))}
      {dislodged.length > 0 && (
        <div className="dip-results-dislodged">
          {dislodged.map((d, i) => (
            <div key={i} className="dip-results-row" style={powerRowStyle(d.unit.power)}>
              <span>{formatUnitType(d.unit.type)} {provinceLabel(d.unitLoc)}</span>
              <span className="dip-results-tag tag-dislodged">dislodged</span>
            </div>
          ))}
        </div>
      )}
      {log.retreatResolution && log.retreatResolution.map((line, i) => (
        <div key={`r-${i}`} className="dip-results-row dip-results-retreat">{line}</div>
      ))}
    </div>
  );
}
