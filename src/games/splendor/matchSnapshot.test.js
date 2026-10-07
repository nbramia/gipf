import SplendorBoard from './SplendorBoard.js';
import { encodeBoard, decodeMatch } from './matchSnapshot.js';
import { validatePortableMatch } from '../../migrationMatchSchema.js';
import { validateMatch, MAX_MATCH_BYTES } from '../../matchSchema.js';
import { validMatch } from '../../../server/matchValidation.js';

const UI = { difficulty: 'expert', showModal: false };
const envelope = (board, ui = UI) => JSON.parse(JSON.stringify({
  v: 1, game: 'splendor', id: 'synthetic', updatedAt: 1, state: encodeBoard(board), ui,
}));

function rng(seed) {
  let t = seed;
  return () => { t = (t * 1664525 + 1013904223) >>> 0; return t / 4294967296; };
}

// Seeded play that prefers buying, so games progress through every phase.
function step(board, random) {
  const moves = board.getLegalMoves();
  const buys = moves.filter(m => m.type === 'buy');
  const pool = buys.length && random() < 0.8 ? buys : moves;
  return board.applyMove(pool[Math.floor(random() * pool.length)]);
}

function midGame(playerCount = 3, steps = 14) {
  const board = new SplendorBoard({ seed: 4242, playerCount });
  const random = rng(7);
  for (let i = 0; i < steps; i++) expect(step(board, random)).toBe(true);
  return board;
}

describe('Splendor match snapshot', () => {
  test.each([2, 3, 4])('round-trips a %i-player mid-game including hidden deck order', playerCount => {
    const board = midGame(playerCount);
    const snapshot = envelope(board);
    const restored = decodeMatch(JSON.parse(JSON.stringify(snapshot)));
    expect(encodeBoard(restored.board)).toEqual(snapshot.state);
    expect(restored.ui).toEqual(UI);
    expect(restored.board.decks).toEqual(board.decks);
    expect(restored.board.playerCount).toBe(playerCount);
    expect(restored.board.currentPlayer).toBe(board.currentPlayer);
    expect(restored.board.firstPlayer).toBe(board.firstPlayer);
    // The resumed engine plays on identically to the original.
    const next = board.getLegalMoves()[0];
    expect(restored.board.applyMove(next)).toBe(true);
    expect(board.applyMove(next)).toBe(true);
    expect(encodeBoard(restored.board)).toEqual(encodeBoard(board));
  });

  test('every position of full games decodes, in every phase, through game over', () => {
    const phases = new Set();
    for (const [seed, playerCount] of [[11, 2], [12, 3], [13, 4]]) {
      const board = new SplendorBoard({ seed, playerCount });
      const random = rng(seed);
      for (let i = 0; i < 1500 && board.phase !== 'game-over'; i++) {
        expect(step(board, random)).toBe(true);
        phases.add(board.phase);
        const restored = decodeMatch(envelope(board));
        expect(encodeBoard(restored.board)).toEqual(encodeBoard(board));
        expect(() => validatePortableMatch(envelope(board), 'splendor')).not.toThrow();
      }
      expect(board.phase).toBe('game-over');
    }
    expect(phases.has('discard')).toBe(true);
    expect(phases.has('game-over')).toBe(true);
  });

  test('a snapshot without UI fields is valid and difficulty is optional', () => {
    expect(() => decodeMatch(envelope(midGame(2), {}))).not.toThrow();
  });
});

