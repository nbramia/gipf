// /api/chessAccount.js — minimal chess accounts so a username+password unlocks
// the same profile and Anthropic API key on any machine.
//
// SECURITY MODEL: everything sensitive is derived client-side from the
// password (PBKDF2). The server receives only (a) usernameId — SHA-256 of the
// namespaced lowercase username, so no raw usernames are stored, (b)
// authToken — a password-derived 64-hex secret used purely for authorization,
// stored only as its SHA-256 hash, and (c) enc — the user's Anthropic API key
// encrypted client-side with an AES-GCM key that never leaves the browser.
// The account record also carries encLichess — same encryption model — for
// the user's Lichess explorer token. The server can never read anyone's API
// key or Lichess token. No email, no recovery: a
// forgotten password means a new account. No rate limiting — accepted risk
// for low-stakes data.
//
// Backed by Vercel KV / Upstash Redis over its REST API (plain fetch, no
// deps). If the store isn't provisioned (no env vars), every call returns
// { configured: false } so the client silently falls back to localStorage.
//
// CORS mirrors api/chessProfile.js: an allowlist applied on every path.

import { createHash } from 'crypto';

const ALLOWED_ORIGINS = ['https://gipf.vercel.app', 'http://localhost:3000'];

const KV_URL = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
const KV_TOKEN = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;

const HEX64_RE = /^[a-f0-9]{64}$/; // SHA-256 hex
const BASE64_RE = /^[A-Za-z0-9+/=]+$/;
const MAX_BODY_CHARS = 8_192;

function applyCors(req, res) {
  const origin = req.headers.origin;
  if (ALLOWED_ORIGINS.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
  }
  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

const accountKey = (usernameId) => `chess:account:${usernameId}`;

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

// Upstash REST: POST {url}/set/{key} with the value string in the body.
async function kvSet(key, value) {
  const r = await fetch(`${KV_URL}/set/${key}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${KV_TOKEN}` },
    body: JSON.stringify(value),
  });
  if (!r.ok) throw new Error(`kv set ${r.status}`);
}

const sha256Hex = (s) => createHash('sha256').update(s).digest('hex');

function isHex64(s) {
  return typeof s === 'string' && HEX64_RE.test(s);
}

// Validates the { iv, ct } shape; does not accept null (callers check for
// null explicitly where it's allowed).
function isValidEncShape(enc) {
  if (!enc || typeof enc !== 'object') return false;
  const { iv, ct } = enc;
  if (typeof iv !== 'string' || iv.length === 0 || iv.length > 32 || !BASE64_RE.test(iv)) return false;
  if (typeof ct !== 'string' || ct.length === 0 || ct.length > 4096 || !BASE64_RE.test(ct)) return false;
  return true;
}

export default async function handler(req, res) {
  applyCors(req, res);

  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return;
  }

  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  // No store provisioned → tell the client to stay local (not an error).
  if (!KV_URL || !KV_TOKEN) {
    res.status(200).json({ configured: false });
    return;
  }

  try {
    // Approximate the raw body length from either the string CRA/Vercel
    // gives us when bodyParser is bypassed, or a re-stringify of the parsed
    // object.
    const raw = typeof req.body === 'string' ? req.body : JSON.stringify(req.body || {});
    if (raw.length > MAX_BODY_CHARS) {
      res.status(413).json({ error: 'too_large' });
      return;
    }
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body || {};
    const { action, u, auth, enc, encLichess } = body;

    if (!isHex64(u) || !isHex64(auth)) {
      res.status(400).json({ error: 'bad_request', message: 'Invalid username or auth token.' });
      return;
    }

    const encProvided = enc !== undefined;
    if (encProvided && enc !== null && !isValidEncShape(enc)) {
      res.status(400).json({ error: 'bad_request', message: 'Invalid enc payload.' });
      return;
    }

    const encLichessProvided = encLichess !== undefined;
    if (encLichessProvided && encLichess !== null && !isValidEncShape(encLichess)) {
      res.status(400).json({ error: 'bad_request', message: 'Invalid encLichess payload.' });
      return;
    }

    if (action === 'create') {
      if (!encProvided) {
        res.status(400).json({ error: 'bad_request', message: 'enc is required (use null for a keyless account).' });
        return;
      }
      // Not atomic: this is a get followed by a set over the Upstash REST
      // API, so two simultaneous creates for the same username could both
      // pass the existence check. Accepted non-issue at this scale.
      const existing = await kvGet(accountKey(u));
      if (existing) {
        res.status(409).json({ error: 'taken', message: 'That username is taken.' });
        return;
      }
      await kvSet(accountKey(u), {
        authHash: sha256Hex(auth),
        enc: enc || null,
        encLichess: encLichess || null,
        createdAt: Date.now(),
      });
      res.status(200).json({ configured: true, created: true });
      return;
    }

    if (action === 'login') {
      const record = await kvGet(accountKey(u));
      if (!record) {
        res.status(404).json({ error: 'no_account', message: 'No account with that username.' });
        return;
      }
      if (sha256Hex(auth) !== record.authHash) {
        res.status(401).json({ error: 'bad_credentials', message: 'Incorrect password.' });
        return;
      }
      res.status(200).json({ configured: true, enc: record.enc || null, encLichess: record.encLichess || null });
      return;
    }

    if (action === 'setKey') {
      if (encProvided && enc === null) {
        res.status(400).json({ error: 'bad_request', message: 'enc must not be null.' });
        return;
      }
      if (encLichessProvided && encLichess === null) {
        res.status(400).json({ error: 'bad_request', message: 'encLichess must not be null.' });
        return;
      }
      if (!encProvided && !encLichessProvided) {
        res.status(400).json({ error: 'bad_request', message: 'enc or encLichess is required.' });
        return;
      }
      const record = await kvGet(accountKey(u));
      if (!record) {
        res.status(404).json({ error: 'no_account', message: 'No account with that username.' });
        return;
      }
      if (sha256Hex(auth) !== record.authHash) {
        res.status(401).json({ error: 'bad_credentials', message: 'Incorrect password.' });
        return;
      }
      await kvSet(accountKey(u), {
        authHash: record.authHash,
        enc: encProvided ? enc : record.enc || null,
        encLichess: encLichessProvided ? encLichess : record.encLichess || null,
        createdAt: record.createdAt,
      });
      res.status(200).json({ configured: true, saved: true });
      return;
    }

    res.status(400).json({ error: 'bad_request', message: 'Unknown action.' });
  } catch (e) {
    res.status(502).json({ error: 'store_error', message: 'Account store unavailable.' });
  }
}
