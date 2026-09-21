import { previewActivation, activateImport, activationRecovery, downloadActivationRecovery, defaultSelection, recordIdentity } from './migrationActivation.js';
import React, { useEffect, useRef, useState } from 'react';
import { captureIdentity, exportProgress, validateFile, previewImport, stageImport, inspectStages, rawStageRecovery, MAX_BYTES } from './migration.js';
import './gamesMigration.css';

// A split file's part index goes only in the filename; the envelope stays closed.
function download(bundle, raw = false, part = null, filename = null) {
  const url = URL.createObjectURL(new Blob([raw ? bundle : JSON.stringify(bundle)],{type:'application/json'}));
  const a = document.createElement('a');
  a.href = url; a.download = filename || (raw ? 'games-stage-raw-recovery.json' : `games-migration-${bundle.exportId}${part ? `-part-${part.index}-of-${part.total}` : ''}.json`); a.click();
  setTimeout(() => URL.revokeObjectURL(url),1000);
}
export default function GamesMigration() {
  const [identityReady,setIdentityReady] = useState(false);
  const [activation,setActivation] = useState(null), [selected,setSelected] = useState([]);
  const [prepared,setPrepared] = useState(null), [incoming,setIncoming] = useState(null);
  const [preview,setPreview] = useState([]), [stages,setStages] = useState([]);
  const [busy,setBusy] = useState(false), [error,setError] = useState(''), [status,setStatus] = useState('');
  const [confirmed,setConfirmed] = useState(false), [invalid,setInvalid] = useState(false);
  const [unreadable,setUnreadable] = useState(0), [rawConsent,setRawConsent] = useState(false), [downloaded,setDownloaded] = useState([]);
  const guard = useRef(null);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    try { guard.current = captureIdentity(); setIdentityReady(true); } catch (_) { setInvalid(true); setError('Account transition in progress. Reload after it finishes.'); }
    const changed = e => {
      if (e.type === 'gipf-account-transition' && e.detail?.migration) return;
      if (e.type === 'gipf-account-transition' || ['gipfAccount','gipf:account-transition','gipf:account-epoch'].includes(e.key) || e.key === null) {
        guard.current?.invalidate(); setInvalid(true); setPrepared(null); setIncoming(null); setActivation(null); setStages([]); setPreview([]); setUnreadable(0); setRawConsent(false);
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
        if (changed) { setInvalid(true); setPrepared(null); setIncoming(null); setActivation(null); setStages([]); setPreview([]); }
        setError(changed ? 'Account changed. Reload this page before continuing.'
          : e.message === 'no_stage' ? 'No retained stage exists for this account or guest, so there is nothing to back up. Retain an imported file first.'
          : e.message === 'stage_full' ? 'This account or guest cannot retain this file: retained files are limited to 50 files and 5 MiB in total. Nothing was stored. Keep the downloaded file instead.'
          : e.message === 'migration_conflict' ? 'Destination cloud progress changed. Preview again before activating. No cloud domains were replaced by this request.'
          : e.message === 'migration_claimed' ? 'This export is already claimed by another account or with a different selection. Destination progress was not replaced.'
          : e.message === 'progress_changed' ? 'Progress changed during this operation. New edits were preserved. Keep the source file and download activation recovery before trying again.'
          : e.message === 'activation_pending' ? 'Finish the pending activation before activating a different file.'
          : 'Unable to finish. Keep the original files. If activation started, use Resume pending activation or download activation recovery; cloud progress may already be committed.');
      }
    } finally { if (mounted.current) setBusy(false); }
  };
  const safeDownload = (bundle, onDone, part) => run(async g => { g.check(); download(bundle,false,part); onDone?.(); });
  return <main className="games-migration">
    <a href={`${process.env.PUBLIC_URL || ''}/`}>Back to Games</a>
    <h1>Move your Games progress</h1>
    <p>Export from each old browser origin, then open this page on the destination and select the file. Keep your original device and files.</p>
    <div className="migration-notice"><strong>Destination activation</strong>
      <p>Signed-in accounts can activate validated records after reviewing local and cloud conflicts. Activation retains the source file and recovery copies. Guests can retain bounded, visible recovery files, then sign in and select the original file to activate it.</p>
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
            <p><strong>Split export:</strong> records are divided into {prepared.bundles.length} files to stay within the 5 MiB file limit. Each file alone is partial. Download all {prepared.bundles.length} files and keep them together; {downloaded.length} of {prepared.bundles.length} downloads started. This page cannot confirm that your browser saved them.</p>
            <ol>{prepared.bundles.map((bundle,i) => <li key={bundle.exportId}>
              File {i + 1} of {prepared.bundles.length} · {bundle.records.length} records{downloaded.includes(i) && ' · download started'}
              <ul>{bundle.records.map(r => <li key={`${r.kind}/${r.id}`}>{r.kind} · {r.id}</li>)}</ul>
              <button onClick={() => safeDownload(bundle,() => setDownloaded(d => d.includes(i) ? d : [...d,i]),{index:i + 1,total:prepared.bundles.length})}>Download file {i + 1} of {prepared.bundles.length}</button>
            </li>)}</ol>
          </>}
      </div>}
    </fieldset>
    <fieldset disabled={busy || invalid}>
      <legend>2. Validate and preview a file</legend>
      <label>Migration file <input type="file" accept="application/json,.json" onChange={e => {
        const file = e.target.files?.[0]; setIncoming(null); setActivation(null); setPreview([]); setConfirmed(false);
        if (!file) return;
        run(async g => {
          if (file.size > MAX_BYTES) throw new Error('too_large');
          g.check(); const raw = await file.text(); g.check();
          const bundle = await validateFile(raw,g); g.check();
          setPreview(previewImport(bundle,g)); setSelected(defaultSelection(bundle)); setActivation(null); setIncoming(bundle);
        });
      }} /></label>
      <p>Maximum 5 MiB. The entire file is checked before it can be retained.</p>
      {incoming && <>
        <p>{preview.length} records checked against current destination progress. Retaining a file leaves active saves unchanged; activation requires a separate cloud preview and confirmation.</p>
        <ul>{preview.map(r => <li key={`${r.kind}/${r.id}`}>{r.kind} · {r.id}: <strong>{r.status}</strong></li>)}</ul>
        {!guard.current?.session && <p><strong>Guest privacy warning:</strong> Guest staging stores the entire imported file unencrypted on this browser. Anyone using this browser as a guest can recover it, including any private progress from a signed-in export.</p>}
        <label><input type="checkbox" checked={confirmed} onChange={e => setConfirmed(e.target.checked)} /> I have selected the intended account or guest destination. Retaining only stores a file; activating replaces the selected progress after preview.{!guard.current?.session && ' I consent to storing this file unencrypted and accessible to other guests.'}</label>
        {identityReady && guard.current?.session && <>
          <p>Select one version per destination key to activate. Unselected alternatives stay in the retained source file.</p>
          {incoming.records.map(record => <label key={recordIdentity(record)} style={{display:'block'}}><input type="checkbox" checked={selected.includes(recordIdentity(record))} onChange={e => { setActivation(null); setSelected(old => e.target.checked ? [...old,recordIdentity(record)] : old.filter(id => id !== recordIdentity(record))); }} />{record.kind} · {record.id}</label>)}
          <button disabled={!selected.length} onClick={() => run(async g => { setActivation(await previewActivation(incoming,selected,g)); })}>Preview account activation</button>
          {activation && <div role="alert">
            <p>Cloud conflicts: {activation.cloud.conflicts?.join(', ') || 'none'}. Activating replaces the selected destination values; prior cloud and device values are retained for recovery.</p>
            <button disabled={!confirmed} onClick={() => run(async g => {
              try { const result = await activateImport(activation,g); setStatus(result.status === 'replay' ? 'This selection is already activated. No progress was added again.' : 'Selected progress activated. Reload Games before playing.'); setIncoming(null); setActivation(null); }
              finally { guard.current = captureIdentity(); }
            })}>Activate selected progress</button>
          </div>}
        </>}
        <div className="migration-actions">
          <button onClick={() => run(async g => { await stageImport(incoming,'keep',g); g.check(); setIncoming(null); setStatus('Destination kept. No imported data was stored.'); })}>Keep destination</button>
          <button disabled={!confirmed} onClick={() => run(async g => {
            const result = await stageImport(incoming,'retain',g); g.check();
            setStatus(result.status === 'replay' ? 'This identical file is already retained. Active saves are unchanged.' : 'File retained separately. Active saves are unchanged.');
            setIncoming(null); setConfirmed(false);
          })}>Retain imported file separately</button>
        </div>
      </>}
    </fieldset>
    <fieldset disabled={busy || invalid}>
      <legend>3. Recover retained files</legend>
      {identityReady && guard.current?.session && <>
        <button onClick={() => run(async g => { const recovery = await downloadActivationRecovery(g); if (!recovery) { setStatus('No activation recovery for this account.'); return; } download(JSON.stringify(recovery),true,null,'games-activation-recovery.json'); })}>Download activation recovery</button>
        <button onClick={() => run(async g => {
          const recovery = await activationRecovery(g);
          if (!recovery || recovery.done) { setStatus('No pending activation for this account.'); return; }
          try { await activateImport({bundle:recovery.bundle,selected:recovery.selected,before:recovery.before,cloud:{token:recovery.token}},g); setStatus('Activation resumed. Reload Games before playing.'); }
          finally { guard.current = captureIdentity(); }
        })}>Resume pending activation</button>
      </>}
      <button onClick={() => run(async g => { const result = await inspectStages(g); g.check(); setStages(result.stages); setUnreadable(result.unreadable); setStatus(result.stages.length || result.unreadable ? 'Retained files loaded for this identity.' : 'No retained files for this identity.'); })}>Show retained files</button>
      {!!unreadable && <p role="alert">{unreadable} retained entries cannot be validated by this build. Their originals are preserved; other valid files remain available below.</p>}
      <ul>{stages.map((bundle,i) => <li key={bundle.exportId}>{bundle.exportedAt} · {bundle.records.length} records <button onClick={() => safeDownload(bundle)}>Download retained file {i + 1}</button> <button onClick={() => run(async g => { g.check(); setIncoming(bundle); setPreview(previewImport(bundle,g)); setSelected(defaultSelection(bundle)); setActivation(null); setConfirmed(false); })}>Preview retained file {i + 1}</button></li>)}</ul>
      <p>Raw recovery is for manual repair of unreadable stages, including a damaged container. It is not a validated migration file, and this page cannot import or open it. An account's raw backup stays encrypted with a key derived from that account's original credentials; no current Games tool decrypts it. Guest stages may contain private, unvalidated data. Keep this backup private.</p>
      <label><input type="checkbox" checked={rawConsent} onChange={e => setRawConsent(e.target.checked)} /> I understand raw recovery is unvalidated and may contain private data.</label>
      <button disabled={!rawConsent} onClick={() => run(async g => { const raw = rawStageRecovery(g); g.check(); download(raw,true); setRawConsent(false); })}>Download raw stage recovery</button>
    </fieldset>
    {busy && <p role="status">Checking local progress…</p>}
    {status && <p role="status">{status}</p>}
    {error && <p role="alert">{error}</p>}
  </main>;
}
