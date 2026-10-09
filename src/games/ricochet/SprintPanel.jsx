// SprintPanel.jsx — Sprint mode screens: the mode switch, the Start and Results screens, the HUD
// tiles, the "+87" toast and the leaderboard views. Presentation only; the session lives in
// hooks/useSprint.js and the rules in engine/sprint.js.

import React, { useMemo } from 'react';
import { setupLabel } from './engine/variants.js';
import {
  BOARD_CAP, SPRINT_MS, WARNING_MS, bestFor, classicKey, loadBoard,
} from './engine/sprint.js';

const pct = x => `${Math.round(x * 100)}%`;
export const fmtCountdown = ms => {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};
const labelOf = key => setupLabel(classicKey(key));
const dateOf = at => {
  try { return new Date(at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }); } catch { return ''; }
};

// The Classic | Sprint switch. `phoneHidden`: on a phone the row is hidden while a round is on
// screen (the same switch is in Settings, and the phone gets its End button beside Skip) so the
// board and controls still fit.
export function ModeSwitch({ mode, onChange, disabled }) {
  return (
    <div className="ricochet-seg" role="group" aria-label="Game mode">
      <button type="button" aria-pressed={mode === 'classic'} disabled={disabled} onClick={() => onChange('classic')}>Classic</button>
      <button type="button" aria-pressed={mode === 'sprint'} disabled={disabled} onClick={() => onChange('sprint')}>Sprint</button>
    </div>
  );
}

export function ModeBar({ phoneHidden, ...props }) {
  return (
    <div className={`ricochet-modebar${phoneHidden ? ' is-phone-hidden' : ''}`}>
      <ModeSwitch {...props} />
    </div>
  );
}

// The countdown and the running points, in place of the Classic time and rating tiles.
export function SprintHudTiles({ remainingMs, points, solved }) {
  const warn = remainingMs <= WARNING_MS;
  return (
    <>
      <div className="ricochet-hud-num">
        <span className="ricochet-hud-label">Time left</span>
        <strong data-testid="sprint-clock" className={warn ? 'ricochet-sprint-warn' : ''}>{fmtCountdown(remainingMs)}</strong>
      </div>
      <div className="ricochet-hud-num">
        <span className="ricochet-hud-label">Points</span>
        <strong data-testid="sprint-points">{points}</strong>
        <span className="ricochet-sprint-solved" data-testid="sprint-solved">{solved} solved</span>
      </div>
    </>
  );
}

export function SprintToast({ toast }) {
  if (!toast) return null;
  return <div key={toast.id} className="ricochet-sprint-toast" data-testid="sprint-toast" role="status">{toast.text}</div>;
}

function Leaderboard({ records, highlight, label }) {
  if (!records || records.length === 0) return <p className="ricochet-muted">No sprints yet.</p>;
  return (
    <table className="ricochet-board-table" aria-label={label}>
      <thead>
        <tr><th>#</th><th>Points</th><th>Solved</th><th>Skipped</th><th>Quality</th><th>Date</th></tr>
      </thead>
      <tbody>
        {records.map((r, i) => (
          <tr key={`${r.at}-${i}`} className={highlight && r === highlight ? 'is-current' : ''} aria-current={highlight && r === highlight ? 'true' : undefined}>
            <td>{i + 1}</td><td>{r.points}</td><td>{r.solved}</td><td>{r.skipped}</td><td>{pct(r.avgQuality)}</td><td>{dateOf(r.at)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export function SprintStart({ sprintKey, onStart }) {
  const best = useMemo(() => bestFor(loadBoard(), sprintKey), [sprintKey]);
  return (
    <section className="ricochet-sprint-card" aria-label="Sprint">
      <h2>Sprint</h2>
      <p>Solve as many puzzles as you can in {SPRINT_MS / 60000} minutes. Puzzles get longer as you go. Skip any puzzle for 0 points.</p>
      <p className="ricochet-setup-line">Setup: <strong data-testid="sprint-setup">{labelOf(sprintKey)}</strong> <span className="ricochet-muted">(change it in Settings)</span></p>
      <p className="ricochet-sprint-best" data-testid="sprint-best">
        {best ? <>Best score: <strong>{best.points}</strong> points, {best.solved} solved</> : 'No best score yet for this setup.'}
      </p>
      <div className="ricochet-actions">
        <button type="button" className="ricochet-btn ricochet-btn-primary" onClick={onStart} autoFocus>Start Sprint</button>
      </div>
    </section>
  );
}

export function SprintResults({ result, sprintKey, onDone }) {
  const { summary, board, newBest, record } = result;
  const records = board[sprintKey] || [];
  const highlight = record && records.find(r => r.at === record.at && r.points === record.points && r.solved === record.solved && r.skipped === record.skipped);
  return (
    <section className="ricochet-sprint-card" aria-label="Sprint results">
      <h2>Time&apos;s up</h2>
      {newBest && <p className="ricochet-sprint-pb" data-testid="sprint-pb">New personal best!</p>}
      <dl className="ricochet-results-grid">
        <div><dt>Points</dt><dd data-testid="sprint-res-points">{summary.points}</dd></div>
        <div><dt>Solved</dt><dd data-testid="sprint-res-solved">{summary.solved}</dd></div>
        <div><dt>Skipped</dt><dd data-testid="sprint-res-skipped">{summary.skipped}</dd></div>
        <div><dt>Avg quality</dt><dd data-testid="sprint-res-quality">{summary.solved ? pct(summary.avgQuality) : '-'}</dd></div>
        <div><dt>Best puzzle</dt><dd data-testid="sprint-res-best">{summary.best ? `${summary.best.points} pts` : '-'}</dd></div>
        <div><dt>Optimal</dt><dd data-testid="sprint-res-optimal">{summary.optimalCount}</dd></div>
      </dl>
      <h3>Top {BOARD_CAP}, {labelOf(sprintKey)}</h3>
      <Leaderboard records={records} highlight={highlight} label="Sprint top 10" />
      {summary.solved === 0 && <p className="ricochet-muted">A sprint with no solved puzzle is not recorded.</p>}
      <div className="ricochet-actions">
        <button type="button" className="ricochet-btn ricochet-btn-primary" onClick={onDone} autoFocus>Done</button>
      </div>
    </section>
  );
}

// The Progress panel's Sprint tab: every setup's personal leaderboard, the current setup first.
export function SprintBoards({ sprintKey }) {
  const board = useMemo(() => loadBoard(), []);
  const keys = Object.keys(board).sort((a, b) => (a === sprintKey ? -1 : b === sprintKey ? 1 : a < b ? -1 : 1));
  return (
    <div data-testid="sprint-boards">
      {keys.length === 0 && <p className="ricochet-muted">No sprints yet. Finish a Sprint to start your leaderboard.</p>}
      {keys.map(k => (
        <div key={k}>
          <h3>{labelOf(k)}</h3>
          <Leaderboard records={board[k]} label={`Sprint top 10, ${labelOf(k)}`} />
        </div>
      ))}
    </div>
  );
}

export function ProgressTabs({ tab, onTab, sprintKey, children }) {
  return (
    <div>
      <div className="ricochet-seg ricochet-progress-tabs" role="group" aria-label="Progress view">
        <button type="button" aria-pressed={tab === 'rounds'} onClick={() => onTab('rounds')}>Rounds</button>
        <button type="button" aria-pressed={tab === 'sprint'} onClick={() => onTab('sprint')}>Sprint</button>
      </div>
      {tab === 'sprint' ? <SprintBoards sprintKey={sprintKey} /> : children}
    </div>
  );
}
