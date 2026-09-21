import React, { useEffect, useRef, useState } from 'react';
import { captureIdentity, exportProgress, validateFile, previewImport, stageImport, readStages, MAX_BYTES } from './migration.js';
import './gamesMigration.css';

function download(bundle) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(bundle)],{type:'application/json'}));
  const a = document.createElement('a');
  a.href = url; a.download = `games-migration-${bundle.exportId}.json`; a.click();
  setTimeout(() => URL.revokeObjectURL(url),1000);
}
export default function GamesMigration() {
  const [prepared,setPrepared] = useState(null), [incoming,setIncoming] = useState(null);
  const [preview,setPreview] = useState([]), [stages,setStages] = useState([]);
  const [busy,setBusy] = useState(false), [error,setError] = useState(''), [status,setStatus] = useState('');
  const [confirmed,setConfirmed] = useState(false), [invalid,setInvalid] = useState(false);
  const guard = useRef(null);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    try { guard.current = captureIdentity(); } catch (_) { setInvalid(true); setError('Account transition in progress. Reload after it finishes.'); }
    const changed = e => {
      if (e.type === 'gipf-account-transition' || ['gipfAccount','gipf:account-transition'].includes(e.key) || e.key === null) {
        guard.current?.invalidate(); setInvalid(true); setPrepared(null); setIncoming(null); setStages([]); setPreview([]);
        setError('Account changed. Reload this page before continuing.');
      }
    };
    window.addEventListener('storage',changed);
    window.addEventListener('gipf-account-transition',changed);
    return () => { mounted.current = false; guard.current?.invalidate(); window.removeEventListener('storage',changed); window.removeEventListener('gipf-account-transition',changed); };
  },[]);
  const run = async fn => {
    if (!guard.current || invalid || busy) return;
    setBusy(true); setError(''); setStatus('');
    try {
      guard.current.check(); await fn(guard.current); guard.current.check();
    } catch (_) {
      if (mounted.current) setError('Unable to complete this operation. Check the file, available storage and account. Originals and active saves remain unchanged.');
    } finally { if (mounted.current) setBusy(false); }
  };
  const safeDownload = bundle => run(async g => { g.check(); download(bundle); });
  return <main className="games-migration">
    <a href={`${process.env.PUBLIC_URL || ''}/`}>Back to Games</a>
    <h1>Move your Games progress</h1>
    <p>Export from each old browser origin, then open this page on the destination and select the file. Keep your original device and files.</p>
    <div className="migration-notice"><strong>Preparatory recovery tools</strong>
      <p>Active save replacement is unavailable until the account writer boundary is fixed and reviewed. Import retains a separate recovery file; it does not resume games or replace destination progress.</p>
    </div>
    <p>Close other Games tabs before exporting. This page checks your current identity, but cannot freeze older tabs. Sign in through Games first to include that account’s decrypted progress recovery. Guest recovery stays separate.</p>
    <p>No passwords, account sessions, API keys, Lichess tokens or encrypted credential containers are transferred. Re-enter your original account and encryption secrets for cloud recovery.</p>
    <fieldset disabled={busy || invalid}>
      <legend>1. Export this browser</legend>
      <button onClick={() => { setPrepared(null); run(async g => { const result = await exportProgress(window.location.origin,g); g.check(); setPrepared(result); }); }}>Prepare export</button>
      {prepared && <div>
        <p>{prepared.bundle.records.length} supported progress records.</p>
        {!!prepared.issues.length && <><strong>Incomplete export — keep the original browser data.</strong><ul>{prepared.issues.map((issue,i) => <li key={i}>{issue}</li>)}</ul></>}
        <button onClick={() => safeDownload(prepared.bundle)}>{prepared.issues.length ? 'Download incomplete export' : 'Download export'}</button>
      </div>}
    </fieldset>
    <fieldset disabled={busy || invalid}>
      <legend>2. Validate and preview a file</legend>
      <label>Migration file <input type="file" accept="application/json,.json" onChange={e => {
        const file = e.target.files?.[0]; setIncoming(null); setPreview([]); setConfirmed(false);
        if (!file) return;
        run(async g => {
          if (file.size > MAX_BYTES) throw new Error('too_large');
          g.check(); const raw = await file.text(); g.check();
          const bundle = await validateFile(raw,g); g.check();
          setPreview(previewImport(bundle,g)); setIncoming(bundle);
        });
      }} /></label>
      <p>Maximum 5 MiB. The entire file is checked before it can be retained.</p>
      {incoming && <>
        <p>{preview.length} records checked against current destination progress. Neither choice below changes active saves.</p>
        <ul>{preview.map(r => <li key={`${r.kind}/${r.id}`}>{r.kind} · {r.id}: <strong>{r.status}</strong></li>)}</ul>
        <label><input type="checkbox" checked={confirmed} onChange={e => setConfirmed(e.target.checked)} /> I understand this only stages a recovery file, and I have selected the intended account or guest destination.</label>
        <div className="migration-actions">
          <button onClick={() => run(async g => { await stageImport(incoming,'keep',g); g.check(); setIncoming(null); setStatus('Destination kept. No imported data was stored.'); })}>Keep destination</button>
          <button disabled={!confirmed} onClick={() => run(async g => {
            const result = await stageImport(incoming,'retain',g); g.check();
            setStatus(result.status === 'replay' ? 'This identical file is already retained. Active saves are unchanged.' : 'File retained separately. Active saves are unchanged; activation is unavailable.');
            setIncoming(null); setConfirmed(false);
          })}>Retain imported file separately</button>
        </div>
      </>}
    </fieldset>
    <fieldset disabled={busy || invalid}>
      <legend>3. Recover retained files</legend>
      <button onClick={() => run(async g => { const files = await readStages(g); g.check(); setStages(files); setStatus(files.length ? 'Retained files loaded for this identity.' : 'No retained files for this identity.'); })}>Show retained files</button>
      <ul>{stages.map((bundle,i) => <li key={bundle.exportId}>{bundle.exportedAt} · {bundle.records.length} records <button onClick={() => safeDownload(bundle)}>Download retained file {i + 1}</button></li>)}</ul>
    </fieldset>
    {busy && <p role="status">Checking local progress…</p>}
    {status && <p role="status">{status}</p>}
    {error && <p role="alert">{error}</p>}
  </main>;
}
