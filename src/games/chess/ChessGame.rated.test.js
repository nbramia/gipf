// Rated-match abandonment across the match boundary (conflict and recovery
// choices), match-id scoring, tab keyboard handling and the forfeit dialog.

import React from 'react';
import { render, fireEvent, act } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

jest.mock('react-chessboard', () => ({ Chessboard: () => <div data-testid="chessboard-stub" /> }));

import ChessGame from './ChessGame';
import ChessBoard from './ChessBoard';
import { encodeBoard } from './matchSnapshot';
import { beforeReplace } from './ratedMatches';

const snap = (id, pgn, ui = {}) => {
  const board = new ChessBoard();
  board.loadPgn(pgn);
  return {
    v: 1, game: 'chess', id, updatedAt: Date.now(), state: encodeBoard(board),
    ui: { humanColor: 'w', rated: true, timeControl: 'off', ...ui },
  };
};
const seed = (value) => localStorage.setItem('chessMatch:v1', JSON.stringify(value));
const mount = () => render(<MemoryRouter><ChessGame /></MemoryRouter>);
const press = async (utils, name) => {
  await act(async () => { fireEvent.click(utils.getByRole('button', { name })); });
};
const rating = () => JSON.parse(localStorage.getItem('chessRating') || '1000');
const ratedGames = () => JSON.parse(localStorage.getItem('chessRatedGames') || '0');

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem('chessIntroSeen', 'true');
});

describe('beforeReplace policy', () => {
  test('a rated match past the abort window needs a forfeit; inside it, or once scored, it does not', () => {
    expect(beforeReplace({ dropped: [snap('a', '1. e4 e5')], next: null })).toBeTruthy();
    expect(beforeReplace({ dropped: [snap('a', '1. e4')], next: null })).toBeNull();
    expect(beforeReplace({ dropped: [snap('a', '1. e4 e5', { rated: false })], next: null })).toBeNull();
    expect(beforeReplace({ dropped: [snap('a', '1. e4 e5', { ratedApplied: true })], next: null })).toBeNull();
    localStorage.setItem('chessRatedScored', JSON.stringify(['a']));
    expect(beforeReplace({ dropped: [snap('a', '1. e4 e5')], next: null })).toBeNull();
  });

  test('restoring an earlier snapshot of the same match is a rewind; a later one is not', () => {
    const live = snap('a', '1. e4 e5 2. Nf3 Nc6');
    expect(beforeReplace({ dropped: [live], next: snap('a', '1. e4 e5') })).toBeTruthy();
    expect(beforeReplace({ dropped: [snap('a', '1. e4 e5')], next: live })).toBeNull();
  });
});

describe('conflict and recovery replacements', () => {
  test('using the other tab match over a started rated game asks and forfeits', async () => {
    seed(snap('mine', '1. e4 e5'));
    const utils = mount();
    seed(snap('theirs', '1. d4'));
    await act(async () => { window.dispatchEvent(new StorageEvent('storage', { key: 'chessMatch:v1' })); });
    await press(utils, 'Use other tab match');
    const dialog = await utils.findByRole('dialog', { name: 'Abandon this rated game?' });
    expect(dialog).toBeTruthy();
    expect(ratedGames()).toBe(0);
    await press(utils, 'Forfeit and continue');
    expect(ratedGames()).toBe(1);
    expect(rating()).toBeLessThan(1000);
  });

  test('cancelling the prompt keeps the conflict and records nothing', async () => {
    seed(snap('mine', '1. e4 e5'));
    const utils = mount();
    seed(snap('theirs', '1. d4'));
    await act(async () => { window.dispatchEvent(new StorageEvent('storage', { key: 'chessMatch:v1' })); });
    await press(utils, 'Use other tab match');
    await press(utils, 'Cancel');
    expect(utils.getByRole('button', { name: 'Keep this match' })).toBeTruthy();
    expect(ratedGames()).toBe(0);
  });

  test('"Keep backup and start new game" from recovery forfeits a started rated game', async () => {
    seed(snap('mine', '1. e4 e5'));
    localStorage.setItem('chessMatchRecovery:v1', JSON.stringify({ v: 1, alternatives: [snap('old', '1. c4')] }));
    const utils = mount();
    await press(utils, 'Match recovery');
    await press(utils, 'Keep backup and start new game');
    await press(utils, 'Forfeit and continue');
    expect(ratedGames()).toBe(1);
  });

  test('a match already scored by id never scores again when a snapshot of it returns', async () => {
    localStorage.setItem('chessRatedScored', JSON.stringify(['again']));
    seed(snap('again', '1. e4 e5'));
    const utils = mount();
    await press(utils, 'New Rated Game');
    expect(utils.queryByRole('dialog')).toBeNull();
    expect(ratedGames()).toBe(0);
  });

  test('forfeiting records the id so a retained snapshot of the match is not scored twice', async () => {
    seed(snap('mine', '1. e4 e5'));
    const utils = mount();
    await press(utils, 'New Rated Game');
    await press(utils, 'Forfeit and continue');
    expect(JSON.parse(localStorage.getItem('chessRatedScored'))).toContain('mine');
    expect(ratedGames()).toBe(1);
  });
});

