import React from 'react';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import RicochetGame from './RicochetGame.jsx';
import RicochetBoard from './RicochetBoard.js';
import { emptyWalls, cellOf } from './engine/geometry.js';
import { scoreRound } from './engine/scoring.js';

const mockWorkers = [];
jest.mock('./hooks/createAIWorker', () => ({
  createAIWorker: () => {
    const worker = { postMessage: jest.fn(), terminate: jest.fn() };
    mockWorkers.push(worker);
    return worker;
  },
}));

// Bare grid, red in one corner. Even targets sit in the bottom-right corner (reached from the
// top-left by East then South), odd targets in the top-left (reached from the bottom-right by
// North then West), so consecutive puzzles chain: each starts where the last optimal line ended.
const TARGETS = Array.from({ length: 20 }, (_, i) => ({
  id: i, color: 'red', shape: 'circle', cell: i % 2 === 0 ? cellOf(15, 15) : cellOf(0, 0),
}));
const board = () => new RicochetBoard({
  walls: emptyWalls(),
  robots: { red: cellOf(0, 0), green: cellOf(3, 3), blue: cellOf(12, 12), yellow: cellOf(3, 12) },
  targets: TARGETS,
});
const puzzle = i => ({
  targetId: i,
  length: 2,
  solution: i % 2 === 0 ? [{ robot: 'red', dir: 'E' }, { robot: 'red', dir: 'S' }] : [{ robot: 'red', dir: 'N' }, { robot: 'red', dir: 'W' }],
});
const KEYS = i => (i % 2 === 0 ? ['ArrowRight', 'ArrowDown'] : ['ArrowUp', 'ArrowLeft']);

const mount = () => render(
  <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
    <RicochetGame createBoard={board} />
  </MemoryRouter>,
);
const worker = () => mockWorkers[mockWorkers.length - 1];
const lastRequestId = () => worker().postMessage.mock.calls.slice(-1)[0][0].requestId;
const deliver = (round, requestId = lastRequestId()) => act(() => {
  worker().onmessage({ data: { type: 'result', requestId, data: { round } } });
});
const press = key => act(() => { fireEvent.keyDown(window, { key }); });
const advance = ms => act(() => { jest.advanceTimersByTime(ms); });
const wanted = () => mockWorkers.flatMap(w => w.postMessage.mock.calls.map(c => c[0].data.desiredLength));
const requests = () => mockWorkers.reduce((n, w) => n + w.postMessage.mock.calls.length, 0);
const clockText = () => screen.getByTestId('sprint-clock').textContent;
const points = () => screen.getByTestId('sprint-points').textContent;
const click = name => fireEvent.click(screen.getByRole('button', { name }));
const resultsPanel = () => screen.queryByRole('region', { name: 'Sprint results' });
const board10 = () => JSON.parse(localStorage.getItem('ricochetSprintBoard'));
const STANDARD_LIVE = '16-r4-d0-live';

// Starts a Sprint and deals its first puzzle; the next one is requested ahead.
const begin = () => {
  click('Start Sprint');
  deliver(puzzle(0));
};
// Solves puzzle i by key and waits out the slide; the toast shows and the next puzzle is asked
// for from where the robots ended, and dealt.
const solve = (i) => {
  KEYS(i).forEach(press);
  advance(1000);
  deliver(puzzle(i + 1));
};

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem('ricochetInputMode', 'live');
  localStorage.setItem('ricochetGameMode', 'sprint');
  mockWorkers.length = 0;
  jest.useFakeTimers();
});
afterEach(() => { jest.useRealTimers(); });

