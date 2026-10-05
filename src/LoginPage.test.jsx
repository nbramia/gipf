import '@testing-library/jest-dom';
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import LoginPage from './LoginPage';
import { safeReturn, loginHref } from './loginReturn';
import { games } from './games-registry';
import * as account from './account';

jest.mock('./account', () => ({
  signInUrl: jest.fn(), completeSignIn: jest.fn(), linkOldAccount: jest.fn(), saveAccountKeys: jest.fn(),
  endServerSession: jest.fn(), loadSession: jest.fn(), clearSession: jest.fn(), checkServerSession: jest.fn(),
  getSharedApiKey: jest.fn(), setSharedApiKey: jest.fn(), getSharedLichessToken: jest.fn(), setSharedLichessToken: jest.fn(),
  SESSION_EXPIRED_KEY: 'gipf:session-expired',
}));
const signedIn = { v: 3, username: 'player@synthetic.example', usernameId: 'f'.repeat(64), sid: 'a'.repeat(32) };
const status = (over = {}) => ({ signedIn: true, u: signedIn.usernameId, name: signedIn.username, linked: false, keys: { anthropic: false, lichess: false }, ...over });
const originalLocation = window.location;
function mount(search = '') {
  render(<MemoryRouter basename="/gipf" initialEntries={[`/gipf/login${search}`]}><LoginPage /></MemoryRouter>);
}
beforeEach(() => {
  jest.resetAllMocks();
  localStorage.clear();
  sessionStorage.clear();
  delete window.location;
  window.location = { ...originalLocation, hostname: 'play.ramia.us', assign: jest.fn(), replace: jest.fn(), reload: jest.fn() };
  account.signInUrl.mockImplementation((r, { reauthenticate = false } = {}) => `/api/auth/login?return=${encodeURIComponent(r)}${reauthenticate ? '&reauthenticate=1' : ''}`);
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
  expect(screen.getByRole('link', { name: '← Back to chess' })).toHaveAttribute('href', '/gipf/chess');
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
  account.completeSignIn.mockResolvedValue({ offerLink: false, keys: { anthropic: true, lichess: false }, keysMoved: true });
  mount('?signedin=1&return=/splendor');
  expect(screen.getByRole('heading', { name: 'Signing in…' })).toBeInTheDocument();
  await waitFor(() => expect(window.location.assign).toHaveBeenCalledWith('/splendor'));
  expect(account.completeSignIn).toHaveBeenCalledWith({ importGuest: true });
  expect(sessionStorage.getItem('gipf:import-guest')).toBeNull();
});

test('a first sign-in reloads into the link offer; skipping leaves to the game', async () => {
  account.completeSignIn.mockResolvedValue({ offerLink: true, keys: { anthropic: false, lichess: false }, keysMoved: true });
  mount('?signedin=1&return=/catan');
  // The device changed identity under the account boundary, so the offer loads afresh.
  await waitFor(() => expect(window.location.replace).toHaveBeenCalledWith('/login?link=1&return=%2Fcatan'));
  expect(window.location.assign).not.toHaveBeenCalled();
});

test('keys that could not move are reported after the reload', async () => {
  account.completeSignIn.mockResolvedValue({ offerLink: true, keys: { anthropic: false, lichess: false }, keysMoved: false });
  mount('?signedin=1&return=/catan');
  await waitFor(() => expect(window.location.replace).toHaveBeenCalledWith('/login?link=1&keys=unmoved&return=%2Fcatan'));
  account.completeSignIn.mockResolvedValue({ offerLink: false, keys: { anthropic: false, lichess: false }, keysMoved: false });
  mount('?signedin=1&return=/chess');
  await waitFor(() => expect(window.location.replace).toHaveBeenCalledWith('/login?keys=unmoved&return=%2Fchess'));
});

