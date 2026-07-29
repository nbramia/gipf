// Smoke test for LandingPage — covers the six game cards plus the app-level
// account widget (signed-out prompt, signed-out form reveal, signed-in state
// and sign-out). See src/games/chess/ChessGame.test.js for the render-smoke
// style this mirrors.

import '@testing-library/jest-dom';
import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

import LandingPage from './LandingPage';

const ACCOUNT_KEY = 'gipfAccount';
const API_KEY = 'gipfApiKey';
const LICHESS_KEY = 'chessLichessToken';

function renderLanding() {
  return render(
    <MemoryRouter>
      <LandingPage />
    </MemoryRouter>
  );
}

describe('LandingPage', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  test('renders the six game cards and the sign-in prompt when signed out', () => {
    renderLanding();

    expect(screen.getByText('YINSH')).toBeInTheDocument();
    expect(screen.getByText('ZERTZ')).toBeInTheDocument();
    expect(screen.getByText('CHESS')).toBeInTheDocument();
    expect(screen.getByText('CATAN')).toBeInTheDocument();
    expect(screen.getByText('SPLENDOR')).toBeInTheDocument();
    expect(screen.getByText('DIPLOMACY')).toBeInTheDocument();

    expect(screen.getByRole('button', { name: 'Sign in / Create account' })).toBeInTheDocument();
  });

  test('clicking the sign-in button reveals the form and the privacy copy', () => {
    renderLanding();

    fireEvent.click(screen.getByRole('button', { name: 'Sign in / Create account' }));

    expect(screen.getByPlaceholderText('Username')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('Password')).toBeInTheDocument();
    expect(screen.getByText(/Your password never leaves this device/)).toBeInTheDocument();
  });

  test('clicking "Create account" reveals the confirm-password field and the no-recovery warning', () => {
    renderLanding();

    fireEvent.click(screen.getByRole('button', { name: 'Sign in / Create account' }));
    expect(screen.queryByPlaceholderText('Confirm password')).not.toBeInTheDocument();

    fireEvent.change(screen.getByPlaceholderText('Username'), { target: { value: 'newplayer' } });
    fireEvent.change(screen.getByPlaceholderText('Password'), { target: { value: 'hunter22' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create account' }));

    expect(screen.getByPlaceholderText('Confirm password')).toBeInTheDocument();
    expect(screen.getByText(/there is no password reset and no email on file/i)).toBeInTheDocument();
  });

  test('the show/hide toggle reveals the password field text', () => {
    renderLanding();

    fireEvent.click(screen.getByRole('button', { name: 'Sign in / Create account' }));
    const passwordInput = screen.getByPlaceholderText('Password');
    expect(passwordInput).toHaveAttribute('type', 'password');

    fireEvent.click(screen.getByRole('button', { name: 'Show password' }));
    expect(passwordInput).toHaveAttribute('type', 'text');
  });

  test('with a valid session, renders signed-in state; sign out (after confirming) returns to signed-out and keeps a seeded API key', () => {
    localStorage.setItem(
      ACCOUNT_KEY,
      JSON.stringify({
        v: 1,
        username: 'Nathan',
        usernameId: 'a'.repeat(64),
        authToken: 'b'.repeat(64),
        aesKey: 'x',
        profileId: 'c'.repeat(64),
      })
    );
    localStorage.setItem(API_KEY, 'sk-test-key');
    localStorage.setItem(LICHESS_KEY, 'lip-test-token');

    renderLanding();

    expect(screen.getByText('Signed in as Nathan')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Sign out' }));

    // Inline confirmation names the account and explains the keys stay put.
    expect(screen.getByText(/stay on this device/i)).toBeInTheDocument();
    expect(screen.getByText(/Sign out of/)).toBeInTheDocument();

    // The second "Sign out" is the confirm action inside the prompt.
    fireEvent.click(screen.getByRole('button', { name: 'Sign out' }));

    expect(screen.getByRole('button', { name: 'Sign in / Create account' })).toBeInTheDocument();
    expect(screen.queryByText('Signed in as Nathan')).not.toBeInTheDocument();
    expect(localStorage.getItem(API_KEY)).toBe('sk-test-key');
    expect(localStorage.getItem(LICHESS_KEY)).toBe('lip-test-token');
  });

  test('declining the sign-out confirmation keeps the session', () => {
    localStorage.setItem(
      ACCOUNT_KEY,
      JSON.stringify({
        v: 1,
        username: 'Nathan',
        usernameId: 'a'.repeat(64),
        authToken: 'b'.repeat(64),
        aesKey: 'x',
        profileId: 'c'.repeat(64),
      })
    );

    renderLanding();

    fireEvent.click(screen.getByRole('button', { name: 'Sign out' }));
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(screen.getByText('Signed in as Nathan')).toBeInTheDocument();
    expect(screen.queryByText(/stay on this device/i)).not.toBeInTheDocument();
    expect(localStorage.getItem(ACCOUNT_KEY)).not.toBeNull();
  });
});
