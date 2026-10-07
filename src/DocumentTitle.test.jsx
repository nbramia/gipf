import React from 'react';
import { render, act } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import DocumentTitle, { titleFor } from './DocumentTitle.jsx';

test('titles come from the registry and route', () => {
  expect(titleFor('/')).toBe('Play');
  expect(titleFor('/yinsh')).toBe('YINSH · Play');
  expect(titleFor('/chess/')).toBe('CHESS · Play');
  expect(titleFor('/CHESS')).toBe('CHESS · Play');
  expect(titleFor('/Login')).toBe('Sign in · Play');
  expect(titleFor('/login')).toBe('Sign in · Play');
  expect(titleFor('/nope')).toBe('Page not found · Play');
});

test('wins over a title a game assigns later', async () => {
  render(<MemoryRouter initialEntries={['/']}><DocumentTitle /></MemoryRouter>);
  expect(document.title).toBe('Play');
  await act(async () => { document.title = 'Splendor'; await Promise.resolve(); });
  expect(document.title).toBe('Play');
});
