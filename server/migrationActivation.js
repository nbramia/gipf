import { command, hash } from './publicSecurity.js';
import { validateFile } from '../src/migration.js';
import { canonical, destinationKey } from '../src/migrationSchema.js';

export const MIGRATION_LIMITS = Object.freeze({
  requestBytes: 512 * 1024, records: 128, selected: 64, matches: 4,
  pgnBytes: 8192, pgnTokens: 1024,
  extrasBytes: 256 * 1024, profileBytes: 280000, settingsBytes: 280000,
  snapshotBytes: 2 * 1024 * 1024, receiptBytes: 1024 * 1024,
  accountBytes: 4 * 1024 * 1024, activations: 50,
});
const size = value => Buffer.byteLength(JSON.stringify(value));

// Cheap checks MUST precede schema decoders (especially chess.js PGN replay).
// PGN token counting is deliberately conservative, including comments/headers.
function boundedSelection(body) {
  const records = body.bundle?.records, selected = body.selected;
  if (size(body) > MIGRATION_LIMITS.requestBytes || !Array.isArray(records) || records.length > MIGRATION_LIMITS.records ||
      !Array.isArray(selected) || !selected.length || selected.length > MIGRATION_LIMITS.selected ||
      selected.some(s => typeof s !== 'string' || s.length > 201) || new Set(selected).size !== selected.length) throw new Error();
  const selection = new Set(selected), targets = new Set();
  let matches = 0;
  for (const record of records) {
    if (!selection.has(id(record))) continue;
    const key = destinationKey(record);
    if (targets.has(key)) throw new Error();
    targets.add(key);
    if (record.kind.endsWith('-match') && ++matches > MIGRATION_LIMITS.matches) throw new Error();
    if (record.kind === 'chess-match') {
      const pgn = record.data?.state?.pgn;
      if (typeof pgn !== 'string' || Buffer.byteLength(pgn) > MIGRATION_LIMITS.pgnBytes ||
          (pgn.match(/[a-zA-Z0-9]+/g) || []).length > MIGRATION_LIMITS.pgnTokens) throw new Error();
    }
    if (record.kind === 'preference' && (typeof record.data !== 'string' || record.data.length > 2048)) throw new Error();
    if (record.kind === 'chess-puzzles' && Object.keys(record.data?.puzzles || {}).length > 500) throw new Error();
    if (record.kind === 'chess-mistakes' && size({ v: 1, entries: record.data }) > 262144) throw new Error();
  }
  if (targets.size !== selected.length) throw new Error();
  return selection;
}

// Exact byte CAS across every affected account domain and the durable receipt.
// JSON is encoded in JS, never Lua cjson (which loses empty arrays).
const COMMIT = `
for i=1,#KEYS do
 local v=redis.call('GET',KEYS[i]); local s=v and ('1'..v) or '0';
 if s~=ARGV[i] then return 0 end;
end;
for i=1,#KEYS do
 if ARGV[#KEYS+i]~='0' then redis.call('SET',KEYS[i],string.sub(ARGV[#KEYS+i],2)) end;
end;
return 1`;
const snapshot = raw => raw == null ? '0' : `1${raw}`;
const parse = raw => raw == null ? { revision: 0, profile: {} } : JSON.parse(raw);
const id = r => `${r.kind}/${r.id}`;
const games = ['chess','yinsh','zertz','catan'];

