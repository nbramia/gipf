// Legacy capability derivation is retained for migration only. Unauthenticated
// rating sync has been retired; normal persistence uses profileSync credentials.
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
export async function fetchRemoteRating() { return { configured: false }; }
export async function putRemoteRating() { return false; }
