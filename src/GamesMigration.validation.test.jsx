import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import GamesMigration from './GamesMigration.jsx';
import * as migration from './migration.js';
jest.mock('./migration.js', () => ({ captureIdentity:jest.fn(() => ({check:jest.fn(),invalidate:jest.fn()})),exportProgress:jest.fn(),validateFile:jest.fn(),previewImport:jest.fn(),stageImport:jest.fn(),inspectStages:jest.fn(),rawStageRecovery:jest.fn(),MAX_BYTES:5242880 }));
beforeEach(() => { jest.clearAllMocks(); migration.captureIdentity.mockImplementation(() => ({check:jest.fn(),invalidate:jest.fn()})); });

test.each([
  ['invalid_migration', new Error('invalid_migration'), /This is not a valid Games migration file\. No progress was changed\./],
  ['malformed JSON', new SyntaxError('Unexpected token'), /not valid JSON.*No progress was changed/],
])('a rejected file (%s) is explained next to the input without activation warnings', async (_n, err, text) => {
  migration.validateFile.mockRejectedValue(err);
  render(<GamesMigration />);
  fireEvent.change(screen.getByLabelText('Migration file'), {target:{files:[{size:20,text:async () => '{"not":"a migration"}'}]}});
  const alert = await screen.findByText(text);
  expect(alert.getAttribute('role')).toBe('alert');
  expect(screen.queryByText(/cloud progress may already be committed/)).toBeNull();
  expect(screen.queryByText(/Resume pending activation or download/)).toBeNull();
});

test('an oversize file is reported at the upload step', async () => {
  render(<GamesMigration />);
  fireEvent.change(screen.getByLabelText('Migration file'), {target:{files:[{size:5242881,text:async () => ''}]}});
  expect(await screen.findByText(/larger than 5 MiB.*No progress was changed/)).toBeTruthy();
});

test('a non-activation failure does not claim cloud progress may be committed', async () => {
  migration.validateFile.mockResolvedValue({exportId:'x',records:[]});
  migration.previewImport.mockReturnValue([]);
  migration.stageImport.mockRejectedValue(new Error('boom'));
  render(<GamesMigration />);
  fireEvent.change(screen.getByLabelText('Migration file'), {target:{files:[{size:20,text:async () => '{}'}]}});
  fireEvent.click(await screen.findByRole('button',{name:'Keep destination'}));
  const alert = await screen.findByText(/Unable to finish/);
  expect(alert.textContent).not.toMatch(/cloud progress may already be committed/);
});
