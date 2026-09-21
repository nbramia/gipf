import { migrationActivation, MIGRATION_LIMITS } from '../server/migrationActivation.js';
import { validChessLog } from '../server/chessLogValidation.js';
import { validMatch } from '../server/matchValidation.js';
// Authenticated profile persistence. Legacy IDs are capabilities only in claim.
import { guardRequest, authenticate, command, hex64, hash, limit } from '../server/publicSecurity.js';
export const config = { api: { bodyParser: { sizeLimit: '512kb' } } };
const MIN_RATING = 100;
const MAX_RATING = 4000;
const MAX_MISTAKES_BYTES = 262144;
const MAX_EPOCH_MS = 4102444800000;
const SETTING_KEYS = ['chessGameLog','chessTimeControl','chessPuzzleShowTheme','yinshDifficulty','yinshTwoPlayer','zertzDifficulty','zertzTwoPlayer','chessDarkMode','chessShowMoves','chessDifficulty','chessLearningGoal','chessShowEvalBar','chessSound','chessRated','yinshDarkMode','yinshShowMoves','yinshRandomSetup','yinshKeepScore','yinshWins','yinshShowMoveHistory','yinshEvaluationMode','zertzDarkMode','zertzShowMoves','catanDarkMode','catanShowMoves','catanDifficulty','catanRulesetId','catanPlayerCount','catanScenarioId'];
const DOMAINS = ['rating', 'history', 'puzzles', 'mistakes'];
// --- Per-domain sanitizers. Each returns a clean, storage-ready value or null
// if the supplied payload doesn't match the expected shape. -----------------

// Same sanitize as chessRating.js, just reshaped to take the {rating, ratedGames}
// object as it arrives nested under domains.rating in the POST body.
function sanitizeRating(value) {
  if (!value || typeof value !== 'object') return null;
  const rating = Math.round(Number(value.rating));
  const ratedGames = Math.round(Number(value.ratedGames));
  if (!Number.isFinite(rating) || !Number.isFinite(ratedGames)) return null;
  if (rating < MIN_RATING || rating > MAX_RATING) return null;
  if (ratedGames < 0 || ratedGames > 1_000_000) return null;
  return { rating, ratedGames };
}

function sanitizeHistory(data) {
  if (!data || typeof data !== 'object' || data.v !== 1) return null;

  const cleanSide = (side) => {
    if (!side || typeof side !== 'object' || Array.isArray(side)) return null;
    const keys = Object.keys(side);
    if (keys.length > 32) return null;
    const out = {};
    for (const key of keys) {
      if (key.length > 32) return null;
      const rec = side[key];
      if (!rec || typeof rec !== 'object') return null;
      const w = Math.round(Number(rec.w));
      const l = Math.round(Number(rec.l));
      const d = Math.round(Number(rec.d));
      const valid = [w, l, d].every((n) => Number.isFinite(n) && n >= 0 && n <= 1_000_000);
      if (!valid) return null;
      out[key] = { w, l, d };
    }
    return out;
  };

  const casual = cleanSide(data.casual);
  const rated = cleanSide(data.rated);
  if (!casual || !rated) return null;
  return { v: 1, casual, rated };
}

