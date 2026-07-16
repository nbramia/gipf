import React, { useState } from 'react';
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
  setSharedApiKey,
} from './account';

const games = [
  {
    name: 'YINSH',
    path: '/yinsh',
    description: 'Place rings, flip markers, score rows. Features AI with neural network evaluation.',
    accent: '#93C5FD',
  },
  {
    name: 'ZERTZ',
    path: '/zertz',
    description: 'Capture marbles by jumping. Isolate rings to claim pieces. Pure strategy for two.',
    accent: '#A8A29E',
  },
  {
    name: 'CHESS',
    path: '/chess',
    description: 'Play against Stockfish with a built-in coach that explains every move — yours and its.',
    accent: '#818CF8',
  },
  {
    name: 'CATAN',
    path: '/catan',
    description: 'Build settlements, trade ports, and race three strong MCTS opponents to 10 points.',
    accent: '#2DD4BF',
  },
  {
    name: 'SPLENDOR',
    path: '/splendor',
    description: 'Collect gems, build a card engine, and court nobles. Race deep-search opponents to 15 prestige.',
    accent: '#D9A441',
  },
  {
    name: 'DIPLOMACY',
    path: '/diplomacy',
    description: 'Command armies and fleets across Europe. Enter simultaneous orders, resolve, and race to 18 supply centers.',
    accent: '#4FB8D4',
  },
];

export default function LandingPage() {
  const [account, setAccount] = useState(() => loadSession());
  const [open, setOpen] = useState(false);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const closeForm = () => {
    setOpen(false);
    setUsername('');
    setPassword('');
    setError('');
  };

  const handleSignOut = () => {
    clearSession();
    setAccount(null);
    // The local gipfApiKey is deliberately retained — matches chess's sign-out.
  };

  const handleCreateAccount = async () => {
    const name = username.trim();
    if (!name || password.length < 6) {
      setError(!name ? 'Enter a username.' : 'Password must be at least 6 characters.');
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
      let res;
      try {
        res = await createAccount({ usernameId: creds.usernameId, authToken: creds.authToken, enc });
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
      saveSession(creds);
      setAccount(creds);
      closeForm();
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
      if (res.enc) {
        let key;
        try {
          key = await decryptApiKey(creds.aesKey, res.enc);
        } catch (_) {
          setError('Wrong username or password.');
          return;
        }
        if (key) setSharedApiKey(key);
      }
      // No profile merge here — chess performs the profile merge itself on
      // its next mount, once it sees this session.
      saveSession(creds);
      setAccount(creds);
      closeForm();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="min-h-screen bg-neutral-950 flex flex-col items-center justify-center px-6 py-16">
      <h1 className="font-display text-5xl sm:text-6xl font-extrabold tracking-tight text-white mb-3">
        GIPF Project
      </h1>
      <p className="text-neutral-400 font-body text-lg mb-8 text-center max-w-md">
        Abstract strategy board games — playable in the browser.
      </p>

      <div className="mb-16 w-full max-w-sm flex flex-col items-center">
        {account ? (
          <div className="flex items-center gap-3">
            <span className="font-body text-sm text-neutral-300">
              Signed in as {account.username}
            </span>
            <button
              type="button"
              onClick={handleSignOut}
              className="text-sm font-body text-neutral-400 border border-neutral-800 rounded px-3 py-1 hover:border-neutral-600 hover:text-neutral-200 transition-colors"
            >
              Sign out
            </button>
          </div>
        ) : !open ? (
          <button
            type="button"
            onClick={() => setOpen(true)}
            className="text-sm font-body text-neutral-500 border border-neutral-800 rounded-full px-4 py-1.5 hover:text-neutral-300 hover:border-neutral-600 transition-colors"
          >
            Sign in / Create account
          </button>
        ) : (
          <div className="w-full max-w-sm rounded-2xl border border-neutral-800 bg-neutral-900 p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-body text-sm font-semibold text-neutral-200">Account</h3>
              <button
                type="button"
                onClick={closeForm}
                className="text-sm font-body text-neutral-500 hover:text-neutral-300 transition-colors"
              >
                Cancel
              </button>
            </div>
            <div className="flex flex-col gap-3">
              <input
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="Username"
                className="bg-neutral-950 border border-neutral-800 rounded px-3 py-2 text-sm text-neutral-200 font-body"
              />
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Password"
                className="bg-neutral-950 border border-neutral-800 rounded px-3 py-2 text-sm text-neutral-200 font-body"
              />
              {error && <p className="text-sm text-red-400 font-body">{error}</p>}
              <div className="flex gap-3">
                <button
                  type="button"
                  onClick={handleSignIn}
                  disabled={busy || !username.trim() || !password}
                  className="flex-1 text-sm font-body text-neutral-200 border border-neutral-800 rounded px-3 py-2 hover:border-neutral-600 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                >
                  Sign in
                </button>
                <button
                  type="button"
                  onClick={handleCreateAccount}
                  disabled={busy || !username.trim() || !password}
                  className="flex-1 text-sm font-body text-neutral-200 border border-neutral-800 rounded px-3 py-2 hover:border-neutral-600 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                >
                  Create account
                </button>
              </div>
              <p className="text-xs font-body text-neutral-500 leading-relaxed">
                One password unlocks your saved Anthropic API key and your chess history on any
                device. No email, no reset — if you forget the password, you'll need a new
                account.
              </p>
            </div>
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-6 w-full max-w-xl">
        {games.map((game) => (
          <Link
            key={game.path}
            to={game.path}
            className="group block rounded-2xl border border-neutral-800 bg-neutral-900 p-8 transition-all hover:border-neutral-600 hover:bg-neutral-800/60"
          >
            <h2
              className="font-display text-2xl font-bold tracking-wide mb-3"
              style={{ color: game.accent }}
            >
              {game.name}
            </h2>
            <p className="text-neutral-400 font-body text-sm leading-relaxed">
              {game.description}
            </p>
            <span className="inline-block mt-5 text-sm font-body text-neutral-500 group-hover:text-neutral-300 transition-colors">
              Play &rarr;
            </span>
          </Link>
        ))}
      </div>
    </div>
  );
}
