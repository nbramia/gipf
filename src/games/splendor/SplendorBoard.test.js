import SplendorBoard from './SplendorBoard.js';
import {
  CARDS,
  NOBLES,
  GEMS,
  GOLD,
  ALL_TOKENS,
  TOKEN_SETUP,
  GOLD_COUNT,
  nobleCount,
  VICTORY_POINTS,
  CARDS_BY_ID,
  VISIBLE_PER_TIER,
} from './splendorCards.js';

// ---------------------------------------------------------------------------
// Phase 0 — data lock. These invariants encode the canonical Splendor set and
// must never regress; the card costs were cross-validated against two
// independent public datasets. If you change splendorCards.js and these fail,
// the data is wrong, not the test.
// ---------------------------------------------------------------------------

describe('Splendor card data', () => {
  test('has 90 development cards split 40/30/20 across tiers', () => {
    expect(CARDS).toHaveLength(90);
    const byTier = tier => CARDS.filter(c => c.tier === tier).length;
    expect(byTier(1)).toBe(40);
    expect(byTier(2)).toBe(30);
    expect(byTier(3)).toBe(20);
  });

  test('every tier carries each bonus color evenly (8/6/4 per color)', () => {
    const expected = { 1: 8, 2: 6, 3: 4 };
    for (const tier of [1, 2, 3]) {
      for (const gem of GEMS) {
        const n = CARDS.filter(c => c.tier === tier && c.bonus === gem).length;
        expect(n).toBe(expected[tier]);
      }
    }
  });

  test('prestige distribution matches the published deck', () => {
    const count = (tier, points) =>
      CARDS.filter(c => c.tier === tier && c.points === points).length;
    // Tier 1: 35 zero-point, 5 one-point.
    expect(count(1, 0)).toBe(35);
    expect(count(1, 1)).toBe(5);
    // Tier 2: 10 one-point, 15 two-point, 5 three-point.
    expect(count(2, 1)).toBe(10);
    expect(count(2, 2)).toBe(15);
    expect(count(2, 3)).toBe(5);
    // Tier 3: 5 three-point, 10 four-point, 5 five-point.
    expect(count(3, 3)).toBe(5);
    expect(count(3, 4)).toBe(10);
    expect(count(3, 5)).toBe(5);
  });

  test('cards have valid bonus, points, and positive costs only', () => {
    for (const card of CARDS) {
      expect(GEMS).toContain(card.bonus);
      expect(card.points).toBeGreaterThanOrEqual(0);
      expect([1, 2, 3]).toContain(card.tier);
      const costGems = Object.keys(card.cost);
      expect(costGems.length).toBeGreaterThan(0);
      for (const gem of costGems) {
        expect(GEMS).toContain(gem);
        expect(card.cost[gem]).toBeGreaterThan(0);
      }
      // Gold is never a cost.
      expect(card.cost[GOLD]).toBeUndefined();
    }
  });

  test('card ids are unique and stably tier-prefixed', () => {
    const ids = CARDS.map(c => c.id);
    expect(new Set(ids).size).toBe(90);
    expect(Object.keys(CARDS_BY_ID)).toHaveLength(90);
    for (const card of CARDS) {
      expect(card.id.startsWith(`t${card.tier}-`)).toBe(true);
    }
  });
});

describe('Splendor noble data', () => {
  test('has 10 nobles each worth 3 prestige', () => {
    expect(NOBLES).toHaveLength(10);
    for (const noble of NOBLES) {
      expect(noble.points).toBe(3);
      const reqGems = Object.keys(noble.requirement);
      expect(reqGems.length).toBeGreaterThan(0);
      for (const gem of reqGems) {
        expect(GEMS).toContain(gem);
        expect(noble.requirement[gem]).toBeGreaterThan(0);
      }
    }
  });

  test('matches the canonical 3x(3/3/3) + 5x(4/4) split', () => {
    const totals = NOBLES.map(n =>
      Object.values(n.requirement).reduce((a, b) => a + b, 0));
    // Each noble requires exactly 9 bonuses (3+3+3) or 8 bonuses (4+4).
    const threeColor = totals.filter(t => t === 9).length;
    const twoColor = totals.filter(t => t === 8).length;
    expect(threeColor).toBe(5);
    expect(twoColor).toBe(5);
  });
});

