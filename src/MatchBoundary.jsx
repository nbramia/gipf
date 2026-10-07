import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { createMatchStore, matchKey } from './matchStore.js';
import { describeSnapshot, gameLabel } from './matchSummary.js';
import ConfirmDialog from './ConfirmDialog.jsx';
import './matchBoundary.css';

const MatchContext = createContext(null);
const equal = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const newId = () => globalThis.crypto?.randomUUID?.() || `match-${Date.now()}-${Math.random().toString(36).slice(2)}`;

export function useSavedMatch() { return useContext(MatchContext); }

// One boundary per mounted game: cloud hydration and conflict decisions happen
// before the engine mounts. Replacing a snapshot unmounts all AI/clock callbacks.
// `beforeReplace({ dropped, next })` is optional. A game passes it to be asked
// before saved matches stop being current (use the other copy, restore a backup,
// start over). It returns null, or { title, body, confirmLabel, commit } for the
// boundary to confirm; `commit()` runs once, on confirmation, before the
// replacement. Without it nothing changes.
export default function MatchBoundary({ game, decode, loadLegacy, beforeReplace, children }) {
  const [store, setStore] = useState(() => createMatchStore(game));
  const [initial, setInitial] = useState(() => {
    try { let snapshot = store.load(); if (!store.hasCurrent() && loadLegacy) { snapshot = loadLegacy(); if (snapshot) store.save(snapshot); } return { snapshot, decoded: snapshot ? decode(snapshot) : null }; }
    catch (_) { return { invalid: true }; }
  });
  const [ready, setReady] = useState(!store.owner);
  const [conflict, setConflict] = useState(null);
  // Quiet by default: a notice exists only while the player may need to act.
  // `source` scopes clearing: a local save clears all but a cloud problem, and a
  // cloud success clears all but a local save failure.
  const [notice, setNotice] = useState(null);
  const [recoveryCheck, setRecoveryCheck] = useState(0);
  const [blocked, setBlocked] = useState(false);
  const [recovery, setRecovery] = useState(null);
  const [replacing, setReplacing] = useState(null);
  const [dark, setTheme] = useState(() => localStorage.getItem(`${game}DarkMode`) === 'true');
  const latest = useRef(initial.snapshot || null);
  const nextId = useRef(null);
  const running = useRef(false);
  const conflicted = useRef(false);
  const stopped = useRef(false);
  const generation = useRef(0);

  const remount = useCallback(snapshot => {
    const decoded = snapshot ? decode(snapshot) : null;
    latest.current = snapshot;
    generation.current += 1;
    setInitial({ snapshot, decoded });
    setStore(createMatchStore(game));
  }, [game, decode]);

  const showConflict = useCallback(value => {
    conflicted.current = true;
    setConflict(value);
    setReady(true);
  }, []);

  const positionGeneration = generation.current;
  const isCurrent = useCallback(() => {
    try { store.assertOwner(); return !stopped.current && !conflicted.current && positionGeneration === generation.current; } catch (_) { return false; }
  }, [store, positionGeneration]);

  const persist = useCallback((state, ui) => {
    if (!isCurrent()) return;
    const prior = latest.current;
    if (!nextId.current && equal(prior?.state, state) && equal(prior?.ui, ui)) return;
    const value = { v: 1, game, id: nextId.current || prior?.id || newId(), updatedAt: Date.now(), state, ui };
    try {
      store.save(value);
      nextId.current = null;
      latest.current = JSON.parse(JSON.stringify(value));
      setNotice(n => (n?.source === 'sync' ? n : null));
      setRecoveryCheck(c => c + 1);
    } catch (e) {
      if (e.message === 'local_conflict') {
        try { showConflict({ kind: 'local', local: value, remote: store.current() }); }
        catch (_) { showConflict({ kind: 'local', local: value, remote: null, invalidRemote: true }); }
      } else if (e.message === 'account_changed') setBlocked(true);
      else if (e.message === 'invalid_snapshot') setNotice({ source: 'local', text: 'This match is unsupported or too large to save. Keep this page open; free storage will not fix this format or size error.' });
      else setNotice({ source: 'local', text: 'Save failed on this device. Keep this page open and free storage before retrying.' });
    }
  }, [game, store, showConflict, isCurrent]);

  useEffect(() => {
    stopped.current = false;
    const transition = () => { try { store.assertOwner(); } catch (_) { setBlocked(true); } };
    const storage = event => {
      transition();
      if (event.key === matchKey(game)) {
        try {
          const remote = store.current();
          if (!equal(remote, latest.current)) showConflict({ kind: 'local', local: latest.current, remote });
        } catch (_) { showConflict({ kind: 'local', local: latest.current, remote: null, invalidRemote: true }); }
      }
    };
    window.addEventListener('play-account-transition', transition);
    window.addEventListener('storage', storage);
    return () => { stopped.current = true; window.removeEventListener('storage', storage); window.removeEventListener('play-account-transition', transition); };
  }, [game, store, showConflict]);

  useEffect(() => {
    if (!store.owner || initial.invalid) return undefined;
    let disposed = false;
    let nextAt = 0;
    let lastAttempt = -Infinity;
    let failures = 0;
    let rejected;
    // A successful sync clears cloud and choice notices; a local save failure stays until a local save succeeds.
    const synced = () => { setNotice(n => (n?.source === 'local' ? n : null)); setRecoveryCheck(c => c + 1); };
    const sync = async () => {
      if (disposed || running.current || conflicted.current || Date.now() < nextAt) return;
      running.current = true;
      let local, cloud;
      try {
        local = store.current();
        if (rejected !== undefined && equal(rejected, local)) return;
        rejected = undefined;
        lastAttempt = Date.now();
        nextAt = lastAttempt + 30000;
        const remote = await store.request('read');
        if (disposed) return;
        cloud = remote.profile.match || null;
        local = store.current();
        if (cloud) {
          try { decode(cloud); }
          catch (_) {
            store.backup([local, cloud]);
            showConflict({ kind: 'cloud', local, remote: cloud, revision: remote.revision, invalidRemote: true });
            setNotice({ source: 'sync', text: 'The cloud save is unsupported or damaged. Both versions are in recovery; keep this match to replace it explicitly.' });
            return;
          }
        }
        const meta = store.metadata();
        if (equal(local, cloud)) {
          store.acknowledge(remote.revision, cloud);
          synced();
        } else if (!local && !store.hasCurrent() && !meta) {
          // Only absent storage can hydrate; an explicit clear still requires a conflict choice.
          store.resolve(cloud);
          store.acknowledge(remote.revision, cloud);
          remount(cloud);
        } else if ((meta && equal(meta.baseline, cloud)) || (!cloud && !meta)) {
          store.backup([local, cloud]);
          const saved = await store.request('write', { revision: remote.revision, domains: { match: local } });
          if (disposed) return;
          store.acknowledge(saved.revision, local);
          synced();
        } else {
          showConflict({ kind: 'cloud', local, remote: cloud, revision: remote.revision });
        }
        failures = 0;
        if (!disposed) setReady(true);
      } catch (e) {
        if (disposed) return;
        if (e.message === 'account_changed') setBlocked(true);
        else if (e.message === 'cloud_conflict') {
          // Reread on next pass; never advance a revision and silently retry.
          setNotice({ source: 'sync', text: 'Cloud changed while saving. Checking both versions…' });
          nextAt = Date.now() + 10000;
        } else if (e.message === 'sync_rejected') {
          rejected = local;
          try {
            store.backup([local, cloud]);
            setNotice({ source: 'sync', text: 'Cloud rejected this match as unsupported or too large. It remains on this device and in recovery. Automatic retries pause until the match changes.' });
          } catch (_) {
            setNotice({ source: 'sync', text: 'Cloud rejected this match and recovery storage failed. Keep this page open. Automatic retries pause until the match changes.' });
          }
        } else {
          nextAt = Date.now() + Math.min(120000, 10000 * (2 ** failures++));
          setNotice({ source: 'sync', text: 'Cloud unavailable. Your match stays on this device and will retry automatically.' });
        }
        setReady(true);
      } finally { running.current = false; }
    };
    sync();
    const wake = event => {
      if (event.type === 'play-match-saved' && event.detail !== game) return;
      // Edits/reconnects may accelerate idle polling, but never defeat outage backoff.
      if (!failures) nextAt = Math.min(nextAt, Math.max(lastAttempt + 10000, Date.now() + 1000));
    };
    const interval = setInterval(sync, 1000);
    window.addEventListener('online', wake);
    window.addEventListener('play-match-saved', wake);
    return () => { disposed = true; clearInterval(interval); window.removeEventListener('online', wake); window.removeEventListener('play-match-saved', wake); };
  }, [game, store, decode, initial.invalid, remount, showConflict]);

  // Run `go` now, or after the game's confirmation when the replacement would
  // abandon something it protects.
  const gate = (dropped, next, go) => {
    const pending = beforeReplace?.({ dropped: dropped.filter(Boolean), next: next || null });
    if (!pending) { go(); return; }
    setReplacing({ ...pending, go });
  };
  const choose = useLocal => {
    if (!conflict || running.current) return;
    gate([useLocal ? conflict.remote : conflict.local], useLocal ? conflict.local : conflict.remote, () => applyChoice(useLocal));
  };
  const applyChoice = async useLocal => {
    if (!conflict || running.current) return;
    running.current = true;
    try {
      const chosen = useLocal ? conflict.local : conflict.remote;
      if (chosen) decode(chosen);
      // Stage both alternatives before a network write or local replacement.
      store.backup([conflict.local, conflict.remote]);
      if (conflict.kind === 'cloud' && useLocal) {
        const saved = await store.request('write', { revision: conflict.revision, domains: { match: chosen } });
        store.acknowledge(saved.revision, chosen);
      } else if (conflict.kind === 'cloud') store.acknowledge(conflict.revision, chosen);
      store.resolve(chosen);
      remount(chosen);
      conflicted.current = false;
      setConflict(null);
      setNotice({ source: 'choice', text: 'Choice saved. Both alternatives are available in recovery.' });
    } catch (e) {
      if (e.message === 'cloud_conflict') {
        try {
          const remote = await store.request('read');
          showConflict({ ...conflict, remote: remote.profile.match || null, revision: remote.revision });
          setNotice({ source: 'choice', text: 'Cloud changed again. Review your choice before saving.' });
        } catch (_) { setNotice({ source: 'choice', text: 'Cloud unavailable. Both alternatives remain on this device.' }); }
      } else if (e.message === 'sync_rejected') setNotice({ source: 'choice', text: 'Cloud rejected this match as unsupported or too large. Both alternatives remain in recovery; choose a supported backup or start a new match.' });
      else setNotice({ source: 'choice', text: 'Could not preserve or restore this match. No alternative was discarded.' });
    } finally { running.current = false; }
  };

  const openRecovery = () => {
    try { setRecovery(store.recovery()); }
    catch (_) { setNotice({ source: 'choice', text: 'Recovery is unavailable on this device.' }); }
  };
  const restore = snapshot => {
    if (running.current) return;
    gate(conflict ? [conflict.local, conflict.remote] : [latest.current], snapshot, () => applyRestore(snapshot));
  };
  const applyRestore = snapshot => {
    if (running.current) return;
    try {
      if (snapshot) decode(snapshot);
      store.resolve(snapshot, conflict ? [conflict.local, conflict.remote] : []);
      remount(snapshot);
      conflicted.current = false;
      setConflict(null);
      setRecovery(null);
      setReady(true);
    } catch (_) { setNotice({ source: 'choice', text: 'That backup is unsupported or storage is full. It has been preserved.' }); }
  };
  // Offer recovery when it holds a copy newer than both the current and the account
  // match. Older copies are the history of a match the player moved on from. Timestamps
  // only decide whether to mention recovery, never which match wins; unreadable
  // alternatives cannot be restored, so they are not offered.
  const newerInRecovery = useMemo(() => {
    if (!ready || conflict || initial.invalid) return false;
    try {
      const known = [store.current(), store.owner ? store.metadata()?.baseline : null].filter(Boolean);
      const since = Math.max(-Infinity, ...known.map(snapshot => snapshot.updatedAt));
      return store.recovery().some(alt => alt && alt.unreadable === undefined && alt.updatedAt > since);
    } catch (_) { return false; }
    // recoveryCheck re-reads storage after each save and sync.
  }, [store, ready, conflict, initial.invalid, recoveryCheck]);
  // Retained alternatives keep a quiet entry reachable after any notice clears.
  const hasRecovery = useMemo(() => {
    if (!ready || conflict || initial.invalid) return false;
    try { return store.recovery().length > 0; } catch (_) { return false; }
    // recoveryCheck re-reads storage after each save and sync.
  }, [store, ready, conflict, initial.invalid, recoveryCheck]);
  const message = notice?.text || (newerInRecovery ? 'A newer copy of this match is saved in recovery on this device.' : '');
  const recoveryButton = <button className="m-2 underline" onClick={openRecovery}>Match recovery</button>;
  const context = useMemo(() => ({ restored: initial.decoded, persist, assertOwner: store.assertOwner, isCurrent, setTheme,
    startNew: () => { nextId.current = newId(); },
    matchId: () => nextId.current || latest.current?.id || null }), [initial.decoded, persist, store, isCurrent]);
  if (blocked) return <p className={`match-chrome${dark ? ' dark' : ''}`} role="status">Account changed. Reload to continue safely.</p>;
  return <>
    <section className={`match-chrome${dark ? ' dark' : ''}`} aria-label="Saved match">
    {/* The live region stays mounted so a notice that appears later is announced. */}
    <div className={message ? 'p-2 text-sm' : undefined} aria-live="polite">
      {message && <><span>{message}</span>{' '}{!conflict && !initial.invalid && recoveryButton}</>}
    </div>
    {!message && hasRecovery && !recovery && <p className="match-recovery-entry">{recoveryButton}</p>}
    {recovery && <div role="dialog" aria-label="Match recovery" className="p-3 match-recovery">
      <p><strong>{gameLabel(game)} match recovery.</strong> Saved alternatives stay on this device. Restoring one may require a cloud conflict choice.</p>
      <ul className="match-choices">
        {recovery.map((snapshot, i) => <li key={i} className="match-choice">
          <span className="match-choice-label">Backup {i + 1}{snapshot && equal(snapshot, latest.current) ? ' (same as current match)' : ''}</span>
          <span className="match-choice-detail">{describeSnapshot(snapshot)}</span>
          <button className="underline" onClick={() => restore(snapshot)}>Restore backup {i + 1}</button>
        </li>)}
      </ul>
      {!recovery.length && <p>No alternative matches saved.</p>}
      <button className="m-2 underline" onClick={() => restore(null)}>Keep backup and start new game</button>
      <button onClick={() => setRecovery(null)}>Close recovery</button>
    </div>}
    {initial.invalid && <div role="alert" className="p-3">This save is damaged or uses an unsupported version. It has not been changed.
      <button className="m-2 underline" onClick={() => restore(null)}>Keep backup and start new game</button>
      {recoveryButton}
    </div>}
    {conflict && <div role="alert" className="p-3 match-conflict">
      <p><strong>{gameLabel(game)}:</strong> this match differs from {conflict.kind === 'cloud' ? 'your cloud save' : 'another tab'}. Choose a version; both will be kept in recovery.</p>
      <ul className="match-choices">
        <li className="match-choice">
          <span className="match-choice-label">This match (current on this page)</span>
          <span className="match-choice-detail">{describeSnapshot(conflict.local)}</span>
          <button className="underline" onClick={() => choose(true)}>Keep this match</button>
        </li>
        <li className="match-choice">
          <span className="match-choice-label">{conflict.kind === 'cloud' ? 'Cloud match (alternative)' : 'Other tab match (alternative)'}</span>
          <span className="match-choice-detail">{conflict.invalidRemote ? 'Unreadable copy (cannot be restored)' : describeSnapshot(conflict.remote)}</span>
          <button className="underline" disabled={conflict.invalidRemote} onClick={() => choose(false)}>Use {conflict.kind === 'cloud' ? 'cloud' : 'other tab'} match</button>
        </li>
      </ul>
      {recoveryButton}
    </div>}
    {replacing && <ConfirmDialog
      title={replacing.title}
      body={replacing.body}
      confirmLabel={replacing.confirmLabel}
      onCancel={() => setReplacing(null)}
      onConfirm={() => { const { commit, go } = replacing; setReplacing(null); commit?.(); go(); }}
      classes={{ overlay: 'match-modal', panel: 'match-modal-panel', title: 'match-modal-title', actions: 'match-modal-actions' }}
    />}
    {!ready && !initial.invalid && <p>Loading saved match…</p>}
    </section>
    {ready && !conflict && !initial.invalid && <MatchContext.Provider key={generation.current} value={context}>
      {children}
    </MatchContext.Provider>}
  </>;
}
