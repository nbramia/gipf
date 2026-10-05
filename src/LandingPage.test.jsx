// LandingPage: the six game cards, plus a single link to /login. Sign-in and
// keys live only on /login; the catalogue never renders credential inputs.

import '@testing-library/jest-dom';
import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';

import LandingPage from './LandingPage';
import AccountBoundary from './AccountBoundary';
import { games } from './games-registry';

function renderLanding({ basename } = {}) {
  return render(
    <MemoryRouter basename={basename} initialEntries={[basename ? `${basename}/` : '/']}>
      <Routes>
        <Route path="/" element={<LandingPage />} />
        <Route path="/login" element={<p>Login page</p>} />
      </Routes>
    </MemoryRouter>
  );
}

beforeEach(() => localStorage.clear());

test('renders every registry game under the base path, before the optional account link', () => {
  renderLanding({ basename: '/gipf' });
  for (const game of games) expect(screen.getByRole('link', { name: `Play ${game.name}` })).toHaveAttribute('href', `/gipf${game.path}`);
  const catalogue = screen.getByRole('navigation', { name: 'Choose a game' });
  const optional = screen.getByRole('region', { name: 'Your account' });
  expect(catalogue.compareDocumentPosition(optional) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
});

test('signed out, offers a single Sign in link to /login and no credential inputs', () => {
  renderLanding();
  expect(screen.getByRole('link', { name: 'Sign in' })).toHaveAttribute('href', '/login');
  expect(document.querySelector('input')).toBeNull();
  fireEvent.click(screen.getByRole('link', { name: 'Sign in' }));
  expect(screen.getByText('Login page')).toBeInTheDocument();
});

test('signed in, names the account and links to account and keys', () => {
  localStorage.setItem('gipfAccount', JSON.stringify({
    v: 1, username: 'Synthetic', usernameId: 'a'.repeat(64), authToken: 'b'.repeat(64), aesKey: 'x', profileId: 'c'.repeat(64),
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
  fireEvent.click(screen.getByRole('button', { name: 'Statistics recovery' }));
  expect(screen.getByRole('dialog', { name: 'Statistics recovery' })).toHaveTextContent('No statistics alternatives saved.');
  fireEvent.click(screen.getByRole('button', { name: 'Close', exact: true }));
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
});
