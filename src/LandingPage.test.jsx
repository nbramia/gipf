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

  test('clicking the sign-in button reveals the form and no-recovery copy', () => {
    renderLanding();

    fireEvent.click(screen.getByRole('button', { name: 'Sign in / Create account' }));

    expect(screen.getByPlaceholderText('Username')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('Password')).toBeInTheDocument();
    expect(screen.getByText(/No email, no reset/)).toBeInTheDocument();
  });

  test('with a valid session, renders signed-in state; sign out returns to signed-out and keeps a seeded API key', () => {
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

    renderLanding();

    expect(screen.getByText('Signed in as Nathan')).toBeInTheDocument();
    const signOutButton = screen.getByRole('button', { name: 'Sign out' });
    expect(signOutButton).toBeInTheDocument();

    fireEvent.click(signOutButton);

    expect(screen.getByRole('button', { name: 'Sign in / Create account' })).toBeInTheDocument();
    expect(screen.queryByText('Signed in as Nathan')).not.toBeInTheDocument();
    expect(localStorage.getItem(API_KEY)).toBe('sk-test-key');
  });
});
