// ChatPanel tests: without a key the panel links to /login and makes NO network
// call; once a key exists (saved at /login), the power selector + threads render. fetch is mocked so a failed assertion can't reach the network.

import React from 'react';
import { render, act } from '@testing-library/react';
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
  localStorage.setItem('gipfApiKey', 'sk-existing');
  const { container } = renderPanel();
  expect(container.querySelector('a[href="/login?return=/diplomacy"]')).toBeFalsy();
  expect(container.querySelector('.dip-chat-send')).toBeTruthy();
  expect(global.fetch).not.toHaveBeenCalled();
});
