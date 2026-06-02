// splendorCards.js
// Canonical Splendor static data: the 90 development cards, the 10 noble tiles,
// and per-player-count token setup. The card set was cross-validated against two
// independent public datasets (seal256/splendor `assets/cards.csv` and
// andrzejchmura/splendor `src/cards.json`), which are byte-for-byte identical as
// multisets. SplendorBoard.test.js locks every composition invariant, so do not
// edit costs/points without re-validating against those sources.
//
// Gem colors map to the printed tokens: white=Diamond, blue=Sapphire,
// green=Emerald, red=Ruby, black=Onyx. Gold is the wild/joker token.

export const GEMS = ['white', 'blue', 'green', 'red', 'black'];
export const GOLD = 'gold';
export const ALL_TOKENS = [...GEMS, GOLD];

export const GEM_LABELS = {
  white: 'Diamond',
  blue: 'Sapphire',
  green: 'Emerald',
  red: 'Ruby',
  black: 'Onyx',
  gold: 'Gold',
};

// First player to this many prestige points triggers the final round.
export const VICTORY_POINTS = 15;

// Rules constants.
export const MAX_RESERVED = 3;   // cards a player may hold in reserve
export const MAX_TOKENS = 10;    // token hand limit checked at end of turn
export const VISIBLE_PER_TIER = 4; // face-up cards per tier row
export const TAKE_TWO_MIN = 4;   // a pile must have >= this to take two of one color

// Colored tokens of EACH gem by player count; gold is always GOLD_COUNT.
export const TOKEN_SETUP = { 2: 4, 3: 5, 4: 7 };
export const GOLD_COUNT = 5;

// Nobles revealed at setup = players + 1.
export function nobleCount(players) {
  return players + 1;
}

export function emptyGems() {
  return { white: 0, blue: 0, green: 0, red: 0, black: 0 };
}

export function emptyTokens() {
  return { white: 0, blue: 0, green: 0, red: 0, black: 0, gold: 0 };
}

