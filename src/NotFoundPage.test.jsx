import React from 'react';
import { render, screen } from '@testing-library/react';
import App from './App.jsx';

test('an unknown route renders a not-found page with a link home', async () => {
  window.history.pushState({}, '', '/this-route-does-not-exist');
  render(<App />);
  expect(await screen.findByRole('heading', { name: 'Page not found' })).toBeTruthy();
  expect(screen.getByRole('link', { name: 'Back to Games' }).getAttribute('href')).toBe('/');
  expect(document.title).toBe('Page not found · Play');
});