describe('Splendor snapshot rejection', () => {
  const mutate = fn => { const s = envelope(midGame(2)); fn(s); return s; };
  const firstSeat = s => s.state.players[1];

  test.each([
    ['wrong game', s => { s.game = 'catan'; }],
    ['unknown state field', s => { s.state.extra = 1; }],
    ['missing state field', s => { delete s.state.decks; }],
    ['unknown ui field', s => { s.ui.other = 1; }],
    ['bad difficulty', s => { s.ui.difficulty = 'godlike'; }],
    ['non-boolean showModal', s => { s.ui.showModal = 'yes'; }],
    ['player count out of range', s => { s.state.playerCount = 5; }],
    ['mismatched seats', s => { s.state.playerIds = [1, 3]; }],
    ['unknown phase', s => { s.state.phase = 'trading'; }],
    ['current seat not in game', s => { s.state.currentPlayer = 4; }],
    ['non-empty undo history', s => { s.state.stateHistory = ['{}']; }],
    ['non-null maxTurns', s => { s.state.maxTurns = 5; }],
    ['duplicate card across market and deck', s => { s.state.decks[1][0] = s.state.visible[1][0]; }],
    ['card in the wrong tier deck', s => { s.state.decks[1][0] = s.state.decks[3][0]; s.state.decks[3][0] = 't1-01'; }],
    ['missing card', s => { s.state.decks[2].pop(); }],
    ['unknown card id', s => { s.state.decks[2][0] = 'x-99'; }],
    ['prototype-key card id', s => { s.state.decks[2][0] = 'constructor'; }],
    ['market row of wrong length', s => { s.state.visible[1].pop(); }],
    ['token created from nothing', s => { firstSeat(s).tokens.red += 1; }],
    ['negative token count', s => { firstSeat(s).tokens.red = -1; s.state.bank.red += 1; }],
    ['fractional token count', s => { s.state.bank.red += 0.5; }],
    ['extra token colour', s => { s.state.bank.pearl = 1; }],
    ['bonuses that disagree with owned cards', s => { firstSeat(s).bonuses.white += 1; }],
    ['points that disagree with owned cards', s => { firstSeat(s).points += 3; }],
    ['unknown noble', s => { s.state.nobles[0] = 'n99'; }],
    ['noble both on the table and claimed', s => { firstSeat(s).nobles = [s.state.nobles[0]]; firstSeat(s).points += 3; }],
    ['too many reserved cards', s => { const p = firstSeat(s); p.reserved = [0, 1, 2, 3].map(i => ({ cardId: s.state.decks[1][i], hidden: true })); s.state.decks[1].splice(0, 4); }],
    ['reserved entry with extra field', s => { firstSeat(s).reserved.push({ cardId: s.state.decks[1].pop(), hidden: true, peek: true }); }],
    ['discard phase without excess tokens', s => { s.state.phase = 'discard'; }],
    ['noble-choice phase without candidates', s => { s.state.phase = 'noble-choice'; }],
    ['winner while the game is live', s => { s.state.winners = [1]; s.state.winner = 1; }],
    ['oversized log line', s => { s.state.log.push('x'.repeat(301)); }],
    ['__proto__ key', s => { s.state = JSON.parse(JSON.stringify(s.state).replace('"seed"', '"__proto__"')); }],
  ])('rejects %s', (_label, change) => {
    const snapshot = mutate(change);
    expect(() => decodeMatch(snapshot)).toThrow('invalid_snapshot');
  });

  test('the shared byte guard, not field validation, stops an oversized envelope', () => {
    const ok = envelope(midGame(2));
    expect(validateMatch(ok, 'splendor')).toBe(true);
    // Same valid fields; only padding beyond the byte budget differs.
    expect(validateMatch({ ...ok, state: { ...ok.state, pad: 'x'.repeat(MAX_MATCH_BYTES) } }, 'splendor')).toBe(false);
  });

  test('the largest legal snapshot stays far inside the byte budget', () => {
    const board = midGame(4, 40);
    board.log = Array(60).fill('x'.repeat(300));
    board.lastAction = 'y'.repeat(300);
    const snapshot = envelope(board);
    expect(() => decodeMatch(snapshot)).not.toThrow();
    expect(JSON.stringify(snapshot).length).toBeLessThan(MAX_MATCH_BYTES / 4);
  });

  test.each([
    ['string seat ids', s => { s.state.playerIds = ['1', '2']; }],
    ['string current seat', s => { s.state.currentPlayer = '1'; }],
    ['string starting seat', s => { s.state.firstPlayer = '1'; }],
    ['fractional seat ids', s => { s.state.playerIds = [1, 2.0000001]; }],
  ])('rejects %s on both the client and the server decoder', (_label, change) => {
    const snapshot = mutate(change);
    expect(() => decodeMatch(snapshot)).toThrow('invalid_snapshot');
    expect(validMatch('splendor', snapshot)).toBe(false);
  });

  test.each([
    ['a noble choice between nobles nobody has earned', s => { s.state.phase = 'noble-choice'; s.state.pendingNobles = s.state.nobles.slice(0, 2); }],
    ['a game over nobody won', s => { s.state.phase = 'game-over'; s.state.winners = [1]; s.state.winner = 1; s.state.winningPoints = 99; }],
    ['a game over with the wrong winner', s => { s.state.phase = 'game-over'; s.state.endTriggered = true; s.state.winners = [2]; s.state.winner = 2; s.state.winningPoints = 15; s.state.players[1].points = 15; }],
    ['eleven tokens held in the play phase', s => { const p = s.state.players[s.state.currentPlayer]; const take = 11 - Object.values(p.tokens).reduce((a, b) => a + b, 0); p.tokens.white += take; s.state.bank.white -= take; }],
    ['a final round that was never triggered but has a 15-point leader', s => { s.state.players[2].points = 15; }],
  ])('rejects %s', (_label, change) => {
    expect(() => decodeMatch(mutate(change))).toThrow('invalid_snapshot');
  });

  test('the portable migration schema accepts a valid snapshot and rejects unknown fields', () => {
    const ok = envelope(midGame(2));
    expect(() => validatePortableMatch(ok, 'splendor')).not.toThrow();
    ok.ui.future = true;
    expect(() => validatePortableMatch(ok, 'splendor')).toThrow();
    const extra = envelope(midGame(2));
    extra.state.players[1].secretHand = [];
    expect(() => validatePortableMatch(extra, 'splendor')).toThrow();
  });
});
