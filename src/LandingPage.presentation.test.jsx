import '@testing-library/jest-dom';
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import LandingPage from './LandingPage';
import AccountBoundary from './AccountBoundary';
import { games } from './games-registry';
import * as account from './account';

jest.mock('./account', () => ({
  loadSession: jest.fn(), clearSession: jest.fn(), saveSession: jest.fn(),
  deriveCredentials: jest.fn(), encryptApiKey: jest.fn(), decryptApiKey: jest.fn(),
  createAccount: jest.fn(), loginAccount: jest.fn(),
  getSharedApiKey: jest.fn(), getSharedLichessToken: jest.fn(),
}));
const creds = { username: 'Synthetic player', usernameId: 'synthetic-id', authToken: 'synthetic-token', aesKey: 'synthetic-key' };
function mount() {
  render(<MemoryRouter basename="/gipf" initialEntries={['/gipf/']}><LandingPage /></MemoryRouter>);
}
function fill() {
  fireEvent.click(screen.getByRole('button', { name: 'Sign in / Create account' }));
  fireEvent.change(screen.getByLabelText('Username'), { target: { value: 'Synthetic player' } });
  fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'synthetic-password' } });
}
beforeEach(() => {
  jest.resetAllMocks();
  account.deriveCredentials.mockResolvedValue(creds);
  account.loginAccount.mockResolvedValue({});
  account.createAccount.mockResolvedValue({});
});
test('guest catalogue precedes optional account and keeps every registry link under the base path', () => {
  mount();
  const catalogue = screen.getByRole('navigation', { name: 'Choose a game' });
  const optional = screen.getByRole('region', { name: 'Your account' });
  expect(catalogue.compareDocumentPosition(optional) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  for (const game of games) expect(screen.getByRole('link', { name: `Play ${game.name}` })).toHaveAttribute('href', `/gipf${game.path}`);
  expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
});
test('integrated guest catalogue is first in keyboard order and statistics recovery remains usable', () => {
  render(<AccountBoundary><MemoryRouter><LandingPage /></MemoryRouter></AccountBoundary>);
  const controls = document.querySelectorAll('a[href], button, input');
  expect(controls[0]).toHaveAccessibleName('Play YINSH');
  fireEvent.click(screen.getByRole('button', { name: 'Statistics recovery' }));
  expect(screen.getByRole('dialog', { name: 'Statistics recovery' })).toHaveTextContent('No statistics alternatives saved.');
  fireEvent.click(screen.getByRole('button', { name: 'Close', exact: true }));
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
});
test('labelled controls, password visibility, consent and login errors remain usable', async () => {
  account.loginAccount.mockResolvedValue({ error: 'bad_credentials' });
  mount(); fill();
  expect(screen.getByRole('checkbox')).not.toBeChecked();
  fireEvent.click(screen.getByRole('button', { name: 'Show password' }));
  expect(screen.getByLabelText('Password')).toHaveAttribute('type', 'text');
  fireEvent.click(screen.getByRole('button', { name: 'Hide password' }));
  fireEvent.click(screen.getByRole('button', { name: 'Sign in', exact: true }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Wrong username or password.');
  expect(account.saveSession).not.toHaveBeenCalled();
});
test.each([false, true])('login forwards explicit import consent %s and decrypted credentials', async consent => {
  account.loginAccount.mockResolvedValue({ enc: 'sealed-api', encLichess: 'sealed-lichess' });
  account.decryptApiKey.mockResolvedValueOnce('synthetic-api').mockResolvedValueOnce('synthetic-lichess');
  mount(); fill();
  if (consent) fireEvent.click(screen.getByRole('checkbox'));
  fireEvent.click(screen.getByRole('button', { name: 'Sign in', exact: true }));
  await waitFor(() => expect(account.saveSession).toHaveBeenCalledWith(creds, { importGuest: consent, apiKey: 'synthetic-api', lichessToken: 'synthetic-lichess' }));
});
test('creation keeps confirmation, recovery warning, validation and encryption boundary', async () => {
  account.getSharedApiKey.mockReturnValue('synthetic-api');
  account.getSharedLichessToken.mockReturnValue('synthetic-lichess');
  account.encryptApiKey.mockResolvedValueOnce('sealed-api').mockResolvedValueOnce('sealed-lichess');
  mount(); fill();
  fireEvent.click(screen.getByRole('button', { name: 'Create account', exact: true }));
  expect(screen.getByText(/There is no password reset/)).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Create account', exact: true }));
  expect(screen.getByRole('alert')).toHaveTextContent("Those passwords don't match.");
  expect(account.createAccount).not.toHaveBeenCalled();
  fireEvent.change(screen.getByLabelText('Confirm password'), { target: { value: 'synthetic-password' } });
  fireEvent.click(screen.getByRole('button', { name: 'Create account', exact: true }));
  await waitFor(() => expect(account.createAccount).toHaveBeenCalledWith({ usernameId: creds.usernameId, authToken: creds.authToken, enc: 'sealed-api', encLichess: 'sealed-lichess' }));
  expect(account.saveSession).toHaveBeenCalledWith(creds, { importGuest: false, apiKey: 'synthetic-api', lichessToken: 'synthetic-lichess' });
});
test('signout cancel preserves account; confirmation calls existing boundary', async () => {
  account.loadSession.mockReturnValue(creds);
  mount();
  fireEvent.click(screen.getByRole('button', { name: 'Sign out' }));
  expect(screen.getByText(/Unsynced progress stays encrypted/)).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
  expect(account.clearSession).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Sign out' }));
  fireEvent.click(screen.getByRole('button', { name: 'Sign out' }));
  await waitFor(() => expect(account.clearSession).toHaveBeenCalledTimes(1));
});
test('opening focuses username and Cancel returns focus without stealing initial guest focus', () => {
  mount();
  expect(document.activeElement).toBe(document.body);
  const launcher = screen.getByRole('button', { name: 'Sign in / Create account' });
  expect(launcher).not.toHaveAttribute('aria-expanded');
  fireEvent.click(launcher);
  expect(screen.getByLabelText('Username')).toHaveFocus();
  fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
  expect(screen.getByRole('button', { name: 'Sign in / Create account' })).toHaveFocus();
});
test.each([false, true])('native submit selects displayed create mode %s and blocks duplicate busy submissions', async creating => {
  let release;
  account.deriveCredentials.mockImplementation(() => new Promise(resolve => { release = resolve; }));
  account.loginAccount.mockResolvedValue({ error: 'bad_credentials' });
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
  expect(creating ? account.createAccount : account.loginAccount).toHaveBeenCalledTimes(1);
  expect(creating ? account.loginAccount : account.createAccount).not.toHaveBeenCalled();
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
  expect(screen.getByRole('alert')).toHaveTextContent('Password must be at least 6 characters.');
  expect(account.deriveCredentials).not.toHaveBeenCalled();
});
