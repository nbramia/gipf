import { loadSession, decryptApiKey, encryptApiKey } from './account.js';
import { fromLegacy } from './games/chess/matchSnapshot.js';
import { validatePortableMatch } from './migrationMatchSchema.js';
import { validateDiplomacy } from './migrationDiplomacySchema.js';
import { shape, array, one, text, safeTree, canonical, bytes, validateData, destinationKey, PREFERENCE_KEYS, DATA_KEYS, fail } from './migrationSchema.js';

export const MAX_BYTES = 5 * 1024 * 1024;
const GAMES = ['chess','yinsh','zertz','catan'];
const uuid = v => typeof v === 'string' && /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(v);
const digest = v => typeof v === 'string' && /^[a-f0-9]{64}$/.test(v);
const recordId = v => typeof v === 'string' && /^[a-zA-Z0-9:_-]{1,160}$/.test(v);
const recordShape = shape({kind:text(40),id:recordId,schemaVersion:one(1),revision:digest,data:() => true});
const validOrigin = value => {
  try {
    const u = new URL(value);
    return value === u.origin && !u.username && !u.password &&
      (u.protocol === 'https:' || (u.protocol === 'http:' && ['localhost','127.0.0.1','[::1]'].includes(u.hostname)));
  } catch (_) { return false; }
};
const iso = v => typeof v === 'string' && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(v) && Number.isFinite(Date.parse(v)) && new Date(v).toISOString() === v;
const envelope = shape({format:one('ramia-migration'),version:one(1),app:one('games'),exportId:uuid,exportedAt:iso,sourceOrigin:validOrigin,records:array(recordShape,10000)});
const hash = async value => [...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(canonical(value))))].map(b => b.toString(16).padStart(2,'0')).join('');

// Bind to exact raw session and transition, including guest identity. No secrets
// leave this closure. A marker that changes and disappears still invalidates via
// storage events in the UI, in addition to these synchronous storage checks.
export function captureIdentity() {
  const owner = localStorage.getItem('gipfAccount');
  const marker = localStorage.getItem('gipf:account-transition');
  if (marker) {
    try { if (!(JSON.parse(marker).until <= Date.now())) throw new Error(); }
    catch (_) { throw new Error('account_changed'); }
  }
  const session = loadSession();
  if (owner && !session) throw new Error('account_changed');
  let invalid = false;
  return {
    session,
    invalidate() { invalid = true; },
    check() {
      if (invalid || localStorage.getItem('gipfAccount') !== owner || localStorage.getItem('gipf:account-transition') !== marker) throw new Error('account_changed');
    },
  };
}
function checkRecord(r) {
  if (!recordShape(r)) fail();
  validateData(r.kind,r.id,r.data);
  if (r.kind.endsWith('-match')) validatePortableMatch(r.data,r.kind.slice(0,-6));
  if (r.kind === 'diplomacy-save') validateDiplomacy(r.data);
}
export async function validateFile(raw, guard = captureIdentity()) {
  guard.check();
  if (typeof raw !== 'string' || bytes(raw) > MAX_BYTES) fail();
  const bundle = JSON.parse(raw);
  if (!envelope(bundle) || !safeTree(bundle)) fail();
  const seen = new Set();
  // All structural validation precedes even digest work, and every write.
  for (const r of bundle.records) {
    checkRecord(r);
    const id = `${r.kind}/${r.id}`;
    if (seen.has(id)) fail();
    seen.add(id);
  }
  for (const r of bundle.records) {
    guard.check();
    const revision = await hash(r.data);
    guard.check();
    if (revision !== r.revision) fail();
  }
  guard.check();
  return bundle;
}