test('the link offer page: skipping leaves to the game', async () => {
  account.loadSession.mockReturnValue(signedIn);
  mount('?link=1&return=/catan');
  expect(await screen.findByRole('heading', { name: 'Link your existing games account' })).toBeInTheDocument();
  expect(screen.getByText('player@synthetic.example')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Skip — start fresh' }));
  expect(window.location.assign).toHaveBeenCalledWith('/catan');
  expect(account.linkOldAccount).not.toHaveBeenCalled();
});

test('the link offer page shows the unmoved-keys notice', () => {
  account.loadSession.mockReturnValue(signedIn);
  mount('?link=1&keys=unmoved&return=/catan');
  expect(screen.getByText(/keys could not be moved to your account/)).toBeInTheDocument();
});

test.each([
  ['bad_credentials', 'Wrong username or password.'],
  ['account_linked', 'That games account is already linked to another sign-in.'],
  ['identity_linked', 'This sign-in already has a games account linked.'],
])('the link form reports %s', async (error, message) => {
  account.loadSession.mockReturnValue(signedIn);
  account.linkOldAccount.mockResolvedValue({ error });
  mount('?link=1&return=/catan');
  fireEvent.change(await screen.findByLabelText('Old username'), { target: { value: 'synthetic-old' } });
  fireEvent.change(screen.getByLabelText('Old password'), { target: { value: 'synthetic-password' } });
  fireEvent.click(screen.getByRole('button', { name: 'Link account' }));
  expect(await screen.findByRole('alert')).toHaveTextContent(message);
  expect(account.linkOldAccount).toHaveBeenCalledWith('synthetic-old', 'synthetic-password');
  expect(window.location.assign).not.toHaveBeenCalled();
});

test('a successful link leaves to the game', async () => {
  account.loadSession.mockReturnValue(signedIn);
  account.linkOldAccount.mockResolvedValue({ linked: true });
  mount('?link=1&return=/chess');
  fireEvent.change(await screen.findByLabelText('Old username'), { target: { value: 'synthetic-old' } });
  fireEvent.change(screen.getByLabelText('Old password'), { target: { value: 'synthetic-password' } });
  fireEvent.click(screen.getByRole('button', { name: 'Link account' }));
  await waitFor(() => expect(window.location.assign).toHaveBeenCalledWith('/chess'));
});

test('without a session the link offer is not shown', () => {
  account.loadSession.mockReturnValue(null);
  mount('?link=1&return=/chess');
  expect(screen.queryByRole('heading', { name: 'Link your existing games account' })).toBeNull();
  expect(screen.getByRole('heading', { name: 'Sign in' })).toBeInTheDocument();
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
  account.checkServerSession.mockResolvedValue(status({ linked: true, keys: { anthropic: false, lichess: true } }));
  mount();
  expect(screen.getByText('Signed in as player@synthetic.example')).toBeInTheDocument();
  expect(screen.getByRole('heading', { name: 'Keys on your account' })).toBeInTheDocument();
  expect(await screen.findByText('Saved ✓')).toBeInTheDocument();
  expect(screen.queryByRole('heading', { name: 'Link your existing games account' })).toBeNull();
  fireEvent.change(screen.getByLabelText('Anthropic API key'), { target: { value: 'sk-ant-synthetic-account-key-00000000000000' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save' }));
  await waitFor(() => expect(account.saveAccountKeys).toHaveBeenCalledWith({ anthropic: 'sk-ant-synthetic-account-key-00000000000000' }));
  expect(await screen.findByText('Saved to your account.')).toBeInTheDocument();
  fireEvent.click(screen.getAllByRole('button', { name: 'Remove' })[1]);
  await waitFor(() => expect(account.saveAccountKeys).toHaveBeenCalledWith({ lichess: null }));
  expect(account.setSharedApiKey).not.toHaveBeenCalled();
  expect(account.setSharedLichessToken).not.toHaveBeenCalled();
});

test('signed in but unlinked: the link form is offered in the account view', async () => {
  account.loadSession.mockReturnValue(signedIn);
  mount();
  expect(await screen.findByRole('heading', { name: 'Link your existing games account' })).toBeInTheDocument();
  expect(screen.getByText(/replaced by the linked account/)).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Skip — start fresh' })).toBeNull();
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

test.each([['expired', 'Your session ended.'], ['auth0', 'Games now signs in with your ramia.us account.']])('an ended (%s) session explains itself once', (reason, message) => {
  sessionStorage.setItem('gipf:session-expired', reason);
  mount();
  expect(screen.getByRole('status')).toHaveTextContent(message);
  expect(sessionStorage.getItem('gipf:session-expired')).toBeNull();
});

test('the retired gated host points to play.ramia.us instead of offering sign-in', () => {
  window.location.hostname = 'gipf.vercel.app';
  mount('?return=/chess');
  expect(screen.getByRole('link', { name: 'play.ramia.us' })).toHaveAttribute('href', 'https://play.ramia.us/login');
  expect(screen.queryByRole('button', { name: 'Sign in', exact: true })).toBeNull();
});
