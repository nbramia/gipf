import '@testing-library/jest-dom';
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import LoginPage from './LoginPage';
import { safeReturn, loginHref } from './loginReturn';
import { games } from './games-registry';
import * as account from './account';
import { ATTEMPT_KEY, OFF_KEY, TRY_AGAIN_MS } from './silentSignIn';

jest.mock('./account', () => ({
  signInUrl: jest.fn(), completeSignIn: jest.fn(), saveAccountKeys: jest.fn(),
  endServerSession: jest.fn(), loadSession: jest.fn(), clearSession: jest.fn(), checkServerSession: jest.fn(),
  getSharedApiKey: jest.fn(), setSharedApiKey: jest.fn(), getSharedLichessToken: jest.fn(), setSharedLichessToken: jest.fn(),
  SESSION_EXPIRED_KEY: 'gipf:session-expired',
}));
const signedIn = { v: 3, username: 'player@synthetic.example', usernameId: 'f'.repeat(64), sid: 'a'.repeat(32) };
const status = (over = {}) => ({ signedIn: true, u: signedIn.usernameId, name: signedIn.username, keys: { anthropic: false, lichess: false }, ...over });
const originalLocation = window.location;
function mount(search = '') {
  render(<MemoryRouter initialEntries={[`/login${search}`]}><LoginPage /></MemoryRouter>);
}
beforeEach(() => {
  jest.resetAllMocks();
  localStorage.clear();
  sessionStorage.clear();
  delete window.location;
  window.location = { ...originalLocation, hostname: 'play.ramia.us', assign: jest.fn(), replace: jest.fn(), reload: jest.fn() };
  account.signInUrl.mockImplementation((r, { reauthenticate = false, silent = null } = {}) =>
    `/api/auth/login?return=${encodeURIComponent(r)}${reauthenticate ? '&reauthenticate=1' : silent === 'login' ? '&silent=1' : ''}`);
  // Most tests show the page after this browser's automatic attempt; the silent
  // sign-in tests below start without it.
  localStorage.setItem(ATTEMPT_KEY, String(Date.now()));
  account.getSharedApiKey.mockReturnValue('');
  account.getSharedLichessToken.mockReturnValue('');
  account.checkServerSession.mockResolvedValue(status());
  account.saveAccountKeys.mockResolvedValue({ saved: true, keys: { anthropic: true, lichess: false } });
});
afterAll(() => { window.location = originalLocation; });

describe('return allowlist', () => {
  test.each(games.map(g => g.path))('accepts the registry route %s exactly', path => expect(safeReturn(path)).toBe(path));
  test.each([null, '', '/', '/login', '/chess/', '/chess/x', '/CHESS', 'chess', '//evil.example', 'https://evil.example/chess',
    '/%2Fevil.example', '/chess?x=1', ' /chess', 'javascript:alert(1)'])('falls back to / for %p', raw => expect(safeReturn(raw)).toBe('/'));
  test('game links carry an allowlisted return', () => {
    expect(loginHref('/catan')).toBe('/login?return=/catan');
    expect(loginHref('https://evil.example')).toBe('/login?return=/');
  });
});

test('signed out: Auth0 sign-in with the allowlisted return; no username/password account UI', () => {
  mount('?return=/chess');
  expect(screen.getByRole('link', { name: '← Back to chess' })).toHaveAttribute('href', '/chess');
  expect(screen.queryByRole('button', { name: /Create account/ })).toBeNull();
  expect(screen.queryByLabelText('Confirm password')).toBeNull();
  expect(screen.queryByLabelText('Username')).toBeNull();
  expect(screen.queryByLabelText(/password/i)).toBeNull();
  expect(screen.getByRole('checkbox')).not.toBeChecked();
  fireEvent.click(screen.getByRole('button', { name: 'Sign in', exact: true }));
  expect(account.signInUrl).toHaveBeenCalledWith('/chess', { reauthenticate: false });
  expect(window.location.assign).toHaveBeenCalledWith('/api/auth/login?return=%2Fchess');
  expect(sessionStorage.getItem('gipf:import-guest')).toBeNull();
});