export async function exportProgress(sourceOrigin, guard = captureIdentity()) {
  guard.check();
  if (!validOrigin(sourceOrigin)) fail();
  const issues = [];
  const candidates = [];
  const add = (kind, id, data, label, alternative = false) => {
    try {
      validateData(kind,id,data);
      if (kind.endsWith('-match')) validatePortableMatch(data,kind.slice(0,-6));
      if (kind === 'diplomacy-save') validateDiplomacy(data);
      candidates.push({kind,id,data,alternative});
    } catch (_) { issues.push(`${label}: unsupported or damaged; original retained.`); }
  };
  const read = (get,key,fn) => {
    guard.check();
    const raw = get(key);
    if (raw === null || raw === undefined) return;
    try { fn(JSON.parse(raw)); }
    catch (_) { issues.push(`${key}: unsupported or damaged; original retained.`); }
  };
  const progress = (get, label) => {
    for (const game of GAMES) {
      const key = `${game}Match:v1`;
      read(get,key,value => { if (value !== null) add(`${game}-match`,value.id,value,`${label} ${key}`,!!label); });
      read(get,`${game}MatchRecovery:v1`,value => {
        if (!shape({v:one(1),alternatives:array(() => true,8)})(value)) fail();
        value.alternatives.forEach(v => {
          if (v !== null) add(`${game}-match`,v?.id,v,`${label} ${game} recovery`,true);
        });
      });
    }
    read(get,'chessGameLog',value => add('chess-log','chessGameLog',value,`${label} chessGameLog`,!!label));
    read(get,'chessStatsRecovery:v1',value => {
      if (!array(text(100000),8)(value)) fail();
      for (const raw of value) {
        try { add('chess-log','chessGameLog',JSON.parse(raw),`${label} statistics recovery`,true); }
        catch (_) { issues.push(`${label} statistics recovery: damaged; original retained.`); }
      }
    });
  };
  // Decrypt only the captured account's progress container. Never export the
  // container, arbitrary decoded keys, metadata or another account's recovery.
  if (guard.session) {
    const sealed = localStorage.getItem(`gipf:recovery:${guard.session.usernameId}`);
    if (sealed) {
      try {
        guard.check();
        const decoded = await decryptApiKey(guard.session.aesKey,JSON.parse(sealed));
        guard.check();
        if (bytes(decoded) > MAX_BYTES) fail();
        const recovered = JSON.parse(decoded);
        if (!recovered || typeof recovered !== 'object' || Array.isArray(recovered)) fail();
        progress(k => Object.hasOwn(recovered,k) ? recovered[k] : null,'Encrypted recovery');
        // The documented decrypted-recovery interface intentionally exposes
        // only match/log progress. Report other recoverable content that differs
        // from the current device instead of advertising a complete export.
        for (const key of [...PREFERENCE_KEYS,...Object.values(DATA_KEYS).filter(k => k !== 'chessGameLog'),'chessGameState']) {
          if (Object.hasOwn(recovered,key) && recovered[key] !== null && recovered[key] !== localStorage.getItem(key)) {
            issues.push(`Encrypted recovery ${key}: outside the portable recovery interface; original retained.`);
          }
        }
      } catch (e) {
        guard.check();
        issues.push('Encrypted recovery: unreadable or unsupported; original retained.');
      }
    }
  }
  if (localStorage.getItem('gipf:guest:recovery')) {
    issues.push('Retained guest recovery is separate from current guest progress and is not exported; original retained.');
  }
  // Inspect only names, never values, for other account recovery. Do not reveal
  // account identifiers or counts in either the warning or portable bundle.
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (key?.startsWith('gipf:recovery:') && key !== `gipf:recovery:${guard.session?.usernameId}`) {
      issues.push('Other account recovery exists on this device and is not exported. Sign in to the intended account to include its supported recovery; originals retained.');
      break;
    }
  }
  // Read live values after decryption so pending local edits are not replaced
  // with an earlier snapshot taken before an await.
  guard.check();
  const get = k => localStorage.getItem(k);
  progress(get,'');
  for (const key of PREFERENCE_KEYS) {
    const value = get(key);
    if (value !== null) add('preference',key,value,key);
  }
  for (const [kind,key] of Object.entries(DATA_KEYS)) {
    if (kind !== 'chess-log') read(get,key,value => add(kind,key,value,key));
  }
  if (get('chessGameState') !== null) {
    if (get('chessMatch:v1') === null) read(get,'chessGameState',value => add('chess-match','legacy-chess',fromLegacy(value),'chessGameState'));
    else issues.push('chessGameState: shadowed legacy save is not exported; original retained.');
  }
  const records = [];
  const bundle = {format:'ramia-migration',version:1,app:'games',exportId:crypto.randomUUID(),exportedAt:new Date().toISOString(),sourceOrigin,records};
  let usedBytes = bytes(JSON.stringify(bundle));
  const seen = new Set();
  // Prefer the current match's ordinary ID when identical to a backup.
  candidates.sort((a,b) => Number(a.alternative) - Number(b.alternative));
  for (const {kind,id,data,alternative} of candidates) {
    guard.check();
    const revision = await hash(data);
    guard.check();
    const fingerprint = `${kind}/${id}/${revision}`;
    if (seen.has(fingerprint)) continue;
    seen.add(fingerprint);
    const record = {kind,id:alternative ? `${id}:${revision}` : id,schemaVersion:1,revision,data};
    const size = bytes(JSON.stringify(record)) + (records.length ? 1 : 0);
    if (records.length >= 10000 || usedBytes + size > MAX_BYTES) {
      issues.push(`${kind} ${record.id}: omitted because the export reaches its 5 MiB / 10,000 record limit; original retained. Keep the source browser for recovery; this partial file is not a complete migration.`);
      continue;
    }
    records.push(record);
    usedBytes += size;
  }
  await validateFile(JSON.stringify(bundle),guard);
  guard.check();
  return {bundle,issues};
}

