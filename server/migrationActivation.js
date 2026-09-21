import { command, hash } from './publicSecurity.js';
import { validateFile } from '../src/migration.js';
import { canonical, destinationKey } from '../src/migrationSchema.js';

// Exact byte CAS across every affected account domain and the durable receipt.
// JSON is encoded in JS, never Lua cjson (which loses empty arrays).
const COMMIT = `
for i=1,#KEYS do
 local v=redis.call('GET',KEYS[i]); local s=v and ('1'..v) or '0';
 if s~=ARGV[i] then return 0 end;
end;
for i=1,#KEYS do redis.call('SET',KEYS[i],ARGV[#KEYS+i]) end;
return 1`;
const snapshot = raw => raw == null ? '0' : `1${raw}`;
const parse = raw => raw == null ? { revision: 0, profile: {} } : JSON.parse(raw);
const id = r => `${r.kind}/${r.id}`;
const games = ['chess','yinsh','zertz','catan'];

export async function migrationActivation(body, res, settingKeys) {
  let bundle, values;
  try {
    bundle = await validateFile(JSON.stringify(body.bundle), { check() {} });
    if (!Array.isArray(body.selected) || !body.selected.length || body.selected.length > bundle.records.length || new Set(body.selected).size !== body.selected.length) throw new Error();
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
    ...games.map(game => `gipf:match:v1:${body.u}:${game}`), `gipf:migration-extra:v1:${body.u}`];
  const raw = await command('MGET', ...keys);
  if (raw[0] !== null) {
    const receipt = JSON.parse(raw[0]);
    if (receipt.owner !== body.u || receipt.fingerprint !== fingerprint) return res.status(409).json({ error: 'migration_claimed' });
    return res.status(200).json(body.action === 'migration-recovery' ? {status:'recovery',receipt} : { status: 'replay' });
  }
  if (body.action === 'migration-recovery') return res.status(404).json({error:'no_activation'});
  const count = raw[1] === null ? 0 : Number(raw[1]);
  if (!Number.isSafeInteger(count) || count < 0 || count >= 50) return res.status(409).json({ error: 'migration_limit' });
  const records = raw.slice(2).map(parse);
  if (records.some(r => !Number.isSafeInteger(r.revision) || r.revision < 0 || !r.profile || typeof r.profile !== 'object' || Array.isArray(r.profile))) throw new Error('invalid_destination');
  const [settings, profile, ...rest] = records;
  const extras = rest[4];
  const cloud = { ...extras.profile.values, ...settings.profile.preferences };
  const profileKeys = { history: 'chessOppHistory', puzzles: 'chessPuzzleProgress', mistakes: 'chessMistakes' };
  for (const [domain,key] of Object.entries(profileKeys)) if (profile.profile[domain] !== undefined) cloud[key] = JSON.stringify(domain === 'mistakes' ? profile.profile[domain].entries : profile.profile[domain]);
  if (profile.profile.rating) { cloud.chessRating = String(profile.profile.rating.rating); cloud.chessRatedGames = String(profile.profile.rating.ratedGames); }
  games.forEach((game,i) => { if (Object.hasOwn(rest[i].profile,'match')) cloud[`${game}Match:v1`] = JSON.stringify(rest[i].profile.match); });
  const token = hash(canonical(raw));
  if (body.action === 'migration-preview') return res.status(200).json({ status: 'preview', token, conflicts: Object.keys(values).filter(k => cloud[k] !== undefined && cloud[k] !== values[k]) });
  if (body.action !== 'migration-activate' || body.token !== token) return res.status(409).json({ error: 'migration_conflict' });
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
  // The receipt preserves prior exact cloud bytes and selected imported values.
  // A per-account count bounds durable growth; failures and replays consume none.
  const receipt = JSON.stringify({ v: 1, owner: body.u, fingerprint, values, before: raw.slice(2) });
  const next = [receipt, String(count + 1), ...records.map((record,i) => changed.has(i) ? JSON.stringify(record) : raw[i+2])];
  // Missing untouched domains stay missing; do not create a null record.
  const commitIndices = [0,1,...[...changed].map(i => i+2)];
  // Check untouched domains as well but write their exact bytes only if present.
  const script = COMMIT.replace("for i=1,#KEYS do redis.call('SET',KEYS[i],ARGV[#KEYS+i]) end;", "for i=1,#KEYS do if ARGV[#KEYS+i]~='0' then redis.call('SET',KEYS[i],string.sub(ARGV[#KEYS+i],2)) end end;");
  const result = await command('EVAL', script, keys.length, ...keys, ...raw.map(snapshot), ...next.map((v,i) => commitIndices.includes(i) || v !== null ? snapshot(v) : '0'));
  return result === 1 ? res.status(200).json({ status: 'activated' }) : res.status(409).json({ error: 'migration_conflict' });
}
