// Auth0 sign-in for play.ramia.us: OpenID Connect authorization code flow with PKCE,
// state and nonce (openid-client), client_secret_post, RS256 ID tokens whose
// signatures are checked against the tenant's JWKS as well as their claims.
//
// Configuration fails closed: without every variable below, sign-in is unavailable
// and nothing else changes — guests keep playing.
//   AUTH0_ISSUER_BASE_URL  the tenant, e.g. https://<tenant>.us.auth0.com
//   AUTH0_CLIENT_ID, AUTH0_CLIENT_SECRET  play's own Regular Web Application
//   GAMES_SESSION_SECRET   32+ characters; encrypts the short-lived sign-in
//                          transaction cookie between /api/auth/login and the callback
import * as client from 'openid-client';
import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from 'node:crypto';
import { PRODUCTION_ORIGIN } from './session.js';
import { games } from '../src/games-registry.js';

export const CALLBACK_URL = `${PRODUCTION_ORIGIN}/api/auth/callback`;
export const TRANSACTION_COOKIE = '__Host-games_auth';
export const TRANSACTION_MS = 10 * 60000;

export class AuthUnavailable extends Error {
  constructor() { super('sign_in_unavailable'); }
}

export function authConfig(env = process.env) {
  const value = env.AUTH0_ISSUER_BASE_URL;
  let issuer;
  try { issuer = new URL(value); } catch (_) { throw new AuthUnavailable(); }
  if (issuer.protocol !== 'https:' || issuer.username || issuer.password || !['', '/'].includes(issuer.pathname) || issuer.search || issuer.hash) throw new AuthUnavailable();
  const config = { issuer: issuer.origin, clientId: env.AUTH0_CLIENT_ID, clientSecret: env.AUTH0_CLIENT_SECRET, sessionSecret: env.GAMES_SESSION_SECRET };
  if (!config.clientId || !config.clientSecret || typeof config.sessionSecret !== 'string' || config.sessionSecret.length < 32) throw new AuthUnavailable();
  return config;
}

// `?return=` accepts only an exact game route from the registry, otherwise the
// catalogue — the same rule as src/loginReturn.js, so sign-in is never an open redirect.
export function safeReturn(raw) {
  return games.some(game => game.path === raw) ? raw : '/';
}

// Discovery is cached per warm instance; a failure is forgotten so the next request retries.
let discovered = null;
export function resetDiscovery() { discovered = null; }
export async function oidcClient(config) {
  const key = `${config.issuer}|${config.clientId}`;
  if (discovered?.key !== key) {
    const promise = client.discovery(new URL(config.issuer), config.clientId,
      { client_secret: config.clientSecret, id_token_signed_response_alg: 'RS256' },
      client.ClientSecretPost(config.clientSecret), { timeout: 5 })
      .then(oidc => { client.enableNonRepudiationChecks(oidc); return oidc; });
    discovered = { key, promise };
    promise.catch(() => { if (discovered?.promise === promise) discovered = null; });
  }
  return discovered.promise;
}

// ---- transaction cookie: state, nonce, PKCE verifier and return path, sealed ----

const transactionKey = secret => Buffer.from(hkdfSync('sha256', secret, 'gipf-games', 'auth-transaction:v1', 32));

export function sealTransaction(secret, payload) {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', transactionKey(secret), iv);
  const ct = Buffer.concat([cipher.update(JSON.stringify(payload), 'utf8'), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), ct]).toString('base64url');
}

export function openTransaction(secret, value, now = Date.now()) {
  try {
    const raw = Buffer.from(String(value), 'base64url');
    if (raw.length < 29) return null;
    const decipher = createDecipheriv('aes-256-gcm', transactionKey(secret), raw.subarray(0, 12));
    decipher.setAuthTag(raw.subarray(12, 28));
    const payload = JSON.parse(Buffer.concat([decipher.update(raw.subarray(28)), decipher.final()]).toString('utf8'));
    if (!(payload.expires > now) || ![payload.state, payload.nonce, payload.verifier].every(v => typeof v === 'string' && v)) return null;
    return { ...payload, returnTo: safeReturn(payload.returnTo), silent: SILENT_ORIGINS.includes(payload.silent) ? payload.silent : null };
  } catch (_) { return null; }
}

export function readCookie(req, name) {
  const header = req.headers?.cookie;
  if (typeof header !== 'string') return null;
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i > 0 && part.slice(0, i).trim() === name) return part.slice(i + 1).trim();
  }
  return null;
}

export const transactionCookie = value => `${TRANSACTION_COOKIE}=${value}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${TRANSACTION_MS / 1000}`;
export const clearedTransactionCookie = () => `${TRANSACTION_COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`;

// Where a silent attempt began: its failure returns there quietly.
export const SILENT_ORIGINS = ['login', 'home'];

// The provider URL that starts a sign-in, and the transaction cookie that must come
// back with its callback. `reauthenticate` asks Auth0 for credentials even when its
// own session would sign the user in silently. `silent` ('login' or 'home') sends
// prompt=none: Auth0 either signs in from its own session (for example from
// home.ramia.us) or returns an error without showing anything; `reauthenticate` wins.
export async function beginSignIn(config, { returnTo = '/', reauthenticate = false, silent = null, now = Date.now() } = {}) {
  const quiet = !reauthenticate && SILENT_ORIGINS.includes(silent) ? silent : null;
  const oidc = await oidcClient(config);
  const verifier = client.randomPKCECodeVerifier();
  const state = client.randomState();
  const nonce = client.randomNonce();
  const url = client.buildAuthorizationUrl(oidc, {
    redirect_uri: CALLBACK_URL,
    response_type: 'code',
    scope: 'openid email profile',
    code_challenge: await client.calculatePKCECodeChallenge(verifier),
    code_challenge_method: 'S256',
    state,
    nonce,
    ...(reauthenticate ? { prompt: 'login' } : quiet ? { prompt: 'none' } : {}),
  });
  const cookie = sealTransaction(config.sessionSecret, { state, nonce, verifier, returnTo: safeReturn(returnTo), ...(quiet ? { silent: quiet } : {}), expires: now + TRANSACTION_MS });
  return { url: url.href, cookie };
}

// Exchange the callback's code and validate the ID token. Returns the verified
// claims; throws on any mismatch (state, nonce, issuer, audience, signature, expiry).
export async function completeSignIn(config, transaction, search) {
  const oidc = await oidcClient(config);
  const tokens = await client.authorizationCodeGrant(oidc, new URL(`${CALLBACK_URL}${search}`), {
    pkceCodeVerifier: transaction.verifier,
    expectedState: transaction.state,
    expectedNonce: transaction.nonce,
    idTokenExpected: true,
  });
  return tokens.claims();
}
