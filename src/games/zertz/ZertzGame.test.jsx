import React from 'react';
import { render, screen, fireEvent, act, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import Game from './ZertzGame';
import { createAIWorker } from './hooks/createAIWorker';

jest.mock('./hooks/createAIWorker', () => ({ createAIWorker: jest.fn() }));

let workers;
beforeEach(() => {
  jest.useFakeTimers();
  localStorage.clear();
  localStorage.setItem('zertzDifficulty', 'easy');
  workers = [];
  createAIWorker.mockImplementation(() => {
    const worker = { postMessage: jest.fn(), terminate: jest.fn() };
    workers.push(worker);
    return worker;
  });
  jest.spyOn(Math, 'random').mockReturnValue(0.1); // human is player 1
});
afterEach(() => {
  jest.useRealTimers();
  jest.restoreAllMocks();
});

function mount({ twoPlayer = false } = {}) {
  localStorage.setItem('zertzTwoPlayer', JSON.stringify(twoPlayer));
  const view = render(<MemoryRouter><Game /></MemoryRouter>);
  fireEvent.click(screen.getAllByRole('button', { name: 'New Game' })[0]);
  return view;
}
const tile = (q, r) => screen.getByRole('button', { name: new RegExp(`^Ring \\(${q},${r}\\),`) });
const pickColor = (name) => fireEvent.click(screen.getByRole('button', { name: new RegExp(`^${name}`, 'i') }));
const requests = () => workers.flatMap(w => w.postMessage.mock.calls.map(c => ({ worker: w, requestId: c[0].requestId })));
function aiReply(move) {
  const list = requests();
  const { worker, requestId } = list[list.length - 1];
  act(() => worker.onmessage({ data: { requestId, type: 'result', data: { move }, stats: { evaluationMode: 'heuristic' } } }));
}
const wait = (ms) => act(() => { jest.advanceTimersByTime(ms); });

function playHumanTurnThenAI() {
  pickColor('White'); fireEvent.click(tile(1, 0)); // human places
  fireEvent.click(tile(3, 0)); // human removes a ring
  wait(600); aiReply({ type: 'place-marble', color: 'grey', q: 0, r: 0 });
  wait(600); aiReply({ type: 'remove-ring', q: -3, r: 0 });
}

test('undo against the AI lands on a human decision point and keeps redo available', () => {
  mount();
  playHumanTurnThenAI();
  const before = requests().length;
  fireEvent.click(screen.getByTitle('Undo (Ctrl+Z)'));
  wait(3000);
  expect(requests().length).toBe(before); // AI did not replay
  expect(screen.getByTitle('Redo (Ctrl+Shift+Z)').disabled).toBe(false);
  expect(screen.getByText('Remove a ring')).toBeTruthy(); // human's remove step restored
});

test('redo is not destroyed by AI autoplay after keyboard undo', () => {
  mount();
  playHumanTurnThenAI();
  fireEvent.keyDown(window, { key: 'z', ctrlKey: true });
  wait(3000);
  fireEvent.keyDown(window, { key: 'z', ctrlKey: true, shiftKey: true });
  expect(screen.getByTitle('Undo (Ctrl+Z)').disabled).toBe(false);
});

test('AI Suggest names the marble color and keeps the hint when that color is chosen', () => {
  mount({ twoPlayer: true });
  fireEvent.click(screen.getByRole('button', { name: 'AI Suggest' }));
  aiReply({ type: 'place-marble', color: 'black', q: 0, r: 0 });
  expect(screen.getByText('AI suggests: place Black on (0,0)')).toBeTruthy();
  pickColor('Black');
  expect(screen.getByText('AI suggests: place Black on (0,0)')).toBeTruthy();
  fireEvent.click(tile(0, 0));
  expect(screen.queryByText(/AI suggests/)).toBeNull();
});

test('Escape closes Settings, the background is inert, and focus returns to the opener', () => {
  mount({ twoPlayer: true });
  const opener = screen.getByRole('button', { name: 'Settings' });
  opener.focus();
  fireEvent.click(opener);
  const dialog = screen.getByRole('dialog', { name: 'Settings' });
  expect(dialog.contains(document.activeElement)).toBe(true);
  expect(screen.getByTitle('Undo (Ctrl+Z)').closest('[inert]')).not.toBeNull();
  fireEvent.click(within(dialog).getByRole('button', { name: 'Rules' }));
  const rules = screen.getByRole('dialog', { name: 'How to Play ZERTZ' });
  fireEvent.keyDown(rules, { key: 'Escape' });
  expect(screen.queryByRole('dialog', { name: 'How to Play ZERTZ' })).toBeNull();
  expect(screen.getByRole('dialog', { name: 'Settings' })).toBeTruthy();
  fireEvent.keyDown(screen.getByRole('dialog', { name: 'Settings' }), { key: 'Escape' });
  expect(screen.queryByRole('dialog')).toBeNull();
  expect(document.activeElement).toBe(opener);
  expect(screen.getByTitle('Undo (Ctrl+Z)').closest('[inert]')).toBeNull();
});

test('Tab stays inside the dialog', () => {
  mount({ twoPlayer: true });
  fireEvent.click(screen.getByRole('button', { name: 'Settings' }));
  const dialog = screen.getByRole('dialog', { name: 'Settings' });
  const close = within(dialog).getByRole('button', { name: 'Close settings' });
  const buttons = within(dialog).getAllByRole('button');
  buttons[buttons.length - 1].focus();
  fireEvent.keyDown(buttons[buttons.length - 1], { key: 'Tab' });
  expect(document.activeElement).toBe(close);
});

test('Show Valid Moves off also hides ring-removal highlights', () => {
  mount({ twoPlayer: true });
  pickColor('White'); fireEvent.click(tile(0, 0));
  const highlighted = () => document.querySelectorAll('polygon[fill="var(--color-ring-free)"]').length;
  expect(highlighted()).toBeGreaterThan(0);
  fireEvent.click(screen.getByRole('button', { name: 'Settings' }));
  fireEvent.click(screen.getByRole('switch', { name: 'Show Valid Moves' }));
  expect(highlighted()).toBe(0);
});

test('tiles and switches have accessible names and Space activates a tile', () => {
  mount({ twoPlayer: true });
  expect(tile(0, 0).getAttribute('aria-label')).toBe('Ring (0,0), empty');
  pickColor('White');
  fireEvent.keyDown(tile(0, 0), { key: ' ' });
  expect(tile(0, 0).getAttribute('aria-label')).toBe('Ring (0,0), White marble');
  fireEvent.click(screen.getByRole('button', { name: 'Settings' }));
  expect(screen.getByRole('switch', { name: 'Two Players' })).toBeTruthy();
  expect(screen.getByRole('switch', { name: 'Dark Mode' })).toBeTruthy();
  expect(screen.getByRole('button', { name: 'easy' }).getAttribute('aria-pressed')).toBe('true');
});

test('rules describe mandatory continued jumps', () => {
  mount({ twoPlayer: true });
  fireEvent.click(screen.getByRole('button', { name: 'Settings' }));
  fireEvent.click(screen.getByRole('button', { name: 'Rules' }));
  const rules = screen.getByRole('dialog', { name: 'How to Play ZERTZ' });
  expect(rules.textContent).toMatch(/must continue jumping/);
  expect(rules.textContent).not.toMatch(/Multi-jumps are optional/);
});
