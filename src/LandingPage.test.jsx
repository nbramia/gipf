// LandingPage: one card per registry game, plus a single link to /login. Sign-in and
// keys live only on /login; the catalogue never renders credential inputs.

import '@testing-library/jest-dom';
import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';

import LandingPage from './LandingPage';
import AccountBoundary from './AccountBoundary';
import { games } from './games-registry';

function renderLanding() {
  return render(
    <MemoryRouter initialEntries={['/']}>
      <Routes>
        <Route path="/" element={<LandingPage />} />
        <Route path="/login" element={<p>Login page</p>} />
      </Routes>
    </MemoryRouter>
  );
}

beforeEach(() => localStorage.clear());

test('renders every registry game at its root route, before the optional account link', () => {
  renderLanding();
  for (const game of games) expect(screen.getByRole('link', { name: `Play ${game.name}` })).toHaveAttribute('href', game.path);
  const catalogue = screen.getByRole('navigation', { name: 'Choose a game' });
  const optional = screen.getByRole('region', { name: 'Your account' });
  expect(catalogue.compareDocumentPosition(optional) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
});

test('Ricochet has its own card and motif, not the fallback map', () => {
  renderLanding();
  const link = screen.getByRole('link', { name: 'Play RICOCHET' });
  expect(link).toHaveAttribute('href', '/ricochet');
  const fallback = screen.getByRole('link', { name: 'Play DIPLOMACY' });
  expect(link.querySelector('svg').innerHTML).not.toBe(fallback.querySelector('svg').innerHTML);
});

test('signed out, offers a single Sign in link to /login and no credential inputs', () => {
  renderLanding();
  expect(screen.getByRole('link', { name: 'Sign in' })).toHaveAttribute('href', '/login');
  expect(document.querySelector('input')).toBeNull();
  fireEvent.click(screen.getByRole('link', { name: 'Sign in' }));
  expect(screen.getByText('Login page')).toBeInTheDocument();
});

test('signed in, names the account and links to account and keys', () => {
  localStorage.setItem('playAccount', JSON.stringify({
    v: 3, username: 'Synthetic', usernameId: 'a'.repeat(64), sid: 'b'.repeat(32),
  }));
  renderLanding();
  expect(screen.getByText('Signed in as Synthetic')).toBeInTheDocument();
  expect(screen.getByRole('link', { name: 'Account and keys' })).toHaveAttribute('href', '/login');
  expect(screen.queryByRole('button', { name: /sign out/i })).toBeNull();
});

test('integrated guest catalogue is first in keyboard order and statistics recovery remains usable', () => {
  render(<AccountBoundary><MemoryRouter><LandingPage /></MemoryRouter></AccountBoundary>);
  const controls = document.querySelectorAll('a[href], button, input');
  expect(controls[0]).toHaveAccessibleName('Play YINSH');
  fireEvent.click(screen.getByRole('button', { name: 'Chess statistics recovery' }));
  expect(screen.getByRole('dialog', { name: 'Chess statistics recovery' })).toHaveTextContent('No statistics alternatives saved.');
  fireEvent.click(screen.getByRole('button', { name: 'Close', exact: true }));
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
});

describe('automatic sign-in from the ramia.us session', () => {
  const originalLocation = window.location;
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    delete window.location;
    window.location = { ...originalLocation, hostname: 'play.ramia.us', replace: jest.fn() };
  });
  afterEach(() => { window.location = originalLocation; });

  test('a signed-out visit tries once, top-level, returning to the catalogue', () => {
    renderLanding();
    expect(window.location.replace).toHaveBeenCalledWith('/api/auth/login?return=%2F&silent=home');
  });

  test('at most once per browser session, even after the ten-minute window', () => {
    sessionStorage.setItem('play:silent-sign-in-home', '1');
    renderLanding();
    expect(window.location.replace).not.toHaveBeenCalled();
  });

  test('not within ten minutes of another attempt (for example from /login)', () => {
    localStorage.setItem('play:silent-sign-in-at', String(Date.now()));
    renderLanding();
    expect(window.location.replace).not.toHaveBeenCalled();
  });

  test('not after signing out of Games, and not when already signed in', () => {
    localStorage.setItem('play:silent-sign-in-off', '1');
    const { unmount } = renderLanding();
    expect(window.location.replace).not.toHaveBeenCalled();
    unmount();
    localStorage.removeItem('play:silent-sign-in-off');
    localStorage.setItem('playAccount', JSON.stringify({
      v: 3, username: 'Synthetic', usernameId: 'a'.repeat(64), sid: 'b'.repeat(32),
    }));
    renderLanding();
    expect(screen.getByText('Signed in as Synthetic')).toBeInTheDocument();
    expect(window.location.replace).not.toHaveBeenCalled();
  });
});
