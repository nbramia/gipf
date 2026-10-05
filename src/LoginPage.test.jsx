import '@testing-library/jest-dom';
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import LoginPage from './LoginPage';
import { safeReturn, loginHref } from './loginReturn';
import { games } from './games-registry';
import * as account from './account';

jest.mock('./account', () => ({
  loadSession: jest.fn(), clearSession: jest.fn(), saveSession: jest.fn(),
  deriveCredentials: jest.fn(), encryptApiKey: jest.fn(), decryptApiKey: jest.fn(),
  createAccount: jest.fn(), startServerSession: jest.fn(), endServerSession: jest.fn(), pushEncryptedKey: jest.fn(),
  accountKey: jest.fn(), SESSION_EXPIRED_KEY: 'gipf:session-expired',
  getSharedApiKey: jest.fn(), setSharedApiKey: jest.fn(),
  getSharedLichessToken: jest.fn(), setSharedLichessToken: jest.fn(),
}));
const creds = { username: 'Synthetic player', usernameId: 'synthetic-id', authToken: 'synthetic-token', aesKey: 'synthetic-key' };
const originalLocation = window.location;
function mount(search = '') {
  render(<MemoryRouter basename="/gipf" initialEntries={[`/gipf/login${search}`]}><LoginPage /></MemoryRouter>);
}
function fill() {
  fireEvent.change(screen.getByLabelText('Username'), { target: { value: 'Synthetic player' } });
  fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'synthetic-password' } });
}
beforeEach(() => {
  jest.resetAllMocks();
  delete window.location;
  window.location = { ...originalLocation, hostname: 'play.ramia.us', assign: jest.fn(), reload: jest.fn() };
  account.deriveCredentials.mockResolvedValue(creds);
  account.startServerSession.mockResolvedValue({ signedIn: true });
  account.createAccount.mockResolvedValue({ created: true });
  account.accountKey.mockResolvedValue('stored-account-key');
  account.getSharedApiKey.mockReturnValue('');
  account.getSharedLichessToken.mockReturnValue('');
  account.pushEncryptedKey.mockResolvedValue(true);
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

test('signed out: form first, username focused, consent unchecked, password visibility and login errors', async () => {
  account.startServerSession.mockResolvedValue({ error: 'bad_credentials' });
  mount();
  expect(screen.getByLabelText('Username')).toHaveFocus();
  fill();
  expect(screen.getByRole('checkbox')).not.toBeChecked();
  fireEvent.click(screen.getByRole('button', { name: 'Show password' }));
  expect(screen.getByLabelText('Password')).toHaveAttribute('type', 'text');
  fireEvent.click(screen.getByRole('button', { name: 'Hide password' }));
  fireEvent.click(screen.getByRole('button', { name: 'Sign in', exact: true }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Wrong username or password.');
  expect(account.saveSession).not.toHaveBeenCalled();
  expect(window.location.assign).not.toHaveBeenCalled();
});

test.each([false, true])('login forwards import consent %s and decrypted keys, then returns to the game', async consent => {
  account.startServerSession.mockResolvedValue({ enc: 'sealed-api', encLichess: 'sealed-lichess' });
  account.decryptApiKey.mockResolvedValueOnce('synthetic-api').mockResolvedValueOnce('synthetic-lichess');
  mount('?return=/chess');
  expect(screen.getByRole('link', { name: '← Back to chess' })).toHaveAttribute('href', '/gipf/chess');
  fill();
  if (consent) fireEvent.click(screen.getByRole('checkbox'));
  fireEvent.click(screen.getByRole('button', { name: 'Sign in', exact: true }));
  await waitFor(() => expect(account.saveSession).toHaveBeenCalledWith(creds, { importGuest: consent, apiKey: 'synthetic-api', lichessToken: 'synthetic-lichess' }));
  await waitFor(() => expect(window.location.assign).toHaveBeenCalledWith('/chess'));
});

test.each(['?return=https://evil.example', '?return=//evil.example', '?return=/chess/../../x', ''])('login with %p returns to the catalogue', async search => {
  mount(search);
  fill();
  fireEvent.click(screen.getByRole('button', { name: 'Sign in', exact: true }));
  await waitFor(() => expect(window.location.assign).toHaveBeenCalledWith('/'));
});

test('creation keeps confirmation, recovery warning, validation and encryption boundary', async () => {
  account.getSharedApiKey.mockReturnValue('synthetic-api');
  account.getSharedLichessToken.mockReturnValue('synthetic-lichess');
  account.encryptApiKey.mockResolvedValueOnce('sealed-api').mockResolvedValueOnce('sealed-lichess');
  mount('?return=/splendor'); fill();
  fireEvent.click(screen.getByRole('button', { name: 'Create account', exact: true }));
  expect(screen.getByText(/There is no password reset/)).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Create account', exact: true }));
  expect(screen.getByRole('alert')).toHaveTextContent("Those passwords don't match.");
  expect(account.createAccount).not.toHaveBeenCalled();
  fireEvent.change(screen.getByLabelText('Confirm password'), { target: { value: 'synthetic-password' } });
  fireEvent.click(screen.getByRole('button', { name: 'Create account', exact: true }));
  await waitFor(() => expect(account.createAccount).toHaveBeenCalledWith({ usernameId: creds.usernameId, authToken: creds.authToken, enc: 'sealed-api', encLichess: 'sealed-lichess' }));
  await waitFor(() => expect(account.startServerSession).toHaveBeenCalledWith(creds));
  expect(account.saveSession).toHaveBeenCalledWith(creds, { importGuest: false, apiKey: 'synthetic-api', lichessToken: 'synthetic-lichess' });
  await waitFor(() => expect(window.location.assign).toHaveBeenCalledWith('/splendor'));
});

test.each([false, true])('native submit selects displayed create mode %s and blocks duplicate busy submissions', async creating => {
  let release;
  account.deriveCredentials.mockImplementation(() => new Promise(resolve => { release = resolve; }));
  account.startServerSession.mockResolvedValue({ error: 'bad_credentials' });
  account.createAccount.mockResolvedValue({ error: 'taken' });
  mount(); fill();
  if (creating) {
    fireEvent.click(screen.getByRole('button', { name: 'Create account', exact: true }));
    fireEvent.submit(screen.getByLabelText('Password').closest('form'));
    expect(screen.getByRole('alert')).toHaveTextContent("Those passwords don't match.");
    expect(account.deriveCredentials).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText('Confirm password'), { target: { value: 'synthetic-password' } });
  }
  const form = screen.getByLabelText('Password').closest('form');
  expect(fireEvent.submit(form)).toBe(false);
  expect(account.deriveCredentials).toHaveBeenCalledTimes(1);
  expect(screen.getByRole('button', { name: 'Sign in', exact: true })).toBeDisabled();
  expect(screen.getByRole('button', { name: 'Working…' })).toBeDisabled();
  fireEvent.submit(form);
  expect(account.deriveCredentials).toHaveBeenCalledTimes(1);
  release(creds);
  expect(await screen.findByRole('alert')).toHaveTextContent(creating ? 'That username is taken.' : 'Wrong username or password.');
  expect(creating ? account.createAccount : account.startServerSession).toHaveBeenCalledTimes(1);
  expect(creating ? account.startServerSession : account.createAccount).not.toHaveBeenCalled();
});

test('native submission preserves empty-field and creation length validation', () => {
  mount(); fill();
  const form = screen.getByLabelText('Password').closest('form');
  fireEvent.change(screen.getByLabelText('Username'), { target: { value: ' ' } });
  fireEvent.submit(form);
  expect(account.deriveCredentials).not.toHaveBeenCalled();
  fireEvent.change(screen.getByLabelText('Username'), { target: { value: 'Synthetic player' } });
  fireEvent.change(screen.getByLabelText('Password'), { target: { value: '' } });
  fireEvent.submit(form);
  expect(account.deriveCredentials).not.toHaveBeenCalled();
  fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'short' } });
  fireEvent.click(screen.getByRole('button', { name: 'Create account', exact: true }));
  fireEvent.change(screen.getByLabelText('Confirm password'), { target: { value: 'short' } });
  fireEvent.submit(form);
  expect(screen.getByRole('alert')).toHaveTextContent(/Password must be at least \d+ characters\./);
  expect(account.deriveCredentials).not.toHaveBeenCalled();
});

