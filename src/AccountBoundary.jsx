import React, { useEffect, useState } from 'react';
import { loadSession, retainProgress } from './account.js';

// Preferences plus existing Yinsh scores and Chess finished-game statistics.
export const SETTING_KEYS = ['chessGameLog','chessTimeControl','chessPuzzleShowTheme','yinshDifficulty','yinshTwoPlayer','zertzDifficulty','zertzTwoPlayer','chessDarkMode','chessShowMoves','chessDifficulty','chessLearningGoal','chessShowEvalBar','chessSound','chessRated','yinshDarkMode','yinshShowMoves','yinshRandomSetup','yinshKeepScore','yinshWins','yinshShowMoveHistory','yinshEvaluationMode','zertzDarkMode','zertzShowMoves','catanDarkMode','catanShowMoves','catanDifficulty','catanRulesetId','catanPlayerCount','catanScenarioId'];
const snapshot = () => Object.fromEntries(SETTING_KEYS.map(k => [k, localStorage.getItem(k)]).filter(([,v]) => v !== null));
const same = (a, b) => SETTING_KEYS.every(k => (a[k] ?? null) === (b[k] ?? null));
const apply = value => SETTING_KEYS.forEach(k => {
  if (typeof value[k] === 'string') localStorage.setItem(k, value[k]);
  else localStorage.removeItem(k);
});
export default function AccountBoundary({ children }) {
  const [ready, setReady] = useState(() => !loadSession());
  const [conflict, setConflict] = useState(null);
  const [error, setError] = useState('');
  const [generation, setGeneration] = useState(0);
  const [statBackups, setStatBackups] = useState(null);
  const [accountOwner] = useState(() => localStorage.getItem('gipfAccount'));
  const assertStatsOwner = () => {
    const marker = localStorage.getItem('gipf:account-transition');
    if (localStorage.getItem('gipfAccount') !== accountOwner || (marker && JSON.parse(marker).until > Date.now())) throw new Error('account_changed');
  };
  useEffect(() => {
    const session = loadSession();
    if (!session) return undefined;
    let stopped = false;
    let busy = false;
    let revision;
    let baseline;
    let pendingConflict = false;
    const request = async (action, extra = {}) => {
      if (loadSession()?.authToken !== session.authToken) throw new Error('account_changed');
      const response = await fetch(`${process.env.PUBLIC_URL || ''}/api/chessProfile`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ u: session.usernameId, auth: session.authToken, scope: 'settings', action, ...extra }),
        signal: AbortSignal.timeout(10000),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(response.status === 409 ? 'conflict' : 'unavailable');
      if (stopped || loadSession()?.authToken !== session.authToken) throw new Error('account_changed');
      return data;
    };
    const preserveStats = remote => {
      if (stopped || loadSession()?.authToken !== session.authToken) throw new Error('account_changed');
      assertStatsOwner();
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
          if (stopped || loadSession()?.authToken !== session.authToken) return;
          try { preserveStats(remote); await retainProgress(session); } catch (_) { setError('Cannot preserve recovery on this device; cloud replacement cancelled.'); return; }
          if (stopped || loadSession()?.authToken !== session.authToken) return;
          apply(remote.profile.preferences || {}); revision = remote.revision; baseline = snapshot();
          pendingConflict = false; setConflict(null); setReady(true); setGeneration(n => n + 1);
        },
      });
    };
    request('read').then(remote => {
      const local = snapshot();
      const cloud = remote.profile.preferences || {};
      revision = remote.revision;
      if (Object.keys(local).length && Object.keys(cloud).length && !same(local, cloud)) {
        showConflict(remote);
      } else {
        if (!Object.keys(local).length) apply(cloud);
        baseline = cloud; setReady(true);
      }
    }).catch(() => { if (!stopped) { setError('Cloud preferences unavailable. Play continues locally.'); setReady(true); } });
    const interval = setInterval(async () => {
      if (stopped || busy || pendingConflict || revision === undefined) return;
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
  }, []);
  return <>
    {conflict && <div role="alert" className="bg-amber-100 text-black p-3">
      This device and cloud have different preferences or scores. Choose which to keep.
      <button className="mx-3 underline" onClick={conflict.local}>Keep this device</button>
      <button className="underline" onClick={conflict.cloud}>Use cloud</button>
    </div>}
    <button className="m-2 underline text-sm" onClick={() => {
      try { assertStatsOwner(); setStatBackups(JSON.parse(localStorage.getItem('chessStatsRecovery:v1') || '[]')); }
      catch (_) { setError('Statistics recovery unavailable.'); }
    }}>Statistics recovery</button>
    {statBackups && <div role="dialog" aria-label="Statistics recovery" className="p-3">
      <p>Previous Chess statistics from conflict choices. Restoring a copy does not add its results to current counters.</p>
      {statBackups.map((raw, i) => <button key={i} className="m-2 underline" onClick={() => {
        try {
          assertStatsOwner();
          const current = localStorage.getItem('chessGameLog');
          localStorage.setItem('chessStatsRecovery:v1', JSON.stringify([...new Set([...statBackups, current].filter(Boolean))].slice(-8)));
          localStorage.setItem('chessGameLog', raw); setGeneration(n => n + 1); setStatBackups(null);
        } catch (_) { setError('Cannot preserve statistics recovery; replacement cancelled.'); }
      }}>Restore statistics {i + 1}</button>)}
      {!statBackups.length && <p>No statistics alternatives saved.</p>}
      <button onClick={() => setStatBackups(null)}>Close</button>
    </div>}
    {error && <div role="status" className="bg-amber-100 text-black p-2">{error}</div>}
    {ready ? <React.Fragment key={generation}>{children}</React.Fragment> : !conflict && <p>Loading account preferences…</p>}
  </>;
}
