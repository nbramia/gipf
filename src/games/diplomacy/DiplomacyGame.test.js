// Smoke test for DiplomacyGame — guards against render-time crashes that the
// pure-logic DiplomacyBoard suite cannot catch (only mounting the component
// exercises the SVG map, order panel, and effects). The core assertion is that
// mounting does not throw and the map + key controls render.

import React from 'react';
import { render } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

import DiplomacyGame from './DiplomacyGame';

describe('DiplomacyGame — render smoke', () => {
  test('mounts without throwing and renders the map + key state', () => {
    let container;
    expect(() => {
      ({ container } = render(
        <MemoryRouter>
          <DiplomacyGame />
        </MemoryRouter>
      ));
    }).not.toThrow();

    // The SVG map renders.
    expect(container.querySelector('.dip-board-svg')).toBeTruthy();
    // Phase banner + scoreboard + order panel rendered for Spring 1901.
    expect(container.textContent).toContain('Spring 1901 orders');
    expect(container.textContent).toContain('Supply Centers');
    expect(container.textContent).toContain('Submit Orders');
  });

  test('draws all province nodes and starting units', () => {
    const { container } = render(
      <MemoryRouter>
        <DiplomacyGame />
      </MemoryRouter>
    );
    // Every province in PROVINCES renders a labelled group.
    expect(container.querySelectorAll('.dip-province-group').length).toBe(76);
    // 22 starting units across the seven powers.
    expect(container.querySelectorAll('.dip-unit-group').length).toBe(22);
  });
});