// Wire shape is the puzzle trainer's store verbatim (coach/puzzleProgress.js:
// { rating, attempts, puzzles }) — no v field.
function sanitizePuzzles(data) {
  if (!data || typeof data !== 'object') return null;
  const rating = Math.round(Number(data.rating));
  const attempts = Math.round(Number(data.attempts));
  if (!Number.isFinite(rating) || rating < MIN_RATING || rating > MAX_RATING) return null;
  if (!Number.isFinite(attempts) || attempts < 0 || attempts > 1_000_000) return null;

  const puzzles = data.puzzles;
  if (!puzzles || typeof puzzles !== 'object' || Array.isArray(puzzles)) return null;
  const keys = Object.keys(puzzles);
  if (keys.length > 500) return null;

  const out = {};
  for (const key of keys) {
    if (key.length > 64) return null;
    const rec = puzzles[key];
    if (!rec || typeof rec !== 'object') return null;
    const recAttempts = Math.round(Number(rec.attempts));
    const solves = Math.round(Number(rec.solves));
    const streak = Math.round(Number(rec.streak));
    const nextDueAt = Math.round(Number(rec.nextDueAt));
    if (!Number.isFinite(recAttempts) || recAttempts < 0 || recAttempts > 1_000_000) return null;
    if (!Number.isFinite(solves) || solves < 0 || solves > 1_000_000) return null;
    if (!Number.isFinite(streak) || streak < 0 || streak > 1_000_000) return null;
    if (!Number.isFinite(nextDueAt) || nextDueAt < 0 || nextDueAt > MAX_EPOCH_MS) return null;
    const lastResult = rec.lastResult === 'solved' ? 'solved' : 'failed';
    out[key] = { attempts: recAttempts, solves, streak, nextDueAt, lastResult };
  }
  return { rating, attempts, puzzles: out };
}

// Fields kept from a mistake-drill entry; everything else is dropped on write.
const MISTAKE_STR_FIELDS = {
  id: 32,
  movePlayed: 16,
  bestSan: 16,
  bestPv: 120,
  classification: 64,
  opening: 64,
};
const MISTAKE_NUM_FIELDS = ['cpLoss', 'moveNo', 'createdAt', 'attempts', 'streak', 'nextDueAt'];

function sanitizeMistakes(data) {
  if (!data || typeof data !== 'object' || data.v !== 1 || !Array.isArray(data.entries)) return null;
  if (data.entries.length > 200) return null;

  const entries = [];
  for (const entry of data.entries) {
    if (!entry || typeof entry !== 'object') return null;
    // fenBefore is required; entries missing (or with an oversized) fenBefore are dropped.
    if (typeof entry.fenBefore !== 'string' || entry.fenBefore.length === 0 || entry.fenBefore.length > 120) {
      continue;
    }
    const clean = { fenBefore: entry.fenBefore };
    for (const [field, max] of Object.entries(MISTAKE_STR_FIELDS)) {
      clean[field] = typeof entry[field] === 'string' ? entry[field].slice(0, max) : '';
    }
    for (const field of MISTAKE_NUM_FIELDS) {
      const n = Number(entry[field]);
      clean[field] = Number.isFinite(n) ? n : 0;
    }
    entries.push(clean);
  }

  const clean = { v: 1, entries };
  if (Buffer.byteLength(JSON.stringify(clean), 'utf8') > MAX_MISTAKES_BYTES) return null;
  return clean;
}

const SANITIZERS = {
  rating: sanitizeRating,
  history: sanitizeHistory,
  puzzles: sanitizePuzzles,
  mistakes: sanitizeMistakes,
};


// Merge with JSON.parse/stringify in JS, then atomically compare the exact input.
// Lua must never re-encode domain values: cjson erases empty-array identity.
const SNAPSHOT = `local function snapshot(k) local r=redis.call('GET',k); if r then return '1'..r else return '0' end end;\n`;
const snapshot = raw => raw == null ? '0' : `1${raw}`;
const WRITE = `${SNAPSHOT}if snapshot(KEYS[1])~=ARGV[1] then return 0 end;
redis.call('SET',KEYS[1],ARGV[2]); return 1`;
// Redis Lua cjson loses empty-array identity on decode/re-encode. Match JSON
// must remain opaque so empty queues/decks/maps survive byte-for-byte.
const WRITE_MATCH = `local r=redis.call('GET',KEYS[1]); local p=r and cjson.decode(r) or {revision=0};
if p.revision~=tonumber(ARGV[1]) then return 0 end;
local revision=p.revision+1;
redis.call('SET',KEYS[1],'{"revision":'..revision..',"profile":{"match":'..ARGV[2]..'}}'); return revision`;
// Owner check precedes snapshot comparison so same-owner retries stay idempotent.
// Compare destination and every source before either write; source keys stay intact.
const CLAIM = `${SNAPSHOT}local owner=redis.call('GET',KEYS[2]); if owner and owner~=ARGV[1] then return -1 end;
if owner then return 0 end;
for i=1,7 do if i~=2 and snapshot(KEYS[i])~=ARGV[i+2] then return -3 end end;
if ARGV[11]=='0' then return 2 end;
if tonumber(ARGV[10])>=5 then return -2 end;
if tonumber(redis.call('GET',KEYS[8]) or '0')>=5 then return -4 end;
local n=redis.call('INCR',KEYS[8]); if n==1 then redis.call('EXPIRE',KEYS[8],86400) end;
redis.call('SET',KEYS[1],ARGV[2]); redis.call('SET',KEYS[2],ARGV[1]); return 1`;
const emptyRecord = () => ({ revision: 0, profile: {} });