describe('Splendor setup constants', () => {
  test('token bank scales 4/5/7 colored by player count, gold always 5', () => {
    expect(TOKEN_SETUP[2]).toBe(4);
    expect(TOKEN_SETUP[3]).toBe(5);
    expect(TOKEN_SETUP[4]).toBe(7);
    expect(GOLD_COUNT).toBe(5);
  });

  test('nobles revealed = players + 1', () => {
    expect(nobleCount(2)).toBe(3);
    expect(nobleCount(3)).toBe(4);
    expect(nobleCount(4)).toBe(5);
  });

  test('victory threshold is 15 prestige', () => {
    expect(VICTORY_POINTS).toBe(15);
  });
});

// ---------------------------------------------------------------------------
// Phase 1 — pure engine.
// ---------------------------------------------------------------------------

function newGame(opts = {}) {
  return new SplendorBoard({ seed: 42, playerCount: 4, ...opts });
}

describe('Splendor setup', () => {
  test('deals a 4x3 face-up market and scales the bank by player count', () => {
    for (const pc of [2, 3, 4]) {
      const board = new SplendorBoard({ seed: 7, playerCount: pc });
      for (const tier of [1, 2, 3]) {
        expect(board.visible[tier]).toHaveLength(VISIBLE_PER_TIER);
        expect(board.visible[tier].every(Boolean)).toBe(true);
      }
      for (const gem of GEMS) expect(board.bank[gem]).toBe(TOKEN_SETUP[pc]);
      expect(board.bank[GOLD]).toBe(GOLD_COUNT);
      expect(board.nobles).toHaveLength(nobleCount(pc));
    }
  });

  test('decks hold the remaining cards after dealing the market', () => {
    const board = newGame();
    expect(board.decks[1]).toHaveLength(40 - VISIBLE_PER_TIER);
    expect(board.decks[2]).toHaveLength(30 - VISIBLE_PER_TIER);
    expect(board.decks[3]).toHaveLength(20 - VISIBLE_PER_TIER);
  });

  test('starts in play phase with a seat to move and zero scores', () => {
    const board = newGame();
    expect(board.phase).toBe('play');
    expect(board.getPlayerIds()).toContain(board.currentPlayer);
    expect(Object.values(board.getPublicScores())).toEqual([0, 0, 0, 0]);
  });
});

describe('Splendor taking tokens', () => {
  test('take three distinct colors enumerates C(5,3)=10 options from a full bank', () => {
    const board = newGame();
    const threes = board.getLegalMoves().filter(m => m.type === 'take-three');
    expect(threes).toHaveLength(10);
    threes.forEach(m => expect(new Set(m.colors).size).toBe(3));
  });

  test('taking three moves one of each color from bank to player', () => {
    const board = newGame();
    const me = board.currentPlayer;
    expect(board.takeTokens(['white', 'blue', 'green'])).toBe(true);
    expect(board.players[me].tokens.white).toBe(1);
    expect(board.players[me].tokens.blue).toBe(1);
    expect(board.players[me].tokens.green).toBe(1);
    expect(board.bank.white).toBe(TOKEN_SETUP[4] - 1);
    expect(board.currentPlayer).not.toBe(me); // turn ended
  });

  test('take two of one color requires a pile of at least four', () => {
    const board = newGame();
    expect(board.getLegalMoves().filter(m => m.type === 'take-two')).toHaveLength(5);
    board.bank.white = 3;
    const twos = board.getLegalMoves().filter(m => m.type === 'take-two');
    expect(twos.map(m => m.color)).not.toContain('white');
    const me = board.currentPlayer;
    expect(board.takeTwo('white')).toBe(false);
    expect(board.takeTwo('blue')).toBe(true);
    expect(board.players[me].tokens.blue).toBe(2);
  });

  test('rejects taking duplicate colors or the wrong count', () => {
    const board = newGame();
    expect(board.takeTokens(['white', 'white', 'blue'])).toBe(false);
    expect(board.takeTokens(['white', 'blue'])).toBe(false); // 3 available -> must take 3
    expect(board.takeTokens([])).toBe(false);
  });

  test('when fewer than three colors remain, takes only what is available', () => {
    const board = newGame();
    for (const gem of ['green', 'red', 'black']) board.bank[gem] = 0;
    const threes = board.getLegalMoves().filter(m => m.type === 'take-three');
    expect(threes).toHaveLength(1);
    expect(threes[0].colors.sort()).toEqual(['blue', 'white']);
    expect(board.takeTokens(['white', 'blue'])).toBe(true);
  });
});

