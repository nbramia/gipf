import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import GamesMigration from './GamesMigration.jsx';
import * as migration from './migration.js';
jest.mock('./migration.js', () => ({ captureIdentity:jest.fn(() => ({check:jest.fn(),invalidate:jest.fn()})),exportProgress:jest.fn(),validateFile:jest.fn(),previewImport:jest.fn(),stageImport:jest.fn(),inspectStages:jest.fn(),rawStageRecovery:jest.fn(),MAX_BYTES:5242880 }));
beforeEach(() => { jest.clearAllMocks(); migration.captureIdentity.mockImplementation(() => ({check:jest.fn(),invalidate:jest.fn()})); migration.inspectStages.mockResolvedValue({stages:[],unreadable:0}); });
test('states activation behavior, shows incomplete export issues and uses explicit import choice', async () => {
  const bundle = {exportId:'synthetic',records:[{kind:'preference',id:'chessDarkMode',data:'true'}]};
  migration.exportProgress.mockResolvedValue({bundles:[bundle],manifest:[{kind:'preference',id:'chessDarkMode',file:1}],issues:['diplomacyGameState: unsupported; original retained.']});
  migration.validateFile.mockResolvedValue(bundle);
  migration.previewImport.mockReturnValue([{kind:'preference',id:'chessDarkMode',status:'different'}]);
  migration.stageImport.mockResolvedValue({status:'retained'});
  render(<GamesMigration />);
  expect(screen.getByText(/Signed-in accounts can activate/)).toBeTruthy();
  fireEvent.click(screen.getByRole('button',{name:'Prepare export'}));
  await screen.findByText(/diplomacyGameState/);
  expect(screen.getByRole('button',{name:'Download incomplete export'})).toBeTruthy();
  fireEvent.change(screen.getByLabelText('Migration file'), {target:{files:[{size:20,text:async () => '{}'}]}});
  await screen.findByText('different');
  expect(screen.getByText(/Guest privacy warning/)).toBeTruthy();
  expect(screen.getByLabelText(/I consent to storing this file unencrypted/).checked).toBe(false);
  const retain = screen.getByRole('button',{name:'Retain imported file separately'});
  expect(retain.disabled).toBe(true);
  fireEvent.click(screen.getByLabelText(/I have selected the intended/));
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

test('split export lists each file, says each alone is partial, and tracks downloads', async () => {
  global.URL.createObjectURL = jest.fn(() => 'blob:synthetic'); global.URL.revokeObjectURL = jest.fn();
  const click = jest.spyOn(HTMLAnchorElement.prototype,'click').mockImplementation(() => {});
  const bundles = [
    {exportId:'one',records:[{kind:'diplomacy-save',id:'diplomacyGameState'}]},
    {exportId:'two',records:[{kind:'preference',id:'chessLearningGoal'},{kind:'preference',id:'chessDarkMode'}]},
  ];
  migration.exportProgress.mockResolvedValue({bundles,manifest:[{kind:'diplomacy-save',id:'diplomacyGameState',file:1},{kind:'preference',id:'chessLearningGoal',file:2},{kind:'preference',id:'chessDarkMode',file:2}],issues:[]});
  render(<GamesMigration />);
  fireEvent.click(screen.getByRole('button',{name:'Prepare export'}));
  await screen.findByText(/3 supported progress records in 2 files/);
  expect(screen.getByText(/Each file alone is partial/).textContent).toMatch(/0 of 2 downloads started\. This page cannot confirm/);
  expect(screen.queryByRole('button',{name:'Download export'})).toBeNull();
  expect(screen.queryByText(/Incomplete export/)).toBeNull();
  expect(screen.getByText('diplomacy-save · diplomacyGameState')).toBeTruthy();
  fireEvent.click(screen.getByRole('button',{name:'Download file 2 of 2'}));
  await waitFor(() => expect(screen.getByText(/Each file alone is partial/).textContent).toMatch(/1 of 2 downloads started/));
  expect(click).toHaveBeenCalledTimes(1);
  expect(click.mock.instances[0].download).toBe('games-migration-two-part-2-of-2.json');
  expect(screen.getByText(/File 2 of 2 · 2 records · download started/)).toBeTruthy();
  click.mockRestore();
});

test('single-file export keeps its unsuffixed filename', async () => {
  global.URL.createObjectURL = jest.fn(() => 'blob:synthetic'); global.URL.revokeObjectURL = jest.fn();
  const click = jest.spyOn(HTMLAnchorElement.prototype,'click').mockImplementation(() => {});
  const bundle = {exportId:'solo',records:[{kind:'preference',id:'chessDarkMode'}]};
  migration.exportProgress.mockResolvedValue({bundles:[bundle],manifest:[{kind:'preference',id:'chessDarkMode',file:1}],issues:[]});
  render(<GamesMigration />);
  fireEvent.click(screen.getByRole('button',{name:'Prepare export'}));
  fireEvent.click(await screen.findByRole('button',{name:'Download export'}));
  await waitFor(() => expect(click).toHaveBeenCalledTimes(1));
  expect(click.mock.instances[0].download).toBe('games-migration-solo.json');
  click.mockRestore();
});

test('a full stage says the limit was reached and nothing was stored', async () => {
  const bundle = {exportId:'big',records:[{kind:'preference',id:'chessDarkMode',data:'true'}]};
  migration.validateFile.mockResolvedValue(bundle);
  migration.previewImport.mockReturnValue([{kind:'preference',id:'chessDarkMode',status:'missing'}]);
  migration.stageImport.mockRejectedValue(new Error('stage_full'));
  render(<GamesMigration />);
  fireEvent.change(screen.getByLabelText('Migration file'), {target:{files:[{size:20,text:async () => '{}'}]}});
  await screen.findByText('missing');
  fireEvent.click(screen.getByLabelText(/I have selected the intended/));
  fireEvent.click(screen.getByRole('button',{name:'Retain imported file separately'}));
  expect((await screen.findByRole('alert')).textContent).toMatch(/limited to 50 files and 5 MiB in total\. Nothing was stored\. Keep the downloaded file instead\./);
});

test('raw recovery without a stage explains itself and consent resets after download', async () => {
  global.URL.createObjectURL = jest.fn(() => 'blob:synthetic'); global.URL.revokeObjectURL = jest.fn();
  const click = jest.spyOn(HTMLAnchorElement.prototype,'click').mockImplementation(() => {});
  migration.rawStageRecovery.mockImplementationOnce(() => { throw new Error('no_stage'); }).mockReturnValueOnce('[]');
  render(<GamesMigration />);
  expect(screen.getByText(/this page cannot import or open it/).textContent).toMatch(/original credentials; no current Games tool decrypts it/);
  const consent = screen.getByLabelText(/I understand raw recovery/);
  const button = screen.getByRole('button',{name:'Download raw stage recovery'});
  fireEvent.click(consent);
  fireEvent.click(button);
  expect((await screen.findByRole('alert')).textContent).toMatch(/No retained stage exists for this account or guest/);
  expect(consent.checked).toBe(true);
  fireEvent.click(button);
  await waitFor(() => expect(click).toHaveBeenCalledTimes(1));
  await waitFor(() => expect(consent.checked).toBe(false));
  expect(button.disabled).toBe(true);
  click.mockRestore();
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
  migration.exportProgress.mockResolvedValue({bundles:[{exportId:'e',records:[]}],manifest:[],issues:[]});
  render(<GamesMigration />);
  fireEvent.click(screen.getByRole('button',{name:'Prepare export'}));
  await screen.findByRole('button',{name:'Download export'});
  fireEvent(window,new StorageEvent('storage',{key:'gipf:account-transition'}));
  expect(screen.queryByRole('button',{name:'Download export'})).toBeNull();
  expect(screen.getByRole('alert').textContent).toMatch(/Account changed/);
});