export function previewImport(bundle, guard = captureIdentity()) {
  guard.check();
  return bundle.records.map(record => {
    checkRecord(record);
    const key = destinationKey(record), raw = localStorage.getItem(key);
    let equal = false;
    try { equal = record.kind === 'preference' ? raw === record.data : raw !== null && canonical(JSON.parse(raw)) === canonical(record.data); } catch (_) { /* Damaged destination is preserved too. */ }
    return {kind:record.kind,id:record.id,key,status:raw === null ? 'missing' : equal ? 'equal' : 'different'};
  });
}
const stageKey = guard => `gamesMigration:v1:${guard.session ? guard.session.usernameId : 'guest'}`;
async function loadStages(guard) {
  guard.check();
  const raw = localStorage.getItem(stageKey(guard));
  if (raw === null) return {raw,decoded:'[]',stages:[],valid:[],unreadable:0};
  if (bytes(raw) > MAX_BYTES * 2) fail();
  const decoded = guard.session ? await decryptApiKey(guard.session.aesKey,JSON.parse(raw)) : raw;
  guard.check();
  if (bytes(decoded) > MAX_BYTES) fail();
  const stages = JSON.parse(decoded);
  if (!array(() => true,50)(stages)) fail();
  const valid = [];
  let unreadable = 0;
  for (const value of stages) {
    try { valid.push(await validateFile(JSON.stringify(value),guard)); }
    catch (_) { guard.check(); unreadable++; }
    guard.check();
  }
  return {raw,decoded,stages,valid,unreadable};
}
export async function readStages(guard = captureIdentity()) {
  const result = await loadStages(guard);
  guard.check();
  return result.valid;
}
export async function inspectStages(guard = captureIdentity()) {
  const result = await loadStages(guard);
  guard.check();
  return {stages:result.valid,unreadable:result.unreadable};
}
// Explicit disaster-recovery download, NOT a migration file. Never decrypt
// unvalidated account content for export; preserve its original ciphertext.
export function rawStageRecovery(guard = captureIdentity()) {
  guard.check();
  const raw = localStorage.getItem(stageKey(guard));
  if (raw === null || bytes(raw) > MAX_BYTES * 2) fail();
  guard.check();
  return raw;
}
export async function stageImport(input, choice, guard = captureIdentity()) {
  guard.check();
  if (!['keep','retain'].includes(choice)) throw new Error('choice_required');
  const bundle = await validateFile(JSON.stringify(input),guard);
  guard.check();
  if (choice === 'keep') return {status:'kept'};
  if (!navigator.locks?.request) throw new Error('web_locks_required');
  return navigator.locks.request('games-migration-stage-v1',async () => {
    guard.check();
    const {raw,decoded,stages} = await loadStages(guard);
    guard.check();
    const existing = stages.find(v => v?.exportId === bundle.exportId);
    if (existing) {
      if (canonical(existing) !== canonical(bundle)) throw new Error('export_id_collision');
      return {status:'replay'};
    }
    // Append to the version-1 array without reserializing any old entry. Even
    // unreadable entries retain their exact original JSON text for recovery.
    const end = decoded.lastIndexOf(']');
    const next = decoded.slice(0,end) + (stages.length ? ',' : '') + JSON.stringify(bundle) + decoded.slice(end);
    if (stages.length >= 50 || bytes(next) > MAX_BYTES) throw new Error('stage_full');
    const value = guard.session ? JSON.stringify(await encryptApiKey(guard.session.aesKey,next)) : next;
    guard.check();
    if (localStorage.getItem(stageKey(guard)) !== raw) throw new Error('stage_changed');
    // The sole mutation: atomic replacement of one account-owned stage value.
    // No active keys, baselines, source data or replay markers are touched.
    localStorage.setItem(stageKey(guard),value);
    return {status:'retained'};
  });
}
