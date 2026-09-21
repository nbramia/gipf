import { captureIdentity, validateFile, stageImport } from './migration.js';
import { canonical, destinationKey, bytes } from './migrationSchema.js';
import { PROGRESS_KEYS, encryptApiKey, decryptApiKey } from './account.js';
import { withAccountTransition } from './accountFence.js';

export const recordIdentity = record => `${record.kind}/${record.id}`;
export function defaultSelection(bundle) {
  const seen = new Set();
  return bundle.records.filter(r => {
    const key = destinationKey(r);
    if (seen.has(key)) return false;
    seen.add(key); return true;
  }).map(recordIdentity);
}
const snapshot = () => Object.fromEntries(PROGRESS_KEYS.map(k => [k,localStorage.getItem(k)]));
const equal = (a,b) => canonical(a) === canonical(b);
const journalKey = session => `gamesMigrationActivation:v1:${session.usernameId}`;
async function request(session, body, check) {
  check();
  const response = await fetch(`${process.env.PUBLIC_URL || ''}/api/chessProfile`, {
    method:'POST', headers:{'Content-Type':'application/json'},
    body:JSON.stringify({u:session.usernameId,auth:session.authToken,...body}), signal:AbortSignal.timeout(20000),
  });
  check();
  const data = await response.json(); check();
  if (!response.ok) throw new Error(data.error || 'activation_unavailable');
  return data;
}
export async function previewActivation(bundle, selected, guard = captureIdentity()) {
  guard.check();
  if (!guard.session) throw new Error('account_required');
  await validateFile(JSON.stringify(bundle),guard); guard.check();
  const before = snapshot();
  const cloud = await request(guard.session,{action:'migration-preview',bundle,selected},() => guard.check());
  if (!equal(snapshot(),before)) throw new Error('progress_changed');
  return {bundle,selected,before,cloud};
}
export async function activationRecovery(guard = captureIdentity()) {
  guard.check();
  if (!guard.session) return null;
  const raw = localStorage.getItem(journalKey(guard.session));
  if (!raw) return null;
  if (bytes(raw) > 30 * 1024 * 1024) throw new Error('recovery_too_large');
  const decoded = await decryptApiKey(guard.session.aesKey,JSON.parse(raw)); guard.check();
  const journal = JSON.parse(decoded);
  if (journal.v !== 1 || journal.owner !== guard.session.usernameId) throw new Error('invalid_recovery');
  return journal;
}
export async function activateImport(plan, guard = captureIdentity()) {
  guard.check();
  if (!guard.session) throw new Error('account_required');
  // A validated source copy is durable before acquiring the writer boundary.
  await stageImport(plan.bundle,'retain',guard); guard.check();
  const session = guard.session;
  return withAccountTransition(async check => {
    const fingerprint = canonical({bundle:plan.bundle,selected:[...plan.selected].sort()});
    const key = journalKey(session), previous = localStorage.getItem(key);
    let journal = previous ? JSON.parse(await decryptApiKey(session.aesKey,JSON.parse(previous))) : null;
    check();
    if (localStorage.getItem(key) !== previous) throw new Error('progress_changed');
    if (journal && journal.owner !== session.usernameId) throw new Error('invalid_recovery');
    if (journal?.fingerprint === fingerprint && journal.done) return {status:'replay'};
    if (journal && !journal.done && journal.fingerprint !== fingerprint) throw new Error('activation_pending');
    if (journal?.fingerprint !== fingerprint || (plan.cloud.status === 'preview' && (plan.cloud.token !== journal.token || !equal(plan.before,journal.before)))) {
      if (plan.cloud.status === 'replay') return {status:'replay'};
      if (!equal(snapshot(),plan.before)) throw new Error('progress_changed');
      const after = {};
      for (const record of plan.bundle.records.filter(r => plan.selected.includes(recordIdentity(r)))) {
        const destination = destinationKey(record);
        if (Object.hasOwn(after,destination)) throw new Error('ambiguous_selection');
        after[destination] = record.kind === 'preference' ? record.data : JSON.stringify(record.data);
        if (record.kind.endsWith('-match')) after[`${record.kind.slice(0,-6)}MatchSync:v1`] = null;
      }
      journal = {v:1,owner:session.usernameId,fingerprint,bundle:plan.bundle,selected:plan.selected,token:plan.cloud.token,before:plan.before,after,done:false};
    }
    const current = snapshot();
    // A partial commit may contain either the old or imported bytes. Any third
    // value is a new edit and must be preserved for explicit reconciliation.
    for (const [k,v] of Object.entries(current)) {
      if (v !== journal.before[k] && (!Object.hasOwn(journal.after,k) || v !== journal.after[k])) throw new Error('progress_changed');
    }
    const serialized = JSON.stringify(journal);
    if (bytes(serialized) > 20 * 1024 * 1024) throw new Error('recovery_too_large');
    const pending = JSON.stringify(await encryptApiKey(session.aesKey,serialized)); check();
    const completed = JSON.stringify(await encryptApiKey(session.aesKey,JSON.stringify({...journal,done:true}))); check();
    if (!equal(snapshot(),current) || localStorage.getItem(key) !== previous) throw new Error('progress_changed');
    localStorage.setItem(key,pending);
    const result = await request(session,{action:'migration-activate',bundle:journal.bundle,selected:journal.selected,token:journal.token},check);
    check();
    if (!equal(snapshot(),current) || localStorage.getItem(key) !== pending) throw new Error('progress_changed');
    // No awaits between the final snapshot check, promotion and durable completion.
    // On quota/error the encrypted before/after journal remains recoverable.
    for (const [k,v] of Object.entries(journal.after)) {
      if (v === null) localStorage.removeItem(k); else localStorage.setItem(k,v);
    }
    localStorage.setItem(key,completed);
    return result;
  },true);
}

export async function downloadActivationRecovery(guard = captureIdentity()) {
  const journal = await activationRecovery(guard);
  if (!journal) return null;
  try {
    const cloud = await request(guard.session,{action:'migration-recovery',bundle:journal.bundle,selected:journal.selected},() => guard.check());
    return {...journal,cloud:cloud.receipt};
  } catch (_) { guard.check(); return {...journal,cloudUnavailable:true}; }
}