describe('Splendor reserving', () => {
  test('reserving a visible card grants a gold and refills the slot', () => {
    const board = newGame();
    const me = board.currentPlayer;
    const card = board.getVisibleCards()[0];
    const goldBefore = board.bank[GOLD];
    expect(board.reserveCard({ type: 'reserve', cardId: card.cardId, tier: card.tier })).toBe(true);
    expect(board.players[me].reserved).toHaveLength(1);
    expect(board.players[me].reserved[0]).toEqual({ cardId: card.cardId, hidden: false });
    expect(board.players[me].tokens[GOLD]).toBe(1);
    expect(board.bank[GOLD]).toBe(goldBefore - 1);
    expect(board.visible[card.tier][card.index]).toBeTruthy(); // refilled
  });

  test('blind reserve from a deck is hidden and draws off the top', () => {
    const board = newGame();
    const me = board.currentPlayer;
    const deckBefore = board.decks[1].length;
    expect(board.reserveCard({ type: 'reserve', tier: 1, fromDeck: true })).toBe(true);
    expect(board.players[me].reserved[0].hidden).toBe(true);
    expect(board.decks[1]).toHaveLength(deckBefore - 1);
  });

  test('reserving with an empty gold pile gives no gold', () => {
    const board = newGame();
    const me = board.currentPlayer;
    board.bank[GOLD] = 0;
    const card = board.getVisibleCards()[0];
    board.reserveCard({ type: 'reserve', cardId: card.cardId, tier: card.tier });
    expect(board.players[me].tokens[GOLD]).toBe(0);
  });

  test('cannot hold more than three reserved cards', () => {
    const board = newGame();
    const me = board.currentPlayer;
    board.players[me].reserved = [{ cardId: 't1-01', hidden: true }, { cardId: 't1-02', hidden: true }, { cardId: 't1-03', hidden: true }];
    expect(board.getLegalMoves().some(m => m.type === 'reserve')).toBe(false);
    expect(board.reserveCard({ type: 'reserve', tier: 1, fromDeck: true })).toBe(false);
  });
});