export async function migrationActivation(body, res, settingKeys, deadline) {
  const store = (...args) => {
    if (Date.now() + 3000 > deadline) throw new Error('store_unavailable');
    return command(...args);
  };
  let bundle, values;
  try {
    const selected = boundedSelection(body);
    bundle = await validateFile(JSON.stringify(body.bundle), { check() {} }, { selected });
    values = {};
    for (const selected of body.selected) {
      const record = bundle.records.find(r => id(r) === selected);
      if (!record || Object.hasOwn(values, destinationKey(record))) throw new Error();
      values[destinationKey(record)] = record.kind === 'preference' ? record.data : JSON.stringify(record.data);
    }
  } catch (_) { return res.status(400).json({ error: 'invalid_migration' }); }
  const fingerprint = hash(canonical({ bundle, selected: [...body.selected].sort() }));
  const receiptKey = `gipf:migration:v1:${hash(bundle.exportId)}`;
  const countKey = `gipf:migration-count:v1:${body.u}`;
  const keys = [receiptKey, countKey, `gipf:settings:v2:${body.u}`, `gipf:profile:v2:${body.u}`,
    ...games.map(game => `gipf:match:v1:${body.u}:${game}`), `gipf:migration-extra:v1:${body.u}`,
    `gipf:migration-bytes:v1:${body.u}`];
  const raw = await store('MGET', ...keys);
  if (raw[0] !== null && Buffer.byteLength(raw[0]) > MIGRATION_LIMITS.receiptBytes) return res.status(409).json({ error: 'migration_storage_limit' });
  if (raw[0] !== null) {
    const receipt = JSON.parse(raw[0]);
    if (receipt.owner !== body.u || receipt.fingerprint !== fingerprint) return res.status(409).json({ error: 'migration_claimed' });
    return res.status(200).json(body.action === 'migration-recovery' ? {status:'recovery',receipt} : { status: 'replay' });
  }
  if (body.action === 'migration-recovery') return res.status(404).json({error:'no_activation'});
  if (raw.slice(2,9).reduce((n,v) => n + (v === null ? 0 : Buffer.byteLength(v)),0) > MIGRATION_LIMITS.snapshotBytes) return res.status(409).json({ error: 'migration_storage_limit' });
  const count = raw[1] === null ? 0 : Number(raw[1]);
  if (!Number.isSafeInteger(count) || count < 0 || count >= MIGRATION_LIMITS.activations) return res.status(409).json({ error: 'migration_limit' });
  // Monotonic lifetime charge, including replaced values. No expiry can release
  // ownership or make an old file apply again. Missing accounting fails closed.
  const used = raw[9] === null && count === 0 ? 0 : raw[9] === null ? NaN : Number(raw[9]);
  if (!Number.isSafeInteger(used) || used < 0 || used > MIGRATION_LIMITS.accountBytes) return res.status(409).json({ error: 'migration_storage_limit' });
  const records = raw.slice(2,9).map(parse);
  if (records.some(r => !Number.isSafeInteger(r.revision) || r.revision < 0 || !r.profile || typeof r.profile !== 'object' || Array.isArray(r.profile))) throw new Error('invalid_destination');
  const [settings, profile, ...rest] = records;
  const extras = rest[4];
  const cloud = { ...extras.profile.values, ...settings.profile.preferences };
  const profileKeys = { history: 'chessOppHistory', puzzles: 'chessPuzzleProgress', mistakes: 'chessMistakes' };
  for (const [domain,key] of Object.entries(profileKeys)) if (profile.profile[domain] !== undefined) cloud[key] = JSON.stringify(domain === 'mistakes' ? profile.profile[domain].entries : profile.profile[domain]);
  if (profile.profile.rating) { cloud.chessRating = String(profile.profile.rating.rating); cloud.chessRatedGames = String(profile.profile.rating.ratedGames); }
  games.forEach((game,i) => { if (Object.hasOwn(rest[i].profile,'match')) cloud[`${game}Match:v1`] = JSON.stringify(rest[i].profile.match); });
  const token = hash(canonical(raw));
  if (body.action !== 'migration-preview' && (body.action !== 'migration-activate' || body.token !== token)) return res.status(409).json({ error: 'migration_conflict' });
  const changed = new Set();
  for (const [key,value] of Object.entries(values)) {
    const game = games.find(g => key === `${g}Match:v1`);
    const domain = Object.keys(profileKeys).find(d => profileKeys[d] === key);
    if (settingKeys.includes(key)) {
      settings.profile.preferences = { ...settings.profile.preferences, [key]: value }; changed.add(0);
    } else if (game) { const index = games.indexOf(game) + 2; records[index].profile.match = JSON.parse(value); changed.add(index); }
    else if (domain) { profile.profile[domain] = domain === 'mistakes' ? { v: 1, entries: JSON.parse(value) } : JSON.parse(value); changed.add(1); }
    else if (key === 'chessRating' || key === 'chessRatedGames') {
      profile.profile.rating = { rating: 1000, ratedGames: 0, ...profile.profile.rating, [key === 'chessRating' ? 'rating' : 'ratedGames']: Number(value) }; changed.add(1);
    } else { extras.profile.values = { ...extras.profile.values, [key]: value }; changed.add(6); }
  }
  // Old collision alternatives are recovery, not a second source that may
  // silently re-merge over an explicit selected replacement on the next load.
  if (changed.has(1) && profile.legacyProfiles) {
    const selectedDomains = new Set(Object.keys(values).map(key => key === 'chessRating' || key === 'chessRatedGames' ? 'rating' : Object.keys(profileKeys).find(d => profileKeys[d] === key)).filter(Boolean));
    profile.legacyProfiles = Object.fromEntries(Object.entries(profile.legacyProfiles).map(([key,legacy]) => [key,Object.fromEntries(Object.entries(legacy).filter(([domain]) => !selectedDomains.has(domain)))]));
  }
  changed.forEach(i => { records[i].revision++; });
  // Keep exact recovery bytes, under a receipt cap AND a CAS-protected lifetime
  // byte budget for receipts plus every changed destination. Nothing is trimmed.
  const receipt = JSON.stringify({ v: 1, owner: body.u, fingerprint, values, before: raw.slice(2,9) });
  const nextRecords = records.map((record,i) => changed.has(i) ? JSON.stringify(record) : raw[i+2]);
  const charge = Buffer.byteLength(receipt) + [...changed].reduce((n,i) => n + Buffer.byteLength(nextRecords[i]),0);
  if (Buffer.byteLength(receipt) > MIGRATION_LIMITS.receiptBytes || used + charge > MIGRATION_LIMITS.accountBytes ||
      (changed.has(0) && size(settings.profile) > MIGRATION_LIMITS.settingsBytes) ||
      (changed.has(1) && size(profile.profile) > MIGRATION_LIMITS.profileBytes) ||
      (changed.has(6) && Buffer.byteLength(nextRecords[6]) > MIGRATION_LIMITS.extrasBytes)) return res.status(409).json({ error: 'migration_storage_limit' });
  if (body.action === 'migration-preview') return res.status(200).json({ status: 'preview', token, conflicts: Object.keys(values).filter(k => cloud[k] !== undefined && cloud[k] !== values[k]) });
  const next = [receipt, String(count + 1), ...nextRecords, String(used + charge)];
  // Missing untouched domains stay missing; do not create a null record.
  const commitIndices = [0,1,9,...[...changed].map(i => i+2)];
  // Check untouched domains as well but write their exact bytes only if present.
  const result = await store('EVAL', COMMIT, keys.length, ...keys, ...raw.map(snapshot), ...next.map((v,i) => commitIndices.includes(i) || v !== null ? snapshot(v) : '0'));
  return result === 1 ? res.status(200).json({ status: 'activated' }) : res.status(409).json({ error: 'migration_conflict' });
}
