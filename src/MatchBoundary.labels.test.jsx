import React from 'react';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import MatchBoundary from './MatchBoundary.jsx';
const sample = (turn, extra = {}) => ({ v: 1, game: 'yinsh', id: 'synthetic', updatedAt: 1760000000000 + turn, state: { turn, currentPlayer: 2, gamePhase: 'play', ...extra }, ui: {} });
const decode = snapshot => ({ board: snapshot.state, ui: snapshot.ui });
beforeEach(() => { localStorage.clear(); global.fetch = jest.fn(); });

test('conflict and recovery choices name the game, saved time, turn and which is current', () => {
  localStorage.setItem('yinshMatch:v1', JSON.stringify(sample(1)));
  localStorage.setItem('yinshMatchRecovery:v1', JSON.stringify({ v: 1, alternatives: [sample(5)] }));
  render(<MatchBoundary game="yinsh" decode={decode}><span>game</span></MatchBoundary>);
  act(() => { localStorage.setItem('yinshMatch:v1', JSON.stringify(sample(2))); window.dispatchEvent(new StorageEvent('storage', { key: 'yinshMatch:v1' })); });
  const conflict = screen.getByRole('alert');
  expect(conflict.textContent).toMatch(/YINSH/);
  const current = within(conflict).getByText('Keep this match').closest('li');
  expect(current.textContent).toMatch(/This match \(current/);
  expect(current.textContent).toMatch(/Saved .*Player 2 to move.*play/);
  const other = within(conflict).getByText('Use other tab match').closest('li');
  expect(other.textContent).toMatch(/Other tab match \(alternative\)/);
  fireEvent.click(screen.getByText('Match recovery'));
  const dialog = screen.getByRole('dialog', { name: 'Match recovery' });
  expect(dialog.textContent).toMatch(/YINSH match recovery/);
  expect(within(dialog).getByText('Restore backup 1').closest('li').textContent).toMatch(/Backup 1.*Saved .*Player 2 to move/);
});
