// Deterministic evidence for nbramia/gipf#66. These assertions document the
// inherited defect, not correct authorization behavior. Flip them when fixing it.
import React from 'react';
import { render, act, screen } from '@testing-library/react';
import { webcrypto } from 'crypto';
import { TextEncoder, TextDecoder } from 'util';
import AccountBoundary from './AccountBoundary.jsx';
import { retainProgress, decryptApiKey } from './account.js';

const session = {v:1,username:'Synthetic fixture',usernameId:'1'.repeat(64),authToken:'2'.repeat(64),aesKey:'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=',profileId:'3'.repeat(64)};
beforeEach(() => {
  localStorage.clear();
  Object.defineProperty(globalThis,'crypto',{value:webcrypto,configurable:true});
  globalThis.TextEncoder = TextEncoder; globalThis.TextDecoder = TextDecoder;
  AbortSignal.timeout = () => new AbortController().signal;
  globalThis.fetch = jest.fn();
  localStorage.setItem('gipfAccount',JSON.stringify(session));
});
afterEach(() => jest.restoreAllMocks());

test('known #66: settings response applies while the account transition lease is held', async () => {
  let release;
  fetch.mockReturnValue(new Promise(resolve => { release = resolve; }));
  const mounted = render(<AccountBoundary><p>Synthetic child</p></AccountBoundary>);
  localStorage.setItem('gipf:account-transition',JSON.stringify({id:'synthetic-held-transition',until:Date.now()+60000}));
  await act(async () => release({ok:true,json:async () => ({revision:1,profile:{preferences:{chessDarkMode:'true'}}})}));
  expect(screen.getByText('Synthetic child')).toBeTruthy();
  expect(localStorage.getItem('chessDarkMode')).toBe('true');
  expect(localStorage.getItem('gipf:account-transition')).toContain('synthetic-held-transition');
  mounted.unmount();
});

test('known #66: retainProgress encrypts its pre-await snapshot while an unfenced writer changes progress', async () => {
  localStorage.setItem('chessDarkMode','false');
  const encrypt = webcrypto.subtle.encrypt.bind(webcrypto.subtle);
  let started, release;
  const reached = new Promise(resolve => { started = resolve; });
  const paused = new Promise(resolve => { release = resolve; });
  jest.spyOn(webcrypto.subtle,'encrypt').mockImplementation(async (...args) => { started(); await paused; return encrypt(...args); });
  const pending = retainProgress(session);
  await reached;
  localStorage.setItem('chessDarkMode','true');
  release(); await pending;
  const raw = localStorage.getItem(`gipf:recovery:${session.usernameId}`);
  const recovered = JSON.parse(await decryptApiKey(session.aesKey,JSON.parse(raw)));
  expect(recovered.chessDarkMode).toBe('false');
  expect(localStorage.getItem('chessDarkMode')).toBe('true');
});
