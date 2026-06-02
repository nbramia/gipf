// /api/chessRating.js — cross-device persistence for Chess "Rated" mode.
//
// SECURITY MODEL: the rating is keyed by an OPAQUE id that the browser derives
// by hashing the user's Anthropic key (SHA-256 with a fixed app namespace).
// The raw key NEVER reaches this endpoint — only the 64-hex-char hash — so this
// store can never leak or spend anyone's Anthropic credits. We store nothing
// but {rating, ratedGames} against that hash.
//
// Backed by Vercel KV / Upstash Redis over its REST API (plain fetch, no deps).
// If the store isn't provisioned (no env vars), every call returns
// { configured: false } so the client silently falls back to localStorage.
//
// CORS mirrors api/chessCoach.js: an allowlist applied on every path.

const ALLOWED_ORIGINS = ['https://gipf.vercel.app', 'http://localhost:3000'];

const KV_URL = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
const KV_TOKEN = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;

const ID_RE = /^[a-f0-9]{64}$/; // SHA-256 hex
const MIN_RATING = 100;
const MAX_RATING = 4000;

function applyCors(req, res) {
  const origin = req.headers.origin;
  if (ALLOWED_ORIGINS.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
  }
  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

const redisKey = (id) => `chess:rating:${id}`;

// Upstash REST: GET {url}/get/{key} → { result: "<string>" | null }.
async function kvGet(id) {
  const r = await fetch(`${KV_URL}/get/${redisKey(id)}`, {
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

// Upstash REST: POST {url}/set/{key} with the value string in the body.
async function kvSet(id, value) {
  const r = await fetch(`${KV_URL}/set/${redisKey(id)}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${KV_TOKEN}` },
    body: JSON.stringify(value),
  });
  if (!r.ok) throw new Error(`kv set ${r.status}`);
}

function validId(id) {
  return typeof id === 'string' && ID_RE.test(id);
}

// Coerce/clamp a stored or incoming record into a clean {rating, ratedGames}.
function sanitize(rating, ratedGames) {
  const r = Math.round(Number(rating));
  const g = Math.round(Number(ratedGames));
  if (!Number.isFinite(r) || !Number.isFinite(g)) return null;
  if (r < MIN_RATING || r > MAX_RATING || g < 0 || g > 1_000_000) return null;
  return { rating: r, ratedGames: g };
}

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
      const record = await kvGet(id);
      res.status(200).json({ configured: true, record: record || null });
      return;
    }

    if (req.method === 'POST') {
      const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body || {};
      const { id, rating, ratedGames } = body;
      if (!validId(id)) {
        res.status(400).json({ error: 'bad_request', message: 'Invalid id.' });
        return;
      }
      const clean = sanitize(rating, ratedGames);
      if (!clean) {
        res.status(400).json({ error: 'bad_request', message: 'Invalid rating payload.' });
        return;
      }
      await kvSet(id, clean);
      res.status(200).json({ configured: true, record: clean });
      return;
    }

    res.status(405).json({ error: 'Method not allowed' });
  } catch (e) {
    res.status(502).json({ error: 'store_error', message: 'Rating store unavailable.' });
  }
}