test.each(['?return=https://evil.example', '?return=//evil.example', '?return=/chess/../../x', ''])('sign-in with %p returns to the catalogue', search => {
  mount(search);
  fireEvent.click(screen.getByRole('button', { name: 'Sign in', exact: true }));
  expect(account.signInUrl).toHaveBeenCalledWith('/', { reauthenticate: false });
});

test('import consent survives the redirect; "Use a different account" asks Auth0 for credentials', () => {
  mount('?return=/catan');
  fireEvent.click(screen.getByRole('checkbox'));
  fireEvent.click(screen.getByRole('button', { name: 'Use a different account' }));
  expect(sessionStorage.getItem('gipf:import-guest')).toBe('1');
  expect(window.location.assign).toHaveBeenCalledWith('/api/auth/login?return=%2Fcatan&reauthenticate=1');
});

test('back from Auth0: completes sign-in with the stored consent and leaves to the game', async () => {
  sessionStorage.setItem('gipf:import-guest', '1');
  account.completeSignIn.mockResolvedValue({ keys: { anthropic: true, lichess: false }, keysMoved: true });
  mount('?signedin=1&return=/splendor');
  expect(screen.getByRole('heading', { name: 'Signing in…' })).toBeInTheDocument();
  await waitFor(() => expect(window.location.assign).toHaveBeenCalledWith('/splendor'));
  expect(account.completeSignIn).toHaveBeenCalledWith({ importGuest: true });
  expect(sessionStorage.getItem('gipf:import-guest')).toBeNull();
});

test('a sign-in goes straight to the game', async () => {
  account.completeSignIn.mockResolvedValue({ keys: { anthropic: false, lichess: false }, keysMoved: true });
  mount('?signedin=1&return=/catan');
  await waitFor(() => expect(window.location.assign).toHaveBeenCalledWith('/catan'));
  expect(window.location.replace).not.toHaveBeenCalled();
});

test('keys that could not move are reported after the reload', async () => {
  account.completeSignIn.mockResolvedValue({ keys: { anthropic: false, lichess: false }, keysMoved: false });
  mount('?signedin=1&return=/chess');
  await waitFor(() => expect(window.location.replace).toHaveBeenCalledWith('/login?keys=unmoved&return=%2Fchess'));
});

test('a device switch that fails after the cookie is set ends that server session', async () => {
  account.completeSignIn.mockRejectedValue(new Error('progress_changed'));
  mount('?signedin=1&return=/chess');
  await waitFor(() => expect(window.location.replace).toHaveBeenCalledWith('/login?error=device&return=%2Fchess'));
  expect(account.endServerSession).toHaveBeenCalledTimes(1);
  expect(window.location.assign).not.toHaveBeenCalled();
});

test.each([
  ['unavailable', 'Sign-in is unavailable right now.'],
  ['signin', 'Sign-in did not complete.'],
  ['unverified', 'Sign-in needs a verified email address.'],
  ['busy', 'New sign-ups are paused for today.'],
  ['device', 'Unable to finish signing in on this device.'],
])('error=%s explains itself', (error, message) => {
  mount(`?error=${error}`);
  expect(screen.getByRole('alert')).toHaveTextContent(message);
});

test('guest keys are device-only', async () => {
  mount();
  expect(screen.getByRole('heading', { name: 'Keys on this device' })).toBeInTheDocument();
  fireEvent.change(screen.getByLabelText('Anthropic API key'), { target: { value: 'sk-ant-synthetic-guest-key-0000000000000000' } });
  fireEvent.click(screen.getAllByRole('button', { name: 'Save' })[0]);
  expect(await screen.findByText('Saved on this device.')).toBeInTheDocument();
  expect(account.setSharedApiKey).toHaveBeenCalledWith('sk-ant-synthetic-guest-key-0000000000000000');
  expect(account.saveAccountKeys).not.toHaveBeenCalled();
});

