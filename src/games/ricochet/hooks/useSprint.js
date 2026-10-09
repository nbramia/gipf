import { useCallback, useEffect, useReducer, useRef, useState } from 'react';
import {
  SPRINT_MS, addResult, newSession, summarize, withSkip, withSolve,
} from '../engine/sprint.js';

const TOAST_MS = 1300;

// Owns one Sprint session: the 5:00 active-time clock (it runs only between puzzle shown and
// next deal started, and not while the tab is hidden), the banked solves and skips, the toast,
// and the final result. Sessions live in memory only: nothing is written until the session ends,
// so a refresh or an unmount records nothing.
//
// `onEnd` runs when the session ends, for any reason, so the game can drop its round state.
export default function useSprint({ onEnd }) {
  const [, force] = useReducer(n => n + 1, 0);
  const [remainingMs, setRemainingMs] = useState(SPRINT_MS);
  const state = useRef({ status: 'idle', session: newSession(), held: 0, key: null, result: null, toast: null });
  const clock = useRef({ running: false, accum: 0, since: null });
  const buzzer = useRef(null);
  const toastTimer = useRef(null);
  const toastId = useRef(0);
  const onEndRef = useRef(onEnd);
  onEndRef.current = onEnd;

  const elapsed = useCallback(() => {
    const c = clock.current;
    return c.accum + (c.since != null ? Date.now() - c.since : 0);
  }, []);
  const refresh = useCallback(() => setRemainingMs(Math.max(0, SPRINT_MS - elapsed())), [elapsed]);

  // `reason`: 'time' at the buzzer, 'early' when the player ended it.
  const end = useCallback((reason = 'time') => {
    const s = state.current;
    if (s.status !== 'running') return;
    const c = clock.current;
    c.accum = elapsed(); c.running = false; c.since = null;
    clearTimeout(buzzer.current);
    const summary = summarize(s.session);
    s.result = { summary, reason, ...addResult(s.key, summary) };
    s.status = 'results';
    s.held = 0;
    s.toast = null;
    setRemainingMs(Math.max(0, SPRINT_MS - c.accum));
    force();
    if (onEndRef.current) onEndRef.current();
  }, [elapsed]);

  // The buzzer is a timeout for the exact moment the active time reaches 5:00.
  const schedule = useCallback(() => {
    clearTimeout(buzzer.current);
    const c = clock.current;
    if (state.current.status !== 'running' || !c.running || c.since == null) return;
    buzzer.current = setTimeout(() => end('time'), Math.max(0, SPRINT_MS - elapsed()));
  }, [end, elapsed]);

  const pause = useCallback(() => {
    const c = clock.current;
    if (!c.running) return;
    c.accum = elapsed(); c.running = false; c.since = null;
    clearTimeout(buzzer.current);
    refresh();
  }, [elapsed, refresh]);

  const resume = useCallback(() => {
    const c = clock.current;
    if (state.current.status !== 'running' || c.running) return;
    c.running = true;
    c.since = document.visibilityState === 'hidden' ? null : Date.now();
    schedule();
    refresh();
  }, [schedule, refresh]);

  const start = useCallback((key) => {
    clearTimeout(buzzer.current);
    clearTimeout(toastTimer.current);
    clock.current = { running: false, accum: 0, since: null };
    state.current = { status: 'running', session: newSession(), held: 0, key, result: null, toast: null };
    setRemainingMs(SPRINT_MS);
    force();
  }, []);

  // Back to the Start screen after the results.
  const reset = useCallback(() => {
    clearTimeout(buzzer.current);
    state.current = { ...state.current, status: 'idle', result: null, toast: null, held: 0, session: newSession() };
    force();
  }, []);

  const showToast = useCallback((text) => {
    state.current.toast = { id: ++toastId.current, text };
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => { state.current.toast = null; force(); }, TOAST_MS);
    force();
  }, []);

  // A solve counts at the moment it is made, if the clock has not run out. Its points stay
  // out of the visible total until `release`, so a plan's replay does not give the result away.
  const bank = useCallback((solve) => {
    const s = state.current;
    // An overdue buzzer callback must not let a solve in after time is up.
    if (s.status !== 'running' || elapsed() >= SPRINT_MS) return null;
    s.session = withSolve(s.session, solve);
    const points = s.session.solves[s.session.solves.length - 1].points;
    s.held = points;
    force();
    return points;
  }, [elapsed]);

  const release = useCallback(() => {
    const s = state.current;
    if (s.status !== 'running' || !s.held) return;
    const points = s.held;
    s.held = 0;
    showToast(`+${points}`);
  }, [showToast]);

  const skip = useCallback(() => {
    const s = state.current;
    if (s.status !== 'running') return;
    s.session = withSkip(s.session);
    showToast('Skipped');
  }, [showToast]);

  useEffect(() => {
    const onVisibility = () => {
      const c = clock.current;
      if (!c.running) return;
      if (document.visibilityState === 'hidden') {
        if (c.since != null) { c.accum += Date.now() - c.since; c.since = null; }
        clearTimeout(buzzer.current);
      } else if (c.since == null) {
        c.since = Date.now();
        schedule();
      }
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => document.removeEventListener('visibilitychange', onVisibility);
  }, [schedule]);

  const running = state.current.status === 'running';
  useEffect(() => {
    if (!running) return undefined;
    const id = setInterval(refresh, 250);
    return () => clearInterval(id);
  }, [running, refresh]);

  useEffect(() => () => { clearTimeout(buzzer.current); clearTimeout(toastTimer.current); }, []);

  const s = state.current;
  const summary = summarize(s.session);
  return {
    status: s.status,
    isRunning: () => state.current.status === 'running',
    remainingMs,
    solved: summary.solved - (s.held ? 1 : 0),
    points: summary.points - s.held,
    skipped: summary.skipped,
    solvedForRamp: () => state.current.session.solves.length,
    toast: s.toast,
    result: s.result,
    key: s.key,
    start, reset, pause, resume, end, bank, release, skip,
  };
}
