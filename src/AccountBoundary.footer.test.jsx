import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import AccountBoundary from './AccountBoundary.jsx';
jest.mock('./account.js', () => ({ loadSession: jest.fn(() => null), retainProgress: jest.fn(), REQUEST_HEADERS: {}, credentialFields: () => ({}) }));
beforeEach(() => localStorage.clear());

test('the global recovery footer says it restores Chess statistics', () => {
  render(<AccountBoundary><p>Some other game</p></AccountBoundary>);
  const button = screen.getByRole('button', { name: 'Chess statistics recovery' });
  expect(button.closest('footer.account-footer')).toBeTruthy();
  fireEvent.click(button);
  expect(screen.getByRole('dialog', { name: 'Chess statistics recovery' })).toBeTruthy();
});