// The 90 development cards. `cost` lists only nonzero gem requirements.
export const CARDS = [
  { id: 't1-01', tier: 1, bonus: 'white', points: 0, cost: { red: 2, black: 1 } },
  { id: 't1-02', tier: 1, bonus: 'white', points: 0, cost: { blue: 1, green: 1, red: 1, black: 1 } },
  { id: 't1-03', tier: 1, bonus: 'white', points: 0, cost: { blue: 1, green: 2, red: 1, black: 1 } },
  { id: 't1-04', tier: 1, bonus: 'white', points: 0, cost: { blue: 2, black: 2 } },
  { id: 't1-05', tier: 1, bonus: 'white', points: 0, cost: { blue: 2, green: 2, black: 1 } },
  { id: 't1-06', tier: 1, bonus: 'white', points: 0, cost: { blue: 3 } },
  { id: 't1-07', tier: 1, bonus: 'white', points: 0, cost: { white: 3, blue: 1, black: 1 } },
  { id: 't1-08', tier: 1, bonus: 'white', points: 1, cost: { green: 4 } },
  { id: 't1-09', tier: 1, bonus: 'blue', points: 0, cost: { black: 3 } },
  { id: 't1-10', tier: 1, bonus: 'blue', points: 0, cost: { green: 2, black: 2 } },
  { id: 't1-11', tier: 1, bonus: 'blue', points: 0, cost: { blue: 1, green: 3, red: 1 } },
  { id: 't1-12', tier: 1, bonus: 'blue', points: 0, cost: { white: 1, black: 2 } },
  { id: 't1-13', tier: 1, bonus: 'blue', points: 0, cost: { white: 1, green: 1, red: 1, black: 1 } },
  { id: 't1-14', tier: 1, bonus: 'blue', points: 0, cost: { white: 1, green: 1, red: 2, black: 1 } },
  { id: 't1-15', tier: 1, bonus: 'blue', points: 0, cost: { white: 1, green: 2, red: 2 } },
  { id: 't1-16', tier: 1, bonus: 'blue', points: 1, cost: { red: 4 } },
  { id: 't1-17', tier: 1, bonus: 'green', points: 0, cost: { red: 3 } },
  { id: 't1-18', tier: 1, bonus: 'green', points: 0, cost: { blue: 1, red: 2, black: 2 } },
  { id: 't1-19', tier: 1, bonus: 'green', points: 0, cost: { blue: 2, red: 2 } },
  { id: 't1-20', tier: 1, bonus: 'green', points: 0, cost: { white: 1, blue: 1, red: 1, black: 1 } },
  { id: 't1-21', tier: 1, bonus: 'green', points: 0, cost: { white: 1, blue: 1, red: 1, black: 2 } },
  { id: 't1-22', tier: 1, bonus: 'green', points: 0, cost: { white: 1, blue: 3, green: 1 } },
  { id: 't1-23', tier: 1, bonus: 'green', points: 0, cost: { white: 2, blue: 1 } },
  { id: 't1-24', tier: 1, bonus: 'green', points: 1, cost: { black: 4 } },
  { id: 't1-25', tier: 1, bonus: 'red', points: 0, cost: { blue: 2, green: 1 } },
  { id: 't1-26', tier: 1, bonus: 'red', points: 0, cost: { white: 1, red: 1, black: 3 } },
  { id: 't1-27', tier: 1, bonus: 'red', points: 0, cost: { white: 1, blue: 1, green: 1, black: 1 } },
  { id: 't1-28', tier: 1, bonus: 'red', points: 0, cost: { white: 2, red: 2 } },
  { id: 't1-29', tier: 1, bonus: 'red', points: 0, cost: { white: 2, green: 1, black: 2 } },
  { id: 't1-30', tier: 1, bonus: 'red', points: 0, cost: { white: 2, blue: 1, green: 1, black: 1 } },
  { id: 't1-31', tier: 1, bonus: 'red', points: 0, cost: { white: 3 } },
  { id: 't1-32', tier: 1, bonus: 'red', points: 1, cost: { white: 4 } },
  { id: 't1-33', tier: 1, bonus: 'black', points: 0, cost: { green: 1, red: 3, black: 1 } },
  { id: 't1-34', tier: 1, bonus: 'black', points: 0, cost: { green: 2, red: 1 } },
  { id: 't1-35', tier: 1, bonus: 'black', points: 0, cost: { green: 3 } },
  { id: 't1-36', tier: 1, bonus: 'black', points: 0, cost: { white: 1, blue: 1, green: 1, red: 1 } },
  { id: 't1-37', tier: 1, bonus: 'black', points: 0, cost: { white: 1, blue: 2, green: 1, red: 1 } },
  { id: 't1-38', tier: 1, bonus: 'black', points: 0, cost: { white: 2, green: 2 } },
  { id: 't1-39', tier: 1, bonus: 'black', points: 0, cost: { white: 2, blue: 2, red: 1 } },
  { id: 't1-40', tier: 1, bonus: 'black', points: 1, cost: { blue: 4 } },
  { id: 't2-01', tier: 2, bonus: 'white', points: 1, cost: { green: 3, red: 2, black: 2 } },
  { id: 't2-02', tier: 2, bonus: 'white', points: 1, cost: { white: 2, blue: 3, red: 3 } },
  { id: 't2-03', tier: 2, bonus: 'white', points: 2, cost: { red: 5 } },
  { id: 't2-04', tier: 2, bonus: 'white', points: 2, cost: { red: 5, black: 3 } },
  { id: 't2-05', tier: 2, bonus: 'white', points: 2, cost: { green: 1, red: 4, black: 2 } },
  { id: 't2-06', tier: 2, bonus: 'white', points: 3, cost: { white: 6 } },
  { id: 't2-07', tier: 2, bonus: 'blue', points: 1, cost: { blue: 2, green: 2, red: 3 } },
  { id: 't2-08', tier: 2, bonus: 'blue', points: 1, cost: { blue: 2, green: 3, black: 3 } },
  { id: 't2-09', tier: 2, bonus: 'blue', points: 2, cost: { blue: 5 } },
  { id: 't2-10', tier: 2, bonus: 'blue', points: 2, cost: { white: 2, red: 1, black: 4 } },
  { id: 't2-11', tier: 2, bonus: 'blue', points: 2, cost: { white: 5, blue: 3 } },
  { id: 't2-12', tier: 2, bonus: 'blue', points: 3, cost: { blue: 6 } },
  { id: 't2-13', tier: 2, bonus: 'green', points: 1, cost: { white: 2, blue: 3, black: 2 } },
  { id: 't2-14', tier: 2, bonus: 'green', points: 1, cost: { white: 3, green: 2, red: 3 } },
  { id: 't2-15', tier: 2, bonus: 'green', points: 2, cost: { green: 5 } },
  { id: 't2-16', tier: 2, bonus: 'green', points: 2, cost: { blue: 5, green: 3 } },
  { id: 't2-17', tier: 2, bonus: 'green', points: 2, cost: { white: 4, blue: 2, black: 1 } },
  { id: 't2-18', tier: 2, bonus: 'green', points: 3, cost: { green: 6 } },
  { id: 't2-19', tier: 2, bonus: 'red', points: 1, cost: { blue: 3, red: 2, black: 3 } },
  { id: 't2-20', tier: 2, bonus: 'red', points: 1, cost: { white: 2, red: 2, black: 3 } },
  { id: 't2-21', tier: 2, bonus: 'red', points: 2, cost: { black: 5 } },
  { id: 't2-22', tier: 2, bonus: 'red', points: 2, cost: { white: 1, blue: 4, green: 2 } },
  { id: 't2-23', tier: 2, bonus: 'red', points: 2, cost: { white: 3, black: 5 } },
  { id: 't2-24', tier: 2, bonus: 'red', points: 3, cost: { red: 6 } },
  { id: 't2-25', tier: 2, bonus: 'black', points: 1, cost: { white: 3, green: 3, black: 2 } },
  { id: 't2-26', tier: 2, bonus: 'black', points: 1, cost: { white: 3, blue: 2, green: 2 } },
  { id: 't2-27', tier: 2, bonus: 'black', points: 2, cost: { green: 5, red: 3 } },
  { id: 't2-28', tier: 2, bonus: 'black', points: 2, cost: { blue: 1, green: 4, red: 2 } },
  { id: 't2-29', tier: 2, bonus: 'black', points: 2, cost: { white: 5 } },
  { id: 't2-30', tier: 2, bonus: 'black', points: 3, cost: { black: 6 } },
  { id: 't3-01', tier: 3, bonus: 'white', points: 3, cost: { blue: 3, green: 3, red: 5, black: 3 } },
  { id: 't3-02', tier: 3, bonus: 'white', points: 4, cost: { black: 7 } },
  { id: 't3-03', tier: 3, bonus: 'white', points: 4, cost: { white: 3, red: 3, black: 6 } },
  { id: 't3-04', tier: 3, bonus: 'white', points: 5, cost: { white: 3, black: 7 } },
  { id: 't3-05', tier: 3, bonus: 'blue', points: 3, cost: { white: 3, green: 3, red: 3, black: 5 } },
  { id: 't3-06', tier: 3, bonus: 'blue', points: 4, cost: { white: 6, blue: 3, black: 3 } },
  { id: 't3-07', tier: 3, bonus: 'blue', points: 4, cost: { white: 7 } },
  { id: 't3-08', tier: 3, bonus: 'blue', points: 5, cost: { white: 7, blue: 3 } },
  { id: 't3-09', tier: 3, bonus: 'green', points: 3, cost: { white: 5, blue: 3, red: 3, black: 3 } },
  { id: 't3-10', tier: 3, bonus: 'green', points: 4, cost: { blue: 7 } },
  { id: 't3-11', tier: 3, bonus: 'green', points: 4, cost: { white: 3, blue: 6, green: 3 } },
  { id: 't3-12', tier: 3, bonus: 'green', points: 5, cost: { blue: 7, green: 3 } },
  { id: 't3-13', tier: 3, bonus: 'red', points: 3, cost: { white: 3, blue: 5, green: 3, black: 3 } },
  { id: 't3-14', tier: 3, bonus: 'red', points: 4, cost: { green: 7 } },
  { id: 't3-15', tier: 3, bonus: 'red', points: 4, cost: { blue: 3, green: 6, red: 3 } },
  { id: 't3-16', tier: 3, bonus: 'red', points: 5, cost: { green: 7, red: 3 } },
  { id: 't3-17', tier: 3, bonus: 'black', points: 3, cost: { white: 3, blue: 3, green: 5, red: 3 } },
  { id: 't3-18', tier: 3, bonus: 'black', points: 4, cost: { red: 7 } },
  { id: 't3-19', tier: 3, bonus: 'black', points: 4, cost: { green: 3, red: 6, black: 3 } },
  { id: 't3-20', tier: 3, bonus: 'black', points: 5, cost: { red: 7, black: 3 } },
];

