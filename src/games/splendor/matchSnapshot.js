import SplendorBoard from './SplendorBoard.js';
import { CARDS, CARDS_BY_ID, NOBLES_BY_ID, GEMS, GOLD, ALL_TOKENS, TOKEN_SETUP, GOLD_COUNT, nobleCount, VICTORY_POINTS, MAX_RESERVED, MAX_TOKENS, VISIBLE_PER_TIER } from './splendorCards.js';
import { requireSnapshot, record, count } from '../../snapshotValidation.js';

// The human always holds seat 1; every other seat is an AI, so seats need no field of their own.
const UI = ['difficulty', 'showModal'];
export const DIFFICULTIES = ['strong', 'expert', 'brutal'];
const PHASES = ['play', 'discard', 'noble-choice', 'game-over'];

// Undo history is a cache that grows beyond the wire budget and is not exposed in the UI.
// The canonical position includes both hidden deck orders and every reserved card.
export const encodeBoard = board => ({ ...board.serializeState(), stateHistory: [], historyIndex: -1 });
const KEYS = Object.keys(encodeBoard(new SplendorBoard({ seed: 1 })));
const PLAYER_KEYS = ['id', 'name', 'color', 'tokens', 'bonuses', 'cards', 'reserved', 'nobles', 'points'];

const bad = () => { throw new Error('invalid_snapshot'); };
const check = ok => { if (!ok) bad(); };
const sameKeys = (value, keys) => record(value) && Object.keys(value).length === keys.length && keys.every(k => Object.hasOwn(value, k));
const ids = (value, max) => Array.isArray(value) && value.length <= max;
const text = (v, max) => typeof v === 'string' && v.length <= max;
const isNoble = id => typeof id === 'string' && Object.hasOwn(NOBLES_BY_ID, id);

export function decodeMatch(snapshot) {
  requireSnapshot(snapshot, 'splendor', UI, KEYS);
  const s = snapshot.state;
  const { difficulty } = snapshot.ui;
  check(difficulty === undefined || DIFFICULTIES.includes(difficulty));

  const n = s.playerCount;
  check(Number.isInteger(n) && n >= 2 && n <= 4);
  const seats = Array.from({ length: n }, (_, i) => i + 1);
  check(Array.isArray(s.playerIds) && s.playerIds.join() === seats.join());
  check(Number.isSafeInteger(s.seed) && s.victoryTarget === VICTORY_POINTS && s.maxTurns === null);
  check(seats.includes(s.firstPlayer) && seats.includes(s.currentPlayer) && PHASES.includes(s.phase));
  check(Number.isInteger(s.turnNumber) && s.turnNumber >= 1 && s.turnNumber <= 10000 && typeof s.endTriggered === 'boolean');
  check(text(s.lastAction, 300) && ids(s.log, 60) && s.log.every(line => text(line, 300)));
  check(Array.isArray(s.stateHistory) && s.stateHistory.length === 0 && s.historyIndex === -1 && s.maxHistoryLength === 100);

  // Every development card is in exactly one place: a deck, the market, a reserve or a player's tableau.
  const seen = new Set();
  const place = (cardId, tier) => {
    const card = typeof cardId === 'string' && Object.hasOwn(CARDS_BY_ID, cardId) ? CARDS_BY_ID[cardId] : null;
    check(card &&!seen.has(cardId) && (tier === undefined || card.tier === tier));
    seen.add(cardId);
  };
  check(record(s.decks) && record(s.visible) && record(s.bank) && record(s.players));
  for (const tier of [1, 2, 3]) {
    check(ids(s.decks[tier], 40) && ids(s.visible[tier], VISIBLE_PER_TIER) && s.visible[tier].length === VISIBLE_PER_TIER);
    s.decks[tier].forEach(cardId => place(cardId, tier));
    s.visible[tier].forEach(cardId => { if (cardId !== null) place(cardId, tier); });
  }
  check(Object.keys(s.decks).length === 3 && Object.keys(s.visible).length === 3);

  check(Object.keys(s.players).length === n && seats.every(id => sameKeys(s.players[id], PLAYER_KEYS)));
  const claimed = new Set();
  const totals = Object.fromEntries(ALL_TOKENS.map(t => [t, 0]));
  const tokenSet = tokens => {
    check(sameKeys(tokens, ALL_TOKENS) && ALL_TOKENS.every(t => count(tokens[t], 50)));
    return tokens;
  };
  for (const t of ALL_TOKENS) totals[t] += tokenSet(s.bank)[t];
  for (const id of seats) {
    const p = s.players[id];
    check(p.id === id && text(p.name, 40) && text(p.color, 40));
    for (const t of ALL_TOKENS) totals[t] += tokenSet(p.tokens)[t];
    check(sameKeys(p.bonuses, GEMS) && GEMS.every(g => count(p.bonuses[g], 40)));
    check(ids(p.cards, 90) && ids(p.reserved, MAX_RESERVED) && ids(p.nobles, 10));
    p.cards.forEach(cardId => place(cardId));
    p.reserved.forEach(entry => {
      check(sameKeys(entry, ['cardId', 'hidden']) && typeof entry.hidden === 'boolean');
      place(entry.cardId);
    });
    // Bonuses and prestige are derived from the cards held; stored copies must agree.
    const bonuses = Object.fromEntries(GEMS.map(g => [g, 0]));
    let points = 0;
    for (const cardId of p.cards) { bonuses[CARDS_BY_ID[cardId].bonus] += 1; points += CARDS_BY_ID[cardId].points; }
    check(GEMS.every(g => p.bonuses[g] === bonuses[g]));
    for (const nobleId of p.nobles) { check(isNoble(nobleId) && !claimed.has(nobleId)); claimed.add(nobleId); points += NOBLES_BY_ID[nobleId].points; }
    check(p.points === points);
  }
  check(seen.size === CARDS.length);

  // Tokens are conserved: the bank plus every hand equals the setup supply.
  check(GEMS.every(g => totals[g] === TOKEN_SETUP[n]) && totals[GOLD] === GOLD_COUNT);

  check(ids(s.nobles, 5) && s.nobles.every(id => isNoble(id) &&!claimed.has(id)) && new Set(s.nobles).size === s.nobles.length);
  check(s.nobles.length + claimed.size === nobleCount(n));
  check(ids(s.pendingNobles, 5) && s.pendingNobles.every(id => s.nobles.includes(id)));
  check(s.phase === 'noble-choice' ? s.pendingNobles.length > 1 : s.pendingNobles.length === 0);
  const tokenCount = id => ALL_TOKENS.reduce((sum, t) => sum + s.players[id].tokens[t], 0);
  check(s.phase === 'discard' ? tokenCount(s.currentPlayer) > MAX_TOKENS : seats.every(id => id === s.currentPlayer || tokenCount(id) <= MAX_TOKENS));

  check(ids(s.winners, n) && s.winners.every((id, i) => seats.includes(id) && s.winners.indexOf(id) === i));
  if (s.phase === 'game-over') {
    check(s.winners.length >= 1 && s.winner === (s.winners.length === 1 ? s.winners[0] : null) && count(s.winningPoints, 100));
  } else check(s.winners.length === 0 && s.winner === null && s.winningPoints === 0);

  const board = SplendorBoard.fromSerializedState(JSON.parse(JSON.stringify(s)));
  board._captureState();
  return { board, ui: snapshot.ui };
}
