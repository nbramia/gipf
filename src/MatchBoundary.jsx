import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { createMatchStore, matchKey } from './matchStore.js';

const MatchContext = createContext(null);
const equal = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const newId = () => globalThis.crypto?.randomUUID?.() || `match-${Date.now()}-${Math.random().toString(36).slice(2)}`;

export function useSavedMatch() { return useContext(MatchContext); }

// One boundary per mounted game: cloud hydration and conflict decisions happen
// before the engine mounts. Replacing a snapshot unmounts all AI/clock callbacks.
export default function MatchBoundary({ game, decode, loadLegacy, children }) {
  const [store, setStore] = useState(() => createMatchStore(game));
  const [initial, setInitial] = useState(() => {
    try { let snapshot = store.load(); if (!snapshot && loadLegacy) { snapshot = loadLegacy(); if (snapshot) store.save(snapshot); } return { snapshot, decoded: snapshot ? decode(snapshot) : null }; }
    catch (_) { return { invalid: true }; }
  });
  const [ready, setReady] = useState(!store.owner);
  const [conflict, setConflict] = useState(null);
  const [status, setStatus] = useState('');
  const [blocked, setBlocked] = useState(false);
  const [recovery, setRecovery] = useState(null);
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
      setStatus(store.owner ? 'Saved on this device; cloud sync pending.' : 'Saved on this device.');
    } catch (e) {
      if (e.message === 'local_conflict') {
        try { showConflict({ kind: 'local', local: value, remote: store.current() }); }
        catch (_) { showConflict({ kind: 'local', local: value, remote: null, invalidRemote: true }); }
      } else if (e.message === 'account_changed') setBlocked(true);
      else setStatus('Save failed on this device. Keep this page open and free storage before retrying.');
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
    window.addEventListener('gipf-account-transition', transition);
    window.addEventListener('storage', storage);
    return () => { stopped.current = true; window.removeEventListener('storage', storage); window.removeEventListener('gipf-account-transition', transition); };
  }, [game, store, showConflict]);

  useEffect(() => {
    if (!store.owner || initial.invalid) return undefined;
    let disposed = false;
    const sync = async () => {
      if (disposed || running.current || conflicted.current) return;
      running.current = true;
      try {
        const remote = await store.request('read');
        if (disposed) return;
        const cloud = remote.profile.match || null;
        if (cloud) decode(cloud);
        const local = store.current();
        const meta = store.metadata();
        if (equal(local, cloud)) {
          store.acknowledge(remote.revision, cloud);
          setStatus('Saved to your account.');
        } else if (!local && !meta) {
          // A genuinely empty device can hydrate; an existing match never loses to a timestamp.
          store.resolve(cloud);
          store.acknowledge(remote.revision, cloud);
          remount(cloud);
        } else if (meta && equal(meta.baseline, cloud)) {
          const saved = await store.request('write', { revision: remote.revision, domains: { match: local } });
          if (disposed) return;
          store.acknowledge(saved.revision, local);
          setStatus('Saved to your account.');
        } else if (!cloud && !meta) {
          const saved = await store.request('write', { revision: remote.revision, domains: { match: local } });
          if (disposed) return;
          store.acknowledge(saved.revision, local);
          setStatus('Saved to your account.');
        } else {
          showConflict({ kind: 'cloud', local, remote: cloud, revision: remote.revision });
        }
        if (!disposed) setReady(true);
      } catch (e) {
        if (disposed) return;
        if (e.message === 'account_changed') setBlocked(true);
        else if (e.message === 'cloud_conflict') {
          // Reread on next pass; never advance a revision and silently retry.
          setStatus('Cloud changed while saving. Checking both versions…');
        } else setStatus('Cloud unavailable. Your match stays on this device and will retry automatically.');
        setReady(true);
      } finally { running.current = false; }
    };
    sync();
    const interval = setInterval(sync, 3000);
    window.addEventListener('online', sync);
    return () => { disposed = true; clearInterval(interval); window.removeEventListener('online', sync); };
  }, [store, decode, initial.invalid, remount, showConflict]);

  const choose = async useLocal => {
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
      setStatus('Choice saved. Both alternatives are available in recovery.');
    } catch (e) {
      if (e.message === 'cloud_conflict') {
        try {
          const remote = await store.request('read');
          showConflict({ ...conflict, remote: remote.profile.match || null, revision: remote.revision });
          setStatus('Cloud changed again. Review your choice before saving.');
        } catch (_) { setStatus('Cloud unavailable. Both alternatives remain on this device.'); }
      } else setStatus('Could not preserve or restore this match. No alternative was discarded.');
    } finally { running.current = false; }
  };

  const openRecovery = () => {
    try { store.assertOwner(); setRecovery(JSON.parse(localStorage.getItem(`${game}MatchRecovery:v1`) || '{"alternatives":[]}').alternatives); }
    catch (_) { setStatus('Recovery is unavailable on this device.'); }
  };
  const restore = snapshot => {
    try {
      if (snapshot) decode(snapshot);
      store.resolve(snapshot);
      remount(snapshot);
      setRecovery(null);
      setReady(true);
    } catch (_) { setStatus('That backup is unsupported or storage is full. It has been preserved.'); }
  };
  if (blocked) return <p role="status">Account changed. Reload to continue safely.</p>;
  return <>
    <div className="p-2 text-sm" aria-live="polite">
      <span>{status}</span>{' '}
      <button className="underline" onClick={openRecovery}>Match recovery</button>
    </div>
    {recovery && <div role="dialog" aria-label="Match recovery" className="p-3">
      <p>Saved alternatives stay on this device. Restoring one may require a cloud conflict choice.</p>
      {recovery.map((snapshot, i) => <button key={i} className="m-2 underline" onClick={() => restore(snapshot)}>Restore backup {i + 1}</button>)}
      {!recovery.length && <p>No alternative matches saved.</p>}
      <button onClick={() => setRecovery(null)}>Close recovery</button>
    </div>}
    {initial.invalid && <div role="alert" className="p-3">This save is damaged or uses an unsupported version. It has not been changed.
      <button className="m-2 underline" onClick={() => restore(null)}>Keep backup and start new game</button>
    </div>}
    {conflict && <div role="alert" className="p-3 bg-amber-100 text-black">
      This match differs from {conflict.kind === 'cloud' ? 'your cloud save' : 'another tab'}. Choose a version; both will be kept in recovery.
      <button className="m-2 underline" onClick={() => choose(true)}>Keep this match</button>
      <button className="m-2 underline" disabled={conflict.invalidRemote} onClick={() => choose(false)}>Use {conflict.kind === 'cloud' ? 'cloud' : 'other tab'} match</button>
    </div>}
    {ready && !conflict && !initial.invalid && <MatchContext.Provider key={generation.current} value={{ restored: initial.decoded, persist, assertOwner: store.assertOwner, isCurrent, startNew: () => { nextId.current = newId(); } }}>
      {children}
    </MatchContext.Provider>}
    {!ready && !initial.invalid && <p>Loading saved match…</p>}
  </>;
}