describe('Splendor buying', () => {
  test('buying pays tokens to the bank, gains the bonus and points, refills the slot', () => {
    const board = newGame();
    const me = board.currentPlayer;
    // Find a cheap visible card and stock exactly its cost.
    const { cardId, tier, index } = board.getVisibleCards()
      .map(v => ({ ...v, card: board.getCard(v.cardId) }))
      .sort((a, b) => sumCost(a.card.cost) - sumCost(b.card.cost))[0];
    const card = board.getCard(cardId);
    for (const gem of GEMS) board.players[me].tokens[gem] = card.cost[gem] || 0;
    const bankBefore = { ...board.bank };

    expect(board.buyCard(cardId)).toBe(true);
    expect(board.players[me].cards).toContain(cardId);
    expect(board.players[me].bonuses[card.bonus]).toBe(1);
    expect(board.getVictoryPoints(me)).toBe(card.points);
    for (const gem of GEMS) {
      expect(board.players[me].tokens[gem]).toBe(0);
      expect(board.bank[gem]).toBe(bankBefore[gem] + (card.cost[gem] || 0));
    }
    expect(board.visible[tier][index]).not.toBe(cardId); // replaced
  });

  test('bonuses discount future purchases', () => {
    const board = newGame();
    const me = board.currentPlayer;
    // A card costing 4 green (t1-08 provides white). With 4 green bonuses it is free.
    board.players[me].bonuses.green = 4;
    expect(board.canAffordCard(me, 't1-08')).toBe(true);
  });

  test('gold is spent only for the shortfall (colored tokens first)', () => {
    const board = newGame();
    const me = board.currentPlayer;
    board.players[me].reserved = [{ cardId: 't1-08', hidden: true }]; // cost 4 green
    board.players[me].tokens.green = 2;
    board.players[me].tokens[GOLD] = 3;
    expect(board.buyCard('t1-08', { fromReserve: true })).toBe(true);
    expect(board.players[me].tokens.green).toBe(0);     // both greens spent
    expect(board.players[me].tokens[GOLD]).toBe(1);     // only 2 gold used for the shortfall
    expect(board.players[me].reserved).toHaveLength(0);
  });

  test('cannot buy a card you cannot afford', () => {
    const board = newGame();
    const me = board.currentPlayer;
    board.players[me].reserved = [{ cardId: 't3-20', hidden: true }];
    expect(board.buyCard('t3-20', { fromReserve: true })).toBe(false);
  });
});

describe('Splendor token limit (discard sub-phase)', () => {
  test('ending a turn over ten tokens forces discards down to ten', () => {
    const board = newGame();
    const me = board.currentPlayer;
    for (const gem of GEMS) board.players[me].tokens[gem] = 0;
    board.players[me].tokens.white = 9;
    expect(board.takeTokens(['blue', 'green', 'red'])).toBe(true); // -> 12 tokens
    expect(board.phase).toBe('discard');
    expect(board.currentPlayer).toBe(me); // same player discards
    expect(board.discardToken('white')).toBe(true);
    expect(board.phase).toBe('discard'); // 11, still over
    expect(board.discardToken('white')).toBe(true);
    expect(board.phase).toBe('play');    // 10, resolved -> next turn
    expect(board.currentPlayer).not.toBe(me);
  });
});

describe('Splendor nobles', () => {
  test('a single qualifying noble is claimed automatically at end of turn', () => {
    const board = newGame();
    const me = board.currentPlayer;
    const noble = board.getNoble(board.nobles[0]);
    board.nobles = [board.nobles[0]];
    for (const gem of GEMS) board.players[me].bonuses[gem] = noble.requirement[gem] || 0;
    expect(board.takeTokens(['white', 'blue', 'green'])).toBe(true);
    expect(board.players[me].nobles).toContain(noble.id);
    expect(board.getVictoryPoints(me)).toBe(3);
    expect(board.nobles).toHaveLength(0);
  });

  test('when two nobles qualify the player chooses exactly one', () => {
    const board = newGame();
    const me = board.currentPlayer;
    board.nobles = [NOBLES[0].id, NOBLES[1].id];
    for (const gem of GEMS) board.players[me].bonuses[gem] = 4; // satisfies any noble
    expect(board.takeTokens(['white', 'blue', 'green'])).toBe(true);
    expect(board.phase).toBe('noble-choice');
    const choices = board.getLegalMoves();
    expect(choices).toHaveLength(2);
    expect(board.chooseNoble(choices[0].nobleId)).toBe(true);
    expect(board.players[me].nobles).toHaveLength(1);
    expect(board.nobles).toHaveLength(1); // the unclaimed one remains
    expect(board.phase).toBe('play');
  });
});

