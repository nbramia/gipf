import { captureFence } from './accountFence.js';
import React, { useEffect, useState, useCallback } from 'react';
import { loadSession, retainProgress, REQUEST_HEADERS } from './account.js';
import './accountBoundary.css';

// Preferences plus existing Yinsh scores and Chess finished-game statistics.
export const SETTING_KEYS = ['chessGameLog','chessTimeControl','chessPuzzleShowTheme','yinshDifficulty','yinshTwoPlayer','zertzDifficulty','zertzTwoPlayer','chessDarkMode','chessShowMoves','chessDifficulty','chessLearningGoal','chessShowEvalBar','chessSound','chessRated','yinshDarkMode','yinshShowMoves','yinshRandomSetup','yinshKeepScore','yinshWins','yinshShowMoveHistory','yinshEvaluationMode','zertzDarkMode','zertzShowMoves','catanDarkMode','catanShowMoves','catanDifficulty','catanRulesetId','catanPlayerCount','catanScenarioId'];
const snapshot = () => Object.fromEntries(SETTING_KEYS.map(k => [k, localStorage.getItem(k)]).filter(([,v]) => v !== null));
const same = (a, b) => SETTING_KEYS.every(k => (a[k] ?? null) === (b[k] ?? null));
const apply = value => SETTING_KEYS.forEach(k => {
  if (typeof value[k] === 'string') localStorage.setItem(k, value[k]);
  else localStorage.removeItem(k);
});
export default function AccountBoundary({ children }) {
  const [blocked, setBlocked] = useState(false);
  const [ready, setReady] = useState(() => !loadSession());
  const [conflict, setConflict] = useState(null);
  const [error, setError] = useState('');
  const [generation, setGeneration] = useState(0);
  const [statBackups, setStatBackups] = useState(null);
  const [checkFence] = useState(() => { try { return captureFence(); } catch (_) { return () => { throw new Error('account_changed'); }; } });
  const [accountOwner] = useState(() => localStorage.getItem('playAccount'));
  const assertStatsOwner = useCallback(() => {
    checkFence();
    const marker = localStorage.getItem('play:account-transition');
    if (localStorage.getItem('playAccount') !== accountOwner || (marker && JSON.parse(marker).until > Date.now())) throw new Error('account_changed');
  }, [checkFence,accountOwner]);
  useEffect(() => {
    const changed = () => { try { checkFence(); } catch (_) { setBlocked(true); setConflict(null); } };
    window.addEventListener('storage',changed);
    window.addEventListener('play-account-transition',changed);
    return () => { window.removeEventListener('storage',changed); window.removeEventListener('play-account-transition',changed); };
  }, [checkFence]);
  useEffect(() => {
    const session = loadSession();
    if (!session) return undefined;
    let stopped = false;
    let busy = false;
    let revision;
    let baseline;
    let pendingConflict = false;
    const request = async (action, extra = {}) => {
      assertStatsOwner();
      if (loadSession()?.sid !== session.sid) throw new Error('account_changed');
      const response = await fetch('/api/chessProfile', {
        method: 'POST', headers: REQUEST_HEADERS,
        body: JSON.stringify({ u: session.usernameId, scope: 'settings', action, ...extra }),
        signal: AbortSignal.timeout(10000),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(response.status === 409 ? 'conflict' : 'unavailable');
      assertStatsOwner();
      if (stopped || loadSession()?.sid !== session.sid) throw new Error('account_changed');
      return data;
    };
    const preserveStats = remote => {
      assertStatsOwner();
      if (stopped || loadSession()?.sid !== session.sid) throw new Error('account_changed');
      const key = 'chessStatsRecovery:v1';
      const previous = JSON.parse(localStorage.getItem(key) || '[]');
      const alternatives = [...previous, localStorage.getItem('chessGameLog'), remote.profile.preferences?.chessGameLog].filter(v => typeof v === 'string');
      localStorage.setItem(key, JSON.stringify([...new Set(alternatives)].slice(-8)));
    };
    const showConflict = remote => {
      pendingConflict = true;
      setConflict({
        local: () => {
          try { preserveStats(remote); } catch (_) { setError('Cannot preserve statistics recovery; replacement cancelled.'); return; }
          revision = remote.revision; baseline = remote.profile.preferences || {}; pendingConflict = false; setConflict(null); setReady(true); },
        cloud: async () => {
          if (stopped || loadSession()?.sid !== session.sid) return;
          const before = JSON.stringify(snapshot());
          try { preserveStats(remote); await retainProgress(session); assertStatsOwner(); if (JSON.stringify(snapshot()) !== before) throw new Error('progress_changed'); } catch (_) { setError('Cannot preserve recovery on this device; cloud replacement cancelled.'); return; }
          if (stopped || loadSession()?.sid !== session.sid) return;
          apply(remote.profile.preferences || {}); revision = remote.revision; baseline = snapshot();
          pendingConflict = false; setConflict(null); setReady(true); setGeneration(n => n + 1);
        },
      });
    };
    const initial = JSON.stringify(snapshot());
    request('read').then(remote => {
      assertStatsOwner();
      if (JSON.stringify(snapshot()) !== initial) throw new Error('progress_changed');
      const local = snapshot();
      const cloud = remote.profile.preferences || {};
      revision = remote.revision;
      if (Object.keys(local).length && Object.keys(cloud).length && !same(local, cloud)) {
        showConflict(remote);
      } else {
        if (!Object.keys(local).length) apply(cloud);
        baseline = cloud; setReady(true);
      }
    }).catch(() => {
      if (stopped) return;
      try { assertStatsOwner(); } catch (_) { setBlocked(true); return; }
      setError('Cloud preferences unavailable. Play continues locally.'); setReady(true);
    });
    const interval = setInterval(async () => {
      if (stopped || busy || pendingConflict || revision === undefined) return;
      try { assertStatsOwner(); } catch (_) { setBlocked(true); return; }
      const local = snapshot();
      if (same(local, baseline)) return;
      busy = true;
      try {
        const saved = await request('write', { revision, domains: { preferences: local } });
        revision = saved.revision; baseline = local; setError('');
      } catch (e) {
        if (!stopped && e.message === 'conflict') {
          try { showConflict(await request('read')); } catch (_) { setError('Cloud sync unavailable. Changes remain on this device.'); }
        } else if (!stopped) setError('Cloud sync unavailable. Changes remain on this device.');
      } finally { busy = false; }
    }, 5000);
    return () => { stopped = true; clearInterval(interval); };
  }, [assertStatsOwner]);
  if (blocked) return <p role="alert">Account progress changed in another operation. Reload before playing.</p>;
  return <>
    {conflict && <div role="alert" className="bg-amber-100 text-black p-3">
      This device and cloud have different preferences or scores. Choose which to keep.
      <button className="mx-3 underline" onClick={conflict.local}>Keep this device</button>
      <button className="underline" onClick={conflict.cloud}>Use cloud</button>
    </div>}
    {error && <div role="status" className="bg-amber-100 text-black p-2">{error}</div>}
    {ready ? <React.Fragment key={generation}>{children}</React.Fragment> : !conflict && <p>Loading account preferences…</p>}
    <footer className="account-footer">
      <button type="button" onClick={() => {
        try { assertStatsOwner(); setStatBackups(JSON.parse(localStorage.getItem('chessStatsRecovery:v1') || '[]')); }
        catch (_) { setError('Chess statistics recovery unavailable.'); }
      }}>Chess statistics recovery</button>
    </footer>
    {statBackups && <div role="dialog" aria-label="Chess statistics recovery" className="account-recovery">
      <p>Previous Chess statistics from conflict choices. Restoring a copy does not add its results to current counters.</p>
      {statBackups.map((raw, i) => <button key={i} type="button" onClick={() => {
        try {
          assertStatsOwner();
          const current = localStorage.getItem('chessGameLog');
          localStorage.setItem('chessStatsRecovery:v1', JSON.stringify([...new Set([...statBackups, current].filter(Boolean))].slice(-8)));
          localStorage.setItem('chessGameLog', raw); setGeneration(n => n + 1); setStatBackups(null);
        } catch (_) { setError('Cannot preserve statistics recovery; replacement cancelled.'); }
      }}>Restore statistics {i + 1}</button>)}
      {!statBackups.length && <p>No statistics alternatives saved.</p>}
      <button type="button" onClick={() => setStatBackups(null)}>Close</button>
    </div>}
  </>;
}
