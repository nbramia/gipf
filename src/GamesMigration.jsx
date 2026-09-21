import React, { useEffect, useRef, useState } from 'react';
import { captureIdentity, exportProgress, validateFile, previewImport, stageImport, inspectStages, rawStageRecovery, MAX_BYTES } from './migration.js';
import './gamesMigration.css';

function download(bundle, raw = false) {
  const url = URL.createObjectURL(new Blob([raw ? bundle : JSON.stringify(bundle)],{type:'application/json'}));
  const a = document.createElement('a');
  a.href = url; a.download = raw ? 'games-stage-raw-recovery.json' : `games-migration-${bundle.exportId}.json`; a.click();
  setTimeout(() => URL.revokeObjectURL(url),1000);
}
export default function GamesMigration() {
  const [prepared,setPrepared] = useState(null), [incoming,setIncoming] = useState(null);
  const [preview,setPreview] = useState([]), [stages,setStages] = useState([]);
  const [busy,setBusy] = useState(false), [error,setError] = useState(''), [status,setStatus] = useState('');
  const [confirmed,setConfirmed] = useState(false), [invalid,setInvalid] = useState(false);
  const [unreadable,setUnreadable] = useState(0), [rawConsent,setRawConsent] = useState(false), [downloaded,setDownloaded] = useState([]);
  const guard = useRef(null);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    try { guard.current = captureIdentity(); } catch (_) { setInvalid(true); setError('Account transition in progress. Reload after it finishes.'); }
    const changed = e => {
      if (e.type === 'gipf-account-transition' || ['gipfAccount','gipf:account-transition'].includes(e.key) || e.key === null) {
        guard.current?.invalidate(); setInvalid(true); setPrepared(null); setIncoming(null); setStages([]); setPreview([]); setUnreadable(0); setRawConsent(false);
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
    } catch (e) {
      let changed = e.message === 'account_changed';
      try { guard.current.check(); } catch (_) { changed = true; }
      if (mounted.current) {
        if (changed) { setInvalid(true); setPrepared(null); setIncoming(null); setStages([]); setPreview([]); }
        setError(changed ? 'Account changed. Reload this page before continuing.'
          : e.message === 'no_stage' ? 'No retained stage exists for this account or guest, so there is nothing to back up. Retain an imported file first.'
          : 'Unable to complete this operation. Check the file, available storage and account. Originals and active saves remain unchanged.');
      }
    } finally { if (mounted.current) setBusy(false); }
  };
  const safeDownload = (bundle, onDone) => run(async g => { g.check(); download(bundle); onDone?.(); });
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
      <button onClick={() => { setPrepared(null); setDownloaded([]); run(async g => { const result = await exportProgress(window.location.origin,g); g.check(); setPrepared(result); }); }}>Prepare export</button>
      {prepared && <div>
        <p>{prepared.manifest.filter(r => r.file).length} supported progress records{prepared.bundles.length > 1 && ` in ${prepared.bundles.length} files`}.</p>
        {!!prepared.issues.length && <><strong>Incomplete export — keep the original browser data.</strong><ul>{prepared.issues.map((issue,i) => <li key={i}>{issue}</li>)}</ul></>}
        {prepared.bundles.length === 1
          ? <button onClick={() => safeDownload(prepared.bundles[0])}>{prepared.issues.length ? 'Download incomplete export' : 'Download export'}</button>
          : <>
            <p><strong>Split export:</strong> records are divided into {prepared.bundles.length} files to stay within the 5 MiB file limit. Each file alone is partial. Download all {prepared.bundles.length} files and keep them together; {downloaded.length} of {prepared.bundles.length} downloaded.</p>
            <ol>{prepared.bundles.map((bundle,i) => <li key={bundle.exportId}>
              File {i + 1} of {prepared.bundles.length} · {bundle.records.length} records{downloaded.includes(i) && ' · downloaded'}
              <ul>{bundle.records.map(r => <li key={`${r.kind}/${r.id}`}>{r.kind} · {r.id}</li>)}</ul>
              <button onClick={() => safeDownload(bundle,() => setDownloaded(d => d.includes(i) ? d : [...d,i]))}>Download file {i + 1} of {prepared.bundles.length}</button>
            </li>)}</ol>
          </>}
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
        {!guard.current?.session && <p><strong>Guest privacy warning:</strong> Guest staging stores the entire imported file unencrypted on this browser. Anyone using this browser as a guest can recover it, including any private progress from a signed-in export.</p>}
        <label><input type="checkbox" checked={confirmed} onChange={e => setConfirmed(e.target.checked)} /> I understand this only stages a recovery file, and I have selected the intended account or guest destination.{!guard.current?.session && ' I consent to storing this file unencrypted and accessible to other guests.'}</label>
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
      <button onClick={() => run(async g => { const result = await inspectStages(g); g.check(); setStages(result.stages); setUnreadable(result.unreadable); setStatus(result.stages.length || result.unreadable ? 'Retained files loaded for this identity.' : 'No retained files for this identity.'); })}>Show retained files</button>
      {!!unreadable && <p role="alert">{unreadable} retained entries cannot be validated by this build. Their originals are preserved; other valid files remain available below.</p>}
      <ul>{stages.map((bundle,i) => <li key={bundle.exportId}>{bundle.exportedAt} · {bundle.records.length} records <button onClick={() => safeDownload(bundle)}>Download retained file {i + 1}</button></li>)}</ul>
      <p>Raw recovery is for manual repair of unreadable stages, including a damaged container. It is not a validated migration file, and this page cannot import or open it. An account's raw backup stays encrypted with a key derived from that account's original credentials; no current Games tool decrypts it. Guest stages may contain private, unvalidated data. Keep this backup private.</p>
      <label><input type="checkbox" checked={rawConsent} onChange={e => setRawConsent(e.target.checked)} /> I understand raw recovery is unvalidated and may contain private data.</label>
      <button disabled={!rawConsent} onClick={() => run(async g => { const raw = rawStageRecovery(g); g.check(); download(raw,true); setRawConsent(false); })}>Download raw stage recovery</button>
    </fieldset>
    {busy && <p role="status">Checking local progress…</p>}
    {status && <p role="status">{status}</p>}
    {error && <p role="alert">{error}</p>}
  </main>;
}