test('signed in: key status comes from the server; saves and removals go to the account only', async () => {
  account.loadSession.mockReturnValue(signedIn);
  account.checkServerSession.mockResolvedValue(status({ keys: { anthropic: false, lichess: true } }));
  mount();
  expect(screen.getByText('Signed in as player@synthetic.example')).toBeInTheDocument();
  expect(screen.getByRole('heading', { name: 'Keys on your account' })).toBeInTheDocument();
  expect(await screen.findByText('Saved ✓')).toBeInTheDocument();
  fireEvent.change(screen.getByLabelText('Anthropic API key'), { target: { value: 'sk-ant-synthetic-account-key-00000000000000' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save' }));
  await waitFor(() => expect(account.saveAccountKeys).toHaveBeenCalledWith({ anthropic: 'sk-ant-synthetic-account-key-00000000000000' }));
  expect(await screen.findByText('Saved to your account.')).toBeInTheDocument();
  fireEvent.click(screen.getAllByRole('button', { name: 'Remove' })[1]);
  await waitFor(() => expect(account.saveAccountKeys).toHaveBeenCalledWith({ lichess: null }));
  expect(account.setSharedApiKey).not.toHaveBeenCalled();
  expect(account.setSharedLichessToken).not.toHaveBeenCalled();
});

test('a failed account save is reported', async () => {
  account.loadSession.mockReturnValue(signedIn);
  account.saveAccountKeys.mockResolvedValue({ error: 'network' });
  mount();
  fireEvent.change(screen.getByLabelText('Anthropic API key'), { target: { value: 'sk-ant-synthetic-account-key-00000000000000' } });
  fireEvent.click(screen.getAllByRole('button', { name: 'Save' })[0]);
  expect(await screen.findByText('Could not reach the server. Try again.')).toBeInTheDocument();
});

test('sign-out cancel preserves the account; confirmation clears the session and explains SSO', async () => {
  account.loadSession.mockReturnValue(signedIn);
  mount();
  fireEvent.click(screen.getByRole('button', { name: 'Sign out' }));
  expect(screen.getByText(/Unsynced progress stays encrypted/)).toHaveTextContent('home.ramia.us also uses, stays signed in');
  fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
  expect(account.clearSession).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Sign out' }));
  fireEvent.click(screen.getByRole('button', { name: 'Sign out' }));
  await waitFor(() => expect(account.clearSession).toHaveBeenCalledWith({ everywhere: false }));
  await waitFor(() => expect(window.location.reload).toHaveBeenCalled());
  expect(sessionStorage.getItem('gipf:signed-out')).toBe('1');
  expect(localStorage.getItem(OFF_KEY)).toBe('1');
});

test('sign out everywhere confirms and revokes every session', async () => {
  account.loadSession.mockReturnValue(signedIn);
  mount();
  fireEvent.click(screen.getByRole('button', { name: 'Sign out everywhere' }));
  expect(screen.getByText(/Every other device signed in to Games with this account is signed out too/)).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Sign out everywhere' }));
  await waitFor(() => expect(account.clearSession).toHaveBeenCalledWith({ everywhere: true }));
});

test('after sign-out the page says the ramia.us sign-in is still open', () => {
  sessionStorage.setItem('gipf:signed-out', '1');
  mount();
  expect(screen.getByText(/Signed out of Games/)).toHaveTextContent('Use a different account');
  expect(sessionStorage.getItem('gipf:signed-out')).toBeNull();
});

test.each([['expired', 'Your session ended.']])('an ended (%s) session explains itself once', (reason, message) => {
  sessionStorage.setItem('gipf:session-expired', reason);
  mount();
  expect(screen.getByRole('status')).toHaveTextContent(message);
  expect(sessionStorage.getItem('gipf:session-expired')).toBeNull();
});

describe('automatic sign-in from the ramia.us session', () => {
  beforeEach(() => localStorage.removeItem(ATTEMPT_KEY));

  test('signed out with no recent attempt: one top-level prompt=none redirect, keeping the return', () => {
    mount('?return=/chess');
    expect(screen.getByRole('heading', { name: 'Signing in…' })).toBeInTheDocument();
    expect(account.signInUrl).toHaveBeenCalledWith('/chess', { silent: 'login' });
    expect(window.location.replace).toHaveBeenCalledTimes(1);
    expect(window.location.replace).toHaveBeenCalledWith('/api/auth/login?return=%2Fchess&silent=1');
    expect(Number(localStorage.getItem(ATTEMPT_KEY))).toBeGreaterThan(0);
  });

  test('an unsafe return is reduced to the catalogue before the attempt', () => {
    mount('?return=https://evil.example');
    expect(account.signInUrl).toHaveBeenCalledWith('/', { silent: 'login' });
  });

  test('a refused attempt (?silent=failed) shows the Sign in button and never redirects again', () => {
    mount('?silent=failed&return=/chess');
    expect(screen.getByRole('button', { name: 'Sign in', exact: true })).toBeInTheDocument();
    expect(screen.queryByRole('alert')).toBeNull();
    expect(window.location.replace).not.toHaveBeenCalled();
  });

  test('the same browser does not try again for ten minutes, then may', () => {
    localStorage.setItem(ATTEMPT_KEY, String(Date.now() - TRY_AGAIN_MS + 60000));
    mount('?return=/chess');
    expect(window.location.replace).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Sign in', exact: true })).toBeInTheDocument();
  });

  test('an attempt older than ten minutes is retried', () => {
    localStorage.setItem(ATTEMPT_KEY, String(Date.now() - TRY_AGAIN_MS - 1000));
    mount();
    expect(window.location.replace).toHaveBeenCalledWith('/api/auth/login?return=%2F&silent=1');
  });

  test('after signing out of Games there is no attempt until the user chooses Sign in', () => {
    localStorage.setItem(OFF_KEY, '1');
    mount('?return=/catan');
    expect(window.location.replace).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Sign in', exact: true }));
    expect(window.location.assign).toHaveBeenCalledWith('/api/auth/login?return=%2Fcatan');
    expect(localStorage.getItem(OFF_KEY)).toBeNull();
  });

  test('"Use a different account" also re-enables it and still sends prompt=login', () => {
    localStorage.setItem(OFF_KEY, '1');
    mount('?return=/catan');
    fireEvent.click(screen.getByRole('button', { name: 'Use a different account' }));
    expect(window.location.assign).toHaveBeenCalledWith('/api/auth/login?return=%2Fcatan&reauthenticate=1');
    expect(localStorage.getItem(OFF_KEY)).toBeNull();
  });

  test.each([
    ['signed in', () => account.loadSession.mockReturnValue(signedIn), ''],
    ['an error to show', () => {}, '?error=signin'],
    ['returning from Auth0', () => account.completeSignIn.mockReturnValue(new Promise(() => {})), '?signedin=1'],
    ['off play.ramia.us', () => { window.location.hostname = 'gipf-preview.vercel.app'; }, ''],
    ['on the ramia.us apex', () => { window.location.hostname = 'ramia.us'; }, ''],
  ])('no attempt when %s', (_, arrange, search) => {
    arrange();
    mount(search);
    expect(window.location.replace).not.toHaveBeenCalled();
  });

  test('no attempt when the marker cannot be stored, so a blocked storage cannot loop', () => {
    const setItem = jest.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('blocked'); });
    try {
      mount();
      expect(window.location.replace).not.toHaveBeenCalled();
      expect(screen.getByRole('button', { name: 'Sign in', exact: true })).toBeInTheDocument();
    } finally { setItem.mockRestore(); }
  });
});
