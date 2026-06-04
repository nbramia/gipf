// ChatPanel tests: the BYO-key gate must render a key prompt and make NO network
// call until a key is saved; once a key exists, the power selector + threads
// render. fetch is mocked so a failed assertion can't reach the network.

import React from 'react';
import { render, fireEvent } from '@testing-library/react';

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
  return render(<ChatPanel board={board} humanPower="france" aiPowers={['england', 'germany']} />);
}

test('with no key, shows the key-entry prompt and makes no network call', () => {
  const { container } = renderPanel();
  expect(container.querySelector('input[placeholder="sk-ant-..."]')).toBeTruthy();
  expect(container.textContent).toContain('Save key');
  // No message-send control is shown until a key is set.
  expect(container.querySelector('.dip-chat-send')).toBeFalsy();
  expect(global.fetch).not.toHaveBeenCalled();
});

test('saving a key reveals the power selector and the message input', () => {
  const { container } = renderPanel();
  fireEvent.change(container.querySelector('input[placeholder="sk-ant-..."]'), { target: { value: 'sk-live' } });
  fireEvent.click([...container.querySelectorAll('button')].find((b) => /save key/i.test(b.textContent)));

  expect(localStorage.getItem('gipfApiKey')).toBe('sk-live');
  expect(container.querySelector('.dip-chat-send')).toBeTruthy();
  // A power tab renders for each AI power.
  const tabs = [...container.querySelectorAll('.dip-chat-power')].map((b) => b.textContent);
  expect(tabs).toEqual(expect.arrayContaining(['England', 'Germany']));
  expect(global.fetch).not.toHaveBeenCalled();
});

test('a pre-existing key skips the gate entirely', () => {
  localStorage.setItem('gipfApiKey', 'sk-existing');
  const { container } = renderPanel();
  expect(container.querySelector('input[placeholder="sk-ant-..."]')).toBeFalsy();
  expect(container.querySelector('.dip-chat-send')).toBeTruthy();
  expect(global.fetch).not.toHaveBeenCalled();
});
