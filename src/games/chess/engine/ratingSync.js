// ratingSync.js — browser client for cross-device Rated-mode persistence.
//
// The rating is keyed by an OPAQUE id: the SHA-256 of the user's Anthropic key
// under a fixed app namespace. The raw key is NEVER sent to our server (it only
// ever goes to Anthropic, per the BYO-key model) — only this hash leaves the
// browser. If the server has no store provisioned it replies { configured:
// false } and every helper degrades to "local only" without throwing loudly.

const ENDPOINT = '/api/chessRating';
const NAMESPACE = 'gipf-chess-rating:v1:'; // salts the hash so it isn't a bare key fingerprint

// Derive the opaque sync id from the Anthropic key. Returns a 64-char hex
// string, or null if Web Crypto is unavailable (very old browsers) or no key.
export async function ratingIdFromKey(key) {
  if (!key || typeof key !== 'string') return null;
  const subtle = globalThis.crypto && globalThis.crypto.subtle;
  if (!subtle) return null;
  const bytes = new TextEncoder().encode(NAMESPACE + key);
  const digest = await subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

// Fetch the stored record for an id.
//   → { rating, ratedGames }  when one exists
//   → null                    when the store is reachable but has no record
//   → { configured: false }   when the server has no store provisioned
// Throws only on network/transport failure (caller treats as a transient error).
export async function fetchRemoteRating(id) {
  if (!id) return { configured: false };
  const r = await fetch(`${ENDPOINT}?id=${encodeURIComponent(id)}`);
  if (!r.ok) throw new Error(`rating fetch ${r.status}`);
  const data = await r.json();
  if (data.configured === false) return { configured: false };
  return data.record || null;
}

// Persist a record for an id. Resolves to true on success, false otherwise
// (never throws — sync failures must not interrupt play).
export async function putRemoteRating(id, rating, ratedGames) {
  if (!id) return false;
  try {
    const r = await fetch(ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, rating, ratedGames }),
    });
    if (!r.ok) return false;
    const data = await r.json();
    return data.configured !== false;
  } catch (_) {
    return false;
  }
}
