// Games identities: one per Auth0 subject, keyed by an opaque digest of the issuer and
// subject so Redis never holds the subject itself.
//
// `gipf:identity:v1:<identityId>` → {v, data, linked, created, keys}
//   data    the id every progress key is stored under (`gipf:settings:v2:<data>`,
//           `gipf:match:v1:<data>:<game>`, …). A new identity uses its own id; an
//           identity linked to a pre-Auth0 games account uses that account's
//           usernameId, so the old progress is reached in place, never copied.
//   linked  that usernameId, or null.
//   keys    server-encrypted envelopes (server/keyCustody.js): `anthropic`, `lichess`,
//           and `seal`, the 32-byte key the browser seals its local recovery copies
//           with. A linked identity's seal key is the old account's password-derived
//           AES key, so recovery copies sealed before Auth0 still open.
// `gipf:identity-link:v1:<usernameId>` → identityId, set once: an old account links to
// one identity, and an identity links at most one old account.
import { randomBytes } from 'node:crypto';
import { command, hash, hex64 } from './publicSecurity.js';
import { seal, open, isEnvelope, rewrap, keyring } from './keyCustody.js';

export const identityKey = id => `gipf:identity:v1:${id}`;
export const linkKey = u => `gipf:identity-link:v1:${u}`;
export const MAX_SECRET_LENGTH = 512;
// New identities per network and across all networks per 24 hours (see ensureIdentity's caller).
export const CREATE_PER_NETWORK = 5;
export const CREATE_PER_DAY = 50;

// The identity for an Auth0 subject. The issuer is part of the input, so a subject
// from any other tenant can never collide with one from ours.
export function identityId(issuer, sub) {
  return hash(`gipf-games-identity:v1|${issuer}|${sub}`);
}

const CAS = `local r=redis.call('GET',KEYS[1]); if (r or '')~=ARGV[1] then return 0 end; redis.call('SET',KEYS[1],ARGV[2]); return 1`;
const LINK = `if redis.call('EXISTS',KEYS[2])==1 then return -1 end;
local r=redis.call('GET',KEYS[1]); if (r or '')=='' or r~=ARGV[1] then return 0 end;
redis.call('SET',KEYS[2],ARGV[3]); redis.call('SET',KEYS[1],ARGV[2]); return 1`;

function parse(raw) {
  if (raw == null) return null;
  const record = JSON.parse(raw);
  if (record?.v !== 1 || !hex64(record.data) || !isEnvelope(record.keys?.seal)) throw new Error('store_unavailable');
  return record;
}

export async function readIdentity(id) {
  return parse(await command('GET', identityKey(id)));
}

// The identity's record, creating it on first sign-in. `created` is true only for
// the request that created it.
export async function ensureIdentity(id, now = Date.now()) {
  const existing = await readIdentity(id);
  if (existing) return { record: existing, created: false };
  const record = { v: 1, data: id, linked: null, created: now, keys: { seal: seal(id, 'seal', randomBytes(32).toString('base64')) } };
  const result = await command('SET', identityKey(id), JSON.stringify(record), 'NX');
  if (result === 'OK') return { record, created: true };
  return { record: await readIdentity(id), created: false };
}

export function keyStatus(record) {
  return { anthropic: !!record?.keys?.anthropic, lichess: !!record?.keys?.lichess };
}

// The plaintext in one slot, or '' when the slot is empty.
export function openSlot(id, record, slot) {
  const envelope = record?.keys?.[slot];
  return envelope ? open(id, slot, envelope) : '';
}

export function validSecret(value) {
  return typeof value === 'string' && value.length > 0 && value.length <= MAX_SECRET_LENGTH && !/[\s\0]/.test(value);
}

function applyKeys(id, record, changes) {
  const keys = { ...record.keys };
  for (const slot of ['anthropic', 'lichess']) {
    if (changes[slot] === undefined) continue;
    if (changes[slot] === null) delete keys[slot];
    else keys[slot] = seal(id, slot, changes[slot]);
  }
  return { ...record, keys };
}

// Set (string) or clear (null) the Anthropic key and Lichess token; an omitted slot
// is left as it is. A concurrent change elsewhere is retried against the new record.
export async function updateKeys(id, changes) {
  for (let attempt = 0; attempt < 3; attempt++) {
    const raw = await command('GET', identityKey(id));
    const record = parse(raw);
    if (!record) return null;
    const next = applyKeys(id, record, changes);
    if (await command('EVAL', CAS, 1, identityKey(id), raw, JSON.stringify(next))) return next;
  }
  throw new Error('store_unavailable');
}

// Link a verified pre-Auth0 account to this identity. Its keys fill only the slots the
// identity has not set. Returns the new record, or an error code:
// 'identity_linked' (this identity already has a linked account) or
// 'account_linked' (that account is linked to an identity already).
export async function linkLegacy(id, usernameId, { anthropic, lichess, sealKey }) {
  for (let attempt = 0; attempt < 3; attempt++) {
    const raw = await command('GET', identityKey(id));
    const record = parse(raw);
    if (!record) throw new Error('store_unavailable');
    if (record.linked) return { error: 'identity_linked' };
    const fill = {};
    if (anthropic && !record.keys.anthropic) fill.anthropic = anthropic;
    if (lichess && !record.keys.lichess) fill.lichess = lichess;
    const next = applyKeys(id, { ...record, data: usernameId, linked: usernameId }, fill);
    next.keys.seal = seal(id, 'seal', sealKey);
    const result = Number(await command('EVAL', LINK, 2, identityKey(id), linkKey(usernameId), raw, JSON.stringify(next), id));
    if (result === -1) return { error: 'account_linked' };
    if (result === 1) return { record: next };
  }
  throw new Error('store_unavailable');
}

// Move every envelope of one identity to the current KEK (key rotation). Returns
// true when the record changed.
export async function rewrapIdentity(id, ring = keyring()) {
  for (let attempt = 0; attempt < 3; attempt++) {
    const raw = await command('GET', identityKey(id));
    const record = parse(raw);
    if (!record) return false;
    const keys = Object.fromEntries(Object.entries(record.keys).map(([slot, envelope]) => [slot, rewrap(id, slot, envelope, ring)]));
    if (Object.keys(keys).every(slot => keys[slot] === record.keys[slot])) return false;
    if (await command('EVAL', CAS, 1, identityKey(id), raw, JSON.stringify({ ...record, keys }))) return true;
  }
  throw new Error('store_unavailable');
}
