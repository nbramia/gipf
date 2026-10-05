// Server-side custody of the secrets a signed-in player keeps on their account: the
// Anthropic API key, the Lichess token, and the device seal key (see server/identity.js).
//
// Each value is AES-256-GCM ciphertext under a key-encryption key (KEK) from the
// environment. The additional authenticated data binds a ciphertext to its identity,
// its slot and its key version, so an envelope copied to another identity or slot, or
// relabelled with another version, fails to decrypt rather than yielding a key.
//
// Rotation: `GAMES_KEY_ENCRYPTION_KEY` is the current KEK (base64 of 32 random bytes)
// and `GAMES_KEY_ENCRYPTION_KEY_VERSION` its version (a positive integer, default 1).
// While rotating, each earlier KEK stays readable as `GAMES_KEY_ENCRYPTION_KEY_V<n>`.
// New envelopes always use the current version; `rewrap` moves an old envelope to it,
// and `scripts/rotate-games-keys.mjs` rewraps every identity so the old KEK can go.
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

export const SLOTS = ['anthropic', 'lichess', 'seal'];
const KEY_RE = /^[A-Za-z0-9+/]{43}=$/;
const B64_RE = /^[A-Za-z0-9+/]+={0,2}$/;
const VERSIONED = /^GAMES_KEY_ENCRYPTION_KEY_V([1-9][0-9]{0,5})$/;

export class KeyCustodyUnavailable extends Error {
  constructor() { super('key_custody_unavailable'); }
}

function decodeKey(value) {
  if (!KEY_RE.test(String(value || ''))) throw new KeyCustodyUnavailable();
  return Buffer.from(value, 'base64');
}

// The KEKs this deployment can use. Throws KeyCustodyUnavailable when the current KEK
// is missing or malformed, so callers fail closed instead of storing plaintext.
export function keyring(env = process.env) {
  const current = Number(env.GAMES_KEY_ENCRYPTION_KEY_VERSION || 1);
  if (!Number.isSafeInteger(current) || current < 1) throw new KeyCustodyUnavailable();
  const keys = new Map([[current, decodeKey(env.GAMES_KEY_ENCRYPTION_KEY)]]);
  for (const [name, value] of Object.entries(env)) {
    const match = name.match(VERSIONED);
    if (match && Number(match[1]) !== current) keys.set(Number(match[1]), decodeKey(value));
  }
  return { current, keys };
}

const aad = (identity, slot, kv) => Buffer.from(`gipf-games-key:v1|${identity}|${slot}|${kv}`);

function checkSlot(identity, slot) {
  if (!/^[a-f0-9]{64}$/.test(String(identity)) || !SLOTS.includes(slot)) throw new TypeError('bad_envelope_binding');
}

// Encrypt `plaintext` for one identity and slot under the current KEK.
export function seal(identity, slot, plaintext, ring = keyring()) {
  checkSlot(identity, slot);
  if (typeof plaintext !== 'string' || !plaintext) throw new TypeError('bad_plaintext');
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', ring.keys.get(ring.current), iv);
  cipher.setAAD(aad(identity, slot, ring.current));
  const ct = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  return { kv: ring.current, iv: iv.toString('base64'), ct: ct.toString('base64'), tag: cipher.getAuthTag().toString('base64') };
}

export function isEnvelope(envelope) {
  return !!envelope && typeof envelope === 'object' && Number.isSafeInteger(envelope.kv) && envelope.kv > 0 &&
    [envelope.iv, envelope.ct, envelope.tag].every(v => typeof v === 'string' && B64_RE.test(v));
}

// Decrypt an envelope. Throws when its KEK version is not available or when the
// envelope was not made for this identity and slot.
export function open(identity, slot, envelope, ring = keyring()) {
  checkSlot(identity, slot);
  if (!isEnvelope(envelope)) throw new TypeError('bad_envelope');
  const key = ring.keys.get(envelope.kv);
  if (!key) throw new KeyCustodyUnavailable();
  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(envelope.iv, 'base64'));
  decipher.setAAD(aad(identity, slot, envelope.kv));
  decipher.setAuthTag(Buffer.from(envelope.tag, 'base64'));
  return Buffer.concat([decipher.update(Buffer.from(envelope.ct, 'base64')), decipher.final()]).toString('utf8');
}

// The envelope under the current KEK: unchanged when it already is, re-encrypted otherwise.
export function rewrap(identity, slot, envelope, ring = keyring()) {
  if (envelope.kv === ring.current) return envelope;
  return seal(identity, slot, open(identity, slot, envelope, ring), ring);
}
