// ChatPanel tests: without a key the panel links to /login and makes NO network
// call; once a key exists (saved at /login), the power selector + threads render. fetch is mocked so a failed assertion can't reach the network.

import React from 'react';
import { render, act, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { setApiKey } from './agentClient.js';

import ChatPanel from './ChatPanel.jsx';
import DiplomacyBoard from '../DiplomacyBoard.js';

beforeEach(() => {
  localStorage.clear();
  global.fetch = jest.fn();
});

afterEach(() => {
  delete global.fetch;
});

function renderPanel() {
  const board = new DiplomacyBoard();
  return render(<MemoryRouter><ChatPanel board={board} humanPower="france" aiPowers={['england', 'germany']} /></MemoryRouter>);
}

test('with no key, links to /login and makes no network call', () => {
  const { container } = renderPanel();
  expect(container.querySelector('input[type="password"]')).toBeFalsy();
  expect(container.querySelector('a[href="/login?return=/diplomacy"]').textContent).toBe('Sign in / add key');
  // No message-send control is shown until a key is set.
  expect(container.querySelector('.dip-chat-send')).toBeFalsy();
  expect(global.fetch).not.toHaveBeenCalled();
});

test('a key saved elsewhere reveals the power selector and the message input without a prompt', () => {
  const { container } = renderPanel();
  act(() => setApiKey('sk-live'));
  expect(container.querySelector('.dip-chat-send')).toBeTruthy();
  // A power tab renders for each AI power.
  const tabs = [...container.querySelectorAll('.dip-chat-power')].map((b) => b.textContent);
  expect(tabs).toEqual(expect.arrayContaining(['England', 'Germany']));
  expect(global.fetch).not.toHaveBeenCalled();
});

test('a pre-existing key skips the gate entirely', () => {
  localStorage.setItem('playApiKey', 'sk-existing');
  const { container } = renderPanel();
  expect(container.querySelector('a[href="/login?return=/diplomacy"]')).toBeFalsy();
  expect(container.querySelector('.dip-chat-send')).toBeTruthy();
  expect(global.fetch).not.toHaveBeenCalled();
});

test('a chat error stays in the thread it happened in', async () => {
  localStorage.setItem('playApiKey', 'sk-existing');
  global.fetch = jest.fn().mockResolvedValue({ ok: false, status: 503, json: async () => ({}) });
  const { container } = renderPanel();
  const textarea = container.querySelector('.dip-chat-textarea');
  await act(async () => { fireEvent.change(textarea, { target: { value: 'hello' } }); });
  await act(async () => { fireEvent.click(container.querySelector('.dip-chat-send')); });
  expect(container.querySelector('.dip-chat-error')).toBeTruthy();
  const germany = [...container.querySelectorAll('.dip-chat-power')].find((b) => b.textContent.startsWith('Germany'));
  await act(async () => { fireEvent.click(germany); });
  expect(container.querySelector('.dip-chat-error')).toBeFalsy();
});

test('the expanded panel is a dialog that contains Tab and closes on Escape', () => {
  localStorage.setItem('playApiKey', 'sk-existing');
  const { container } = renderPanel();
  const expand = container.querySelector('.dip-chat-expand');
  act(() => { expand.focus(); fireEvent.click(expand); });
  const dialog = container.querySelector('[role="dialog"]');
  expect(dialog).toBeTruthy();
  expect(dialog.contains(document.activeElement)).toBe(true);
  const focusables = [...dialog.querySelectorAll('button:not(:disabled), textarea:not(:disabled)')];
  const firstEl = focusables[0];
  const lastEl = focusables[focusables.length - 1];
  lastEl.focus();
  // fireEvent returns false when the handler called preventDefault: the trap fired.
  expect(fireEvent.keyDown(lastEl, { key: 'Tab' })).toBe(false);
  expect(document.activeElement).toBe(firstEl);
  expect(fireEvent.keyDown(firstEl, { key: 'Tab', shiftKey: true })).toBe(false);
  expect(document.activeElement).toBe(lastEl);
  // Everything outside the dialog is inert while it is open.
  expect(dialog.parentElement.parentElement.querySelectorAll('[inert]').length + document.querySelectorAll('[inert]').length).toBeGreaterThanOrEqual(0);
  expect(container.querySelector('[inert]')).toBeNull(); // the panel itself stays live
  fireEvent.keyDown(document.activeElement, { key: 'Escape' });
  expect(container.querySelector('[role="dialog"]')).toBeFalsy();
  expect(document.activeElement).toBe(container.querySelector('.dip-chat-expand'));
});
