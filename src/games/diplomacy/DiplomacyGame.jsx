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
import { createDiplomaticState } from './agents/diplomaticState.js';
import { PERSONAS } from './agents/personas.js';
import { hasApiKey } from './agents/agentClient.js';
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
  const [confirmNew, setConfirmNew] = useState(false);
  const [keyPromptDismissed, setKeyPromptDismissed] = useState(false);

  // Transient order-entry state (human power only).
  const [pendingOrders, setPendingOrders] = useState({}); // { [unitLoc]: order }
  const [selectedUnit, setSelectedUnit] = useState(null);
  const [orderType, setOrderType] = useState(null);
  const [retreatChoices, setRetreatChoices] = useState({}); // { [unitLoc]: 'DISBAND'|to }
  const [buildOrders, setBuildOrders] = useState({}); // { [power]: order[] }

  const { computeOrders, isSupported: workerSupported } = useAIWorker();

  useEffect(() => localStorage.setItem('diplomacyDarkMode', JSON.stringify(darkMode)), [darkMode]);
  useEffect(() => localStorage.setItem('diplomacyShowOrders', JSON.stringify(showOrders)), [showOrders]);

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
  });

  // Restore the saved UI phase exactly once after a resume.
  const uiRestoredRef = useRef(false);
  useEffect(() => {
    if (!uiRestoredRef.current && restored && restored.uiPhase) {
      turn.restoreUiPhase(restored.uiPhase);
      uiRestoredRef.current = true;
    }
  }, [restored, turn]);

  // Reset transient entry state whenever the phase/turn changes.
  useEffect(() => {
    setPendingOrders({});
    setSelectedUnit(null);
    setOrderType(null);
    setRetreatChoices({});
    setBuildOrders({});
  }, [board.phase, board.year, board.season, turn.uiPhase]);

  // Persist whenever the board reference changes (every applied move) so a save
  // exists even outside the explicit settle calls.
  const persistRef = useRef(null);
  persistRef.current = { board, uiPhase: turn.uiPhase, controllers, personas, conversations, diplomaticState };
  useEffect(() => {
    if (!inGame) return;
    saveGame(persistRef.current);
  }, [board, turn.uiPhase, inGame]);

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
  }

  function setPendingOrder(order) {
    setPendingOrders(prev => ({ ...prev, [order.unitLoc]: order }));
    setSelectedUnit(null);
    setOrderType(null);
  }

  function chooseOrderType(type) {
    setOrderType(type);
    if (type === 'hold') setPendingOrder({ type: 'hold', unitLoc: selectedUnit });
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
    uiRestoredRef.current = true; // don't re-restore an old phase
    turn.setUiPhase('negotiation');
    setInGame(true);
  }

  function returnToSetup() {
    clearGame();
    setConfirmNew(false);
    setInGame(false);
  }

  const adjustments = board.isWinterPhase() ? board.getAdjustments() : null;
  const lastLog = board.orderHistory[0] || null;

  // Pending-order overlays for the human power.
  const overlayOrders = useMemo(() => {
    if (!showOrders) return [];
    return Object.values(pendingOrders).map(order => ({ power: humanPower, order }));
  }, [pendingOrders, showOrders, humanPower]);

  const showKeyPrompt = !hasApiKey() && !keyPromptDismissed && inGame;

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

      <div className="mx-auto flex min-h-screen w-full max-w-[1600px] flex-col gap-4 px-4 py-4 lg:flex-row lg:px-6">
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
              <button
                className="dip-primary-btn mt-3 w-full"
                onClick={turn.proceedToOrders}
                disabled={turn.isBusy}
              >
                {turn.isBusy ? 'Powers conferring…' : 'Proceed to orders'}
              </button>
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

          <div className="dip-panel p-4">
            <div className="dip-panel-label mb-2">Supply Centers</div>
            <div className="dip-scoreboard">
              {[...POWERS]
                .map(power => ({ power, centers: board.getSupplyCount(power), units: board.getUnitCount(power) }))
                .sort((a, b) => b.centers - a.centers || a.power.localeCompare(b.power))
                .map(({ power, centers, units }) => (
                  <div key={power} className={`dip-score-row ${leader.power === power ? 'is-leader' : ''} ${power === humanPower ? 'is-you' : ''}`}>
                    <span className="dip-score-swatch" style={{ backgroundColor: POWER_COLORS[power] }} aria-hidden="true" />
                    <span className="dip-score-name" style={{ color: 'var(--dip-text)' }}>{POWER_SHORT_NAMES[power]}</span>
                    <span className="dip-score-centers">{centers}</span>
                    <span className="dip-score-units">{units}u</span>
                  </div>
                ))}
            </div>
          </div>

          <div className="dip-panel p-4">
            <div className="dip-panel-label mb-2">Results Log</div>
            <div className="dip-log-feed">
              {!lastLog ? (
                <p className="dip-log-empty">No turn resolved yet.</p>
              ) : (
                <ResultsLog log={lastLog} board={board} />
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
            />
          </div>
        </aside>

        {/* ---- Center: the map ---- */}
        <main className="order-1 flex min-h-[260px] flex-1 flex-col items-center justify-center gap-4 lg:order-2 lg:min-h-[520px]">
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
            const isSelectable = isOrderEntry
              && board.units[id]
              && board.units[id].power === humanPower;
            const selectedLoc = board.unitLocAt(id);
            const isSelected = selectedUnit && baseProvince(selectedUnit) === id;
            return (
              <path
                key={id}
                d={shape}
                className={`dip-province dip-province-${province.type} ${isSelectable ? 'is-selectable' : ''} ${isSelected ? 'is-selected' : ''}`}
                style={owner ? { fill: POWER_ACCENTS[owner], stroke: POWER_COLORS[owner] } : undefined}
                onClick={() => selectedLoc && selectUnitForOrder(selectedLoc)}
                role={isSelectable ? 'button' : undefined}
                tabIndex={isSelectable ? 0 : undefined}
                aria-label={isSelectable ? `Select unit at ${province.name}` : undefined}
                onKeyDown={isSelectable ? (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); selectUnitForOrder(selectedLoc); } } : undefined}
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
            <g key={unit.loc} className="dip-unit-group" filter="url(#dip-piece-shadow)" onClick={() => selectUnitForOrder(unit.loc)}>
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
              <div className="mt-3 dip-target-grid">
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
    return loadGame() || false;
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

function ResultsLog({ log }) {
  const orders = Object.values(log.orders || {});
  const resolved = log.resolved || {};
  const moveSuccess = resolved.moveSuccess || {};
  const cutSupports = resolved.cutSupports || [];
  const dislodged = resolved.dislodged || [];
  return (
    <div className="dip-results">
      <div className="dip-results-phase">{log.phase}</div>
      {orders.map((order, i) => {
        let status = '';
        if (order.type === 'move') status = moveSuccess[order.unitLoc] ? 'moved' : 'bounced';
        else if (cutSupports.includes(order.unitLoc)) status = 'support cut';
        return (
          <div key={i} className="dip-results-row">
            <span>{describeOrder(order)}</span>
            {status && <span className={`dip-results-tag tag-${status.replace(/\s/g, '-')}`}>{status}</span>}
          </div>
        );
      })}
      {dislodged.length > 0 && (
        <div className="dip-results-dislodged">
          {dislodged.map((d, i) => (
            <div key={i} className="dip-results-row">
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
