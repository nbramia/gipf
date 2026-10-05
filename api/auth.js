// Auth0 sign-in for Games (server/auth0.js does the OIDC work).
//   GET  /api/auth/login?return=/<game>[&reauthenticate=1 | &silent=1 | &silent=home]
//        -> 302 to Auth0. With an Auth0 session already open (for example from
//           home.ramia.us), Auth0 returns straight to the callback without a prompt.
//           `silent` sends prompt=none, which never shows Auth0's login page: when
//           Auth0 has no session the callback returns quietly — to
//           /login?silent=failed&return=… for silent=1, or to the catalogue for
//           silent=home — so the page shows its ordinary Sign in button.
//   GET  /api/auth/callback -> verifies the code and ID token, requires a verified
//        email, creates the identity on first sign-in, sets `__Host-games_session`,
//        and returns to /login?signedin=1&return=… to finish on the device.
//   POST /api/auth/logout {everywhere?} -> revokes this session (or every session of
//        the identity) and clears the cookie. It does not end the Auth0 session, so
//        home.ramia.us stays signed in; see docs/public-accounts.md.
// Any sign-in failure returns to /login?error=… with no provider detail.
import { guardRequest, limit } from '../server/publicSecurity.js';
import { readSessionToken, resolveSession, revokeSession, revokeAllSessions, createSession, sameOriginRequest, sessionCookie, clearedSessionCookie, PRODUCTION_ORIGIN } from '../server/session.js';
import { authConfig, beginSignIn, completeSignIn, openTransaction, readCookie, safeReturn, transactionCookie, clearedTransactionCookie, TRANSACTION_COOKIE } from '../server/auth0.js';
import { identityId, readIdentity, ensureIdentity, CREATE_PER_NETWORK, CREATE_PER_DAY } from '../server/identity.js';
export const config = { api: { bodyParser: { sizeLimit: '1kb' } } };

const PRODUCTION_HOST = new URL(PRODUCTION_ORIGIN).host;

function back(res, query, cookies = [], path = '/login') {
  res.setHeader('Set-Cookie', [...cookies, clearedTransactionCookie()]);
  res.setHeader('Location', query ? `${path}?${query}` : path);
  return res.status(302).end();
}

// The OAuth errors prompt=none answers with when Auth0 would have to show something.
const SILENT_REFUSALS = ['login_required', 'consent_required', 'interaction_required'];

// A silent attempt that cannot complete returns to where it began, with no error.
function quietly(res, silent, returnTo) {
  return silent === 'home' ? back(res, '', [], '/') : back(res, `silent=failed&return=${encodeURIComponent(returnTo)}`);
}

async function login(req, res) {
  const returnTo = safeReturn(req.query?.return);
  const reauthenticate = req.query?.reauthenticate === '1';
  const silent = reauthenticate ? null : ({ 1: 'login', home: 'home' })[req.query?.silent] || null;
  const retry = () => silent ? quietly(res, silent, returnTo) : back(res, `error=unavailable&return=${encodeURIComponent(returnTo)}`);
  // Auth0 allows exactly one callback, on the production host; elsewhere sign-in cannot complete.
  if (process.env.VERCEL && req.headers.host !== PRODUCTION_HOST) return retry();
  let begun;
  try {
    begun = await beginSignIn(authConfig(), { returnTo, reauthenticate, silent });
  } catch (_) { return retry(); }
  res.setHeader('Set-Cookie', transactionCookie(begun.cookie));
  res.setHeader('Location', begun.url);
  return res.status(302).end();
}

async function callback(req, res) {
  let config;
  try { config = authConfig(); } catch (_) { return back(res, 'error=unavailable'); }
  const transaction = openTransaction(config.sessionSecret, readCookie(req, TRANSACTION_COOKIE));
  if (!transaction) return back(res, 'error=signin');
  const failed = `error=signin&return=${encodeURIComponent(transaction.returnTo)}`;
  const url = String(req.url || '');
  const search = url.includes('?') ? url.slice(url.indexOf('?')) : '';
  if (transaction.silent && SILENT_REFUSALS.includes(new URLSearchParams(search).get('error'))) {
    return quietly(res, transaction.silent, transaction.returnTo);
  }
  let claims;
  try {
    claims = await completeSignIn(config, transaction, search);
  } catch (_) { return back(res, failed); }
  if (typeof claims?.sub !== 'string' || !claims.sub || claims.email_verified !== true || typeof claims.email !== 'string') {
    return back(res, `error=unverified&return=${encodeURIComponent(transaction.returnTo)}`);
  }
  try {
    const id = identityId(config.issuer, claims.sub);
    // A first sign-in creates an identity that can hold megabytes of progress, so it
    // spends the same creation budgets that bounded the store before Auth0.
    if (!await readIdentity(id) &&
        (!await limit('account-create', req.network, CREATE_PER_NETWORK, 86400) || !await limit('account-create-all', 'all', CREATE_PER_DAY, 86400))) {
      return back(res, `error=busy&return=${encodeURIComponent(transaction.returnTo)}`);
    }
    const { record, created } = await ensureIdentity(id);
    const previous = readSessionToken(req);
    if (previous) await revokeSession(previous);
    const token = await createSession({ i: id, u: record.data, name: claims.email, fresh: created });
    return back(res, `signedin=1&return=${encodeURIComponent(transaction.returnTo)}`, [sessionCookie(token)]);
  } catch (_) { return back(res, failed); }
}

async function logout(req, res) {
  if (!sameOriginRequest(req)) return res.status(403).json({ error: 'forbidden' });
  try {
    const token = readSessionToken(req);
    let revoked = 0;
    if (req.body.everywhere === true) {
      const session = await resolveSession(token);
      if (!session) return res.status(401).json({ error: 'signed_out' });
      revoked = await revokeAllSessions(session.i);
    } else {
      await revokeSession(token);
    }
    res.setHeader('Set-Cookie', clearedSessionCookie());
    return res.status(200).json({ signedOut: true, revoked });
  } catch (_) { return res.status(503).json({ error: 'store_unavailable' }); }
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  const action = req.query?.action;
  const get = action === 'login' || action === 'callback';
  if (!get && action !== 'logout') return res.status(404).json({ error: 'not_found' });
  if (req.method !== (get ? 'GET' : 'POST')) return res.status(405).json({ error: 'method_not_allowed' });
  if (!await guardRequest(req, res, { bucket: get ? 'auth' : 'account', limit: get ? 30 : 20, maxBytes: 1024 })) return;
  if (action === 'login') return login(req, res);
  if (action === 'callback') return callback(req, res);
  return logout(req, res);
}