describe('mode switch', () => {
  test('Classic is the default: no Sprint UI, the round is dealt at once, Give up is there', () => {
    localStorage.removeItem('ricochetGameMode');
    mount();
    expect(screen.getByRole('button', { name: 'Classic' }).getAttribute('aria-pressed')).toBe('true');
    expect(screen.queryByRole('button', { name: 'Start Sprint' })).toBeNull();
    expect(screen.queryByTestId('sprint-clock')).toBeNull();
    expect(requests()).toBe(1);
    deliver(puzzle(0));
    expect(screen.getByTestId('clock')).toBeTruthy();
    expect(screen.getByTestId('hud-rating')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Give up' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Skip' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'End early' })).toBeNull();
  });

  test('the choice is stored in ricochetGameMode and switching to Sprint shows the Start screen without dealing', () => {
    localStorage.removeItem('ricochetGameMode');
    mount();
    deliver(puzzle(0));
    click('Sprint');
    expect(localStorage.getItem('ricochetGameMode')).toBe('sprint');
    expect(screen.getByRole('button', { name: 'Start Sprint' })).toBeTruthy();
    expect(screen.queryByTestId('hud-target')).toBeNull();
    click('Classic');
    expect(localStorage.getItem('ricochetGameMode')).toBe('classic');
    expect(screen.getByText('Dealing a puzzle…')).toBeTruthy();
  });

  test('a stored Sprint mode opens on the Start screen and sends nothing to the worker', () => {
    mount();
    expect(screen.getByRole('button', { name: 'Start Sprint' })).toBeTruthy();
    expect(requests()).toBe(0);
  });

  test('Classic keys cannot reach a hidden Classic round from the Start screen', () => {
    localStorage.removeItem('ricochetGameMode');
    mount();
    deliver(puzzle(0));
    click('Sprint');
    press('ArrowRight');
    click('Classic');
    deliver(puzzle(0));
    expect(screen.getByTestId('move-count').textContent).toBe('0');
  });
});

