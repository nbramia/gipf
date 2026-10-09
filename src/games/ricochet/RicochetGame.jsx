// RicochetGame.jsx - solo Ricochet: slide robots until the target colour lands on its symbol.

import React, { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import RicochetBoard, { DIRS } from './RicochetBoard.js';
import { desiredLength, isProvisional, PROVISIONAL_ROUNDS } from './engine/rating.js';
import { recordRound, loadRating, loadHistory, summarize, historyFor, setupsWithHistory } from './engine/history.js';
import { readVariant, writeVariant, sameVariant, setupKey, setupLabel, setupShortLabel } from './engine/variants.js';
import RicochetBoardView, { TargetGlyph, ROBOT_LETTER, DIR_NAME, COLOR_LABEL } from './RicochetBoardView.jsx';
import useSolverWorker from './hooks/useSolverWorker.js';
import useSprint from './hooks/useSprint.js';
import { readGameMode, sprintKey, sprintLength, writeGameMode } from './engine/sprint.js';
import { ModeBar, ModeSwitch, ProgressTabs, SprintHudTiles, SprintResults, SprintStart, SprintToast } from './SprintPanel.jsx';
import ConfirmDialog from '../../ConfirmDialog.jsx';
import './ricochet.css';

const DARK_KEY = 'ricochetDarkMode';
const MODE_KEY = 'ricochetInputMode';
const TRACES_KEY = 'ricochetPathTraces';
const PLAN_STEP_MS = 300;
const PLAN_HOLD_MS = 800;
const MAX_PLAN = 60;
const KEY_TO_ROBOT = { r: 'red', g: 'green', b: 'blue', y: 'yellow', k: 'black' };
const KEY_TO_DIR = {
  arrowup: 'N', w: 'N', arrowright: 'E', d: 'E', arrowdown: 'S', s: 'S', arrowleft: 'W', a: 'W',
};
const CODE_KEY = {
  KeyR: 'r', KeyG: 'g', KeyB: 'b', KeyY: 'y', KeyK: 'k', KeyW: 'w', KeyA: 'a', KeyS: 's', KeyD: 'd', KeyU: 'u',
};
const DIR_GLYPH = { N: '▲', E: '▶', S: '▼', W: '◀' };
const REPLAY_STEP_MS = 800;
const DEAL_TIMEOUT_MS = 15000;

const makeSeed = () => Math.floor(Math.random() * 1e9) + 1;
const reducedMotion = () => {
  try {
    return typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
};
const readDark = () => {
  try { return localStorage.getItem(DARK_KEY) !== 'false'; } catch { return true; }
};
// A mouse press on a game control must not leave it focused: Enter then submits the
// plan instead of re-activating that button. Keyboard activation is unaffected.
const keepFocus = e => e.preventDefault();
const readMode = () => {
  try { return localStorage.getItem(MODE_KEY) === 'live' ? 'live' : 'plan'; } catch { return 'plan'; }
};
const readTraces = () => {
  try { return localStorage.getItem(TRACES_KEY) === 'on'; } catch { return false; }
};
// One trace per step. `path` is the list of cells the robot passed through as turning
// points (start, any bend, end), `n` the 1-based step number. A step that could not move
// (plan mode only) is a one-cell trace marked `blocked`, drawn as a bump.
// A move that bent at a barrier carries its corner cells in `rec.path`.
const traceOf = (rec, n) => ({ robot: rec.robot, n, path: rec.path || [rec.from, rec.to] });
// A copy of the round's layout (walls, barriers, targets, robots) for replaying a line.
function scratchOf(board) {
  const scratch = new RicochetBoard({
    walls: board.walls, targets: board.targets, robots: board.roundStart, config: board.config, barriers: board.barriers,
  });
  scratch.startRound(board.currentTargetId);
  return scratch;
}
// Plays one step on a scratch board; returns the move record (or false) and its trace.
function playTraced(scratch, step, n) {
  const from = scratch.robots[step.robot];
  const rec = scratch.applyMove(step);
  return { rec, trace: rec ? traceOf(rec, n) : { robot: step.robot, n, path: [from], blocked: true, dir: step.dir } };
}
// Traces for a line of steps played from the round's start on a scratch board.
function tracesFor(board, steps) {
  const scratch = scratchOf(board);
  return steps.map((step, i) => playTraced(scratch, step, i + 1).trace);
}
const pct = x => `${Math.round(x * 100)}%`;
const fmtTime = ms => {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};
const cellDistance = (a, b, size) => Math.abs(((a / size) | 0) - ((b / size) | 0)) + Math.abs((a % size) - (b % size));
// Cells travelled by a move, around its bends when it has any.
const travel = (rec, size) => {
  const pts = rec.path || [rec.from, rec.to];
  let d = 0;
  for (let i = 1; i < pts.length; i++) d += cellDistance(pts[i - 1], pts[i], size);
  return d;
};
// Undo may step back within the current round only (including back over a reset),
// never into the previous round's last position.
function canUndoInRound(board) {
  if (!board.canUndo()) return false;
  try {
    return JSON.parse(board.stateHistory[board.historyIndex - 1]).currentTargetId === board.currentTargetId;
  } catch {
    return false;
  }
}
const slideFor = (rec, size) => (reducedMotion() ? 0 : 90 + 26 * travel(rec, size));

function targetLabel(t) {
  if (!t) return '';
  if (t.color == null) return 'Vortex (any robot)';
  return `${COLOR_LABEL[t.color]} ${t.shape}`;
}

// Modal panel: focus moves in, Tab stays inside, Escape closes, focus returns.
function Panel({ title, onClose, children }) {
  const ref = useRef(null);
  useEffect(() => {
    const opener = document.activeElement;
    const first = ref.current && ref.current.querySelector('button, [href]');
    if (first) first.focus();
    return () => { if (opener && opener.isConnected && opener.focus) opener.focus(); };
  }, []);
  const onKeyDown = (e) => {
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); onClose(); return; }
    if (e.key !== 'Tab') return;
    const items = [...ref.current.querySelectorAll('button:not([disabled]), [href]')];
    if (!items.length) return;
    const first = items[0];
    const last = items[items.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  };
  return (
    <div className="ricochet-overlay" onClick={onClose} onKeyDown={onKeyDown} role="dialog" aria-modal="true" aria-label={title} ref={ref}>
      <div className="ricochet-modal" onClick={e => e.stopPropagation()}>
        <div className="ricochet-modal-head">
          <h2>{title}</h2>
          <button type="button" className="ricochet-btn" onClick={onClose}>Close</button>
        </div>
        {children}
      </div>
    </div>
  );
}

const ARROW = { N: '↑', E: '→', S: '↓', W: '←' };

// Compact notation: a coloured robot chip and an arrow per move. The first step
// that differs from `other` is marked.
function MoveLine({ label, moves, other, traceShown, onTraceToggle }) {
  let diverge = -1;
  if (other) {
    const n = Math.min(moves.length, other.length);
    diverge = moves.length === other.length ? -1 : n;
    for (let i = 0; i < n; i++) {
      if (moves[i].robot !== other[i].robot || moves[i].dir !== other[i].dir) { diverge = i; break; }
    }
  }
  return (
    <div className="ricochet-moveline">
      {onTraceToggle ? (
        <button
          type="button"
          className="ricochet-moveline-label ricochet-trace-toggle"
          aria-pressed={traceShown}
          aria-label={`Show ${label} path trace`}
          onClick={onTraceToggle}
        >{label}</button>
      ) : <span className="ricochet-moveline-label">{label}</span>}
      <ol aria-label={`${label} moves`}>
        {moves.map((m, i) => (
          <li
            key={i}
            className={`ricochet-step${i === diverge ? ' is-diverged' : ''}`}
            title={`${COLOR_LABEL[m.robot]} ${DIR_NAME[m.dir]}`}
          >
            <span className={`ricochet-step-chip ricochet-step-${m.robot}`}>{ROBOT_LETTER[m.robot]}</span>
            <span className="ricochet-step-arrow">{ARROW[m.dir]}</span>
          </li>
        ))}
      </ol>
    </div>
  );
}

const ProvisionalTag = () => (
  <span className="ricochet-prov" title="Provisional rating: it settles after 20 rounds">provisional</span>
);

function HowToPlay({ variant }) {
  const robots = variant.fifthRobot ? 'Five' : 'Four';
  return (
    <div className="ricochet-prose">
      <p>{robots} robots sit on a {variant.size} by {variant.size} board. Each round shows a target symbol. Get the robot of the matching colour to stop on that symbol. The vortex accepts any robot.</p>
      <ul>
        <li>A robot moves in a straight line and keeps sliding until it hits a wall or another robot. You cannot stop partway.</li>
        <li>Any robot may be moved, and blockers matter. Parking one robot is often how another gets to stop where you need.</li>
        <li>Fewer moves and a faster solve score higher. Your rating tracks both, and the next puzzle is chosen near your level.</li>
        <li>The next round starts from wherever the robots ended.</li>
        {variant.fifthRobot && <li>The black robot (key K) is a full robot: it moves, blocks and is blocked, and every move counts. It can take only the vortex, never a coloured target.</li>}
        {variant.diagonals && <li>A diagonal barrier turns any robot of another colour 90 degrees and it keeps sliding; a robot of the barrier&apos;s own colour passes straight through. The black robot is always turned. A turn is not an extra move, and a robot never stops on a barrier.</li>}
        <li>Every setup other than the standard one (16 by 16, four robots, no barriers, Plan mode) has its own rating and history, so Live mode and each variant start from 1200.</li>
      </ul>
      <p><strong>Two input modes.</strong> <em>Plan (default): moves are hidden until you submit.</em> <em>Live: robots move as you enter moves (choose it in Settings).</em></p>
      <p><strong>Plan mode (default).</strong> The board does not move while you enter a line. Pick a robot (tap it, or press R, G, B or Y), then add steps with an arrow key or W A S D, the pad, a tap on the board, or a swipe. Steps appear in the plan list, and nothing says whether a step is legal; a step that cannot move still counts as a move. U or Backspace removes the last step, Esc clears the plan, and Enter or Submit plays it on the board. If the target robot stops on the target at some step the round is solved with that many moves; later steps are ignored. Otherwise the board returns to the start, your plan stays for editing, and the clock keeps running.</p>
      <p><strong>Live mode.</strong> Choose it in Settings. Each move slides immediately, only legal directions are offered, U or Backspace undoes a move, and Esc resets the round.</p>
      <p><strong>Results.</strong> On the results screen of a round, S shows the solution (during play S still moves south).</p>
      <p><strong>Sprint.</strong> Choose Sprint above the board for a timed run: solve as many puzzles as you can in 5:00 of active time (the clock stops while a puzzle is being dealt and while the tab is hidden). Puzzles start at 3 moves and grow by one move for every 2 you solve, up to 9. Each solve scores 100 x quality x pace for that puzzle. Skip gives up the puzzle for 0 points and shows nothing. A puzzle unfinished at the buzzer counts for nothing. Sprint uses your current board and input settings, never changes your rating or round history, and keeps your top 10 scores per setup.</p>
      <p className="ricochet-credit">Ricochet Robots was designed by Alex Randolph. This is an independent, solo implementation.</p>
    </div>
  );
}

function Sparkline({ series }) {
  const pts = series.slice(-60);
  if (pts.length < 2) return <p className="ricochet-muted">Play a few rounds to see your rating trend.</p>;
  const lo = Math.min(...pts);
  const hi = Math.max(...pts);
  const span = Math.max(1, hi - lo);
  const path = pts.map((v, i) => `${i === 0 ? 'M' : 'L'}${(i / (pts.length - 1)) * 220 + 4} ${46 - ((v - lo) / span) * 40 + 2}`).join('');
  return (
    <div>
      <svg className="ricochet-spark" viewBox="0 0 228 52" role="img" aria-label={`Rating trend, ${lo} to ${hi}`}>
        <path d={path} fill="none" stroke="var(--rc-accent)" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
      </svg>
      <p className="ricochet-muted ricochet-spark-labels" data-testid="spark-labels">
        <span>Start {pts[0]}</span><span>Low {lo}</span><span>High {hi}</span><span>Now {pts[pts.length - 1]}</span>
      </p>
    </div>
  );
}

function ProgressPanel({ setup, history: all }) {
  const options = useMemo(() => {
    const keys = setupsWithHistory(all);
    return keys.includes(setup) ? keys : [...keys, setup].sort((a, b) => (a === null ? -1 : b === null ? 1 : a < b ? -1 : 1));
  }, [all, setup]);
  const [viewed, setViewed] = useState(setup);
  const history = useMemo(() => historyFor(all, viewed), [all, viewed]);
  const rating = useMemo(() => loadRating(viewed), [viewed]);
  const s = useMemo(() => summarize(history), [history]);
  const recent = history.slice(-10).reverse();
  return (
    <div>
      <p className="ricochet-setup-line" data-testid="progress-setup">
        Setup: <strong>{setupLabel(viewed)}</strong>
        {options.length > 1 && (
          <select aria-label="View setup" value={viewed || 'standard'} onChange={e => setViewed(e.target.value === 'standard' ? null : e.target.value)}>
            {options.map(k => <option key={k || 'standard'} value={k || 'standard'}>{setupLabel(k)}</option>)}
          </select>
        )}
      </p>
      <div className="ricochet-stat-grid">
        <div><span className="ricochet-stat-n" data-testid="progress-rating">{rating.rating}</span><span className="ricochet-stat-l">{isProvisional(rating.rounds) ? `Rating, provisional (${rating.rounds}/${PROVISIONAL_ROUNDS} rounds)` : 'Rating'}</span></div>
        <div><span className="ricochet-stat-n">{s.avgQuality == null ? '–' : pct(s.avgQuality)}</span><span className="ricochet-stat-l">Avg quality</span></div>
        <div><span className="ricochet-stat-n">{s.avgSecondsPerOptimalMove == null ? '–' : s.avgSecondsPerOptimalMove.toFixed(1)}</span><span className="ricochet-stat-l">Sec per optimal move</span></div>
        <div><span className="ricochet-stat-n">{s.roundsPlayed ? pct(s.optimalShare) : '–'}</span><span className="ricochet-stat-l">Optimal</span></div>
        <div><span className="ricochet-stat-n">{s.revealedCount}</span><span className="ricochet-stat-l">Revealed</span></div>
      </div>
      <p className="ricochet-muted">Averages cover the last {s.roundsPlayed} round{s.roundsPlayed === 1 ? '' : 's'} (up to 20).</p>
      <Sparkline series={history.length ? [history[0].ratingBefore, ...s.ratingSeries] : []} />
      <h3>Recent rounds</h3>
      {recent.length === 0 ? <p className="ricochet-muted">No rounds yet.</p> : (
        <ul className="ricochet-recent">
          {recent.map(e => (
            <li key={e.at}>
              <span>{e.revealed ? 'Revealed' : `${e.moves} / ${e.optimal} moves`}</span>
              <span>{fmtTime(e.timeMs)}</span>
              <span>{pct(e.score)}</span>
              <span className={e.ratingAfter >= e.ratingBefore ? 'ricochet-up' : 'ricochet-down'}>{e.ratingAfter - e.ratingBefore >= 0 ? '+' : ''}{e.ratingAfter - e.ratingBefore}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// `createBoard` is a seam for tests that need a hand-built layout.
export default function RicochetGame({ createBoard = () => new RicochetBoard({ seed: makeSeed(), config: readVariant() }) }) {
  const boardRef = useRef(null);
  if (!boardRef.current) boardRef.current = createBoard();
  const board = boardRef.current;
  const [, repaint] = useReducer(n => n + 1, 0);

  const [darkMode, setDarkMode] = useState(readDark);
  // dealing | play | settling | results | replay | error
  const [phase, setPhase] = useState('dealing');
  const [round, setRound] = useState(null); // { targetId, length, solution }
  const [selected, setSelected] = useState(null);
  // Mirrors `selected` so two key events in the same tick (select, then move) see the new robot.
  const selectedRef = useRef(null);
  selectedRef.current = selected;
  const [results, setResults] = useState(null); // { entry, revealed }
  // The board is the truth about the variant; a setting change swaps in a new board.
  const [variant, setVariant] = useState(() => ({ ...board.config }));
  const variantRef = useRef(variant);
  // Standard (16x16, four robots, no barriers, Plan) is null and keeps the original rating
  // and history keys; every other variant and Live mode has a rating of its own.
  const [ratingTick, bumpRating] = useReducer(n => n + 1, 0);
  const [panel, setPanel] = useState(null); // 'help' | 'progress'
  const [confirmGiveUp, setConfirmGiveUp] = useState(false);
  const [overlayCells, setOverlayCells] = useState(null);
  const [replayStep, setReplayStep] = useState(0);
  const [slideMs, setSlideMs] = useState(0);
  const [slide, setSlide] = useState(null); // the bending path of the latest slide, if it has bends
  const slideCount = useRef(0);
  const [status, setStatus] = useState('');
  const [errorText, setErrorText] = useState('');
  const [elapsed, setElapsed] = useState(0);
  const [mode, setMode] = useState(readMode);
  const [pathTraces, setPathTraces] = useState(readTraces);
  const [gameMode, setGameMode] = useState(readGameMode);
  const gameModeRef = useRef(gameMode);
  gameModeRef.current = gameMode;
  const [confirmEnd, setConfirmEnd] = useState(false);
  const [progressTab, setProgressTab] = useState('rounds');
  // Traces of a submitted plan (every non-blocked step, numbered by plan position); the
  // board only draws the ones the replay has reached. Kept after a failed submit.
  const [planTraces, setPlanTraces] = useState([]);
  // Results panel toggles; null means the default (your line after a solve, the optimal line after a reveal).
  const [traceToggle, setTraceToggle] = useState({ you: null, optimal: null });
  const [plan, setPlan] = useState([]);
  const [bump, setBump] = useState(null);
  const [notice, setNotice] = useState('');
  const modeRef = useRef(mode);
  modeRef.current = mode;
  const setup = setupKey(variant, mode);
  const setupRef = useRef(setup);
  setupRef.current = setup;
  // The setup the round on the board was dealt under; every record of that round uses it.
  const roundSetupRef = useRef(setup);
  const rating = useMemo(() => { void ratingTick; return loadRating(setup); }, [setup, ratingTick]); // ratingTick: re-read after a record
  const planRef = useRef(plan);
  planRef.current = plan;
  const bumpCount = useRef(0);

  const { requestRound, cancel } = useSolverWorker();
  // Sprint: the session. Every puzzle is dealt from where the robots are, as in Classic.
  const sprintEndRef = useRef(null);
  const sprint = useSprint({ onEnd: () => sprintEndRef.current && sprintEndRef.current() });
  const sprintRef = useRef(sprint);
  sprintRef.current = sprint;
  const dealId = useRef(0);
  const phaseRef = useRef(phase);
  phaseRef.current = phase;
  const clock = useRef({ running: false, accum: 0, since: null });
  const timers = useRef(new Set());
  const replayToken = useRef(0);
  const retriedBoard = useRef(false);

  // One call per movement: its duration and, when it bent at a barrier, the path to follow.
  const animate = useCallback((ms, rec = null) => {
    setSlideMs(ms);
    setSlide(rec && rec.path && rec.path.length > 2 ? { robot: rec.robot, path: rec.path, n: ++slideCount.current } : null);
  }, []);

  const later = useCallback((fn, ms) => {
    const id = setTimeout(() => { timers.current.delete(id); fn(); }, ms);
    timers.current.add(id);
    return id;
  }, []);

  // ---- clock: runs while the round is live and the tab is visible ----------
  const clockNow = useCallback(() => {
    const c = clock.current;
    return c.accum + (c.since != null ? Date.now() - c.since : 0);
  }, []);
  const startClock = useCallback(() => {
    clock.current = { running: true, accum: 0, since: document.visibilityState === 'hidden' ? null : Date.now() };
    setElapsed(0);
  }, []);
  const stopClock = useCallback(() => {
    const t = clockNow();
    clock.current = { running: false, accum: t, since: null };
    setElapsed(t);
    return t;
  }, [clockNow]);

  useEffect(() => {
    const onVisibility = () => {
      const c = clock.current;
      if (!c.running) return;
      if (document.visibilityState === 'hidden') {
        if (c.since != null) { c.accum += Date.now() - c.since; c.since = null; }
      } else if (c.since == null) {
        c.since = Date.now();
      }
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => document.removeEventListener('visibilitychange', onVisibility);
  }, []);

  useEffect(() => {
    if (phase !== 'play' && phase !== 'submit') return undefined;
    const id = setInterval(() => setElapsed(clockNow()), 250);
    return () => clearInterval(id);
  }, [phase, clockNow]);

  useEffect(() => {
    try { localStorage.setItem(DARK_KEY, String(darkMode)); } catch { /* unavailable */ }
  }, [darkMode]);

  useEffect(() => {
    const pending = timers.current;
    return () => { pending.forEach(clearTimeout); pending.clear(); };
  }, []);

  // ---- dealing ---------------------------------------------------------------
  const deal = useCallback(() => {
    replayToken.current++;
    const sprintOn = sprintRef.current.isRunning();
    if (sprintOn) sprintRef.current.pause(); // dealing time is not Sprint time
    setPhase((phaseRef.current = 'dealing'));
    setResults(null);
    setOverlayCells(null);
    setSlide(null);
    setPlanTraces([]);
    setTraceToggle({ you: null, optimal: null });
    setErrorText('');
    const myDeal = ++dealId.current;
    later(() => {
      if (dealId.current !== myDeal || phaseRef.current !== 'dealing') return;
      cancel();
      retriedBoard.current = false;
      setErrorText('Dealing is taking too long.');
      setPhase((phaseRef.current = 'error'));
    }, DEAL_TIMEOUT_MS);
    const dealSetup = setupRef.current;
    const accept = (picked) => {
      if (sprintOn && dealId.current !== myDeal) return;
      if (picked && picked.needsNewBoard) {
        if (retriedBoard.current) {
          retriedBoard.current = false;
          setErrorText('Could not find a puzzle on a fresh board.');
          setPhase((phaseRef.current = 'error'));
          return;
        }
        retriedBoard.current = true;
        board.startNewGame(makeSeed());
        deal();
        return;
      }
      retriedBoard.current = false;
      roundSetupRef.current = dealSetup;
      board.startRound(picked.targetId);
      setRound(picked);
      setSelected(board.getTarget().color || 'red');
      setPlan([]);
      setBump(null);
      setNotice('');
      setStatus('New puzzle. Target: ' + targetLabel(board.getTarget()) + '.');
      startClock();
      setPhase((phaseRef.current = 'play'));
      if (sprintOn) sprintRef.current.resume();
    };
    const fail = (message) => {
      if (sprintOn && dealId.current !== myDeal) return;
      setErrorText(message || 'Could not deal a puzzle.');
      setPhase((phaseRef.current = 'error'));
    };
    const desired = sprintOn ? sprintLength(sprintRef.current.solvedForRamp()) : desiredLength(loadRating(setupRef.current).rating);
    requestRound({ ...board.serializeState(), stateHistory: [], historyIndex: -1 }, desired, accept, fail);
  }, [board, requestRound, startClock, cancel, later]);

  useEffect(() => { if (gameModeRef.current === 'classic') deal(); }, [deal]);

  // ---- moves -----------------------------------------------------------------
  const finishSolve = useCallback((lastSlideMs) => {
    const timeMs = stopClock();
    if (sprintRef.current.isRunning()) {
      // Sprint: points are banked now, shown and the next puzzle dealt once the slide settles.
      if (sprintRef.current.bank({ optimal: round.length, moves: board.moves.length, timeMs }) === null) {
        sprintRef.current.end('time'); // time was already up: the solve does not count
        return;
      }
      sprintRef.current.pause(); // the slide is not thinking time
      setPhase((phaseRef.current = 'settling'));
      setStatus(`Solved in ${board.moves.length} moves.`);
      later(() => { sprintRef.current.release(); deal(); }, lastSlideMs + 200);
      return;
    }
    const entry = recordRound({ optimal: round.length, moves: board.moves.length, timeMs, variant: roundSetupRef.current });
    const playerMoves = board.moves.map(({ robot, dir }) => ({ robot, dir }));
    bumpRating();
    setPhase((phaseRef.current = 'settling'));
    setStatus(`Solved in ${board.moves.length} moves.`);
    const myDeal = dealId.current;
    later(() => {
      if (dealId.current !== myDeal) return;
      setResults({ entry, revealed: false, moves: board.moves.length, timeMs, playerMoves });
      setPhase((phaseRef.current = 'results'));
    }, lastSlideMs + 200);
  }, [board, round, later, stopClock, deal]);

  const move = useCallback((robot, dir) => {
    if (phaseRef.current !== 'play') return;
    const rec = board.applyMove({ robot, dir });
    if (!rec) return;
    const dur = slideFor(rec, board.size);
    animate(dur, rec);
    setSelected(robot);
    setStatus(`${COLOR_LABEL[robot]} moved ${DIR_NAME[dir]}. ${board.moves.length} move${board.moves.length === 1 ? '' : 's'}.`);
    repaint();
    if (board.isSolved()) finishSolve(dur);
  }, [board, finishSolve, animate]);

  const undo = useCallback(() => {
    if (phaseRef.current !== 'play' || !canUndoInRound(board)) return;
    board.undo();
    animate(reducedMotion() ? 0 : 120);
    setStatus(`Undid a move. ${board.moves.length} moves.`);
    repaint();
  }, [board, animate]);

  const reset = useCallback(() => {
    if (phaseRef.current !== 'play' || board.moves.length === 0) return;
    board.resetRound();
    animate(reducedMotion() ? 0 : 200);
    setStatus('Round reset.');
    repaint();
  }, [board, animate]);

  // ---- plan mode ---------------------------------------------------------------
  const addStep = useCallback((robot, dir) => {
    if (phaseRef.current !== 'play') return;
    setSelected(robot);
    setNotice('');
    setPlanTraces([]);
    if (planRef.current.length < MAX_PLAN) {
      planRef.current = [...planRef.current, { robot, dir }];
      setPlan(planRef.current);
    }
    setStatus(`${COLOR_LABEL[robot]} ${DIR_NAME[dir]} added to the plan.`);
  }, []);

  const input = useCallback((robot, dir) => {
    if (modeRef.current === 'plan') addStep(robot, dir);
    else move(robot, dir);
  }, [addStep, move]);

  const removeStep = useCallback(() => {
    if (phaseRef.current !== 'play') return;
    setNotice('');
    setPlanTraces([]);
    planRef.current = planRef.current.slice(0, -1);
    setPlan(planRef.current);
  }, []);
  const clearPlan = useCallback(() => {
    if (phaseRef.current !== 'play') return;
    planRef.current = [];
    setPlan(planRef.current);
    setNotice('');
    setPlanTraces([]);
    setStatus('Plan cleared.');
  }, []);

  // Plays the plan on the board step by step. The outcome is decided up front on a
  // scratch board; the animation only shows it. A solve is recorded at submission.
  const submitPlan = useCallback(() => {
    const steps = planRef.current;
    if (phaseRef.current !== 'play' || modeRef.current !== 'plan' || steps.length === 0) return;
    const scratch = scratchOf(board);
    const frames = [];
    const traces = [];
    let solvedAt = 0;
    for (let i = 0; i < steps.length; i++) {
      const { rec, trace } = playTraced(scratch, steps[i], i + 1);
      frames.push({ robots: { ...scratch.robots }, blocked: !rec, step: steps[i], rec });
      traces.push(trace);
      if (scratch.isSolved()) { solvedAt = i + 1; break; }
    }
    setNotice('');
    setPlanTraces(traces);
    const token = ++replayToken.current;
    const quick = reducedMotion();
    setPhase((phaseRef.current = 'submit'));
    sprintRef.current.pause(); // the replay is not thinking time (no-op outside Sprint)
    setOverlayCells({ ...board.roundStart });
    setReplayStep(0);
    animate(0);

    let finishSolved = null;
    if (solvedAt > 0) {
      // Recorded now, at the moment of submission. The clock, rating, status text and
      // board are only updated when the replay ends, so none of them hints at the outcome.
      const timeMs = clockNow();
      // Sprint banks the solve now (it is not a Classic round: no rating, no history).
      const sprintOn = sprintRef.current.isRunning();
      const entry = sprintOn ? null : recordRound({ optimal: round.length, moves: solvedAt, timeMs, variant: roundSetupRef.current });
      if (sprintOn && sprintRef.current.bank({ optimal: round.length, moves: solvedAt, timeMs }) === null) {
        sprintRef.current.end('time'); // time was already up: the solve does not count
        return;
      }
      const playerMoves = steps.slice(0, solvedAt).map(({ robot, dir }) => ({ robot, dir }));
      finishSolved = () => {
        clock.current = { running: false, accum: timeMs, since: null };
        setElapsed(timeMs);
        if (sprintOn) {
          for (const m of playerMoves) board.applyMove(m);
          setOverlayCells(null);
          sprintRef.current.release();
          deal();
          return;
        }
        bumpRating();
        for (const m of playerMoves) board.applyMove(m); // claim the target on the real board
        setStatus(`Solved in ${solvedAt} moves.`);
        setOverlayCells(null);
        setResults({ entry, revealed: false, moves: solvedAt, timeMs, playerMoves });
        setPhase((phaseRef.current = 'results'));
      };
    }

    const run = (i) => {
      if (replayToken.current !== token) return;
      if (i >= frames.length) {
        later(() => {
          if (replayToken.current !== token) return;
          setBump(null);
          animate(quick ? 0 : 150);
          if (finishSolved) { finishSolved(); return; }
          setOverlayCells(null);
          setStatus('Not solved. The board is back at the start; edit the plan and submit again.');
          setNotice('Not solved. Edit your plan and submit again.');
          setPhase((phaseRef.current = 'play'));
          sprintRef.current.resume();
        }, finishSolved ? 200 : (quick ? 300 : PLAN_HOLD_MS));
        return;
      }
      later(() => {
        if (replayToken.current !== token) return;
        const f = frames[i];
        animate(quick ? 0 : 240, f.rec);
        setOverlayCells(f.robots);
        setReplayStep(i + 1);
        setSelected(f.step.robot);
        setBump(f.blocked ? { robot: f.step.robot, dir: f.step.dir, n: ++bumpCount.current } : null);
        run(i + 1);
      }, quick ? 40 : PLAN_STEP_MS);
    };
    run(0);
  }, [board, round, later, clockNow, animate, deal]);

  // Any setup change (mode or variant) drops the current round unrecorded and deals a fresh
  // puzzle under the new setup, superseding a deal still in flight. Not while a solve is
  // being shown (submit, settling).
  const changeMode = useCallback((next) => {
    if (next === modeRef.current || phaseRef.current === 'submit' || phaseRef.current === 'settling' || sprintRef.current.isRunning()) return;
    if (phaseRef.current === 'play' && board.moves.length > 0) board.resetRound();
    modeRef.current = next;
    setupRef.current = setupKey(variantRef.current, next); // deal() reads it before the next render
    planRef.current = [];
    setPlan([]);
    setPlanTraces([]);
    setMode(next);
    try { localStorage.setItem(MODE_KEY, next); } catch { /* unavailable */ }
    repaint();
    if (gameModeRef.current === 'classic') deal(); // the Sprint Start screen deals nothing
  }, [board, deal]);

  // A new variant deals a new board of that shape right away; the current round is dropped,
  // never rewritten.
  const changeVariant = useCallback((patch) => {
    if (phaseRef.current === 'submit' || phaseRef.current === 'settling' || sprintRef.current.isRunning()) return;
    const next = { ...variantRef.current, ...patch };
    if (sameVariant(next, variantRef.current)) return;
    if (phaseRef.current === 'play' && board.moves.length > 0) board.resetRound();
    variantRef.current = next;
    setupRef.current = setupKey(next, modeRef.current); // deal() reads it before the next render
    setVariant(next);
    writeVariant(next);
    Object.assign(board, new RicochetBoard({ seed: makeSeed(), config: next }));
    planRef.current = [];
    setPlan([]);
    repaint();
    if (gameModeRef.current === 'classic') deal();
  }, [board, deal]);

  const changePathTraces = useCallback((on) => {
    setPathTraces(on);
    try { localStorage.setItem(TRACES_KEY, on ? 'on' : 'off'); } catch { /* unavailable */ }
  }, []);

  // ---- sprint -------------------------------------------------------------------
  // When a session ends (buzzer or End early) whatever the round was doing is dropped.
  sprintEndRef.current = () => {
    timers.current.forEach(clearTimeout);
    timers.current.clear();
    replayToken.current++;
    dealId.current++;
    cancel();
    planRef.current = [];
    setPlan([]);
    setPlanTraces([]);
    setOverlayCells(null);
    setSlide(null);
    setConfirmEnd(false);
    setPhase((phaseRef.current = 'idle'));
  };

  const changeGameMode = useCallback((next) => {
    if (next === gameModeRef.current || phaseRef.current === 'submit' || phaseRef.current === 'settling' || sprintRef.current.isRunning()) return;
    replayToken.current++;
    // The abandoned round is dropped unrecorded, as with any setup change.
    if (phaseRef.current === 'play' && board.moves.length > 0) board.resetRound();
    planRef.current = [];
    setPlan([]);
    setPlanTraces([]);
    gameModeRef.current = next;
    setGameMode(next);
    writeGameMode(next);
    if (next === 'classic') {
      sprintRef.current.reset();
      deal();
    } else {
      dealId.current++;
      cancel();
      setOverlayCells(null);
      setPhase((phaseRef.current = 'idle'));
    }
  }, [board, deal, cancel]);

  const startSprint = useCallback(() => {
    Object.assign(board, createBoard()); // every Sprint starts on a fresh board
    planRef.current = [];
    setPlan([]);
    setPlanTraces([]);
    retriedBoard.current = false;
    sprintRef.current.start(sprintKey(variantRef.current, modeRef.current));
    deal();
  }, [board, createBoard, deal]);

  const skipPuzzle = useCallback(() => {
    if (phaseRef.current !== 'play' || !sprintRef.current.isRunning()) return;
    sprintRef.current.skip();
    stopClock();
    // The skipped target is spent; nothing is revealed, and the robots stay exactly where they are.
    if (!board.claimed.includes(board.currentTargetId)) board.claimed.push(board.currentTargetId);
    planRef.current = [];
    setPlan([]);
    setPlanTraces([]);
    deal();
  }, [board, deal, stopClock]);

  // ---- solution replay (reveal and "Show solution") ------------------------
  const playSolution = useCallback((after) => {
    const token = ++replayToken.current;
    const scratch = scratchOf(board);
    setPhase((phaseRef.current = 'replay'));
    setOverlayCells({ ...board.roundStart });
    setReplayStep(0);
    animate(0);
    const steps = round.solution;
    const run = (i) => {
      if (replayToken.current !== token) return;
      if (i >= steps.length) {
        later(() => {
          if (replayToken.current !== token) return;
          setOverlayCells(null);
          animate(0);
          setPhase((phaseRef.current = 'results'));
          after && after();
        }, 900);
        return;
      }
      later(() => {
        if (replayToken.current !== token) return;
        const rec = scratch.applyMove(steps[i]);
        animate(slideFor(rec, board.size), rec);
        setOverlayCells({ ...scratch.robots });
        setReplayStep(i + 1);
        setSelected(steps[i].robot);
        run(i + 1);
      }, i === 0 ? 450 : REPLAY_STEP_MS);
    };
    run(0);
  }, [board, round, later, animate]);

  const reveal = useCallback(() => {
    setConfirmGiveUp(false);
    if (phaseRef.current !== 'play') return;
    const timeMs = stopClock();
    const entered = modeRef.current === 'plan' ? planRef.current.length : board.moves.length;
    setPlanTraces([]);
    const entry = recordRound({ optimal: round.length, moves: entered, timeMs, revealed: true, variant: roundSetupRef.current });
    bumpRating();
    setResults({ entry, revealed: true, moves: entered, timeMs });
    // Settle the round on the optimal line so the target is claimed and the next
    // round starts from the solution's end positions.
    board.resetRound();
    for (const m of round.solution) board.applyMove(m);
    repaint();
    setStatus('Solution revealed. This round scores 0.');
    playSolution();
  }, [board, round, playSolution, stopClock]);

  const showSolution = useCallback(() => {
    if (phaseRef.current !== 'results') return;
    playSolution();
  }, [playSolution]);

  const nextPuzzle = useCallback(() => {
    if (phaseRef.current !== 'results' && phaseRef.current !== 'replay') return;
    // Cancelling a replay leaves the board where the round ended; deal() drops the overlay.
    deal();
  }, [deal]);

  // ---- keyboard --------------------------------------------------------------
  const keyRef = useRef(null);
  keyRef.current = (e) => {
    if (e.repeat) return; // holding a key must not append or submit repeatedly
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const t = e.target;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
    if (panel || confirmGiveUp || confirmEnd) return;
    // A layout whose letters are not Latin (the key is a single non-ASCII character) falls
    // back to the physical key.
    const typed = e.key.toLowerCase();
    const key = typed.length === 1 && !/[a-z]/.test(typed) && CODE_KEY[e.code] ? CODE_KEY[e.code] : typed;
    if (phaseRef.current === 'results' && key === 's' && !(t && t.closest && t.closest('[role="dialog"]'))) { e.preventDefault(); showSolution(); return; }
    if (phaseRef.current !== 'play') return;
    if (KEY_TO_ROBOT[key] && board.robotNames.includes(KEY_TO_ROBOT[key])) { e.preventDefault(); selectedRef.current = KEY_TO_ROBOT[key]; setSelected(KEY_TO_ROBOT[key]); return; }
    if (KEY_TO_DIR[key]) {
      e.preventDefault();
      if (selectedRef.current) input(selectedRef.current, KEY_TO_DIR[key]);
      return;
    }
    const planning = modeRef.current === 'plan';
    if (key === 'u' || key === 'backspace') { e.preventDefault(); if (planning) removeStep(); else undo(); return; }
    if (key === 'escape') { e.preventDefault(); if (planning) clearPlan(); else reset(); return; }
    if (key === 'enter' && planning && !(t && t.closest && t.closest('button, a'))) { e.preventDefault(); submitPlan(); }
  };
  useEffect(() => {
    const handler = e => keyRef.current(e);
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  // ---- render ----------------------------------------------------------------
  const live = phase === 'play';
  // Read once when the panel opens, not on every clock tick.
  const progressHistory = useMemo(() => (panel === 'progress' ? loadHistory() : []), [panel]);
  const target = board.getTarget();
  const robotCells = overlayCells || board.robots;
  const planning = mode === 'plan';
  const legal = live && !planning ? board.getLegalMoves().filter(m => m.robot === selected) : [];
  const arrows = legal.map(m => ({ dir: m.dir, to: board.getDestination(m.robot, m.dir) }));
  const legalDirs = new Set(legal.map(m => m.dir));
  const finished = phase === 'results' || phase === 'replay';
  const locked = phase === 'submit' || phase === 'settling';
  const moveCount = finished && results ? results.moves : planning ? plan.length : board.moves.length;
  const provisional = isProvisional(rating.rounds);
  const entry = results && results.entry;
  const sprintMode = gameMode === 'sprint';
  const sprintRunning = sprintMode && sprint.status === 'running';
  const sprintSetup = sprintKey(variant, mode);

  // Path traces: only what the board itself has reached. A replay shows steps up to
  // `replayStep`, which advances together with the robots.
  const optimalTraces = useMemo(
    () => (pathTraces && round && finished ? tracesFor(board, round.solution) : []),
    [pathTraces, round, finished, board],
  );
  const youTraces = useMemo(
    () => (pathTraces && results && results.playerMoves && finished ? tracesFor(board, results.playerMoves) : []),
    [pathTraces, results, finished, board],
  );
  const showYou = traceToggle.you ?? !(results && results.revealed);
  const showOptimal = traceToggle.optimal ?? !!(results && results.revealed);
  let boardTraces = null;
  if (pathTraces) {
    if (phase === 'submit') boardTraces = planTraces.filter(t => t.n <= replayStep);
    else if (phase === 'replay') boardTraces = optimalTraces.filter(t => t.n <= replayStep);
    else if (phase === 'results') {
      boardTraces = [
        ...(showOptimal ? optimalTraces.map(t => ({ ...t, optimal: true })) : []),
        ...(showYou ? youTraces : []),
      ];
    } else if (phase === 'play' || phase === 'settling') {
      boardTraces = planning ? planTraces : board.moves.map((rec, i) => traceOf(rec, i + 1));
    } else boardTraces = [];
  }
  const toggleTrace = which => setTraceToggle(t => ({
    ...t,
    [which]: !(t[which] ?? (which === 'you' ? !(results && results.revealed) : !!(results && results.revealed))),
  }));

  return (
    <div className={`game-ricochet ${darkMode ? 'dark' : ''}`}>
      <div className="ricochet-app">
        <header className="ricochet-header">
          <div className="ricochet-header-left">
            <Link to="/" className="ricochet-back">← Games</Link>
            <h1 className="ricochet-title">Ricochet</h1>
          </div>
          <div className="ricochet-header-right">
            <button type="button" className="ricochet-btn ricochet-btn-collapse" aria-label="Progress" onClick={() => setPanel('progress')}>
              <span className="ricochet-btn-text">Progress</span>
              <svg className="ricochet-btn-glyph" viewBox="0 0 20 20" width="18" height="18" aria-hidden="true"><path d="M3 17V10M8 17V4M13 17V8M18 17V12" stroke="currentColor" strokeWidth="3" strokeLinecap="round" fill="none" /></svg>
            </button>
            <button type="button" className="ricochet-btn ricochet-btn-collapse" aria-label="Settings" onClick={() => setPanel('settings')}>
              <span className="ricochet-btn-text">Settings</span>
              <svg className="ricochet-btn-glyph" viewBox="0 0 20 20" width="18" height="18" aria-hidden="true"><path d="M3 6h14M3 14h14" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" fill="none" /><circle cx="7" cy="6" r="2.4" fill="currentColor" /><circle cx="13" cy="14" r="2.4" fill="currentColor" /></svg>
            </button>
            <button type="button" className="ricochet-btn ricochet-btn-collapse" aria-label="How to play" onClick={() => setPanel('help')}>
              <span className="ricochet-btn-text">How to play</span>
              <span className="ricochet-btn-glyph" aria-hidden="true">?</span>
            </button>
            <button
              type="button"
              className="ricochet-btn ricochet-btn-icon"
              onClick={() => setDarkMode(d => !d)}
              aria-label={darkMode ? 'Switch to light mode' : 'Switch to dark mode'}
              aria-pressed={darkMode}
            ><span aria-hidden="true">{darkMode ? '☀' : '☾'}</span></button>
          </div>
        </header>

        <ModeBar
          phoneHidden={!(sprintMode && !sprintRunning)}
          mode={gameMode}
          onChange={changeGameMode}
          disabled={sprintRunning || locked || phase === 'settling'}
        />

        {sprintMode && !sprintRunning ? (
          <main className="ricochet-sprint-main">
            {sprint.status === 'results' && sprint.result
              ? <SprintResults result={sprint.result} sprintKey={sprint.key} onDone={sprint.reset} />
              : <SprintStart sprintKey={sprintSetup} onStart={startSprint} />}
          </main>
        ) : (
        <main className="ricochet-main">
          <section className="ricochet-hud" aria-label="Round status">
            <div className="ricochet-hud-target">
              <span className="ricochet-hud-label">Target</span>
              {target && phase !== 'dealing' ? (
                <span className="ricochet-hud-target-row" data-testid="hud-target">
                  <svg viewBox="-16 -16 32 32" width="34" height="34" aria-hidden="true">
                    <TargetGlyph shape={target.shape} color={target.color} r={12} />
                  </svg>
                  <strong>{targetLabel(target)}</strong>
                </span>
              ) : <strong className="ricochet-muted">Dealing…</strong>}
              {setup && <span className="ricochet-setup-tag" data-testid="hud-setup" title={`Rating for ${setupLabel(setup)}`}>{setupShortLabel(setup)}</span>}
            </div>
            <div className="ricochet-hud-num"><span className="ricochet-hud-label">Moves</span><strong data-testid="move-count">{moveCount}</strong></div>
            {sprintRunning ? (
              <SprintHudTiles remainingMs={sprint.remainingMs} points={sprint.points} solved={sprint.solved} />
            ) : (
              <>
                <div className="ricochet-hud-num"><span className="ricochet-hud-label">Time</span><strong data-testid="clock">{fmtTime(elapsed)}</strong></div>
                <div className="ricochet-hud-num"><span className="ricochet-hud-label">Rating</span><strong data-testid="hud-rating">{rating.rating}</strong>{provisional && <ProvisionalTag />}</div>
              </>
            )}
          </section>

          <div className={`ricochet-board-wrap${phase === 'dealing' ? ' is-dealing' : ''}`}>
            <RicochetBoardView
              board={board}
              robotCells={robotCells}
              selected={phase === 'dealing' || phase === 'error' ? null : selected}
              arrows={arrows}
              onSelect={(r) => { if (live) setSelected(r); }}
              onMove={input}
              bump={bump}
              traces={boardTraces}
              slideMs={slideMs}
              slide={slide}
              interactive={live}
              showCurrent={phase !== 'dealing' && phase !== 'error'}
            />
            {sprintRunning && <SprintToast toast={sprint.toast} />}
            {phase === 'dealing' && (
              <div className="ricochet-dealing" role="status"><span className="ricochet-spinner" aria-hidden="true" />Dealing a puzzle…</div>
            )}
            {phase === 'error' && (
              <div className="ricochet-dealing" role="alert">
                <span>{errorText}</span>
                <button type="button" className="ricochet-btn ricochet-btn-primary" onClick={deal}>Try again</button>
              </div>
            )}
          </div>

          <div className="ricochet-side">
          {planning && !finished && (
            <section className="ricochet-plan" aria-label="Plan">
              <span className="ricochet-plan-label" data-testid="plan-count">Plan · {plan.length} step{plan.length === 1 ? '' : 's'}</span>
              {notice && <span className="ricochet-plan-notice" data-testid="plan-notice">{notice}</span>}
              {plan.length === 0 ? <span className="ricochet-plan-empty">Pick a robot, then add directions.</span> : (
                <ol aria-label="Planned moves">
                  {plan.map((m, i) => (
                    <li key={i} className={`ricochet-step${locked && i + 1 === replayStep ? ' is-diverged' : ''}`} title={`${COLOR_LABEL[m.robot]} ${DIR_NAME[m.dir]}`}>
                      <span className={`ricochet-step-chip ricochet-step-${m.robot}`}>{ROBOT_LETTER[m.robot]}</span>
                      <span className="ricochet-step-arrow">{ARROW[m.dir]}</span>
                    </li>
                  ))}
                </ol>
              )}
            </section>
          )}

          {!finished && (
          <section className="ricochet-controls" aria-label="Controls">
            <div className={`ricochet-robot-chips${board.robotNames.length > 4 ? ' has-five' : ''}`} role="group" aria-label="Choose a robot">
              {board.robotNames.map(r => (
                <button
                  key={r}
                  type="button"
                  className={`ricochet-chip ricochet-chip-${r}${selected === r ? ' is-active' : ''}`}
                  aria-label={`Select ${r} robot`}
                  aria-pressed={selected === r}
                  disabled={!live}
                  onMouseDown={keepFocus}
                  onClick={() => setSelected(r)}
                ><span aria-hidden="true">{ROBOT_LETTER[r]}</span></button>
              ))}
            </div>
            <div className="ricochet-dpad" role="group" aria-label="Move selected robot">
              {DIRS.map(d => (
                <button
                  key={d}
                  type="button"
                  className={`ricochet-dir ricochet-dir-${d}`}
                  aria-label={`Move ${DIR_NAME[d]}`}
                  disabled={!live || !selected || (!planning && !legalDirs.has(d))}
                  onMouseDown={keepFocus}
                  onClick={() => input(selected, d)}
                ><span aria-hidden="true">{DIR_GLYPH[d]}</span></button>
              ))}
            </div>
            <div className="ricochet-actions">
              {planning ? (
                <>
                  <button type="button" className="ricochet-btn" disabled={!live || plan.length === 0} onMouseDown={keepFocus} onClick={removeStep}>Undo</button>
                  <button type="button" className="ricochet-btn" disabled={!live || plan.length === 0} onMouseDown={keepFocus} onClick={clearPlan}>Clear</button>
                  <button type="button" className="ricochet-btn ricochet-btn-primary" disabled={!live || plan.length === 0} onMouseDown={keepFocus} onClick={submitPlan}>Submit</button>
                </>
              ) : (
                <>
                  <button type="button" className="ricochet-btn" disabled={!live || !canUndoInRound(board)} onMouseDown={keepFocus} onClick={undo}>Undo</button>
                  <button type="button" className="ricochet-btn" disabled={!live || board.moves.length === 0} onMouseDown={keepFocus} onClick={reset}>Reset</button>
                </>
              )}
              {sprintRunning
                ? <button type="button" className="ricochet-btn" disabled={!live} onMouseDown={keepFocus} onClick={skipPuzzle}>Skip</button>
                : <button type="button" className="ricochet-btn ricochet-btn-danger" disabled={!live} onClick={() => setConfirmGiveUp(true)}>Give up</button>}
              {sprintRunning && <button type="button" className="ricochet-btn ricochet-btn-danger" onMouseDown={keepFocus} onClick={() => setConfirmEnd(true)}>End early</button>}
            </div>
          </section>
          )}

          {(phase === 'results' || phase === 'replay') && results && (
            <section className="ricochet-results" aria-label="Round results">
              <h2>{results.revealed ? 'Solution revealed' : 'Solved!'}</h2>
              {phase === 'replay' && <p className="ricochet-muted">Optimal line, move {replayStep} of {round.solution.length}</p>}
              <dl className="ricochet-results-grid">
                <div><dt>Your moves</dt><dd data-testid="res-moves">{results.revealed ? '-' : results.moves}</dd></div>
                <div><dt>Optimal</dt><dd data-testid="res-optimal">{round.length}</dd></div>
                <div><dt>Time</dt><dd>{fmtTime(results.timeMs)}</dd></div>
                <div><dt>Quality</dt><dd>{entry && !results.revealed ? pct(entry.quality) : '-'}</dd></div>
                <div><dt>Pace</dt><dd>{entry && !results.revealed ? pct(entry.pace) : '-'}</dd></div>
                <div><dt>Score</dt><dd data-testid="res-score">{entry ? pct(entry.score) : '-'}</dd></div>
              </dl>
              {entry && (
                <p className="ricochet-rating-line" data-testid="res-rating">
                  {entry.variant ? `${setupLabel(entry.variant)} rating` : 'Rating'} {entry.ratingBefore} → {entry.ratingAfter}{' '}
                  <span className={entry.ratingAfter >= entry.ratingBefore ? 'ricochet-up' : 'ricochet-down'}>
                    ({entry.ratingAfter - entry.ratingBefore >= 0 ? '+' : ''}{entry.ratingAfter - entry.ratingBefore})
                  </span>
                  {isProvisional(rating.rounds) && <> <ProvisionalTag /></>}
                </p>
              )}
              <div className="ricochet-compare">
                {!results.revealed && <MoveLine
                  label="You"
                  moves={results.playerMoves}
                  other={round.solution}
                  traceShown={showYou}
                  onTraceToggle={pathTraces && phase === 'results' ? () => toggleTrace('you') : null}
                />}
                <MoveLine
                  label="Optimal"
                  moves={round.solution}
                  other={results.revealed ? null : results.playerMoves}
                  traceShown={showOptimal}
                  onTraceToggle={pathTraces && phase === 'results' ? () => toggleTrace('optimal') : null}
                />
              </div>
              <div className="ricochet-actions">
                <button type="button" className="ricochet-btn" disabled={phase === 'replay'} aria-keyshortcuts="S" onClick={showSolution}>Show solution</button>
                <button type="button" className="ricochet-btn ricochet-btn-primary" onClick={nextPuzzle} autoFocus>Next puzzle</button>
              </div>
            </section>
          )}
          </div>
          <p className="ricochet-sr" role="status" aria-live="polite">{status}</p>
        </main>
        )}
      </div>

      {panel === 'settings' && (
        <Panel title="Settings" onClose={() => setPanel(null)}>
          <div className="ricochet-setting">
            <ModeSwitch mode={gameMode} onChange={changeGameMode} disabled={sprintRunning || locked || phase === 'settling'} />
            <p>Game mode: Classic keeps your rating and history; Sprint is a timed five-minute run with a personal leaderboard. Locked while a Sprint runs.</p>
          </div>
          <div className="ricochet-setting">
            <div className="ricochet-seg" role="group" aria-label="Input mode">
              <button type="button" aria-pressed={mode === 'plan'} disabled={locked || sprintRunning} onClick={() => changeMode('plan')}>Plan</button>
              <button type="button" aria-pressed={mode === 'live'} disabled={locked || sprintRunning} onClick={() => changeMode('live')}>Live</button>
            </div>
            <p>Plan: enter a whole line, then submit it; the board only moves on submit. Live: every move slides immediately. Changing mode, like any setup change, drops the current round and deals a new puzzle.</p>
          </div>
          <div className="ricochet-setting">
            <div className="ricochet-seg" role="group" aria-label="Path traces">
              <button type="button" aria-pressed={!pathTraces} onClick={() => changePathTraces(false)}>Off</button>
              <button type="button" aria-pressed={pathTraces} onClick={() => changePathTraces(true)}>On</button>
            </div>
            <p>Path traces: draw each move of the latest sequence as a coloured line with its step number. Off by default.</p>
          </div>
          <div className="ricochet-setting">
            <div className="ricochet-seg" role="group" aria-label="Board size">
              <button type="button" aria-pressed={variant.size === 16} disabled={locked || sprintRunning} onClick={() => changeVariant({ size: 16 })}>16×16</button>
              <button type="button" aria-pressed={variant.size === 12} disabled={locked || sprintRunning} onClick={() => changeVariant({ size: 12 })}>12×12</button>
            </div>
            <p>Board size. A change deals a new board right away.</p>
          </div>
          <div className="ricochet-setting">
            <div className="ricochet-seg" role="group" aria-label="Fifth robot">
              <button type="button" aria-pressed={!variant.fifthRobot} disabled={locked || sprintRunning} onClick={() => changeVariant({ fifthRobot: false })}>None</button>
              <button type="button" aria-pressed={variant.fifthRobot} disabled={locked || sprintRunning} onClick={() => changeVariant({ fifthRobot: true })}>Black</button>
            </div>
            <p>Fifth robot: a black robot that blocks and is blocked like the others, and takes only the vortex.</p>
          </div>
          <div className="ricochet-setting">
            <div className="ricochet-seg" role="group" aria-label="Diagonal barriers">
              <button type="button" aria-pressed={!variant.diagonals} disabled={locked || sprintRunning} onClick={() => changeVariant({ diagonals: false })}>None</button>
              <button type="button" aria-pressed={variant.diagonals} disabled={locked || sprintRunning} onClick={() => changeVariant({ diagonals: true })}>Diagonals</button>
            </div>
            <p>Diagonal barriers: coloured bars that turn robots of any other colour 90 degrees. Every setup other than the standard one (16×16, four robots, no barriers, Plan) has its own rating.</p>
          </div>
        </Panel>
      )}
      {panel === 'help' && <Panel title="How to play" onClose={() => setPanel(null)}><HowToPlay variant={variant} /></Panel>}
      {panel === 'progress' && (
        <Panel title="Progress" onClose={() => setPanel(null)}>
          <ProgressTabs tab={progressTab} onTab={setProgressTab} sprintKey={sprintSetup}>
            <ProgressPanel setup={setup} history={progressHistory} />
          </ProgressTabs>
        </Panel>
      )}
      {confirmEnd && (
        <ConfirmDialog
          title="End this Sprint?"
          body="Your finished puzzles count; the puzzle in progress scores nothing."
          confirmLabel="End Sprint"
          onCancel={() => setConfirmEnd(false)}
          onConfirm={() => sprint.end('early')}
          overlayStyle={{ backgroundColor: 'rgba(0,0,0,0.5)' }}
          classes={{
            overlay: 'ricochet-overlay',
            panel: 'ricochet-modal ricochet-confirm',
            title: 'ricochet-confirm-title',
            body: 'ricochet-confirm-body',
            actions: 'ricochet-actions',
            cancel: 'ricochet-btn',
            confirm: 'ricochet-btn ricochet-btn-danger',
          }}
        />
      )}
      {confirmGiveUp && (
        <ConfirmDialog
          title="Give up this puzzle?"
          body="The optimal solution is shown, this round scores 0, and it counts against your rating."
          confirmLabel="Reveal solution"
          onCancel={() => setConfirmGiveUp(false)}
          onConfirm={reveal}
          overlayStyle={{ backgroundColor: 'rgba(0,0,0,0.5)' }}
          classes={{
            overlay: 'ricochet-overlay',
            panel: 'ricochet-modal ricochet-confirm',
            title: 'ricochet-confirm-title',
            body: 'ricochet-confirm-body',
            actions: 'ricochet-actions',
            cancel: 'ricochet-btn',
            confirm: 'ricochet-btn ricochet-btn-danger',
          }}
        />
      )}
    </div>
  );
}
