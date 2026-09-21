import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import GamesMigration from './GamesMigration.jsx';
import * as migration from './migration.js';
jest.mock('./migration.js', () => ({ captureIdentity:jest.fn(() => ({check:jest.fn(),invalidate:jest.fn()})),exportProgress:jest.fn(),validateFile:jest.fn(),previewImport:jest.fn(),stageImport:jest.fn(),inspectStages:jest.fn(),rawStageRecovery:jest.fn(),MAX_BYTES:5242880 }));
beforeEach(() => { jest.clearAllMocks(); migration.captureIdentity.mockImplementation(() => ({check:jest.fn(),invalidate:jest.fn()})); migration.inspectStages.mockResolvedValue({stages:[],unreadable:0}); });
test('states activation hold, shows incomplete export issues and uses explicit import choice', async () => {
  const bundle = {exportId:'synthetic',records:[{kind:'preference',id:'chessDarkMode',data:'true'}]};
  migration.exportProgress.mockResolvedValue({bundle,issues:['diplomacyGameState: unsupported; original retained.']});
  migration.validateFile.mockResolvedValue(bundle);
  migration.previewImport.mockReturnValue([{kind:'preference',id:'chessDarkMode',status:'different'}]);
  migration.stageImport.mockResolvedValue({status:'retained'});
  render(<GamesMigration />);
  expect(screen.getByText(/Active save replacement is unavailable/)).toBeTruthy();
  fireEvent.click(screen.getByRole('button',{name:'Prepare export'}));
  await screen.findByText(/diplomacyGameState/);
  expect(screen.getByRole('button',{name:'Download incomplete export'})).toBeTruthy();
  fireEvent.change(screen.getByLabelText('Migration file'), {target:{files:[{size:20,text:async () => '{}'}]}});
  await screen.findByText('different');
  expect(screen.getByText(/Guest privacy warning/)).toBeTruthy();
  expect(screen.getByLabelText(/I consent to storing this file unencrypted/).checked).toBe(false);
  const retain = screen.getByRole('button',{name:'Retain imported file separately'});
  expect(retain.disabled).toBe(true);
  fireEvent.click(screen.getByLabelText(/I understand this only stages/));
  fireEvent.click(retain);
  await waitFor(() => expect(migration.stageImport).toHaveBeenCalledWith(bundle,'retain',expect.anything()));
  expect(await screen.findByText(/File retained separately/)).toBeTruthy();
});

test('in-flight failure does not overwrite identity-change explanation', async () => {
  let reject;
  migration.exportProgress.mockReturnValue(new Promise((_,r) => { reject = r; }));
  let changed = false;
  migration.captureIdentity.mockReturnValue({check:() => { if (changed) throw new Error('account_changed'); },invalidate:() => { changed = true; }});
  render(<GamesMigration />);
  fireEvent.click(screen.getByRole('button',{name:'Prepare export'}));
  fireEvent(window,new StorageEvent('storage',{key:'gipfAccount'}));
  reject(new Error('unrelated deferred error'));
  await waitFor(() => expect(screen.queryByText('Checking local progress…')).toBeNull());
  expect(screen.getByRole('alert').textContent).toMatch(/Account changed. Reload/);
  expect(screen.getByRole('button',{name:'Prepare export'}).closest('fieldset').disabled).toBe(true);
});

test('invalid retained entries are labeled and raw recovery needs separate consent', async () => {
  migration.inspectStages.mockResolvedValue({stages:[{exportId:'valid',exportedAt:'today',records:[]}],unreadable:1});
  render(<GamesMigration />);
  fireEvent.click(screen.getByRole('button',{name:'Show retained files'}));
  await screen.findByText(/1 retained entries cannot be validated/);
  expect(screen.getByRole('button',{name:'Download retained file 1'})).toBeTruthy();
  expect(screen.getByRole('button',{name:'Download raw stage recovery'}).disabled).toBe(true);
  fireEvent.click(screen.getByLabelText(/I understand raw recovery/));
  expect(screen.getByRole('button',{name:'Download raw stage recovery'}).disabled).toBe(false);
});

test('account/transition event discards prepared material and prevents stale downloads', async () => {
  migration.exportProgress.mockResolvedValue({bundle:{records:[]},issues:[]});
  render(<GamesMigration />);
  fireEvent.click(screen.getByRole('button',{name:'Prepare export'}));
  await screen.findByRole('button',{name:'Download export'});
  fireEvent(window,new StorageEvent('storage',{key:'gipf:account-transition'}));
  expect(screen.queryByRole('button',{name:'Download export'})).toBeNull();
  expect(screen.getByRole('alert').textContent).toMatch(/Account changed/);
});
