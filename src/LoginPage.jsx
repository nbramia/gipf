import React, { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import {
  signInUrl,
  completeSignIn,
  saveAccountKeys,
  endServerSession,
  loadSession,
  clearSession,
  getSharedApiKey,
  setSharedApiKey,
  getSharedLichessToken,
  setSharedLichessToken,
  checkServerSession,
  SESSION_EXPIRED_KEY,
} from './account.js';
import { accountKeys } from './accountKeys.js';
import { games } from './games-registry.js';
import { safeReturn } from './loginReturn.js';
import { claimSilentAttempt, suppressSilentSignIn, allowSilentSignIn } from './silentSignIn.js';
import './landing.css';

// The guest-progress choice made before the Auth0 redirect, read when it returns.
const IMPORT_KEY = 'gipf:import-guest';
// Set by sign-out so the next visit says what signing in again will do.
const SIGNED_OUT_KEY = 'gipf:signed-out';

function takeFlag(key) {
  try { const value = sessionStorage.getItem(key); sessionStorage.removeItem(key); return value; } catch (_) { return null; }
}
function setFlag(key, value) {
  try { if (value) sessionStorage.setItem(key, value); else sessionStorage.removeItem(key); } catch (_) { /* optional */ }
}

const SIGN_IN_ERRORS = {
  unavailable: 'Sign-in is unavailable right now. You can keep playing as a guest.',
  signin: 'Sign-in did not complete. Try again.',
  unverified: 'Sign-in needs a verified email address. Verify it with your sign-in provider, then try again.',
  busy: 'New sign-ups are paused for today. Try again tomorrow, or keep playing as a guest.',
  device: 'Unable to finish signing in on this device. Check browser storage and try again.',
};

// The retired gated hosts never carried accounts of their own; sign-in lives on play.ramia.us.
const LEGACY_HOSTS = ['gipf.vercel.app', 'ramia.us', 'www.ramia.us'];

function anthropicWarning(value) {
  const v = value.trim();
  if (!v) return '';
  if (!v.startsWith('sk-ant-')) return 'Anthropic keys start with “sk-ant-”. Double-check what you pasted.';
  if (v.length < 40) return 'That looks too short to be a complete key.';
  return '';
}

// One secret slot (Anthropic key or Lichess token). As a guest a save stays on this
// device; signed in it is sent once to the account, which stores it encrypted on the
// server and never sends it back.
function SecretField({ id, label, placeholder, help, saved: initiallySaved, write, warn }) {
  const [saved, setSaved] = useState(initiallySaved);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const [status, setStatus] = useState('');
  useEffect(() => setSaved(initiallySaved), [initiallySaved]);
  const store = async value => {
    setStatus('Saving…');
    const result = await write(value);
    if (!result.ok) { setStatus(result.message); return; }
    setSaved(!!value);
    setDraft('');
    setEditing(false);
    setStatus(result.message);
  };
  const warning = warn ? warn(draft) : '';
  return (
    <div className="login-secret">
      <label htmlFor={id}>{label}</label>
      {saved && !editing ? (
        <div className="landing-actions">
          <span className="login-saved">Saved ✓</span>
          <button type="button" className="landing-button" onClick={() => setEditing(true)}>Change</button>
          <button type="button" className="landing-button" onClick={() => store('')}>Remove</button>
        </div>
      ) : (
        <form className="landing-password" onSubmit={e => { e.preventDefault(); if (draft.trim()) store(draft.trim()); }}>
          <input id={id} type="password" autoComplete="off" value={draft} onChange={e => setDraft(e.target.value)}
            placeholder={placeholder} className="landing-input" />
          <button type="submit" className="landing-button" disabled={!draft.trim()}>Save</button>
        </form>
      )}
      {warning && <p className="landing-error">{warning}</p>}
      {status && <p role="status" className="landing-help">{status}</p>}
      <p className="landing-help">{help}</p>
    </div>
  );
}

function Secrets({ account, keys }) {
  const device = (set) => async value => {
    set(value);
    return { ok: true, message: value ? 'Saved on this device.' : 'Removed from this device.' };
  };
  const onAccount = slot => async value => {
    const res = await saveAccountKeys({ [slot]: value || null });
    if (res.error) return { ok: false, message: res.error === 'network' ? 'Could not reach the server. Try again.' : 'Could not save to your account. Try again.' };
    return { ok: true, message: value ? 'Saved to your account.' : 'Removed from your account.' };
  };
  return (
    <section className="login-section" aria-labelledby="login-keys-title">
      <h2 id="login-keys-title">{account ? 'Keys on your account' : 'Keys on this device'}</h2>
      <p className="landing-help">
        {account
          ? 'Every game uses these keys on every device you sign in on. They are stored encrypted on our server and are never sent back to your browser.'
          : 'Without signing in, keys are saved on this device only. Every game on this device uses them.'}
      </p>
      <SecretField id="login-anthropic" label="Anthropic API key" placeholder="sk-ant-…"
        saved={account ? keys.anthropic : !!getSharedApiKey()} write={account ? onAccount('anthropic') : device(setSharedApiKey)} warn={anthropicWarning}
        help="Powers the Chess coach, the Catan and Splendor rules chat, and Diplomacy negotiation. Model requests send your key through our server to Anthropic." />
      <SecretField id="login-lichess" label="Lichess token" placeholder="lip_…"
        saved={account ? keys.lichess : !!getSharedLichessToken()} write={account ? onAccount('lichess') : device(setSharedLichessToken)}
        help={account ? 'Optional, read-only. Adds master-game statistics to Chess openings. Our server sends it only to Lichess.' : 'Optional, read-only. Adds master-game statistics to Chess openings. Sent only to Lichess.'} />
    </section>
  );
}

export default function LoginPage() {
  const [params] = useSearchParams();
  const returnTo = safeReturn(params.get('return'));
  const returnGame = games.find(game => game.path === returnTo);
  const arriving = params.get('signedin') === '1';
  const signInError = SIGN_IN_ERRORS[params.get('error')] || '';
  const [account] = useState(() => arriving ? null : loadSession());
  const completing = arriving;
  // Not signed in to Games: try the ramia.us session first, without a click (once; see
  // silentSignIn.js). A refused attempt returns with ?silent=failed to the Sign in button.
  const [trying] = useState(() => !arriving && !account && !params.get('error') && !params.get('silent') &&
    !LEGACY_HOSTS.includes(window.location.hostname) && claimSilentAttempt('login'));
  const [keys, setKeys] = useState(() => accountKeys());
  const [confirmingSignOut, setConfirmingSignOut] = useState(false);
  const [importGuest, setImportGuest] = useState(false);
  const [error, setError] = useState('');
  const notice = params.get('keys') === 'unmoved' ? 'This device’s keys could not be moved to your account. Add them again below.' : '';
  const [ended] = useState(() => takeFlag(SESSION_EXPIRED_KEY));
  const [signedOut] = useState(() => takeFlag(SIGNED_OUT_KEY));

  // A full load resets every game's in-memory state for the new identity (and the
  // account boundary, which stops at any identity change made under it).
  const leave = () => window.location.assign(`${process.env.PUBLIC_URL || ''}${returnTo}`);
  const reloadLogin = query => window.location.replace(`${process.env.PUBLIC_URL || ''}/login?${query}&return=${encodeURIComponent(returnTo)}`);

  useEffect(() => {
    if (trying) window.location.replace(signInUrl(returnTo, { silent: 'login' }));
  }, []);

  // Back from Auth0: switch this device to the signed-in account, then load afresh.
  useEffect(() => {
    if (!arriving) return;
    (async () => {
      let result;
      try {
        result = await completeSignIn({ importGuest: takeFlag(IMPORT_KEY) === '1' });
      } catch (_) {
        await endServerSession();
        reloadLogin('error=device');
        return;
      }
      if (!result.keysMoved) reloadLogin('keys=unmoved');
      else leave();
    })();
  }, []);

  // Signed in: which keys the account holds.
  useEffect(() => {
    if (!account || completing) return;
    let cancelled = false;
    checkServerSession().then(res => {
      if (cancelled || typeof res !== 'object' || res.u !== account.usernameId) return;
      setKeys(res.keys);
    });
    return () => { cancelled = true; };
  }, [account, completing]);

  const startSignIn = ({ reauthenticate = false } = {}) => {
    setFlag(IMPORT_KEY, importGuest ? '1' : '');
    allowSilentSignIn();
    window.location.assign(signInUrl(returnTo, { reauthenticate }));
  };

  const confirmSignOut = async () => {
    const everywhere = confirmingSignOut === 'everywhere';
    setConfirmingSignOut(false);
    try { await clearSession({ everywhere }); } catch (_) { setError('Unable to sign out safely. Check browser storage and try again.'); return; }
    setFlag(SIGNED_OUT_KEY, '1');
    suppressSilentSignIn();
    window.location.reload();
  };

  const back = (
    <Link to={returnTo} className="login-back">
      {returnGame ? `← Back to ${returnGame.name.toLowerCase()}` : '← All games'}
    </Link>
  );

  if (LEGACY_HOSTS.includes(window.location.hostname)) {
    return (
      <main className="landing-page"><div className="landing-shell login-shell">
        {back}
        <h1 className="login-title">Sign in</h1>
        <p className="landing-help">Accounts and keys are managed at <a href="https://play.ramia.us/login">play.ramia.us</a>. Use play.ramia.us to sign in.</p>
      </div></main>
    );
  }

  if (completing || trying) {
    return (
      <main className="landing-page"><div className="landing-shell login-shell">
        <h1 className="login-title">Signing in…</h1>
        <p role="status" className="landing-help">{trying ? 'Checking for your ramia.us sign-in.' : 'Setting up this device for your account.'}</p>
      </div></main>
    );
  }

  return (
    <main className="landing-page">
      <div className="landing-shell login-shell">
        {back}
        <h1 className="login-title">{account ? 'Your account' : 'Sign in'}</h1>
        {account ? (
          <section className="login-section" aria-label="Account">
            {confirmingSignOut ? (
              <div className="landing-confirm">
                <p className="landing-confirm-title">
                  {confirmingSignOut === 'everywhere' ? 'Sign out everywhere' : 'Sign out'} of <span className="landing-identity">{account.username}</span>?
                </p>
                <p className="landing-help">
                  Games signs out on this device, in every tab. Unsynced progress stays encrypted for this account; sign in again to recover it.
                  {confirmingSignOut === 'everywhere' && ' Every other device signed in to Games with this account is signed out too.'}
                  {' '}Your ramia.us sign-in, which home.ramia.us also uses, stays signed in.
                </p>
                <div className="landing-actions">
                  <button type="button" onClick={() => setConfirmingSignOut(false)} className="landing-button">Cancel</button>
                  <button type="button" onClick={confirmSignOut} className="landing-button landing-primary">
                    {confirmingSignOut === 'everywhere' ? 'Sign out everywhere' : 'Sign out'}
                  </button>
                </div>
              </div>
            ) : (
              <div className="landing-signed-in">
                <span className="landing-identity">Signed in as {account.username}</span>
                <div className="landing-actions">
                  <button type="button" onClick={() => setConfirmingSignOut(true)} className="landing-button">Sign out</button>
                  <button type="button" onClick={() => setConfirmingSignOut('everywhere')} className="landing-button">Sign out everywhere</button>
                </div>
              </div>
            )}
            {notice && <p role="status" className="landing-warning">{notice}</p>}
            {error && <p role="alert" className="landing-error">{error}</p>}
          </section>
        ) : (
          <section className="login-section" aria-label="Sign in">
            {ended === 'auth0' && <p role="status" className="landing-warning">Games now signs in with your ramia.us account. Sign in to carry your keys and progress between devices.</p>}
            {ended === 'expired' && <p role="status" className="landing-warning">Your session ended. Sign in again to pick up where you left off.</p>}
            {signedOut && <p role="status" className="landing-help">Signed out of Games. You are still signed in to ramia.us, so signing in again will not ask for a password; to use another account, choose “Use a different account”.</p>}
            {signInError && <p role="alert" className="landing-error">{signInError}</p>}
            {error && <p role="alert" className="landing-error">{error}</p>}
            <p className="landing-help">Optional. Every game can be played as a guest. Signing in carries your keys and progress between devices.</p>
            <p className="landing-help">Sign in with your ramia.us account — Google, or email and password. Already signed in at home.ramia.us? It takes one click.</p>
            <label className="landing-import"><input type="checkbox" checked={importGuest} onChange={e => setImportGuest(e.target.checked)} /> Import this device's guest progress when signing in</label>
            <div className="landing-actions">
              <button type="button" className="landing-button landing-primary" onClick={() => startSignIn()}>Sign in</button>
              <button type="button" className="landing-button" onClick={() => startSignIn({ reauthenticate: true })}>Use a different account</button>
            </div>
          </section>
        )}
        <Secrets account={account} keys={keys} />
      </div>
    </main>
  );
}