async function claimLegacy(key, id, user, deadline) {
  // The three preflight commands already consume up to 9s. Reserve the full
  // shared command timeout before each remaining request, including retries.
  const claimCommand = (...args) => {
    if (Date.now() + 3000 > deadline) throw new Error('store_unavailable');
    return command(...args);
  };
  const keys = [key, `gipf:claim:${id}`, ...DOMAINS.map(d => `chess:profile:${id}:${d}`), `chess:rating:${id}`];
  // Five competing successful migrations plus a final read must fit the lifetime cap.
  // All six attempts still share the handler-entry deadline; unrelated writes may conflict.
  for (let attempt = 0; attempt < 6; attempt++) {
    const raw = await claimCommand('MGET', ...keys);
    if (raw[1] != null) return raw[1] === user ? 0 : -1;
    const record = raw[0] != null ? JSON.parse(raw[0]) : emptyRecord();
    const count = record.claimCount || 0;
    const legacy = {};
    for (let i = 0; i < DOMAINS.length; i++) {
      const value = raw[i + 2] ?? (i === 0 ? raw[6] : null);
      if (value != null) {
        legacy[DOMAINS[i]] = JSON.parse(value);
        if (!Object.hasOwn(record.profile, DOMAINS[i])) record.profile[DOMAINS[i]] = legacy[DOMAINS[i]];
      }
    }
    record.legacyProfiles = { ...record.legacyProfiles, [keys[1]]: legacy };
    record.claimCount = count + 1;
    record.revision++;
    const result = await claimCommand('EVAL', CLAIM, 8, ...keys, `gipf:limit:claim-user:${hash(user)}`, user, JSON.stringify(record), ...raw.map(snapshot), count, Object.keys(legacy).length);
    if (result !== -3) return result;
  }
  return -3;
}

