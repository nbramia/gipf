import React, { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  deriveCredentials,
  encryptApiKey,
  decryptApiKey,
  createAccount,
  loginAccount,
  loadSession,
  saveSession,
  clearSession,
  getSharedApiKey,
  getSharedLichessToken,
} from './account';

import { games } from './games-registry.js';
import './landing.css';

// Small decorative studies of the pieces, not playable boards or saved positions.
function BoardMotif({ path }) {
  return (
    <svg className="landing-motif" viewBox="0 0 120 96" aria-hidden="true" focusable="false">
      {path === '/yinsh' ? <>
        <path d="M20 28h80M10 48h100M20 68h80M30 12l42 72M54 8l42 72M12 40l24 42M90 12L48 84M66 8L24 80M108 40L84 82" fill="none" stroke="currentColor" opacity=".25" />
        <g fill="none" stroke="currentColor" strokeWidth="5"><circle cx="42" cy="28" r="10" /><circle cx="78" cy="68" r="10" /></g>
        <circle cx="54" cy="48" r="6" fill="currentColor" />
      </> : path === '/zertz' ? <>
        {[[-1, 0], [0, 0], [1, 0], [-.5, -1], [.5, -1], [-.5, 1], [.5, 1]].map(([x, y], i) => <circle key={i} cx={60 + x * 30} cy={48 + y * 26} r="12" fill="none" stroke="currentColor" strokeWidth="3" opacity=".5" />)}
        <circle cx="45" cy="22" r="8" fill="currentColor" /><circle cx="75" cy="74" r="8" fill="currentColor" />
      </> : path === '/chess' ? <>
        {[0, 1, 2, 3].map(row => [0, 1, 2, 3].map(col => <rect key={`${row}-${col}`} x={24 + col * 18} y={12 + row * 18} width="18" height="18" fill="currentColor" opacity={(row + col) % 2 ? '.25' : '.07'} />))}
        <path d="M48 69h29l-5-9V43l-11-9-13 13 9 3-5 10z" fill="currentColor" /><circle cx="62" cy="42" r="2" fill="white" />
      </> : path === '/catan' ? <>
        <g fill="currentColor" fillOpacity=".12" stroke="currentColor" strokeWidth="2"><path d="M40 12l19 11v22L40 56 21 45V23z" /><path d="M80 12l19 11v22L80 56 61 45V23z" /><path d="M60 47l19 11v22L60 91 41 80V58z" /></g>
        <path d="M50 42l10-9 10 9v13H50z" fill="currentColor" />
      </> : path === '/splendor' ? <>
        <rect x="57" y="15" width="39" height="58" rx="4" fill="none" stroke="currentColor" strokeWidth="2" />
        <path d="M67 34l10-8 10 8-10 15z" fill="currentColor" opacity=".6" />
        {[27, 43, 59].map((x, i) => <circle key={x} cx={x} cy={64 + i * 3} r="13" fill="var(--landing-paper)" stroke="currentColor" strokeWidth="3" />)}
      </> : <>
        <path d="M15 26l27-12 24 13 36-5M15 26l10 35 29 20 22-20 26-39M42 14l-2 32 36 15M40 46L25 61M66 27L54 81" fill="none" stroke="currentColor" strokeWidth="2" opacity=".4" />
        <path d="M61 51h30l-8 10H69zM76 28v22h-12z" fill="currentColor" /><circle cx="36" cy="37" r="7" fill="currentColor" />
      </>}
    </svg>
  );
}