describe('start screen', () => {
  test('shows the best score of the current setup only', () => {
    localStorage.setItem('ricochetSprintBoard', JSON.stringify({
      [STANDARD_LIVE]: [{ at: 1, points: 412, solved: 6, skipped: 1, avgQuality: 0.9 }],
      '16-r4-d0-plan': [{ at: 1, points: 77, solved: 2, skipped: 0, avgQuality: 1 }],
    }));
    mount();
    expect(screen.getByTestId('sprint-best').textContent).toMatch(/412/);
    expect(screen.getByTestId('sprint-setup').textContent).toBe('16×16, Live');
  });

  test('says so when there is no best yet', () => {
    mount();
    expect(screen.getByTestId('sprint-best').textContent).toMatch(/No best score yet/);
  });

  test('pressing Start deals the first puzzle at length 3 and begins a 5:00 countdown', () => {
    mount();
    click('Start Sprint');
    expect(screen.getByText('Dealing a puzzle…')).toBeTruthy();
    expect(wanted()).toEqual([3]);
    deliver(puzzle(0));
    expect(clockText()).toBe('5:00');
    expect(points()).toBe('0');
    expect(screen.getByRole('button', { name: 'Skip' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Give up' })).toBeNull();
    expect(screen.queryByTestId('hud-rating')).toBeNull();
  });
});

describe('setup', () => {
  test('changing the setup on the Start screen deals nothing and renames the setup', () => {
    mount();
    click('Settings');
    fireEvent.click(within(screen.getByRole('dialog', { name: 'Settings' })).getByRole('button', { name: 'Plan' }));
    fireEvent.click(within(screen.getByRole('dialog', { name: 'Settings' })).getByRole('button', { name: '12×12' }));
    expect(requests()).toBe(0);
    fireEvent.click(within(screen.getByRole('dialog', { name: 'Settings' })).getByRole('button', { name: 'Close' }));
    expect(screen.getByTestId('sprint-setup').textContent).toBe('12×12, Plan');
  });

  test('the session keeps the setup it started with: results go to that setup\'s leaderboard', () => {
    mount();
    begin();
    solve(0);
    click('End early');
    click('End Sprint');
    expect(Object.keys(board10())).toEqual([STANDARD_LIVE]);
  });
});

describe('the 5:00 clock counts active time only', () => {
  test('ends at exactly 5:00 after the puzzle is shown, not before', () => {
    mount();
    click('Start Sprint');
    advance(10000); // dealing the first puzzle
    deliver(puzzle(0));
    advance(299999);
    expect(resultsPanel()).toBeNull();
    expect(clockText()).toBe('0:01');
    advance(1);
    expect(resultsPanel()).toBeTruthy();
    expect(screen.queryByTestId('sprint-clock')).toBeNull();
  });

  test('time spent dealing between puzzles is excluded', () => {
    mount();
    begin();
    advance(2000);
    click('Skip'); // the next puzzle is being dealt
    expect(screen.getByText('Dealing a puzzle…')).toBeTruthy();
    advance(12000);
    expect(clockText()).toBe('4:58');
    deliver(puzzle(2));
    expect(clockText()).toBe('4:58');
    advance(3000);
    expect(clockText()).toBe('4:55');
    advance(294999);
    expect(resultsPanel()).toBeNull();
    advance(1);
    expect(resultsPanel()).toBeTruthy();
  });

  test('time while the tab is hidden is excluded', () => {
    let visibility = 'visible';
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => visibility });
    const setVisibility = v => act(() => { visibility = v; document.dispatchEvent(new Event('visibilitychange')); });
    try {
      mount();
      begin();
      advance(3000);
      setVisibility('hidden');
      advance(10 * 60 * 1000);
      expect(resultsPanel()).toBeNull();
      setVisibility('visible');
      advance(2000);
      expect(clockText()).toBe('4:55');
      advance(294999);
      expect(resultsPanel()).toBeNull();
      advance(1);
      expect(resultsPanel()).toBeTruthy();
    } finally {
      delete document.visibilityState;
    }
  });

  test('turns warning-coloured under 30 s', () => {
    mount();
    begin();
    advance(269000);
    expect(screen.getByTestId('sprint-clock').className).not.toMatch(/warn/);
    advance(1000);
    expect(clockText()).toBe('0:30');
    expect(screen.getByTestId('sprint-clock').className).toMatch(/warn/);
  });
});

describe('puzzles and points', () => {
  test('a solve scores round(100 x quality x pace) of that puzzle alone, with a +N toast, then the next puzzle', () => {
    mount();
    begin();
    advance(90000); // slow first puzzle
    KEYS(0).forEach(press);
    const expected = Math.round(100 * scoreRound({ optimal: 2, moves: 2, timeMs: 90000 }).score);
    expect(expected).toBeGreaterThan(30);
    expect(expected).toBeLessThan(100);
    advance(1000);
    deliver(puzzle(1));
    expect(points()).toBe(String(expected));
    expect(screen.getByTestId('sprint-toast').textContent).toBe(`+${expected}`);
    // the next puzzle is up with a fresh move count; its own clock starts at zero
    expect(screen.getByTestId('move-count').textContent).toBe('0');
    expect(screen.getByTestId('hud-target').textContent).toMatch(/Red circle/);
    // a fast, optimal solve of puzzle 1 scores the full 100
    solve(1);
    expect(points()).toBe(String(expected + 100));
  });

  test('extra moves lower quality: 4 moves for an optimal 2 is half marks', () => {
    mount();
    begin();
    ['ArrowRight', 'ArrowLeft', 'ArrowRight', 'ArrowDown'].forEach(press);
    advance(1000);
    expect(points()).toBe('50');
    expect(points()).toBe(String(Math.round(100 * scoreRound({ optimal: 2, moves: 4, timeMs: 0 }).score)));
  });

  test('the toast goes away by itself', () => {
    mount();
    begin();
    solve(0);
    expect(screen.getByTestId('sprint-toast')).toBeTruthy();
    advance(2000);
    expect(screen.queryByTestId('sprint-toast')).toBeNull();
  });

  test('the next puzzle is dealt from the robots where the player left them, not from the optimal line', () => {
    mount();
    begin();
    // blue takes a detour south, then red solves in 3 moves: not the optimal line
    ['b', 'ArrowDown', 'r', 'ArrowRight', 'ArrowDown'].forEach(press);
    advance(1000);
    const sent = worker().postMessage.mock.calls.slice(-1)[0][0].data.boardState;
    expect(sent.robots.blue).toBe(cellOf(15, 12));
    expect(sent.robots.red).toBe(cellOf(15, 15));
    deliver(puzzle(1));
    expect(screen.getByTestId('robot-blue').getAttribute('data-cell')).toBe(String(cellOf(15, 12)));
    expect(screen.getByTestId('robot-red').getAttribute('data-cell')).toBe(String(cellOf(15, 15)));
    expect(points()).toBe('67');
  });

});

describe('difficulty ramp', () => {
  test('asks for 3, 3, 4, 4, 5, 5 as puzzles are solved', () => {
    mount();
    begin();
    for (let i = 0; i < 5; i++) {
      solve(i);
    }
    expect(wanted().slice(0, 6)).toEqual([3, 3, 4, 4, 5, 5]);
  });

  test('a skip does not advance the ramp', () => {
    mount();
    begin();
    click('Skip');
    deliver(puzzle(2));
    click('Skip');
    expect(wanted()).toEqual([3, 3, 3]);
    deliver(puzzle(4));
    solve(4);
    expect(wanted()).toEqual([3, 3, 3, 3]); // one solve is still length 3
  });

  test('the ramp stops at 9', () => {
    mount();
    begin();
    const total = 16;
    for (let i = 0; i < total; i++) {
      solve(i);
    }
    const all = wanted();
    expect(Math.max(...all)).toBe(9);
    expect(all.slice(0, 12)).toEqual([3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 8, 8]);
  });
});

describe('skip', () => {
  test('scores 0, deals the next puzzle, reveals nothing and spends the target', () => {
    mount();
    begin();
    click('Skip');
    const sent = worker().postMessage.mock.calls.slice(-1)[0][0].data.boardState;
    expect(sent.claimed).toContain(0);
    deliver(puzzle(2));
    expect(points()).toBe('0');
    expect(screen.getByTestId('sprint-toast').textContent).toBe('Skipped');
    expect(screen.queryByRole('region', { name: 'Round results' })).toBeNull();
    expect(screen.queryByTestId('res-optimal')).toBeNull();
    expect(screen.getByTestId('move-count').textContent).toBe('0');
    solve(2);
    expect(points()).toBe('100');
  });

  test('leaves every robot exactly where it was and deals the next puzzle from those positions', () => {
    mount();
    begin();
    const cells = () => ['red', 'green', 'blue', 'yellow'].map(r => screen.getByTestId(`robot-${r}`).getAttribute('data-cell'));
    const before = cells();
    click('Skip');
    const sent = worker().postMessage.mock.calls.slice(-1)[0][0].data.boardState;
    expect(sent.robots).toEqual({ red: cellOf(0, 0), green: cellOf(3, 3), blue: cellOf(12, 12), yellow: cellOf(3, 12) });
    deliver(puzzle(2));
    expect(cells()).toEqual(before);
    expect(screen.getByTestId('robot-red').getAttribute('data-cell')).not.toBe(String(cellOf(15, 15)));
  });

  test('after moves were made, the robots stay where the player had put them', () => {
    mount();
    begin();
    press('ArrowRight'); // red to the top-right corner
    click('Skip');
    const sent = worker().postMessage.mock.calls.slice(-1)[0][0].data.boardState;
    expect(sent.robots.red).toBe(cellOf(0, 15));
    deliver(puzzle(1));
    expect(screen.getByTestId('robot-red').getAttribute('data-cell')).toBe(String(cellOf(0, 15)));
  });

  test('is counted on the results screen', () => {
    mount();
    begin();
    click('Skip');
    deliver(puzzle(2));
    click('Skip');
    deliver(puzzle(4));
    advance(300000);
    expect(screen.getByTestId('sprint-res-skipped').textContent).toBe('2');
    expect(screen.getByTestId('sprint-res-solved').textContent).toBe('0');
    expect(screen.getByTestId('sprint-res-points').textContent).toBe('0');
  });

  test('is not available while a plan is replaying', () => {
    localStorage.setItem('ricochetInputMode', 'plan');
    mount();
    begin();
    ['ArrowRight', 'ArrowDown'].forEach(press);
    click('Submit');
    expect(screen.getByRole('button', { name: 'Skip' }).disabled).toBe(true);
  });
});

describe('the buzzer', () => {
  test('a solve made after 5:00 of active time has passed is not banked, even if the buzzer has not fired yet', () => {
    mount();
    begin();
    act(() => { jest.setSystemTime(Date.now() + 300500); }); // time passes without running the buzzer timer
    KEYS(0).forEach(press); // the solve finds time already up: the session ends, the solve is not banked
    expect(resultsPanel()).toBeTruthy();
    expect(screen.getByTestId('sprint-res-solved').textContent).toBe('0');
    expect(localStorage.getItem('ricochetSprintBoard')).toBeNull();
  });

  test('an unfinished puzzle scores nothing, finished ones count', () => {
    mount();
    begin();
    solve(0);
    press('ArrowUp'); // half way through puzzle 1
    advance(300000);
    expect(resultsPanel()).toBeTruthy();
    expect(screen.getByTestId('sprint-res-points').textContent).toBe('100');
    expect(screen.getByTestId('sprint-res-solved').textContent).toBe('1');
    expect(board10()[STANDARD_LIVE]).toHaveLength(1);
    expect(board10()[STANDARD_LIVE][0]).toMatchObject({ points: 100, solved: 1, skipped: 0 });
  });

  test('a session with nothing solved records nothing', () => {
    mount();
    begin();
    press('ArrowRight');
    advance(300000);
    expect(resultsPanel()).toBeTruthy();
    expect(screen.getByTestId('sprint-res-points').textContent).toBe('0');
    expect(localStorage.getItem('ricochetSprintBoard')).toBeNull();
  });

  test('input after the buzzer does nothing and a late worker reply is ignored', () => {
    mount();
    begin();
    advance(300000);
    press('ArrowUp');
    expect(resultsPanel()).toBeTruthy();
    expect(screen.queryByTestId('hud-target')).toBeNull();
  });
});

describe('plan mode', () => {
  beforeEach(() => localStorage.setItem('ricochetInputMode', 'plan'));
  const plan = keys => keys.forEach(press);

  test('a solving plan counts when submitted, shows its points and the next puzzle after the replay', () => {
    mount();
    begin();
    plan(KEYS(0));
    click('Submit');
    advance(100);
    expect(points()).toBe('0'); // the replay is still running: nothing is given away
    expect(screen.queryByTestId('sprint-toast')).toBeNull();
    advance(1200);
    expect(points()).toBe('100');
    expect(screen.getByTestId('sprint-toast').textContent).toBe('+100');
    deliver(puzzle(1));
    expect(screen.getByTestId('plan-count').textContent).toMatch(/0 steps/);
    expect(localStorage.getItem('ricochetHistory')).toBeNull();
    expect(localStorage.getItem('ricochetRating')).toBeNull();
  });

  test('a failed submit costs only thinking time: no points, same puzzle, the replay is not counted', () => {
    mount();
    begin();
    advance(1000);
    plan(['ArrowRight', 'ArrowRight']);
    click('Submit');
    advance(3000); // the replay ends after 1.4 s; the remaining 1.6 s are thinking time again
    expect(points()).toBe('0');
    expect(screen.getByTestId('plan-notice').textContent).toMatch(/Not solved/);
    expect(clockText()).toBe('4:58');
    expect(screen.getByRole('button', { name: 'Skip' })).toBeTruthy();
  });

  test('a 9-step submit costs no session time', () => {
    mount();
    begin();
    plan(Array(9).fill('ArrowRight'));
    click('Submit');
    advance(9 * 300 + 800); // the whole replay and the hold
    expect(screen.getByTestId('plan-notice').textContent).toMatch(/Not solved/);
    expect(clockText()).toBe('5:00');
    advance(1000);
    expect(clockText()).toBe('4:59');
  });

  test('the replay of a solving plan costs no session time either', () => {
    mount();
    begin();
    advance(1000);
    plan(KEYS(0));
    click('Submit');
    advance(1200);
    deliver(puzzle(1));
    expect(clockText()).toBe('4:59');
  });

  test('the slide after a Live solve is not session time', () => {
    localStorage.setItem('ricochetInputMode', 'live');
    mount();
    begin();
    KEYS(0).forEach(press);
    advance(5000);
    deliver(puzzle(1));
    advance(299999); // had the 0.68 s slide counted, time would be up by now
    expect(resultsPanel()).toBeNull();
  });

});

describe('Classic data is never touched', () => {
  test('no rating, variant rating or history is written by solving, skipping, ending early or the buzzer', () => {
    mount();
    begin();
    solve(0);
    click('Skip');
    deliver(puzzle(3)); // a fresh deal: the clock was paused while it was dealt
    expect(points()).toBe('100');
    advance(300000);
    expect(resultsPanel()).toBeTruthy();
    expect(localStorage.getItem('ricochetRating')).toBeNull();
    expect(localStorage.getItem('ricochetHistory')).toBeNull();
    expect(localStorage.getItem('ricochetVariantRatings')).toBeNull();
    expect(board10()).toBeTruthy();
  });

  test('existing Classic data is left byte for byte as it was', () => {
    const rating = JSON.stringify({ rating: 1337, rounds: 31 });
    const history = '[]';
    localStorage.setItem('ricochetRating', rating);
    localStorage.setItem('ricochetHistory', history);
    mount();
    begin();
    solve(0);
    click('Skip');
    click('End early');
    click('End Sprint');
    expect(localStorage.getItem('ricochetRating')).toBe(rating);
    expect(localStorage.getItem('ricochetHistory')).toBe(history);
  });
});

describe('ending early and leaving', () => {
  test('End early asks first; cancelling keeps the session and records nothing', () => {
    mount();
    begin();
    solve(0);
    click('End early');
    expect(screen.getByRole('dialog', { name: 'End this Sprint?' })).toBeTruthy();
    click('Cancel');
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(resultsPanel()).toBeNull();
    expect(localStorage.getItem('ricochetSprintBoard')).toBeNull();
    expect(points()).toBe('100');
  });

  test('confirming ends the session, banks finished puzzles and shows the results', () => {
    mount();
    begin();
    solve(0);
    click('End early');
    click('End Sprint');
    expect(resultsPanel()).toBeTruthy();
    expect(screen.getByTestId('sprint-res-points').textContent).toBe('100');
    expect(board10()[STANDARD_LIVE]).toHaveLength(1);
    advance(600000);
    expect(board10()[STANDARD_LIVE]).toHaveLength(1); // the buzzer does not record a second time
  });

  test('a keypress while the confirm is open does not play', () => {
    mount();
    begin();
    click('End early');
    press('ArrowRight');
    click('Cancel');
    expect(screen.getByTestId('move-count').textContent).toBe('0');
  });

  test('leaving mid-session (a refresh) records nothing', () => {
    const view = mount();
    begin();
    solve(0);
    expect(points()).toBe('100');
    view.unmount();
    advance(600000);
    expect(localStorage.getItem('ricochetSprintBoard')).toBeNull();
    expect(localStorage.getItem('ricochetRating')).toBeNull();
    expect(localStorage.getItem('ricochetHistory')).toBeNull();
    mount();
    expect(screen.getByRole('button', { name: 'Start Sprint' })).toBeTruthy();
  });

  test('the mode switch and setup settings are locked while a Sprint runs', () => {
    mount();
    begin();
    expect(screen.getByRole('button', { name: 'Classic' }).disabled).toBe(true);
    click('Settings');
    expect(within(screen.getByRole('dialog', { name: 'Settings' })).getByRole('button', { name: 'Live' }).disabled).toBe(true);
    expect(within(screen.getByRole('dialog', { name: 'Settings' })).getByRole('button', { name: '12×12' }).disabled).toBe(true);
  });
});

describe('results and leaderboard', () => {
  const finish = (solved) => {
    mount();
    begin();
    for (let i = 0; i < solved; i++) {
      solve(i);
    }
    advance(300000);
  };

  test('shows solved, skipped, points, average quality, best puzzle, optimal count and a personal best', () => {
    finish(2);
    expect(screen.getByTestId('sprint-pb').textContent).toBe('New personal best!');
    expect(screen.getByTestId('sprint-res-points').textContent).toBe('200');
    expect(screen.getByTestId('sprint-res-solved').textContent).toBe('2');
    expect(screen.getByTestId('sprint-res-skipped').textContent).toBe('0');
    expect(screen.getByTestId('sprint-res-quality').textContent).toBe('100%');
    expect(screen.getByTestId('sprint-res-best').textContent).toBe('100 pts');
    expect(screen.getByTestId('sprint-res-optimal').textContent).toBe('2');
    const table = screen.getByRole('table', { name: 'Sprint top 10' });
    const rows = within(table).getAllByRole('row').slice(1);
    expect(rows).toHaveLength(1);
    expect(rows[0].getAttribute('aria-current')).toBe('true');
  });

  test('a lower score than the best is ranked, highlighted, and not a personal best', () => {
    localStorage.setItem('ricochetSprintBoard', JSON.stringify({
      [STANDARD_LIVE]: [{ at: 1, points: 900, solved: 12, skipped: 0, avgQuality: 1 }],
    }));
    finish(1);
    expect(screen.queryByTestId('sprint-pb')).toBeNull();
    const rows = within(screen.getByRole('table', { name: 'Sprint top 10' })).getAllByRole('row').slice(1);
    expect(rows).toHaveLength(2);
    expect(rows[0].getAttribute('aria-current')).toBeNull();
    expect(rows[1].getAttribute('aria-current')).toBe('true');
  });

  test('Done returns to the Start screen showing the new best', () => {
    finish(1);
    click('Done');
    expect(screen.getByTestId('sprint-best').textContent).toMatch(/100/);
    click('Start Sprint');
    deliver(puzzle(0));
    expect(clockText()).toBe('5:00');
    expect(points()).toBe('0');
  });

  test('the Progress panel has a Sprint tab with the leaderboard of every setup', () => {
    localStorage.setItem('ricochetSprintBoard', JSON.stringify({
      [STANDARD_LIVE]: [{ at: 1, points: 412, solved: 6, skipped: 1, avgQuality: 0.9 }],
      '12-r5-d1-plan': [{ at: 2, points: 55, solved: 1, skipped: 3, avgQuality: 0.5 }],
    }));
    mount();
    click('Progress');
    expect(screen.queryByTestId('sprint-boards')).toBeNull();
    fireEvent.click(within(screen.getByRole('dialog', { name: 'Progress' })).getByRole('button', { name: 'Sprint' }));
    const boards = screen.getByTestId('sprint-boards');
    expect(within(boards).getByRole('table', { name: 'Sprint top 10, 16×16, Live' })).toBeTruthy();
    expect(within(boards).getByRole('table', { name: 'Sprint top 10, 12×12, black robot, barriers, Plan' })).toBeTruthy();
    expect(boards.textContent).toMatch(/412/);
    // the current setup comes first
    expect(within(boards).getAllByRole('heading')[0].textContent).toBe('16×16, Live');
  });

  test('corrupt leaderboard storage does not break the Start screen or the Progress tab', () => {
    localStorage.setItem('ricochetSprintBoard', '{broken');
    mount();
    expect(screen.getByTestId('sprint-best').textContent).toMatch(/No best score/);
    click('Progress');
    fireEvent.click(within(screen.getByRole('dialog', { name: 'Progress' })).getByRole('button', { name: 'Sprint' }));
    expect(screen.getByTestId('sprint-boards').textContent).toMatch(/No sprints yet/);
  });
});

describe('leaving a Classic round by switching mode', () => {
  test('the abandoned Classic round is reset, not left half played', () => {
    localStorage.removeItem('ricochetGameMode');
    mount();
    deliver(puzzle(0));
    press('ArrowRight');
    expect(screen.getByTestId('robot-red').getAttribute('data-cell')).toBe(String(cellOf(0, 15)));
    click('Sprint');
    click('Classic');
    const sent = worker().postMessage.mock.calls.slice(-1)[0][0].data.boardState;
    expect(sent.robots.red).toBe(cellOf(0, 0));
    deliver(puzzle(0));
    expect(screen.getByTestId('robot-red').getAttribute('data-cell')).toBe(String(cellOf(0, 0)));
    expect(screen.getByTestId('move-count').textContent).toBe('0');
  });
});

describe('End early', () => {
  test('a mouse press does not leave it focused, so Enter afterwards submits the plan', () => {
    localStorage.setItem('ricochetInputMode', 'plan');
    mount();
    begin();
    ['ArrowRight', 'ArrowDown'].forEach(press);
    const end = screen.getByRole('button', { name: 'End early' });
    expect(fireEvent.mouseDown(end)).toBe(false); // default prevented: no focus
    fireEvent.click(end);
    click('Cancel');
    expect(document.activeElement.tagName).not.toBe('BUTTON');
    press('Enter');
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.getByRole('button', { name: 'Skip' }).disabled).toBe(true); // the plan is being replayed
  });

  test('the results say "Sprint ended" for an early end and "Time\'s up" at the buzzer', () => {
    mount();
    begin();
    click('End early');
    click('End Sprint');
    expect(screen.getByRole('heading', { name: 'Sprint ended' })).toBeTruthy();
    expect(screen.queryByRole('heading', { name: "Time's up" })).toBeNull();
    click('Done');
    click('Start Sprint');
    deliver(puzzle(0));
    advance(300000);
    expect(screen.getByRole('heading', { name: "Time's up" })).toBeTruthy();
  });
});

