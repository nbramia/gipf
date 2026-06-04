// DiplomacyGame.jsx - React UI + SVG rendering for classic Diplomacy.
//
// Hot-seat baseline: a human enters every power's orders before a single
// "Submit orders" resolves the turn (Diplomacy is simultaneous). All legal
// options are sourced from the engine (getLegalOrdersForUnit / getMoveTargets /
// getRetreatOptions / getLegalAdjustmentOrders) — the UI never computes
// adjacency itself. The per-power `controller` ('human' | 'ai') is the seam for
// later AI issues; 'ai' powers placeholder-hold at submit (no AI logic here).

import React, { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import DiplomacyBoard, {
  POWERS,
  POWER_NAMES,
  POWER_SHORT_NAMES,
  POWER_COLORS,
  POWER_ACCENTS,
  PROVINCES,
  SUPPLY_CENTERS,
  baseProvince,
  coastOf,
  formatUnitType,
} from './DiplomacyBoard.js';
import './diplomacy.css';

// ----- viewBox computed from PROVINCES coords + padding (nothing clipped) -----
const PAD = 48;
const COORDS = Object.values(PROVINCES);
const MIN_X = Math.min(...COORDS.map(p => p.x));
const MAX_X = Math.max(...COORDS.map(p => p.x));
const MIN_Y = Math.min(...COORDS.map(p => p.y));
const MAX_Y = Math.max(...COORDS.map(p => p.y));
const VIEW = {
  x: MIN_X - PAD,
  y: MIN_Y - PAD,
  w: MAX_X - MIN_X + PAD * 2,
  h: MAX_Y - MIN_Y + PAD * 2,
};

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

// Where a unit at `loc` sits on the map (split-coast fleets nudge toward coast).
function unitPoint(loc) {
  const province = PROVINCES[baseProvince(loc)];
  return province ? { x: province.x, y: province.y } : null;
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

function defaultControllers() {
  // All powers default to human (hot-seat). 'ai' is the reserved seam.
  return Object.fromEntries(POWERS.map(power => [power, 'human']));
}

export default function DiplomacyGame() {
  const [board, setBoard] = useState(() => new DiplomacyBoard());
  const [darkMode, setDarkMode] = useState(() => JSON.parse(localStorage.getItem('diplomacyDarkMode') || 'false'));
  const [showOrders, setShowOrders] = useState(() => JSON.parse(localStorage.getItem('diplomacyShowOrders') || 'true'));
  const [controllers] = useState(defaultControllers);

  const [activePower, setActivePower] = useState(POWERS[0]);
  // pendingOrdersByPower[power] = { [unitLoc]: orderObject }
  const [pendingOrders, setPendingOrders] = useState({});
  // In-progress order entry: { unitLoc, type } once a unit + type are chosen.
  const [selectedUnit, setSelectedUnit] = useState(null);
  const [orderType, setOrderType] = useState(null);
  // Retreat phase: { [unitLoc]: 'DISBAND' | targetLoc }
  const [retreatChoices, setRetreatChoices] = useState({});
  // Winter phase: pending adjustment orders per power (array).
  const [buildOrders, setBuildOrders] = useState({});
  const [confirmNew, setConfirmNew] = useState(false);

  useEffect(() => localStorage.setItem('diplomacyDarkMode', JSON.stringify(darkMode)), [darkMode]);
  useEffect(() => localStorage.setItem('diplomacyShowOrders', JSON.stringify(showOrders)), [showOrders]);

  // Reset transient entry state whenever the phase/turn changes.
  useEffect(() => {
    setPendingOrders({});
    setSelectedUnit(null);
    setOrderType(null);
    setRetreatChoices({});
    setBuildOrders({});
  }, [board.phase, board.year, board.season]);

  const phaseLabel = board.getPhaseLabel();
  const leader = board.getLeader();

  const humanPowers = useMemo(() => POWERS.filter(power => controllers[power] === 'human'), [controllers]);

  // Units owned by the active power that can be ordered this phase.
  const activeUnits = useMemo(() => board.getUnits(activePower), [board, activePower]);

  const refresh = () => setBoard(board.clone());

  // ----- Orders phase: order construction (all options from the engine) -----
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

  function selectUnitForOrder(loc) {
    const unit = board.units[loc];
    if (!unit || unit.power !== activePower || !board.isOrdersPhase()) return;
    setSelectedUnit(loc);
    setOrderType(null);
  }

  function setPendingOrder(power, order) {
    setPendingOrders(prev => ({
      ...prev,
      [power]: { ...(prev[power] || {}), [order.unitLoc]: order },
    }));
    setSelectedUnit(null);
    setOrderType(null);
  }

  function chooseOrderType(type) {
    setOrderType(type);
    // Hold has no target — commit immediately.
    if (type === 'hold') {
      setPendingOrder(activePower, { type: 'hold', unitLoc: selectedUnit });
    }
  }

  function clearOrderFor(power, unitLoc) {
    setPendingOrders(prev => {
      const next = { ...(prev[power] || {}) };
      delete next[unitLoc];
      return { ...prev, [power]: next };
    });
  }

  function submitOrders() {
    const ordersByPower = {};
    for (const power of POWERS) {
      if (controllers[power] === 'ai') {
        // Placeholder: AI powers hold every unit (no AI logic in this issue).
        ordersByPower[power] = board.getUnits(power).map(u => ({ type: 'hold', unitLoc: u.loc }));
        continue;
      }
      const entered = pendingOrders[power] || {};
      ordersByPower[power] = board.getUnits(power).map(u => entered[u.loc] || { type: 'hold', unitLoc: u.loc });
    }
    board.applyMove({ type: 'orders', ordersByPower });
    refresh();
  }

  // ----- Retreat phase -----
  function chooseRetreat(unitLoc, value) {
    setRetreatChoices(prev => ({ ...prev, [unitLoc]: value }));
  }

  function submitRetreats() {
    const retreatsByPower = {};
    for (const pending of board.pendingRetreats) {
      const power = pending.unit.power;
      const choice = retreatChoices[pending.unitLoc];
      const to = !choice || choice === 'DISBAND' ? null : choice;
      if (!retreatsByPower[power]) retreatsByPower[power] = [];
      retreatsByPower[power].push({ type: 'retreat', unitLoc: pending.unitLoc, to });
    }
    board.applyMove({ type: 'retreats', retreatsByPower });
    refresh();
  }

  // ----- Winter phase -----
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
    const adjustmentsByPower = {};
    for (const power of POWERS) {
      adjustmentsByPower[power] = buildOrders[power] || [];
    }
    board.applyMove({ type: 'adjustments', adjustmentsByPower });
    refresh();
  }

  // ----- Undo / redo / new game -----
  function doUndo() {
    if (board.undo()) refresh();
  }
  function doRedo() {
    if (board.redo()) refresh();
  }
  function newGame() {
    setConfirmNew(false);
    setBoard(new DiplomacyBoard());
  }

  // ----- Pending-order overlays for the active power (+ already-entered ones) -----
  const overlayOrders = useMemo(() => {
    if (!showOrders) return [];
    const all = [];
    for (const power of POWERS) {
      const entered = pendingOrders[power] || {};
      for (const order of Object.values(entered)) {
        all.push({ power, order });
      }
    }
    return all;
  }, [pendingOrders, showOrders]);

  const adjustments = board.isWinterPhase() ? board.getAdjustments() : null;
  const lastLog = board.orderHistory[0] || null;

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
              <button className="dip-primary-btn flex-1" onClick={newGame}>New Game</button>
              <button className="dip-tool-btn flex-1" onClick={() => setConfirmNew(false)}>Cancel</button>
            </div>
          </div>
        </div>
      )}

      <div className="mx-auto flex min-h-screen w-full max-w-[1600px] flex-col gap-4 px-4 py-4 lg:flex-row lg:px-6">
        {/* ---- Left: header, scoreboard ---- */}
        <aside className="order-2 flex w-full flex-col gap-3 lg:order-1 lg:w-[300px]">
          <div className="dip-panel p-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <Link to="/" className="dip-panel-label hover:opacity-80">GIPF Project</Link>
                <h1 className="mt-1 font-display text-3xl font-bold" style={{ color: 'var(--dip-text)' }}>DIPLOMACY</h1>
              </div>
            </div>
            <div className="dip-phase-banner mt-4">{phaseLabel}</div>
            <div className="dip-last-action mt-2">{board.lastAction}</div>
            <div className="mt-3 flex flex-wrap gap-2">
              <button className="dip-tool-btn px-3" onClick={doUndo} disabled={!board.canUndo()} aria-label="Undo last move">Undo</button>
              <button className="dip-tool-btn px-3" onClick={doRedo} disabled={!board.canRedo()} aria-label="Redo move">Redo</button>
              <button className="dip-tool-btn px-3" onClick={() => setConfirmNew(true)} aria-label="Start a new game">New</button>
            </div>
            <div className="mt-3 space-y-2">
              <ToggleRow label="Dark Mode" checked={darkMode} onChange={() => setDarkMode(v => !v)} />
              <ToggleRow label="Show Orders" checked={showOrders} onChange={() => setShowOrders(v => !v)} />
            </div>
          </div>

          <div className="dip-panel p-4">
            <div className="dip-panel-label mb-2">Supply Centers</div>
            <div className="dip-scoreboard">
              {[...POWERS]
                .map(power => ({ power, centers: board.getSupplyCount(power), units: board.getUnitCount(power) }))
                .sort((a, b) => b.centers - a.centers || a.power.localeCompare(b.power))
                .map(({ power, centers, units }) => (
                  <div key={power} className={`dip-score-row ${leader.power === power ? 'is-leader' : ''}`}>
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

          {/* Reserved region for a future chat / negotiation panel (later issues). */}
          <div className="dip-panel dip-negotiation-slot p-4">
            <div className="dip-panel-label mb-1">Negotiation</div>
            <p className="dip-negotiation-hint">Chat &amp; negotiation arrive in a later release.</p>
          </div>
        </aside>

        {/* ---- Center: the map ---- */}
        <main className="order-1 flex min-h-[520px] flex-1 flex-col items-center justify-center gap-4 lg:order-2">
          <div className="dip-board-shell">
            {renderMap()}
          </div>
        </main>

        {/* ---- Right: order entry / retreat / winter / game-over ---- */}
        <aside className="order-3 flex w-full flex-col gap-3 lg:w-[340px]">
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

          {board.isOrdersPhase() && renderOrderPanel()}
          {board.isRetreatPhase() && renderRetreatPanel()}
          {board.isWinterPhase() && renderWinterPanel()}
        </aside>
      </div>
    </div>
  );

  // ============================ render helpers ============================

  function renderMap() {
    const units = board.getUnits();
    return (
      <svg
        className="dip-board-svg"
        viewBox={`${VIEW.x} ${VIEW.y} ${VIEW.w} ${VIEW.h}`}
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
        </defs>

        {/* Province nodes */}
        {Object.entries(PROVINCES).map(([id, province]) => {
          const owner = province.supply ? board.supplyCenters[id] : null;
          const isSelectable = board.isOrdersPhase()
            && board.units[id]
            && board.units[id].power === activePower;
          const selectedLoc = board.unitLocAt(id);
          const isSelected = selectedUnit && baseProvince(selectedUnit) === id;
          return (
            <g key={id} className="dip-province-group">
              <title>{`${province.name} (${id})${province.supply ? ` — supply center${owner ? `, ${POWER_SHORT_NAMES[owner]}` : ''}` : ''}`}</title>
              <circle
                cx={province.x}
                cy={province.y}
                r={province.supply ? 17 : 13}
                className={`dip-province dip-province-${province.type} ${isSelectable ? 'is-selectable' : ''} ${isSelected ? 'is-selected' : ''}`}
                style={owner ? { fill: POWER_ACCENTS[owner], stroke: POWER_COLORS[owner] } : undefined}
                onClick={() => selectedLoc && selectUnitForOrder(selectedLoc)}
                role={isSelectable ? 'button' : undefined}
                tabIndex={isSelectable ? 0 : undefined}
                aria-label={isSelectable ? `Select unit at ${province.name}` : undefined}
                onKeyDown={isSelectable ? (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); selectUnitForOrder(selectedLoc); } } : undefined}
              />
              {province.supply && (
                <circle cx={province.x} cy={province.y} r={3.2} className="dip-supply-dot" />
              )}
              <text x={province.x} y={province.y + 26} textAnchor="middle" className="dip-province-label">{id}</text>
            </g>
          );
        })}

        {/* Units */}
        {units.map(unit => {
          const pt = unitPoint(unit.loc);
          if (!pt) return null;
          const color = POWER_COLORS[unit.power];
          return (
            <g key={unit.loc} className="dip-unit-group" filter="url(#dip-piece-shadow)" onClick={() => selectUnitForOrder(unit.loc)}>
              <title>{`${POWER_SHORT_NAMES[unit.power]} ${unit.type} ${provinceLabel(unit.loc)}`}</title>
              {unit.type === 'fleet' ? (
                <rect x={pt.x - 9} y={pt.y - 8} width={18} height={16} rx={3} className="dip-unit dip-unit-fleet" style={{ fill: color }} />
              ) : (
                <circle cx={pt.x} cy={pt.y} r={9} className="dip-unit dip-unit-army" style={{ fill: color }} />
              )}
              <text x={pt.x} y={pt.y} textAnchor="middle" dominantBaseline="central" className="dip-unit-glyph">
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
      return (
        <line
          key={key}
          x1={from.x} y1={from.y} x2={target.x} y2={target.y}
          className={`dip-order-support ${order.type === 'convoy' ? 'is-convoy' : ''}`}
          style={{ stroke: color }}
        />
      );
    }
    // hold
    return (
      <circle key={key} cx={from.x} cy={from.y} r={14} className="dip-order-hold" style={{ stroke: color }} />
    );
  }

  function renderOrderPanel() {
    const entered = pendingOrders[activePower] || {};
    return (
      <>
        <div className="dip-panel p-4">
          <div className="dip-panel-label mb-2">Order Entry</div>
          <div className="dip-power-switcher">
            {humanPowers.map(power => (
              <button
                key={power}
                className={`dip-power-tab ${activePower === power ? 'active' : ''}`}
                style={{ '--tab-color': POWER_COLORS[power] }}
                onClick={() => { setActivePower(power); setSelectedUnit(null); setOrderType(null); }}
              >
                {POWER_SHORT_NAMES[power]}
              </button>
            ))}
          </div>

          <div className="mt-3 dip-unit-list">
            {activeUnits.length === 0 && <p className="dip-log-empty">{POWER_SHORT_NAMES[activePower]} has no units.</p>}
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
                    <button className="dip-tool-btn px-2" onClick={() => clearOrderFor(activePower, unit.loc)} aria-label={`Clear order for ${unit.loc}`}>Clear</button>
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
                    onClick={() => setPendingOrder(activePower, option)}
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
            Enter orders for every human power, then resolve the turn. Units with no order will hold.
          </p>
          <button className="dip-primary-btn mt-3 w-full" onClick={submitOrders}>Submit Orders</button>
        </div>
      </>
    );
  }

  function renderRetreatPanel() {
    return (
      <div className="dip-panel p-4">
        <div className="dip-panel-label mb-2">Retreats</div>
        {board.pendingRetreats.length === 0 ? (
          <p className="dip-log-empty">No retreats pending.</p>
        ) : (
          <div className="dip-retreat-list">
            {board.pendingRetreats.map(pending => {
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
        <button className="dip-primary-btn mt-4 w-full" onClick={submitRetreats}>Submit Retreats</button>
      </div>
    );
  }

  function renderWinterPanel() {
    return (
      <div className="dip-panel p-4">
        <div className="dip-panel-label mb-2">Winter Adjustments</div>
        <div className="dip-winter-list">
          {POWERS.map(power => {
            const adj = adjustments[power];
            if (!adj || (adj.buildCount === 0 && adj.disbandCount === 0)) return null;
            const legal = board.getLegalAdjustmentOrders(power);
            const selected = buildOrders[power] || [];
            const need = adj.delta > 0 ? `build ${adj.buildCount}` : `disband ${adj.disbandCount}`;
            return (
              <div key={power} className="dip-winter-power">
                <div className="dip-retreat-head">
                  <span className="dip-score-swatch" style={{ backgroundColor: POWER_COLORS[power] }} aria-hidden="true" />
                  {POWER_SHORT_NAMES[power]} — {need}
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
                        onClick={() => toggleBuildOrder(power, order)}
                      >
                        {label}
                      </button>
                    );
                  })}
                </div>
                <p className="dip-winter-count">{selected.length} selected</p>
              </div>
            );
          })}
        </div>
        <button className="dip-primary-btn mt-4 w-full" onClick={submitAdjustments}>Submit Adjustments</button>
      </div>
    );
  }
}

// ----- small presentational helpers -----

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
