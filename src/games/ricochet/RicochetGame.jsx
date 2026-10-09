// RicochetGame.jsx - solo Ricochet: slide robots until the target colour lands on its symbol.

import React, { useCallback, useEffect, useReducer, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import RicochetBoard, { ROBOTS, DIRS } from './RicochetBoard.js';
import { desiredLength, isProvisional, PROVISIONAL_ROUNDS } from './engine/rating.js';
import { recordRound, loadRating, loadHistory, summarize } from './engine/history.js';
import RicochetBoardView, { TargetGlyph, ROBOT_LETTER, DIR_NAME, COLOR_LABEL } from './RicochetBoardView.jsx';
import useSolverWorker from './hooks/useSolverWorker.js';
import ConfirmDialog from '../../ConfirmDialog.jsx';
import './ricochet.css';

const DARK_KEY = 'ricochetDarkMode';
const KEY_TO_ROBOT = { r: 'red', g: 'green', b: 'blue', y: 'yellow' };
const KEY_TO_DIR = {
  arrowup: 'N', w: 'N', arrowright: 'E', d: 'E', arrowdown: 'S', s: 'S', arrowleft: 'W', a: 'W',
};
const DIR_GLYPH = { N: '▲', E: '▶', S: '▼', W: '◀' };
const REPLAY_STEP_MS = 800;

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
const pct = x => `${Math.round(x * 100)}%`;
const fmtTime = ms => {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};
const cellDistance = (a, b) => Math.abs(((a / 16) | 0) - ((b / 16) | 0)) + Math.abs((a % 16) - (b % 16));
const slideFor = (from, to) => (reducedMotion() ? 0 : 90 + 26 * cellDistance(from, to));

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
function MoveLine({ label, moves, other }) {
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
      <span className="ricochet-moveline-label">{label}</span>
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

function HowToPlay() {
  return (
    <div className="ricochet-prose">
      <p>Four robots sit on a 16 by 16 board. Each round shows a target symbol. Get the robot of the matching colour to stop on that symbol. The vortex accepts any robot.</p>
      <ul>
        <li>A robot moves in a straight line and keeps sliding until it hits a wall or another robot. You cannot stop partway.</li>
        <li>Any robot may be moved, and blockers matter. Parking one robot is often how another gets to stop where you need.</li>
        <li>Fewer moves and a faster solve score higher. Your rating tracks both, and the next puzzle is chosen near your level.</li>
        <li>The next round starts from wherever the robots ended.</li>
      </ul>
      <p><strong>Controls.</strong> Tap or click a robot, or press R, G, B or Y. Then press an arrow key or W A S D, tap a direction arrow, or swipe. U or Backspace undoes a move. Esc resets the round. The clock keeps running.</p>
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

function ProgressPanel({ rating, history }) {
  const s = summarize(history);
  const recent = history.slice(-10).reverse();
  return (
    <div>
      <div className="ricochet-stat-grid">
        <div><span className="ricochet-stat-n" data-testid="progress-rating">{rating.rating}</span><span className="ricochet-stat-l">{isProvisional(rating.rounds) ? `Rating, provisional (${rating.rounds}/${PROVISIONAL_ROUNDS} rounds)` : 'Rating'}</span></div>
        <div><span className="ricochet-stat-n">{s.roundsPlayed ? pct(s.avgQuality) : '-'}</span><span className="ricochet-stat-l">Avg quality</span></div>
        <div><span className="ricochet-stat-n">{s.roundsPlayed ? s.avgSecondsPerOptimalMove.toFixed(1) : '-'}</span><span className="ricochet-stat-l">Sec per optimal move</span></div>
        <div><span className="ricochet-stat-n">{s.roundsPlayed ? pct(s.optimalShare) : '-'}</span><span className="ricochet-stat-l">Optimal</span></div>
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
export default function RicochetGame({ createBoard = () => new RicochetBoard({ seed: makeSeed() }) }) {
  const boardRef = useRef(null);
  if (!boardRef.current) boardRef.current = createBoard();
  const board = boardRef.current;
  const [, bump] = useReducer(n => n + 1, 0);

  const [darkMode, setDarkMode] = useState(readDark);
  // dealing | play | settling | results | replay | error
  const [phase, setPhase] = useState('dealing');
  const [round, setRound] = useState(null); // { targetId, length, solution }
  const [selected, setSelected] = useState(null);
  const [results, setResults] = useState(null); // { entry, revealed }
  const [rating, setRating] = useState(loadRating);
  const [panel, setPanel] = useState(null); // 'help' | 'progress'
  const [confirmGiveUp, setConfirmGiveUp] = useState(false);
  const [overlayCells, setOverlayCells] = useState(null);
  const [replayStep, setReplayStep] = useState(0);
  const [slideMs, setSlideMs] = useState(0);
  const [status, setStatus] = useState('');
  const [errorText, setErrorText] = useState('');
  const [elapsed, setElapsed] = useState(0);

  const { requestRound } = useSolverWorker();
  const phaseRef = useRef(phase);
  phaseRef.current = phase;
  const clock = useRef({ running: false, accum: 0, since: null });
  const timers = useRef(new Set());
  const replayToken = useRef(0);
  const retriedBoard = useRef(false);

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
    if (phase !== 'play') return undefined;
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
    setPhase('dealing');
    setResults(null);
    setOverlayCells(null);
    setErrorText('');
    const state = { ...board.serializeState(), stateHistory: [], historyIndex: -1 };
    requestRound(state, desiredLength(loadRating().rating), (picked) => {
      if (picked && picked.needsNewBoard) {
        if (retriedBoard.current) { setErrorText('Could not find a puzzle on a fresh board.'); setPhase('error'); return; }
        retriedBoard.current = true;
        board.startNewGame(makeSeed());
        deal();
        return;
      }
      retriedBoard.current = false;
      board.startRound(picked.targetId);
      setRound(picked);
      setSelected(board.getTarget().color || 'red');
      setStatus('New puzzle. Target: ' + targetLabel(board.getTarget()) + '.');
      startClock();
      setPhase('play');
    }, (message) => {
      setErrorText(message || 'Could not deal a puzzle.');
      setPhase('error');
    });
  }, [board, requestRound, startClock]);

  useEffect(() => { deal(); }, [deal]);

  // ---- moves -----------------------------------------------------------------
  const finishSolve = useCallback((lastSlideMs) => {
    const timeMs = stopClock();
    const entry = recordRound({ optimal: round.length, moves: board.moves.length, timeMs });
    const playerMoves = board.moves.map(({ robot, dir }) => ({ robot, dir }));
    setRating(loadRating());
    setPhase('settling');
    setStatus(`Solved in ${board.moves.length} moves.`);
    later(() => {
      setResults({ entry, revealed: false, moves: board.moves.length, timeMs, playerMoves });
      setPhase('results');
    }, lastSlideMs + 200);
  }, [board, round, later, stopClock]);

  const move = useCallback((robot, dir) => {
    if (phaseRef.current !== 'play') return;
    const rec = board.applyMove({ robot, dir });
    if (!rec) return;
    const dur = slideFor(rec.from, rec.to);
    setSlideMs(dur);
    setSelected(robot);
    setStatus(`${COLOR_LABEL[robot]} moved ${DIR_NAME[dir]}. ${board.moves.length} move${board.moves.length === 1 ? '' : 's'}.`);
    bump();
    if (board.isSolved()) finishSolve(dur);
  }, [board, finishSolve]);

  const undo = useCallback(() => {
    if (phaseRef.current !== 'play' || board.moves.length === 0) return;
    board.undo();
    setSlideMs(reducedMotion() ? 0 : 120);
    setStatus(`Undid a move. ${board.moves.length} moves.`);
    bump();
  }, [board]);

  const reset = useCallback(() => {
    if (phaseRef.current !== 'play' || board.moves.length === 0) return;
    board.resetRound();
    setSlideMs(reducedMotion() ? 0 : 200);
    setStatus('Round reset.');
    bump();
  }, [board]);

  // ---- solution replay (reveal and "Show solution") ------------------------
  const playSolution = useCallback((after) => {
    const token = ++replayToken.current;
    const scratch = new RicochetBoard({ walls: board.walls, targets: board.targets, robots: board.roundStart });
    scratch.startRound(board.currentTargetId);
    setPhase('replay');
    setOverlayCells({ ...board.roundStart });
    setReplayStep(0);
    setSlideMs(0);
    const steps = round.solution;
    const run = (i) => {
      if (replayToken.current !== token) return;
      if (i >= steps.length) {
        later(() => {
          if (replayToken.current !== token) return;
          setOverlayCells(null);
          setSlideMs(0);
          setPhase('results');
          after && after();
        }, 900);
        return;
      }
      later(() => {
        if (replayToken.current !== token) return;
        const rec = scratch.applyMove(steps[i]);
        setSlideMs(slideFor(rec.from, rec.to));
        setOverlayCells({ ...scratch.robots });
        setReplayStep(i + 1);
        setSelected(steps[i].robot);
        run(i + 1);
      }, i === 0 ? 450 : REPLAY_STEP_MS);
    };
    run(0);
  }, [board, round, later]);

  const reveal = useCallback(() => {
    setConfirmGiveUp(false);
    if (phaseRef.current !== 'play') return;
    const timeMs = stopClock();
    const entry = recordRound({ optimal: round.length, moves: board.moves.length, timeMs, revealed: true });
    setRating(loadRating());
    setResults({ entry, revealed: true, moves: board.moves.length, timeMs });
    // Settle the round on the optimal line so the target is claimed and the next
    // round starts from the solution's end positions.
    board.resetRound();
    for (const m of round.solution) board.applyMove(m);
    bump();
    setStatus('Solution revealed. This round scores 0.');
    playSolution();
  }, [board, round, playSolution, stopClock]);

  const showSolution = useCallback(() => {
    if (phaseRef.current !== 'results') return;
    playSolution();
  }, [playSolution]);

  const nextPuzzle = useCallback(() => {
    if (phaseRef.current !== 'results') return;
    deal();
  }, [deal]);

  // ---- keyboard --------------------------------------------------------------
  const keyRef = useRef(null);
  keyRef.current = (e) => {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const t = e.target;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
    if (panel || confirmGiveUp) return;
    const key = e.key.toLowerCase();
    if (phaseRef.current !== 'play') return;
    if (KEY_TO_ROBOT[key]) { e.preventDefault(); setSelected(KEY_TO_ROBOT[key]); return; }
    if (KEY_TO_DIR[key]) {
      e.preventDefault();
      if (selected) move(selected, KEY_TO_DIR[key]);
      return;
    }
    if (key === 'u' || key === 'backspace') { e.preventDefault(); undo(); return; }
    if (key === 'escape') { e.preventDefault(); reset(); }
  };
  useEffect(() => {
    const handler = e => keyRef.current(e);
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  // ---- render ----------------------------------------------------------------
  const live = phase === 'play';
  const target = board.getTarget();
  const robotCells = overlayCells || board.robots;
  const legal = live ? board.getLegalMoves().filter(m => m.robot === selected) : [];
  const arrows = legal.map(m => ({ dir: m.dir, to: board.getDestination(m.robot, m.dir) }));
  const legalDirs = new Set(legal.map(m => m.dir));
  const moveCount = overlayCells ? replayStep : board.moves.length;
  const provisional = isProvisional(rating.rounds);
  const entry = results && results.entry;

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
            </div>
            <div className="ricochet-hud-num"><span className="ricochet-hud-label">Moves</span><strong data-testid="move-count">{moveCount}</strong></div>
            <div className="ricochet-hud-num"><span className="ricochet-hud-label">Time</span><strong data-testid="clock">{fmtTime(elapsed)}</strong></div>
            <div className="ricochet-hud-num"><span className="ricochet-hud-label">Rating</span><strong data-testid="hud-rating">{rating.rating}</strong>{provisional && <ProvisionalTag />}</div>
          </section>

          <div className={`ricochet-board-wrap${phase === 'dealing' ? ' is-dealing' : ''}`}>
            <RicochetBoardView
              board={board}
              robotCells={robotCells}
              selected={phase === 'dealing' || phase === 'error' ? null : selected}
              arrows={arrows}
              onSelect={(r) => { if (live) setSelected(r); }}
              onMove={move}
              slideMs={slideMs}
              interactive={live}
              showCurrent={phase !== 'dealing' && phase !== 'error'}
            />
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

          <section className="ricochet-controls" aria-label="Controls">
            <div className="ricochet-robot-chips" role="group" aria-label="Choose a robot">
              {ROBOTS.map(r => (
                <button
                  key={r}
                  type="button"
                  className={`ricochet-chip ricochet-chip-${r}${selected === r ? ' is-active' : ''}`}
                  aria-label={`Select ${r} robot`}
                  aria-pressed={selected === r}
                  disabled={!live}
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
                  disabled={!live || !selected || !legalDirs.has(d)}
                  onClick={() => move(selected, d)}
                ><span aria-hidden="true">{DIR_GLYPH[d]}</span></button>
              ))}
            </div>
            <div className="ricochet-actions">
              <button type="button" className="ricochet-btn" disabled={!live || board.moves.length === 0} onClick={undo}>Undo</button>
              <button type="button" className="ricochet-btn" disabled={!live || board.moves.length === 0} onClick={reset}>Reset</button>
              <button type="button" className="ricochet-btn ricochet-btn-danger" disabled={!live} onClick={() => setConfirmGiveUp(true)}>Give up</button>
            </div>
          </section>

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
                  Rating {entry.ratingBefore} → {entry.ratingAfter}{' '}
                  <span className={entry.ratingAfter >= entry.ratingBefore ? 'ricochet-up' : 'ricochet-down'}>
                    ({entry.ratingAfter - entry.ratingBefore >= 0 ? '+' : ''}{entry.ratingAfter - entry.ratingBefore})
                  </span>
                  {isProvisional(rating.rounds) && <> <ProvisionalTag /></>}
                </p>
              )}
              <div className="ricochet-compare">
                {!results.revealed && <MoveLine label="You" moves={results.playerMoves} other={round.solution} />}
                <MoveLine label="Optimal" moves={round.solution} other={results.revealed ? null : results.playerMoves} />
              </div>
              <div className="ricochet-actions">
                <button type="button" className="ricochet-btn" disabled={phase === 'replay'} onClick={showSolution}>Show solution</button>
                <button type="button" className="ricochet-btn ricochet-btn-primary" disabled={phase === 'replay'} onClick={nextPuzzle} autoFocus>Next puzzle</button>
              </div>
            </section>
          )}
          <p className="ricochet-sr" role="status" aria-live="polite">{status}</p>
        </main>
      </div>

      {panel === 'help' && <Panel title="How to play" onClose={() => setPanel(null)}><HowToPlay /></Panel>}
      {panel === 'progress' && <Panel title="Progress" onClose={() => setPanel(null)}><ProgressPanel rating={rating} history={loadHistory()} /></Panel>}
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