// The 10 noble tiles. `requirement` lists the bonus-card counts needed; each is
// worth 3 prestige and is claimed automatically at end of turn.
export const NOBLES = [
  { id: 'n1', points: 3, requirement: { white: 3, blue: 3, black: 3 } },
  { id: 'n2', points: 3, requirement: { blue: 3, green: 3, red: 3 } },
  { id: 'n3', points: 3, requirement: { white: 3, red: 3, black: 3 } },
  { id: 'n4', points: 3, requirement: { green: 4, red: 4 } },
  { id: 'n5', points: 3, requirement: { blue: 4, green: 4 } },
  { id: 'n6', points: 3, requirement: { red: 4, black: 4 } },
  { id: 'n7', points: 3, requirement: { white: 4, black: 4 } },
  { id: 'n8', points: 3, requirement: { white: 3, blue: 3, green: 3 } },
  { id: 'n9', points: 3, requirement: { green: 3, red: 3, black: 3 } },
  { id: 'n10', points: 3, requirement: { white: 4, blue: 4 } },
];

export const CARDS_BY_ID = Object.fromEntries(CARDS.map(c => [c.id, c]));
export const NOBLES_BY_ID = Object.fromEntries(NOBLES.map(n => [n.id, n]));

export function cardsByTier(tier) {
  return CARDS.filter(c => c.tier === tier);
}
