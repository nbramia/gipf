import React from 'react';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import MatchBoundary from './MatchBoundary.jsx';
import YinshBoard from './games/yinsh/YinshBoard.js';
import { encodeBoard, decodeMatch } from './games/yinsh/matchSnapshot.js';
// Real encoded Yinsh positions: `placed` rings on the board after setup moves.
const sample = placed => {
  const board = new YinshBoard();
  [[0, 1], [1, 1], [2, 0]].slice(0, placed).forEach(([q, r]) => { board.selectedSetupRing = { player: board.currentPlayer }; board.handleClick(q, r); });
  return { v: 1, game: 'yinsh', id: 'synthetic', updatedAt: 1760000000000 + placed, state: encodeBoard(board), ui: {} };
};
const decode = decodeMatch;
beforeEach(() => { localStorage.clear(); global.fetch = jest.fn(); });

test('conflict and recovery choices name the game, saved time, turn and which is current', () => {
  localStorage.setItem('yinshMatch:v1', JSON.stringify(sample(1)));
  localStorage.setItem('yinshMatchRecovery:v1', JSON.stringify({ v: 1, alternatives: [sample(3)] }));
  render(<MatchBoundary game="yinsh" decode={decode}><span>game</span></MatchBoundary>);
  act(() => { localStorage.setItem('yinshMatch:v1', JSON.stringify(sample(2))); window.dispatchEvent(new StorageEvent('storage', { key: 'yinshMatch:v1' })); });
  const conflict = screen.getByRole('alert');
  expect(conflict.textContent).toMatch(/YINSH/);
  const current = within(conflict).getByText('Keep this match').closest('li');
  expect(current.textContent).toMatch(/This match \(current/);
  expect(current.textContent).toMatch(/Saved .*1 rings placed.*Player 2 to move.*setup/);
  const other = within(conflict).getByText('Use other tab match').closest('li');
  expect(other.textContent).toMatch(/Other tab match \(alternative\)/);
  expect(within(conflict).getAllByRole('listitem').map(li => li.textContent).join('|')).toMatch(/1 rings placed.*2 rings placed/s);
  fireEvent.click(screen.getByText('Match recovery'));
  const dialog = screen.getByRole('dialog', { name: 'Match recovery' });
  expect(dialog.textContent).toMatch(/YINSH match recovery/);
  expect(within(dialog).getByText('Restore backup 1').closest('li').textContent).toMatch(/Backup 1.*Saved .*3 rings placed/);
});