test('guest keys are device-only: saved locally, never encrypted or pushed', async () => {
  mount();
  expect(screen.getByRole('heading', { name: 'Keys on this device' })).toBeInTheDocument();
  fireEvent.change(screen.getByLabelText('Anthropic API key'), { target: { value: 'sk-ant-synthetic-guest-key-0000000000000000' } });
  fireEvent.click(screen.getAllByRole('button', { name: 'Save' })[0]);
  expect(account.setSharedApiKey).toHaveBeenCalledWith('sk-ant-synthetic-guest-key-0000000000000000');
  expect(await screen.findByText('Saved on this device.')).toBeInTheDocument();
  expect(account.encryptApiKey).not.toHaveBeenCalled();
  expect(account.pushEncryptedKey).not.toHaveBeenCalled();
});

test('signed in: keys are encrypted with the account key and synced; removal clears the synced copy', async () => {
  account.loadSession.mockReturnValue(creds);
  account.getSharedLichessToken.mockReturnValue('synthetic-lichess');
  account.encryptApiKey.mockResolvedValue('sealed-api');
  mount();
  expect(screen.getByText('Signed in as Synthetic player')).toBeInTheDocument();
  expect(screen.queryByLabelText('Username')).toBeNull();
  fireEvent.change(screen.getByLabelText('Anthropic API key'), { target: { value: 'sk-ant-synthetic-account-key-00000000000000' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save' }));
  await waitFor(() => expect(account.pushEncryptedKey).toHaveBeenCalledWith({ usernameId: creds.usernameId, authToken: creds.authToken, enc: 'sealed-api' }));
  expect(account.encryptApiKey).toHaveBeenCalledWith('stored-account-key', 'sk-ant-synthetic-account-key-00000000000000');
  expect(await screen.findByText('Saved and synced to your account.')).toBeInTheDocument();
  fireEvent.click(screen.getAllByRole('button', { name: 'Remove' })[1]);
  expect(account.setSharedLichessToken).toHaveBeenCalledWith('');
  await waitFor(() => expect(account.pushEncryptedKey).toHaveBeenCalledWith({ usernameId: creds.usernameId, authToken: creds.authToken, encLichess: null }));
});

test('sign-out cancel preserves the account; confirmation clears the session', async () => {
  account.loadSession.mockReturnValue(creds);
  mount();
  fireEvent.click(screen.getByRole('button', { name: 'Sign out' }));
  expect(screen.getByText(/Unsynced progress stays encrypted/)).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
  expect(account.clearSession).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Sign out' }));
  fireEvent.click(screen.getByRole('button', { name: 'Sign out' }));
  await waitFor(() => expect(account.clearSession).toHaveBeenCalledTimes(1));
  await waitFor(() => expect(window.location.reload).toHaveBeenCalled());
});

test('the retired gated host points to play.ramia.us instead of offering sign-in', () => {
  window.location.hostname = 'gipf.vercel.app';
  mount('?return=/chess');
  expect(screen.getByRole('link', { name: 'play.ramia.us' })).toHaveAttribute('href', 'https://play.ramia.us/login');
  expect(screen.queryByLabelText('Username')).toBeNull();
});

test('sign out everywhere confirms and revokes every session', async () => {
  account.loadSession.mockReturnValue(creds);
  mount();
  fireEvent.click(screen.getByRole('button', { name: 'Sign out everywhere' }));
  expect(screen.getByText(/Every other device signed in to this account is signed out too/)).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Sign out everywhere' }));
  await waitFor(() => expect(account.clearSession).toHaveBeenCalledWith({ everywhere: true }));
});

test('a device switch that fails after the cookie is set ends that server session', async () => {
  account.saveSession.mockRejectedValue(new Error('progress_changed'));
  mount(); fill();
  fireEvent.click(screen.getByRole('button', { name: 'Sign in', exact: true }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Unable to switch accounts safely.');
  expect(account.endServerSession).toHaveBeenCalledTimes(1);
  expect(window.location.assign).not.toHaveBeenCalled();
});

test('an ended session explains itself once', () => {
  sessionStorage.setItem('gipf:session-expired', '1');
  mount();
  expect(screen.getByRole('status')).toHaveTextContent('Your session ended.');
  expect(sessionStorage.getItem('gipf:session-expired')).toBeNull();
});

test('new accounts need at least 10 characters; existing short passwords still sign in', async () => {
  mount();
  fireEvent.change(screen.getByLabelText('Username'), { target: { value: 'Synthetic player' } });
  fireEvent.change(screen.getByLabelText('Password'), { target: { value: '123456789' } });
  fireEvent.click(screen.getByRole('button', { name: 'Create account', exact: true }));
  fireEvent.change(screen.getByLabelText('Confirm password'), { target: { value: '123456789' } });
  fireEvent.click(screen.getByRole('button', { name: 'Create account', exact: true }));
  expect(screen.getByRole('alert')).toHaveTextContent('Password must be at least 10 characters.');
  expect(account.deriveCredentials).not.toHaveBeenCalled();
  fireEvent.change(screen.getByLabelText('Password'), { target: { value: '1234567890' } });
  fireEvent.change(screen.getByLabelText('Confirm password'), { target: { value: '1234567890' } });
  fireEvent.click(screen.getByRole('button', { name: 'Create account', exact: true }));
  await waitFor(() => expect(account.createAccount).toHaveBeenCalledTimes(1));
  expect(account.deriveCredentials).toHaveBeenCalledWith('Synthetic player', '1234567890');
});

test('an existing account with a short password still signs in', async () => {
  mount();
  fireEvent.change(screen.getByLabelText('Username'), { target: { value: 'Synthetic player' } });
  fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'short' } });
  fireEvent.click(screen.getByRole('button', { name: 'Sign in', exact: true }));
  await waitFor(() => expect(account.startServerSession).toHaveBeenCalledWith(creds));
  expect(account.deriveCredentials).toHaveBeenCalledWith('Synthetic player', 'short');
});
