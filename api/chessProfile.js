// /api/chessProfile.js — cross-device persistence for the Chess profile: rating,
// per-opponent history, puzzle progress, and the mistake-drill library.
//
// SECURITY MODEL: same as api/chessRating.js. Records are keyed by an OPAQUE id
// that the browser derives client-side by hashing the user's Anthropic key
// (SHA-256 with a fixed app namespace). The raw key NEVER reaches this endpoint
// — only the 64-hex-char hash — so this store can never leak or spend anyone's
// Anthropic credits. We store nothing but game-progress data against that hash:
// {rating, ratedGames}, W/L/D tallies per opponent, puzzle attempt/solve counts,
// and a bounded library of missed-move drill entries (FEN + engine line, no
// account info, no PII).
//
// Backed by Vercel KV / Upstash Redis over its REST API (plain fetch, no deps).
// If the store isn't provisioned (no env vars), every call returns
// { configured: false } so the client silently falls back to localStorage.
//
// This endpoint supersedes api/chessRating.js's single-domain store with four
// domains ('rating', 'history', 'puzzles', 'mistakes'), but keeps writing the
// legacy `chess:rating:${id}` key whenever the rating domain is saved, so older
// deployed clients that still call chessRating.js directly stay coherent.
//
// CORS mirrors api/chessCoach.js: an allowlist applied on every path.

const ALLOWED_ORIGINS = ['https://gipf.vercel.app', 'http://localhost:3000'];

const KV_URL = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
const KV_TOKEN = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;

const ID_RE = /^[a-f0-9]{64}$/; // SHA-256 hex
const MIN_RATING = 100;
const MAX_RATING = 4000;
const MAX_BODY_CHARS = 300_000;
const MAX_MISTAKES_BYTES = 262_144; // 256KB
const MAX_EPOCH_MS = 4_102_444_800_000; // year 2100, generous upper bound for timestamps

const DOMAINS = ['rating', 'history', 'puzzles', 'mistakes'];

function applyCors(req, res) {
  const origin = req.headers.origin;
  if (ALLOWED_ORIGINS.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
  }
  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

const profileKey = (id, domain) => `chess:profile:${id}:${domain}`;
const legacyRatingKey = (id) => `chess:rating:${id}`;

// Upstash REST: GET {url}/get/{key} → { result: "<string>" | null }.
async function kvGet(key) {
  const r = await fetch(`${KV_URL}/get/${key}`, {
    headers: { Authorization: `Bearer ${KV_TOKEN}` },
  });
  if (!r.ok) throw new Error(`kv get ${r.status}`);
  const data = await r.json();
  if (data.result == null) return null;
  try {
    return JSON.parse(data.result);
  } catch (_) {
    return null;
  }
}

// Upstash REST: GET {url}/mget/{k1}/{k2}/... → { result: [v1, v2, ...] }, each a
// JSON string or null. One round trip for all four domains.
async function kvMget(keys) {
  const r = await fetch(`${KV_URL}/mget/${keys.join('/')}`, {
    headers: { Authorization: `Bearer ${KV_TOKEN}` },
  });
  if (!r.ok) throw new Error(`kv mget ${r.status}`);
  const data = await r.json();
  return (data.result || []).map((v) => {
    if (v == null) return null;
    try {
      return JSON.parse(v);
    } catch (_) {
      return null;
    }
  });
}

// Upstash REST: POST {url}/set/{key} with the value string in the body.
async function kvSet(key, value) {
  const r = await fetch(`${KV_URL}/set/${key}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${KV_TOKEN}` },
    body: JSON.stringify(value),
  });
  if (!r.ok) throw new Error(`kv set ${r.status}`);
}

function validId(id) {
  return typeof id === 'string' && ID_RE.test(id);
}

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

export default async function handler(req, res) {
  applyCors(req, res);

  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return;
  }

  // No store provisioned → tell the client to stay local (not an error).
  if (!KV_URL || !KV_TOKEN) {
    res.status(200).json({ configured: false });
    return;
  }

  try {
    if (req.method === 'GET') {
      const { id } = req.query || {};
      if (!validId(id)) {
        res.status(400).json({ error: 'bad_request', message: 'Invalid id.' });
        return;
      }
      const keys = DOMAINS.map((d) => profileKey(id, d));
      const values = await kvMget(keys);
      const profile = {};
      DOMAINS.forEach((d, i) => {
        profile[d] = values[i];
      });
      // The rating domain didn't exist under the new key scheme before this
      // endpoint shipped — fall back to the record api/chessRating.js wrote.
      if (profile.rating == null) {
        profile.rating = await kvGet(legacyRatingKey(id));
      }
      res.status(200).json({ configured: true, profile });
      return;
    }

    if (req.method === 'POST') {
      // Approximate the raw body length from either the string CRA/Vercel gives
      // us when bodyParser is bypassed, or a re-stringify of the parsed object.
      const raw = typeof req.body === 'string' ? req.body : JSON.stringify(req.body || {});
      if (raw.length > MAX_BODY_CHARS) {
        res.status(413).json({ error: 'too_large' });
        return;
      }
      const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body || {};
      const { id, domains } = body;
      if (!validId(id)) {
        res.status(400).json({ error: 'bad_request', message: 'Invalid id.' });
        return;
      }
      if (!domains || typeof domains !== 'object' || Array.isArray(domains)) {
        res.status(400).json({ error: 'bad_request', message: 'Invalid domains.' });
        return;
      }

      const clean = {};
      for (const domain of DOMAINS) {
        if (!(domain in domains)) continue;
        const sanitized = SANITIZERS[domain](domains[domain]);
        if (!sanitized) {
          res.status(400).json({ error: 'bad_request', message: `Invalid ${domain} payload.` });
          return;
        }
        clean[domain] = sanitized;
      }

      const saved = Object.keys(clean);
      if (saved.length === 0) {
        res.status(400).json({ error: 'bad_request', message: 'No recognized domain supplied.' });
        return;
      }

      await Promise.all(saved.map((domain) => kvSet(profileKey(id, domain), clean[domain])));
      if (clean.rating) {
        // Mirror the rating write to the legacy key so clients still on the
        // older api/chessRating.js endpoint see a consistent value.
        await kvSet(legacyRatingKey(id), clean.rating);
      }

      res.status(200).json({ configured: true, saved });
      return;
    }

    res.status(405).json({ error: 'Method not allowed' });
  } catch (e) {
    res.status(502).json({ error: 'store_error', message: 'Profile store unavailable.' });
  }
}
