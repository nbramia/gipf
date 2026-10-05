import React, { useEffect, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import {
  deriveCredentials,
  encryptApiKey,
  decryptApiKey,
  createAccount,
  loginAccount,
  pushEncryptedKey,
  loadSession,
  saveSession,
  clearSession,
  getSharedApiKey,
  setSharedApiKey,
  getSharedLichessToken,
  setSharedLichessToken,
} from './account.js';
import { games } from './games-registry.js';
import { safeReturn } from './loginReturn.js';
import './landing.css';

export const MIN_NEW_PASSWORD = 6;

// The retired gated hosts never carried accounts of their own; sign-in lives on play.ramia.us.
const LEGACY_HOSTS = ['gipf.vercel.app', 'ramia.us', 'www.ramia.us'];

function anthropicWarning(value) {
  const v = value.trim();
  if (!v) return '';
  if (!v.startsWith('sk-ant-')) return 'Anthropic keys start with “sk-ant-”. Double-check what you pasted.';
  if (v.length < 40) return 'That looks too short to be a complete key.';
  return '';
}

// One secret slot (Anthropic key or Lichess token). Signed in, a save is encrypted
// under the account key and synced; as a guest it stays on this device only.
function SecretField({ id, label, placeholder, help, read, write, sync, warn }) {
  const [saved, setSaved] = useState(() => !!read());
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const [status, setStatus] = useState('');
  const store = async value => {
    write(value);
    setSaved(!!value);
    setDraft('');
    setEditing(false);
    if (!sync) { setStatus(value ? 'Saved on this device.' : 'Removed from this device.'); return; }
    setStatus('Saving…');
    setStatus(await sync(value) ? (value ? 'Saved and synced to your account.' : 'Removed from your account.')
      : 'Saved on this device; syncing to your account failed. Try again later.');
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

function Secrets({ account }) {
  const sync = field => account ? async value => {
    try {
      const sealed = value ? await encryptApiKey(account.aesKey, value) : null;
      return await pushEncryptedKey({ usernameId: account.usernameId, authToken: account.authToken, [field]: sealed });
    } catch (_) { return false; }
  } : null;
  return (
    <section className="login-section" aria-labelledby="login-keys-title">
      <h2 id="login-keys-title">{account ? 'Keys on your account' : 'Keys on this device'}</h2>
      <p className="landing-help">
        {account
          ? 'Every game uses these keys. They are encrypted with your password before they leave this device.'
          : 'Without an account, keys are saved on this device only. Every game on this device uses them.'}
      </p>
      <SecretField id="login-anthropic" label="Anthropic API key" placeholder="sk-ant-…"
        read={getSharedApiKey} write={setSharedApiKey} sync={sync('enc')} warn={anthropicWarning}
        help="Powers the Chess coach, the Catan and Splendor rules chat, and Diplomacy negotiation. Model requests send your key through our server to Anthropic." />
      <SecretField id="login-lichess" label="Lichess token" placeholder="lip_…"
        read={getSharedLichessToken} write={setSharedLichessToken} sync={sync('encLichess')}
        help="Optional, read-only. Adds master-game statistics to Chess openings. Sent only to Lichess." />
    </section>
  );
}

export default function LoginPage() {
  const [params] = useSearchParams();
  const returnTo = safeReturn(params.get('return'));
  const returnGame = games.find(game => game.path === returnTo);
  const [account] = useState(() => loadSession());
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [password2, setPassword2] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [creatingAccount, setCreatingAccount] = useState(false);
  const [confirmingSignOut, setConfirmingSignOut] = useState(false);
  const [importGuest, setImportGuest] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const usernameRef = useRef(null);
  useEffect(() => { if (!account) usernameRef.current?.focus(); }, [account]);

  // A full load resets every game's in-memory state for the new identity.
  const leave = () => window.location.assign(`${process.env.PUBLIC_URL || ''}${returnTo}`);

  const confirmSignOut = async () => {
    setConfirmingSignOut(false);
    try { await clearSession(); } catch (_) { setError('Unable to sign out safely. Check browser storage and try again.'); return; }
    window.location.reload();
  };

  const handleCreateAccount = async () => {
    const name = username.trim();
    if (!name || password.length < MIN_NEW_PASSWORD) {
      setError(!name ? 'Enter a username.' : `Password must be at least ${MIN_NEW_PASSWORD} characters.`);
      return;
    }
    if (password !== password2) { setError("Those passwords don't match."); return; }
    setBusy(true);
    setError('');
    try {
      const creds = await deriveCredentials(name, password);
      if (!creds) { setError("Your browser doesn't support the required crypto."); return; }
      const currentKey = getSharedApiKey();
      const enc = currentKey ? await encryptApiKey(creds.aesKey, currentKey) : null;
      const currentLichess = getSharedLichessToken();
      const encLichess = currentLichess ? await encryptApiKey(creds.aesKey, currentLichess) : null;
      let res;
      try {
        res = await createAccount({ usernameId: creds.usernameId, authToken: creds.authToken, enc, encLichess });
      } catch (_) { setError('Network error — try again.'); return; }
      if (res.configured === false) { setError("Accounts aren't configured on the server."); return; }
      if (res.error === 'taken') { setError('That username is taken.'); return; }
      if (res.error) { setError(res.message || 'Something went wrong.'); return; }
      await saveSession(creds, { importGuest, apiKey: currentKey, lichessToken: currentLichess });
      leave();
    } catch (_) {
      setError('Unable to switch accounts safely. Check browser storage and try again.');
    } finally {
      setBusy(false);
    }
  };

  const handleSignIn = async () => {
    const name = username.trim();
    if (!name || !password) { setError('Enter a username and password.'); return; }
    setBusy(true);
    setError('');
    try {
      const creds = await deriveCredentials(name, password);
      if (!creds) { setError("Your browser doesn't support the required crypto."); return; }
      let res;
      try {
        res = await loginAccount({ usernameId: creds.usernameId, authToken: creds.authToken });
      } catch (_) { setError('Network error — try again.'); return; }
      if (res.configured === false) { setError("Accounts aren't configured on the server."); return; }
      if (res.error === 'bad_credentials') { setError('Wrong username or password.'); return; }
      if (res.error) { setError(res.message || 'Something went wrong.'); return; }
      let apiKey = '';
      let lichessToken = '';
      if (res.enc) {
        try { apiKey = await decryptApiKey(creds.aesKey, res.enc); } catch (_) { setError('Wrong username or password.'); return; }
      }
      if (res.encLichess) {
        try { lichessToken = await decryptApiKey(creds.aesKey, res.encLichess); } catch (_) { setError('Could not unlock the saved Lichess token.'); return; }
      }
      await saveSession(creds, { importGuest, apiKey, lichessToken });
      leave();
    } catch (_) {
      setError('Unable to switch accounts safely. Check browser storage and try again.');
    } finally {
      setBusy(false);
    }
  };

  const submitAccount = event => {
    event.preventDefault();
    if (busy || !username.trim() || !password) return;
    if (creatingAccount) handleCreateAccount();
    else handleSignIn();
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

  return (
    <main className="landing-page">
      <div className="landing-shell login-shell">
        {back}
        <h1 className="login-title">{account ? 'Your account' : creatingAccount ? 'Create account' : 'Sign in'}</h1>
        {account ? (
          <section className="login-section" aria-label="Account">
            {confirmingSignOut ? (
              <div className="landing-confirm">
                <p className="landing-confirm-title">Sign out of <span className="landing-identity">{account.username}</span>?</p>
                <p className="landing-help">
                  Keys and credentials are removed from this device, in every tab. Unsynced progress stays encrypted for this account; sign in again to recover it.
                </p>
                <div className="landing-actions">
                  <button type="button" onClick={() => setConfirmingSignOut(false)} className="landing-button">Cancel</button>
                  <button type="button" onClick={confirmSignOut} className="landing-button landing-primary">Sign out</button>
                </div>
              </div>
            ) : (
              <div className="landing-signed-in">
                <span className="landing-identity">Signed in as {account.username}</span>
                <button type="button" onClick={() => setConfirmingSignOut(true)} className="landing-button">Sign out</button>
              </div>
            )}
            {error && <p role="alert" className="landing-error">{error}</p>}
          </section>
        ) : (
          <section className="login-section" aria-label="Sign in or create an account">
            <p className="landing-help">Optional. Every game can be played as a guest. An account carries your keys and progress between devices.</p>
            <form className="landing-form" onSubmit={submitAccount}>
              <div className="landing-fields">
                <label htmlFor="landing-username">Username</label>
                <input ref={usernameRef} id="landing-username" autoComplete="username" type="text" value={username}
                  onChange={e => setUsername(e.target.value)} placeholder="Username" className="landing-input" />
                <label htmlFor="landing-password">Password</label>
                <div className="landing-password">
                  <input id="landing-password" autoComplete={creatingAccount ? 'new-password' : 'current-password'}
                    type={showPassword ? 'text' : 'password'} value={password} onChange={e => setPassword(e.target.value)}
                    placeholder="Password" className="landing-input" />
                  <button type="button" onClick={() => setShowPassword(v => !v)}
                    aria-label={showPassword ? 'Hide password' : 'Show password'} className="landing-button">
                    {showPassword ? 'Hide' : 'Show'}
                  </button>
                </div>
                {/* There is no password reset, so a typo at creation is an unrecoverable account. */}
                {creatingAccount && (
                  <>
                    <label htmlFor="landing-password-confirm">Confirm password</label>
                    <input id="landing-password-confirm" autoComplete="new-password" type={showPassword ? 'text' : 'password'}
                      value={password2} onChange={e => setPassword2(e.target.value)} placeholder="Confirm password" className="landing-input" />
                  </>
                )}
                <label className="landing-import"><input type="checkbox" checked={importGuest} onChange={e => setImportGuest(e.target.checked)} /> Import this device's guest progress when signing in</label>
                {error && <p role="alert" className="landing-error">{error}</p>}
                <div className="landing-actions">
                  <button type={creatingAccount ? 'button' : 'submit'}
                    onClick={creatingAccount ? () => { setCreatingAccount(false); handleSignIn(); } : undefined}
                    disabled={busy || !username.trim() || !password} className="landing-button">
                    Sign in
                  </button>
                  <button type={creatingAccount ? 'submit' : 'button'}
                    onClick={creatingAccount ? undefined : () => { setCreatingAccount(true); setError(''); }}
                    disabled={busy || !username.trim() || !password} className="landing-button">
                    {busy ? 'Working…' : 'Create account'}
                  </button>
                </div>
                {creatingAccount && (
                  <p className="landing-warning">
                    There is no password reset and no email on file. If you forget this password,
                    the account — and everything in it — is gone for good. Save it somewhere.
                  </p>
                )}
                <p className="landing-privacy">
                  Your password never leaves this device: the account service stores only an unreadable hash,
                  and your keys only as ciphertext it cannot decrypt. Usernames aren&rsquo;t case-sensitive.
                </p>
              </div>
            </form>
          </section>
        )}
        <Secrets account={account} />
      </div>
    </main>
  );
}