describe('Splendor end of game', () => {
  test('reaching 15 triggers a final round; highest prestige wins', () => {
    const board = new SplendorBoard({ seed: 5, playerCount: 2 });
    const first = board.firstPlayer;
    const second = board._nextPlayerId(first);
    const fivePt = CARDS.find(c => c.points === 5).id;
    board.players[first].cards = [fivePt, fivePt, fivePt]; // 15 prestige
    board.currentPlayer = first;

    expect(board.passTurn()).toBe(true);   // first triggers end-of-round
    expect(board.endTriggered).toBe(true);
    expect(board.phase).toBe('play');
    expect(board.currentPlayer).toBe(second);

    expect(board.passTurn()).toBe(true);   // round completes -> game over
    expect(board.phase).toBe('game-over');
    expect(board.winner).toBe(first);
    expect(board.winningPoints).toBe(15);
  });

  test('ties are broken by fewest development cards', () => {
    const board = new SplendorBoard({ seed: 11, playerCount: 2 });
    const x = board.firstPlayer;
    const y = board._nextPlayerId(x);
    const fivePt = CARDS.find(c => c.points === 5).id;
    const zeroPt = CARDS.find(c => c.points === 0).id;
    // Equal prestige (15), but y reached it with fewer cards.
    board.players[x].cards = [fivePt, fivePt, fivePt, zeroPt]; // 15 pts, 4 cards
    board.players[y].cards = [fivePt, fivePt, fivePt];          // 15 pts, 3 cards
    board.currentPlayer = x;
    board.passTurn();
    board.passTurn();
    expect(board.phase).toBe('game-over');
    expect(board.getVictoryPoints(x)).toBe(15);
    expect(board.getVictoryPoints(y)).toBe(15);
    expect(board.winner).toBe(y); // fewer cards wins the tie
  });
});

describe('Splendor history & cloning', () => {
  test('clone is an independent deep copy', () => {
    const board = newGame();
    const copy = board.clone();
    board.takeTokens(['white', 'blue', 'green']);
    expect(copy.bank.white).toBe(TOKEN_SETUP[4]);
    expect(copy.getStateHash()).not.toBe(board.getStateHash());
  });

  test('undo and redo restore prior states', () => {
    const board = newGame();
    const hash0 = board.getStateHash();
    board.takeTokens(['white', 'blue', 'green']);
    const hash1 = board.getStateHash();
    expect(board.undo()).toBe(true);
    expect(board.getStateHash()).toBe(hash0);
    expect(board.redo()).toBe(true);
    expect(board.getStateHash()).toBe(hash1);
  });
});

describe('Splendor self-play termination', () => {
  function playRandomGame(seed, playerCount) {
    const board = new SplendorBoard({ seed, playerCount, skipInitialHistory: true });
    board._skipHistory = true;
    let steps = 0;
    const rng = mulberryTest(seed * 7 + 1);
    while (board.phase !== 'game-over' && steps < 20000) {
      const moves = board.getLegalMoves();
      expect(moves.length).toBeGreaterThan(0);
      const move = moves[Math.floor(rng() * moves.length)];
      expect(board.applyMove(move)).toBe(true);
      // No player may ever end a turn holding more than ten tokens.
      if (board.phase === 'play') {
        for (const id of board.getPlayerIds()) {
          expect(board.getTokenTotal(id)).toBeLessThanOrEqual(10);
        }
      }
      steps++;
    }
    return board;
  }

  test('random games terminate with a legal winner (multiple seeds, 2-4 players)', () => {
    for (const pc of [2, 3, 4]) {
      for (let seed = 1; seed <= 6; seed++) {
        const board = playRandomGame(seed * 13 + pc, pc);
        expect(board.phase).toBe('game-over');
        expect(board.getPlayerIds()).toContain(board.winner);
      }
    }
  });

  test('token conservation holds across a full random game', () => {
    const board = playRandomGame(123, 3);
    const totalColored = TOKEN_SETUP[3] * 5 + GOLD_COUNT;
    let inHands = 0;
    for (const id of board.getPlayerIds()) inHands += board.getTokenTotal(id);
    const inBank = ALL_TOKENS.reduce((s, t) => s + board.bank[t], 0);
    expect(inHands + inBank).toBe(totalColored);
  });
});

