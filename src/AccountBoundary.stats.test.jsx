import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import AccountBoundary from './AccountBoundary.jsx';
import { loadSession, retainProgress } from './account.js';
jest.mock('./account.js', () => ({loadSession:jest.fn(),retainProgress:jest.fn()}));
beforeEach(() => {
  localStorage.clear(); jest.useFakeTimers();
  loadSession.mockReturnValue({usernameId:'synthetic',authToken:'synthetic'});
  retainProgress.mockResolvedValue(undefined);
  AbortSignal.timeout = () => new AbortController().signal;
});
afterEach(() => jest.useRealTimers());
const one='[{"synthetic":"device"}]', two='[{"synthetic":"cloud"}]';
test.each(['Keep this device','Use cloud'])('statistics conflict %s retains both choices without addition', async choice => {
  localStorage.setItem('chessGameLog',one);
  global.fetch=jest.fn((_url,init)=>Promise.resolve({ok:true,json:async()=>JSON.parse(init.body).action==='read' ? {revision:2,profile:{preferences:{chessGameLog:two}}} : {revision:3}}));
  render(<AccountBoundary><p>Game mounted</p></AccountBoundary>);
  await act(async()=>{});
  expect(screen.queryByText('Game mounted')).toBeNull();
  fireEvent.click(screen.getByText(choice)); await act(async()=>{});
  expect(screen.getByText('Game mounted')).toBeTruthy();
  expect(JSON.parse(localStorage.getItem('chessStatsRecovery:v1'))).toEqual([one,two]);
  expect(localStorage.getItem('chessGameLog')).toBe(choice==='Use cloud'?two:one);
  if (choice==='Keep this device') {
    await act(async()=>jest.advanceTimersByTime(5000));
    const writes=global.fetch.mock.calls.map(c=>JSON.parse(c[1].body)).filter(r=>r.action==='write');
    expect(writes).toHaveLength(1); expect(writes[0].revision).toBe(2); expect(writes[0].domains.preferences.chessGameLog).toBe(one);
  }
});