describe('tabs and dialog keyboard behaviour', () => {
  test('arrow keys move between the tabs (roving tabindex) and do not step through history', async () => {
    seed(snap('k', '1. d4 d5', { rated: false }));
    const utils = mount();
    const play = utils.getByRole('tab', { name: 'Play' });
    const train = utils.getByRole('tab', { name: 'Train' });
    expect(play.tabIndex).toBe(0);
    expect(train.tabIndex).toBe(-1);
    play.focus();
    await act(async () => { fireEvent.keyDown(play, { key: 'ArrowRight' }); });
    expect(train.getAttribute('aria-selected')).toBe('true');
    expect(document.activeElement).toBe(train);
    expect(train.tabIndex).toBe(0);
    expect(play.tabIndex).toBe(-1);
    await act(async () => { fireEvent.keyDown(train, { key: 'ArrowLeft' }); });
    expect(play.getAttribute('aria-selected')).toBe('true');
    await act(async () => { fireEvent.keyDown(play, { key: 'End' }); });
    expect(train.getAttribute('aria-selected')).toBe('true');
    await act(async () => { fireEvent.keyDown(train, { key: 'Home' }); });
    expect(play.getAttribute('aria-selected')).toBe('true');
    expect(utils.container.textContent).not.toMatch(/Reviewing move/);
  });

  test('the forfeit dialog takes focus, traps Tab, cancels on Escape and returns focus', async () => {
    seed(snap('d', '1. e4 e5'));
    const utils = mount();
    const trigger = utils.getByRole('button', { name: 'New Rated Game' });
    trigger.focus();
    await act(async () => { fireEvent.click(trigger); });
    const dialog = utils.getByRole('dialog');
    const cancel = utils.getByRole('button', { name: 'Cancel' });
    const confirm = utils.getByRole('button', { name: 'Forfeit and continue' });
    expect(document.activeElement).toBe(cancel);
    confirm.focus();
    await act(async () => { fireEvent.keyDown(confirm, { key: 'Tab' }); });
    expect(document.activeElement).toBe(cancel);
    await act(async () => { fireEvent.keyDown(cancel, { key: 'Tab', shiftKey: true }); });
    expect(document.activeElement).toBe(confirm);
    await act(async () => { fireEvent.keyDown(dialog, { key: 'Escape' }); });
    expect(utils.queryByRole('dialog')).toBeNull();
    expect(document.activeElement).toBe(trigger);
    expect(ratedGames()).toBe(0);
  });
});

describe('a failed replacement books nothing', () => {
  afterEach(() => jest.restoreAllMocks());

  test.each(['invalid backup', 'recovery storage full'])('%s leaves the live match and its score intact', async (reason) => {
    seed(snap('live', '1. d4 d5'));
    const backup = reason === 'invalid backup' ? { unreadable: 'damaged saved match' } : snap('backup', '1. e4');
    localStorage.setItem('chessMatchRecovery:v1', JSON.stringify({ v: 1, alternatives: [backup] }));
    const utils = mount();
    await press(utils, 'Match recovery');
    if (reason === 'recovery storage full') {
      const original = Storage.prototype.setItem;
      jest.spyOn(Storage.prototype, 'setItem').mockImplementation(function (k, v) {
        if (k === 'chessMatchRecovery:v1') throw new DOMException('full', 'QuotaExceededError');
        return original.call(this, k, v);
      });
    }
    await press(utils, 'Restore backup 1');
    if (utils.queryByRole('button', { name: 'Forfeit and continue' })) await press(utils, 'Forfeit and continue');
    expect(utils.container.textContent).toContain('That backup is unsupported or storage is full.');
    expect(JSON.parse(localStorage.getItem('chessMatch:v1')).id).toBe('live');
    expect(ratedGames()).toBe(0);
    expect(rating()).toBe(1000);
    expect(localStorage.getItem('chessRatedScored')).toBeNull();
    jest.restoreAllMocks();
    await press(utils, 'Close recovery');
    await press(utils, 'New Rated Game');
    await press(utils, 'Forfeit and continue');
    expect(ratedGames()).toBe(1);
    expect(JSON.parse(localStorage.getItem('chessOppHistory')).rated['1000'].l).toBe(1);
  });
});