function sumCost(cost) {
  return GEMS.reduce((s, g) => s + (cost[g] || 0), 0);
}

function mulberryTest(seed) {
  let t = seed >>> 0;
  return function () {
    t += 0x6D2B79F5;
    let n = t;
    n = Math.imul(n ^ (n >>> 15), n | 1);
    n ^= n + Math.imul(n ^ (n >>> 7), n | 61);
    return ((n ^ (n >>> 14)) >>> 0) / 4294967296;
  };
}

// ---------------------------------------------------------------------------
// Phase 2 — AI engine.
// ---------------------------------------------------------------------------

const { MCTS, determinizeForSearch } = require('./engine/mcts.js');

describe('Splendor AI', () => {
  test('MCTS returns a legal opening move', async () => {
    const board = new SplendorBoard({ seed: 3, playerCount: 3 });
    const mcts = new MCTS({ maxChildren: 30, rolloutSteps: 12 });
    const move = await mcts.getBestMove(board, 40);
    const legalKeys = new Set(board.getLegalMoves().map(m => JSON.stringify(stripMeta(m))));
    expect(legalKeys.has(JSON.stringify(stripMeta(move)))).toBe(true);
  });

  test('determinization keeps all 90 cards and never reveals the observer hand', async () => {
    const board = new SplendorBoard({ seed: 8, playerCount: 3 });
    // Give opponents blind reserves and the observer a known one.
    const observer = board.currentPlayer;
    const opp = board._nextPlayerId(observer);
    board.players[opp].reserved = [{ cardId: board.decks[3].pop(), hidden: true }];
    board.players[observer].reserved = [{ cardId: board.decks[1].pop(), hidden: true }];
    const myReserved = board.players[observer].reserved[0].cardId;

    const det = determinizeForSearch(board, observer);

    // Observer's own (even hidden) reserve is untouched.
    expect(det.players[observer].reserved[0].cardId).toBe(myReserved);

    // Exactly the 90 canonical cards exist, no duplicates, none lost.
    const all = [];
    for (const tier of [1, 2, 3]) {
      all.push(...det.decks[tier]);
      all.push(...det.visible[tier].filter(Boolean));
    }
    for (const id of det.getPlayerIds()) {
      all.push(...det.players[id].cards);
      all.push(...det.players[id].reserved.map(r => r.cardId));
    }
    expect(all).toHaveLength(90);
    expect(new Set(all).size).toBe(90);

    // Re-sampled opponent reserve stays in its (public) tier.
    expect(det.getCard(det.players[opp].reserved[0].cardId).tier).toBe(3);
  });

  test('low-budget AI self-play reaches a terminal game with only legal moves', async () => {
    const board = new SplendorBoard({ seed: 21, playerCount: 2, skipInitialHistory: true });
    board._skipHistory = true;
    const mcts = new MCTS({ maxChildren: 24, rolloutSteps: 10 });
    let steps = 0;
    while (board.phase !== 'game-over' && steps < 400) {
      const move = await mcts.getBestMove(board, 16);
      expect(move).toBeTruthy();
      const legalKeys = new Set(board.getLegalMoves().map(m => JSON.stringify(stripMeta(m))));
      expect(legalKeys.has(JSON.stringify(stripMeta(move)))).toBe(true);
      expect(board.applyMove(move)).toBe(true);
      steps++;
    }
    expect(board.phase).toBe('game-over');
    expect(board.getPlayerIds()).toContain(board.winner);
  }, 30000);
});

function stripMeta(move) {
  if (!move) return move;
  const { _rootVisits, _legalMoves, ...rest } = move;
  return rest;
}
