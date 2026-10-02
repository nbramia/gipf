// Deterministic delayed-writer regressions for nbramia/gipf#66.
import React from 'react';
import { render, act, screen, fireEvent } from '@testing-library/react';
import { webcrypto } from 'crypto';
import { TextEncoder, TextDecoder } from 'util';
import AccountBoundary from './AccountBoundary.jsx';
import { retainProgress } from './account.js';

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

test('settings response cannot apply while the account transition lease is held', async () => {
  let release;
  fetch.mockReturnValue(new Promise(resolve => { release = resolve; }));
  const mounted = render(<AccountBoundary><p>Synthetic child</p></AccountBoundary>);
  localStorage.setItem('gipf:account-transition',JSON.stringify({id:'synthetic-held-transition',until:Date.now()+60000}));
  await act(async () => release({ok:true,json:async () => ({revision:1,profile:{preferences:{chessDarkMode:'true'}}})}));
  expect(screen.queryByText('Synthetic child')).toBeNull();
  expect(screen.getByText(/Reload before playing/)).toBeTruthy();
  expect(localStorage.getItem('chessDarkMode')).toBeNull();
  expect(localStorage.getItem('gipf:account-transition')).toContain('synthetic-held-transition');
  mounted.unmount();
});

test('retainProgress rejects a stale pre-await snapshot without overwriting recovery', async () => {
  localStorage.setItem('chessDarkMode','false');
  const encrypt = webcrypto.subtle.encrypt.bind(webcrypto.subtle);
  let started, release;
  const reached = new Promise(resolve => { started = resolve; });
  const paused = new Promise(resolve => { release = resolve; });
  jest.spyOn(webcrypto.subtle,'encrypt').mockImplementation(async (...args) => { started(); await paused; return encrypt(...args); });
  const pending = retainProgress(session);
  await reached;
  localStorage.setItem('chessDarkMode','true');
  release(); await expect(pending).rejects.toThrow('progress_changed');
  expect(localStorage.getItem(`gipf:recovery:${session.usernameId}`)).toBeNull();
  expect(localStorage.getItem('chessDarkMode')).toBe('true');
});


test('same-account transition that finishes before hydration response still fences apply', async () => {
  let release;
  fetch.mockReturnValue(new Promise(resolve => { release = resolve; }));
  render(<AccountBoundary><p>Synthetic child</p></AccountBoundary>);
  localStorage.setItem('gipf:account-epoch','completed-transition');
  await act(async () => release({ok:true,json:async () => ({revision:1,profile:{preferences:{chessDarkMode:'true'}}})}));
  expect(localStorage.getItem('chessDarkMode')).toBeNull();
});

test('delayed cloud conflict recovery cannot replace newer statistics or settings', async () => {
  localStorage.setItem('chessDarkMode','false');
  fetch.mockResolvedValue({ok:true,json:async () => ({revision:1,profile:{preferences:{chessDarkMode:'true',chessGameLog:'[]'}}})});
  render(<AccountBoundary><p>Synthetic child</p></AccountBoundary>);
  await screen.findByText('Use cloud');
  const encrypt = webcrypto.subtle.encrypt.bind(webcrypto.subtle);
  let started, release;
  const reached = new Promise(resolve => { started = resolve; });
  const paused = new Promise(resolve => { release = resolve; });
  jest.spyOn(webcrypto.subtle,'encrypt').mockImplementation(async (...args) => { started(); await paused; return encrypt(...args); });
  fireEvent.click(screen.getByText('Use cloud')); await reached;
  localStorage.setItem('chessGameLog','newer statistics');
  await act(async () => { release(); await new Promise(resolve => setTimeout(resolve,0)); });
  expect(await screen.findByText(/cloud replacement cancelled/)).toBeTruthy();
  expect(localStorage.getItem('chessDarkMode')).toBe('false');
  expect(localStorage.getItem('chessGameLog')).toBe('newer statistics');
  expect(localStorage.getItem(`gipf:recovery:${session.usernameId}`)).toBeNull();
});

test('recovery encryption expiring its lease preserves the prior recovery and active match', async () => {
  localStorage.setItem('chessMatch:v1','original match');
  localStorage.setItem(`gipf:recovery:${session.usernameId}`,'original recovery');
  const until=Date.now()+1000;
  localStorage.setItem('gipf:account-transition',JSON.stringify({id:'owner',until}));
  const encrypt=webcrypto.subtle.encrypt.bind(webcrypto.subtle);
  jest.spyOn(webcrypto.subtle,'encrypt').mockImplementation(async(...args)=>{const sealed=await encrypt(...args);jest.spyOn(Date,'now').mockReturnValue(until+1);return sealed;});
  await expect(retainProgress(session)).rejects.toThrow('account_changed');
  expect(localStorage.getItem(`gipf:recovery:${session.usernameId}`)).toBe('original recovery');
  expect(localStorage.getItem('chessMatch:v1')).toBe('original match');
});