export default function LandingPage() {
  const [account, setAccount] = useState(() => loadSession());
  const [open, setOpen] = useState(false);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [password2, setPassword2] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [creatingAccount, setCreatingAccount] = useState(false);
  const [confirmingSignOut, setConfirmingSignOut] = useState(false);
  const [importGuest, setImportGuest] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const closeForm = () => {
    setOpen(false);
    setUsername('');
    setPassword('');
    setPassword2('');
    setCreatingAccount(false);
    setError('');
  };

  // Retain encrypted recovery before clearing this device.
  const handleSignOut = () => setConfirmingSignOut(true);
  const confirmSignOut = async () => {
    setConfirmingSignOut(false);
    await clearSession();
    window.location.reload();
    setAccount(null);
  };

  const handleCreateAccount = async () => {
    const name = username.trim();
    if (!name || password.length < 6) {
      setError(!name ? 'Enter a username.' : 'Password must be at least 6 characters.');
      return;
    }
    if (password !== password2) {
      setError("Those passwords don't match.");
      return;
    }
    setBusy(true);
    setError('');
    try {
      const creds = await deriveCredentials(name, password);
      if (!creds) {
        setError("Your browser doesn't support the required crypto.");
        return;
      }
      const currentKey = getSharedApiKey();
      const enc = currentKey ? await encryptApiKey(creds.aesKey, currentKey) : null;
      const currentLichess = getSharedLichessToken();
      const encLichess = currentLichess ? await encryptApiKey(creds.aesKey, currentLichess) : null;
      let res;
      try {
        res = await createAccount({ usernameId: creds.usernameId, authToken: creds.authToken, enc, encLichess });
      } catch (_) {
        setError('Network error — try again.');
        return;
      }
      if (res.configured === false) {
        setError("Accounts aren't configured on the server.");
        return;
      }
      if (res.error === 'taken') {
        setError('That username is taken.');
        return;
      }
      if (res.error) {
        setError(res.message || 'Something went wrong.');
        return;
      }
      // No profile merge here — chess performs the profile merge itself on
      // its next mount, once it sees this session.
      await saveSession(creds, { importGuest, apiKey: currentKey, lichessToken: currentLichess });
      window.location.reload();
      setAccount(creds);
      closeForm();
    } catch (_) {
      setError('Unable to switch accounts safely. Check browser storage and try again.');
    } finally {
      setBusy(false);
    }
  };

  const handleSignIn = async () => {
    const name = username.trim();
    if (!name || !password) {
      setError('Enter a username and password.');
      return;
    }
    setBusy(true);
    setError('');
    try {
      const creds = await deriveCredentials(name, password);
      if (!creds) {
        setError("Your browser doesn't support the required crypto.");
        return;
      }
      let res;
      try {
        res = await loginAccount({ usernameId: creds.usernameId, authToken: creds.authToken });
      } catch (_) {
        setError('Network error — try again.');
        return;
      }
      if (res.configured === false) {
        setError("Accounts aren't configured on the server.");
        return;
      }
      if (res.error === 'no_account') {
        setError('No account with that username.');
        return;
      }
      if (res.error === 'bad_credentials') {
        setError('Wrong username or password.');
        return;
      }
      if (res.error) {
        setError(res.message || 'Something went wrong.');
        return;
      }
      let restoredKey = '';
      let restoredLichess = '';
      if (res.enc) {
        let key;
        try {
          key = await decryptApiKey(creds.aesKey, res.enc);
        } catch (_) {
          setError('Wrong username or password.');
          return;
        }
        restoredKey = key;
      }
      if (res.encLichess) {
        try {
          const token = await decryptApiKey(creds.aesKey, res.encLichess);
          restoredLichess = token;
        } catch (_) {
          setError('Could not unlock the saved Lichess token.'); return;
        }
      }
      // No profile merge here — chess performs the profile merge itself on
      // its next mount, once it sees this session.
      await saveSession(creds, { importGuest, apiKey: restoredKey, lichessToken: restoredLichess });
      window.location.reload();
      setAccount(creds);
      closeForm();
    } catch (_) {
      setError('Unable to switch accounts safely. Check browser storage and try again.');
    } finally {
      setBusy(false);
    }
  };

  const launcherRef = useRef(null);
  const usernameRef = useRef(null);
  const wasOpen = useRef(false);
  useEffect(() => {
    if (open) usernameRef.current?.focus();
    else if (wasOpen.current) launcherRef.current?.focus();
    wasOpen.current = open;
  }, [open]);

  const submitAccount = (event) => {
    event.preventDefault();
    if (busy || !username.trim() || !password) return;
    if (creatingAccount) handleCreateAccount();
    else handleSignIn();
  };

  return (
    <main className="landing-page">
      <div className="landing-shell">
        <header className="landing-header">
          <h1>Games</h1>
          <div><p>A good move starts here.</p><p>Board games for your browser. Choose a game and play as a guest.</p></div>
        </header>
        <nav className="landing-catalogue" aria-label="Choose a game">
          {games.map((game) => (
            <Link key={game.path} to={game.path} className={`landing-game landing-game-${game.path.slice(1)}`} aria-label={`Play ${game.name}`}>
              <BoardMotif path={game.path} />
              <div className="landing-game-copy"><h2>{game.name}</h2><p>{game.description}</p><span className="landing-play">Play {game.name.toLowerCase()}</span></div>
            </Link>
          ))}
        </nav>
      <section className="landing-account" aria-labelledby="landing-account-title">
        <div className="landing-account-intro"><h2 id="landing-account-title">Your account</h2><p>Optional. Use your existing username and password, or create an account.</p><p>You can play without signing in.</p></div>
        <div className="landing-account-controls">
        {account ? (
          confirmingSignOut ? (
            <div className="landing-confirm">
              <p className="landing-confirm-title">
                Sign out of <span className="landing-identity">{account.username}</span>?
              </p>
              <p className="landing-help">
                Credentials are removed. Unsynced progress stays encrypted for this account; sign in again to recover it.
              </p>
              <div className="landing-actions">
                <button
                  type="button"
                  onClick={() => setConfirmingSignOut(false)}
                  className="landing-button"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={confirmSignOut}
                  className="landing-button landing-primary"
                >
                  Sign out
                </button>
              </div>
            </div>
          ) : (
            <div className="landing-signed-in">
              <span className="landing-identity">
                Signed in as {account.username}
              </span>
              <button
                type="button"
                onClick={handleSignOut}
                className="landing-button"
              >
                Sign out
              </button>
            </div>
          )
        ) : !open ? (
          <button
            type="button"
            onClick={() => setOpen(true)}
            ref={launcherRef}
            className="landing-button"
          >
            Sign in / Create account
          </button>
        ) : (
          <form className="landing-form" onSubmit={submitAccount}>
            <div className="landing-form-header">
              <h3 className="landing-form-title">{creatingAccount ? 'Create account' : 'Sign in'}</h3>
              <button
                type="button"
                onClick={closeForm}
                className="landing-button"
              >
                Cancel
              </button>
            </div>
            <div className="landing-fields">
              <label htmlFor="landing-username">Username</label>
              <input
                ref={usernameRef}
                id="landing-username"
                autoComplete="username"
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="Username"
                className="landing-input"
              />
              <label htmlFor="landing-password">Password</label>
              <div className="landing-password">
                <input
                  id="landing-password"
                  autoComplete={creatingAccount ? 'new-password' : 'current-password'}
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Password"
                  className="landing-input"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((v) => !v)}
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                  className="landing-button"
                >
                  {showPassword ? 'Hide' : 'Show'}
                </button>
              </div>
              {/* There is no password reset, so a typo at creation is an
                  unrecoverable account. Confirm it. */}
              {creatingAccount && (
                <>
                <label htmlFor="landing-password-confirm">Confirm password</label>
                <input
                  id="landing-password-confirm"
                  autoComplete="new-password"
                  type={showPassword ? 'text' : 'password'}
                  value={password2}
                  onChange={(e) => setPassword2(e.target.value)}
                  placeholder="Confirm password"
                  className="landing-input"
                />
                </>
              )}
              <label className="landing-import"><input type="checkbox" checked={importGuest} onChange={e => setImportGuest(e.target.checked)} /> Import this device's guest progress when signing in</label>
              {error && <p role="alert" className="landing-error">{error}</p>}
              <div className="landing-actions">
                <button
                  type={creatingAccount ? 'button' : 'submit'}
                  onClick={creatingAccount ? () => {
                    setCreatingAccount(false);
                    handleSignIn();
                  } : undefined}
                  disabled={busy || !username.trim() || !password}
                  className="landing-button"
                >
                  Sign in
                </button>
                <button
                  type={creatingAccount ? 'submit' : 'button'}
                  onClick={creatingAccount ? undefined : () => {
                    setCreatingAccount(true);
                    setError('');
                  }}
                  disabled={busy || !username.trim() || !password}
                  className="landing-button"
                >
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
                Your password unlocks your saved Anthropic API key and Lichess token.
                Progress and sync support vary by game. The same API key powers the AI chat in Chess, Catan,
                Splendor and Diplomacy. Your password never leaves this device: the account service only
                ever stores an unreadable hash, and your keys only as ciphertext it cannot
                decrypt. Model assistance sends your own API key through our server to the provider. Usernames aren&rsquo;t case-sensitive.
              </p>
            </div>
          </form>
        )}
        </div>
      </section>
      </div>
    </main>
  );
}