export default async function handler(req, res) {
  const claimDeadline = Date.now() + 17000; // Leave 3s for response/CPU under maxDuration:20.
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') return res.status(405).json({ error: 'use_authenticated_post' });
  if (!await guardRequest(req, res, { bucket: 'sync', limit: 120, maxBytes: MIGRATION_LIMITS.requestBytes })) return;
  const body = req.body;
  const migration = ['migration-preview','migration-activate','migration-recovery'].includes(body.action);
  if (!migration && Buffer.byteLength(JSON.stringify(body)) > 300000) return res.status(413).json({ error: 'too_large' });
  try {
    if (!await authenticate(body, res)) return;
    if (!await limit(migration ? 'migration-user' : 'sync-user', body.u, migration ? 30 : 120, migration ? 3600 : 60)) return res.status(429).json({ error: 'rate_limited' });
    if (migration) return await migrationActivation(body, res, SETTING_KEYS, claimDeadline);
    const settings = body.scope === 'settings';
    const match = body.scope === 'match';
    if (match && !['chess','yinsh','zertz','catan'].includes(body.game)) return res.status(400).json({ error: 'bad_request' });
    if (body.scope && !settings && !match) return res.status(400).json({ error: 'bad_request' });
    const key = match ? `gipf:match:v1:${body.u}:${body.game}` : `gipf:${settings ? 'settings' : 'profile'}:v2:${body.u}`;
    if (body.action === 'claim') {
      if (settings || match) return res.status(400).json({ error: 'bad_request' });
      const start = Date.parse(process.env.GIPF_LEGACY_CLAIM_FROM || '');
      const deadline = Date.parse(process.env.GIPF_LEGACY_CLAIM_UNTIL || '');
      // Explicit operator window, never a permanent alternate authorization path.
      if (!Number.isFinite(start) || !Number.isFinite(deadline) || deadline - start > 90 * 86400000 || start > Date.now() || Date.now() >= deadline) return res.status(410).json({ error: 'claim_closed' });
      if (!hex64(body.legacyId)) return res.status(400).json({ error: 'bad_request' });
      const id = body.legacyId;
      const result = await claimLegacy(key, id, body.u, claimDeadline);
      if (result === -4) return res.status(429).json({ error: 'rate_limited' });
      if (result === -3) return res.status(409).json({ error: 'conflict' });
      if (result === -2) return res.status(409).json({ error: 'claim_limit' });
      if (result === -1) return res.status(409).json({ error: 'already_claimed' });
      return res.status(200).json({ configured: true, claimed: result !== 2 });
    }
    if (body.action === 'read') {
      const raw = await command('GET', key);
      const record = raw != null ? JSON.parse(raw) : { revision: 0, profile: {} };
      return res.status(200).json({ configured: true, ...record });
    }
    if (body.action !== 'write' || !Number.isSafeInteger(body.revision) || body.revision < 0 || !body.domains || typeof body.domains !== 'object' || Array.isArray(body.domains)) return res.status(400).json({ error: 'bad_request' });
    const clean = {};
    if (match) {
      if (Object.keys(body.domains).length !== 1 || !validMatch(body.game, body.domains.match)) return res.status(400).json({ error: 'bad_request' });
      clean.match = body.domains.match;
    }
    if (settings) {
      const value = body.domains.preferences;
      if (!value || typeof value !== 'object' || Array.isArray(value)) return res.status(400).json({ error: 'bad_request' });
      clean.preferences = {};
      for (const [k, v] of Object.entries(value)) {
        if (!SETTING_KEYS.includes(k) || (v !== null && (k === 'chessGameLog' ? !validChessLog(v) : (typeof v !== 'string' || v.length > 2048)))) return res.status(400).json({ error: 'bad_request' });
        clean.preferences[k] = v;
      }
    }
    for (const domain of settings || match ? [] : DOMAINS) {
      if (!(domain in body.domains)) continue;
      const value = SANITIZERS[domain](body.domains[domain]);
      if (!value) return res.status(400).json({ error: 'bad_request' });
      clean[domain] = value;
    }
    if (!Object.keys(clean).length) return res.status(400).json({ error: 'bad_request' });
    let revision;
    if (match) {
      revision = await command('EVAL', WRITE_MATCH, 1, key, body.revision, JSON.stringify(clean.match));
    } else {
      const raw = await command('GET', key);
      const record = raw != null ? JSON.parse(raw) : emptyRecord();
      if (record.revision !== body.revision) return res.status(409).json({ error: 'conflict' });
      // Only the known v1 empty entries object is compatible with historical
      // cjson empty-array loss. Preserve nonempty malformed originals for recovery.
      const mistakes = record.profile.mistakes;
      if (!settings && clean.mistakes && mistakes?.v === 1 && mistakes.entries &&
          typeof mistakes.entries === 'object' && !Array.isArray(mistakes.entries) &&
          Object.keys(mistakes.entries).length > 0) {
        return res.status(409).json({ error: 'legacy_shape_conflict' });
      }
      record.profile = { ...record.profile, ...clean };
      record.revision++;
      const saved = await command('EVAL', WRITE, 1, key, snapshot(raw), JSON.stringify(record));
      revision = saved ? record.revision : 0;
    }
    if (!revision) return res.status(409).json({ error: 'conflict' });
    return res.status(200).json({ configured: true, revision, saved: Object.keys(clean) });
  } catch (_) { return res.status(503).json({ error: 'store_unavailable' }); }
}