describe('S shows the solution on a round results screen', () => {
  beforeEach(() => localStorage.removeItem('ricochetGameMode'));

  test('in the results phase S starts the replay', () => {
    mount();
    deliver(puzzle(0));
    press('ArrowRight');
    press('ArrowDown');
    advance(1000);
    expect(screen.getByRole('region', { name: 'Round results' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Show solution' }).disabled).toBe(false);
    press('s');
    expect(screen.getByRole('button', { name: 'Show solution' }).disabled).toBe(true);
    expect(screen.getByText(/Optimal line, move/)).toBeTruthy();
  });

  test('in play S still moves south (Live)', () => {
    mount();
    deliver(puzzle(0));
    press('s');
    expect(screen.getByTestId('robot-red').getAttribute('data-cell')).toBe(String(cellOf(15, 0)));
    expect(screen.getByTestId('move-count').textContent).toBe('1');
  });

  test('in play S still appends a south step (Plan)', () => {
    localStorage.setItem('ricochetInputMode', 'plan');
    mount();
    deliver(puzzle(0));
    press('s');
    expect(screen.getByTestId('plan-count').textContent).toMatch(/1 step/);
  });

  test('How to play mentions it', () => {
    mount();
    click('How to play');
    expect(screen.getByRole('dialog', { name: 'How to play' }).textContent).toMatch(/S shows the solution/);
  });
});
