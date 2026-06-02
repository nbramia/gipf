// SplendorBoard.js
// Pure rules/state engine for base-game Splendor (2-4 players). No React, no UI.
//
// Splendor has no board geometry and no dice: the only stochastic element is the
// hidden order of the three draw decks (and opponents' blind-reserved cards),
// which is fixed at construction, so every in-game transition is deterministic.
// That keeps the AI's tree free of chance nodes; hidden-information fairness is
// handled by re-shuffling in the search clone (see engine/mcts.js), exactly like
// Catan re-samples opponents' hands.

import {
  CARDS,
  NOBLES,
  CARDS_BY_ID,
  NOBLES_BY_ID,
  GEMS,
  GOLD,
  ALL_TOKENS,
  TOKEN_SETUP,
  GOLD_COUNT,
  nobleCount,
  VICTORY_POINTS,
  MAX_RESERVED,
  MAX_TOKENS,
  VISIBLE_PER_TIER,
  TAKE_TWO_MIN,
  emptyGems,
  emptyTokens,
} from './splendorCards.js';

// Generous round cap so even pathological self-play/rollouts always terminate.
const MAX_GAME_TURNS = 200;

const PLAYER_NAMES = {
  1: 'You',
  2: 'Medici',
  3: 'Fugger',
  4: 'Visconti',
};

const PLAYER_COLORS = {
  1: '#DC2626',
  2: '#2563EB',
  3: '#16A34A',
  4: '#F59E0B',
};

function mulberry32(seed) {
  let t = seed >>> 0;
  return function random() {
    t += 0x6D2B79F5;
    let n = t;
    n = Math.imul(n ^ (n >>> 15), n | 1);
    n ^= n + Math.imul(n ^ (n >>> 7), n | 61);
    return ((n ^ (n >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffle(values, random) {
  const result = [...values];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

function tokenTotal(tokens) {
  return ALL_TOKENS.reduce((sum, t) => sum + (tokens[t] || 0), 0);
}

function normalizePlayerCount(count) {
  const n = Number(count) || 4;
  return Math.max(2, Math.min(4, n));
}

function turnLabel(name) {
  return name === 'You' ? 'Your turn.' : `${name}'s turn.`;
}

// Distinct 3-color subsets (combinations) of an available-colors list.
function tripletsOf(colors) {
  const out = [];
  for (let i = 0; i < colors.length; i++) {
    for (let j = i + 1; j < colors.length; j++) {
      for (let k = j + 1; k < colors.length; k++) {
        out.push([colors[i], colors[j], colors[k]]);
      }
    }
  }
  return out;
}

export default class SplendorBoard {
  constructor({ seed = 1, playerCount = 4, skipInitialHistory = false } = {}) {
    this.seed = seed;
    this.playerCount = normalizePlayerCount(playerCount);
    this.playerIds = Array.from({ length: this.playerCount }, (_, i) => i + 1);
    this.victoryTarget = VICTORY_POINTS;

    // Decks (hidden order, fixed once shuffled). End of array = top of deck.
    const tierCards = { 1: [], 2: [], 3: [] };
    for (const card of CARDS) tierCards[card.tier].push(card.id);
    this.decks = {
      1: shuffle(tierCards[1], mulberry32(seed + 1)),
      2: shuffle(tierCards[2], mulberry32(seed + 2)),
      3: shuffle(tierCards[3], mulberry32(seed + 3)),
    };

    // Face-up market: VISIBLE_PER_TIER per tier; null marks an empty slot.
    this.visible = { 1: [], 2: [], 3: [] };
    for (const tier of [1, 2, 3]) {
      for (let i = 0; i < VISIBLE_PER_TIER; i++) {
        this.visible[tier].push(this.decks[tier].pop() ?? null);
      }
    }

    // Token bank.
    const colored = TOKEN_SETUP[this.playerCount];
    this.bank = emptyTokens();
    for (const gem of GEMS) this.bank[gem] = colored;
    this.bank[GOLD] = GOLD_COUNT;

    // Nobles in play = players + 1.
    const noblePool = shuffle(NOBLES.map(n => n.id), mulberry32(seed + 7));
    this.nobles = noblePool.slice(0, nobleCount(this.playerCount));

    this.players = {};
    for (const id of this.playerIds) {
      this.players[id] = {
        id,
        name: PLAYER_NAMES[id],
        color: PLAYER_COLORS[id],
        tokens: emptyTokens(),
        bonuses: emptyGems(),
        cards: [],            // purchased card ids
        reserved: [],         // [{ cardId, hidden }] hidden=true when reserved blind from a deck
        nobles: [],           // claimed noble ids
        points: 0,
      };
    }

    // Randomize who starts (seed-derived) so the human isn't always first; the
    // round boundary is "back to firstPlayer", which keeps turns equal.
    const firstIndex = Math.floor(mulberry32(seed + 11)() * this.playerCount);
    this.firstPlayer = this.playerIds[firstIndex];
    this.currentPlayer = this.firstPlayer;

    this.phase = 'play';            // 'play' | 'discard' | 'noble-choice' | 'game-over'
    this.pendingNobles = [];        // candidate noble ids during 'noble-choice'
    this.endTriggered = false;      // someone reached 15 -> finish the round
    this.turnNumber = 1;
    this.winner = null;
    this.winningPoints = 0;
    this.lastAction = turnLabel(this.players[this.currentPlayer].name);
    this.log = [];

    this.stateHistory = [];
    this.historyIndex = -1;
    this.maxHistoryLength = 100;
    this._skipHistory = false;

    if (!skipInitialHistory) this._captureState();
  }

  // ---- basic accessors -----------------------------------------------------

  getCurrentPlayer() {
    return this.players[this.currentPlayer];
  }

  getPlayerIds() {
    return this.playerIds || Object.keys(this.players).map(Number).sort((a, b) => a - b);
  }

  _nextPlayerId(playerId = this.currentPlayer) {
    const ids = this.getPlayerIds();
    const index = ids.indexOf(playerId);
    return ids[(index + 1) % ids.length];
  }

  getCard(cardId) {
    return CARDS_BY_ID[cardId];
  }

  getNoble(nobleId) {
    return NOBLES_BY_ID[nobleId];
  }

  getTokenTotal(playerId = this.currentPlayer) {
    return tokenTotal(this.players[playerId].tokens);
  }

  getVictoryPoints(playerId) {
    const player = this.players[playerId];
    let points = 0;
    for (const cardId of player.cards) points += this.getCard(cardId).points;
    for (const nobleId of player.nobles) points += this.getNoble(nobleId).points;
    return points;
  }

  getPublicScores() {
    const scores = {};
    for (const id of this.getPlayerIds()) scores[id] = this.getVictoryPoints(id);
    return scores;
  }

  getLeaders() {
    const scores = this.getPublicScores();
    const max = Math.max(...Object.values(scores));
    return this.getPlayerIds().filter(id => scores[id] === max);
  }

  // Visible cards as a flat list of { tier, index, cardId } (skipping empties).
  getVisibleCards() {
    const out = [];
    for (const tier of [1, 2, 3]) {
      this.visible[tier].forEach((cardId, index) => {
        if (cardId) out.push({ tier, index, cardId });
      });
    }
    return out;
  }

  // ---- affordability & payment ---------------------------------------------

  canAfford(playerId, cost) {
    const player = this.players[playerId];
    let goldNeeded = 0;
    for (const gem of GEMS) {
      const need = Math.max(0, (cost[gem] || 0) - player.bonuses[gem]);
      goldNeeded += Math.max(0, need - player.tokens[gem]);
    }
    return goldNeeded <= player.tokens[GOLD];
  }

  canAffordCard(playerId, cardId) {
    return this.canAfford(playerId, this.getCard(cardId).cost);
  }

  // Spend tokens for a card: colored tokens first, gold only for the shortfall
  // (gold is more flexible, so min-gold payment is always optimal). Spent tokens
  // return to the bank.
  _payCard(playerId, cost) {
    const player = this.players[playerId];
    for (const gem of GEMS) {
      const need = Math.max(0, (cost[gem] || 0) - player.bonuses[gem]);
      const fromColor = Math.min(player.tokens[gem], need);
      player.tokens[gem] -= fromColor;
      this.bank[gem] += fromColor;
      const shortfall = need - fromColor;
      if (shortfall > 0) {
        player.tokens[GOLD] -= shortfall;
        this.bank[GOLD] += shortfall;
      }
    }
  }

  // ---- legal moves ---------------------------------------------------------

  getLegalMoves(options = {}) {
    if (this.phase === 'game-over') return [];
    if (this.phase === 'discard') return this._discardMoves();
    if (this.phase === 'noble-choice') {
      return this.pendingNobles.map(nobleId => ({ type: 'choose-noble', nobleId }));
    }
    return this._playMoves(options);
  }

  _discardMoves() {
    const player = this.getCurrentPlayer();
    const moves = [];
    for (const token of ALL_TOKENS) {
      if (player.tokens[token] > 0) moves.push({ type: 'discard-token', token });
    }
    return moves;
  }

  _playMoves(options = {}) {
    const rollout = !!options.rollout;
    const player = this.getCurrentPlayer();
    const moves = [];

    // Take three different colors (or as many as available if fewer than three).
    const available = GEMS.filter(gem => this.bank[gem] > 0);
    if (available.length >= 3) {
      for (const combo of tripletsOf(available)) {
        moves.push({ type: 'take-three', colors: combo });
      }
    } else if (available.length > 0) {
      moves.push({ type: 'take-three', colors: [...available] });
    }

    // Take two of one color (pile must have >= TAKE_TWO_MIN).
    for (const gem of GEMS) {
      if (this.bank[gem] >= TAKE_TWO_MIN) moves.push({ type: 'take-two', color: gem });
    }

    // Reserve (max MAX_RESERVED held). Grants a gold if any remain.
    if (player.reserved.length < MAX_RESERVED) {
      for (const { tier, cardId } of this.getVisibleCards()) {
        moves.push({ type: 'reserve', cardId, tier });
      }
      // Blind reserve from a deck top. Skipped in rollout mode (high-variance,
      // rarely the best play) to keep the playout branching factor tight.
      if (!rollout) {
        for (const tier of [1, 2, 3]) {
          if (this.decks[tier].length > 0) moves.push({ type: 'reserve', tier, fromDeck: true });
        }
      }
    }

    // Buy a visible card or a reserved card.
    for (const { cardId } of this.getVisibleCards()) {
      if (this.canAffordCard(player.id, cardId)) moves.push({ type: 'buy', cardId });
    }
    for (const entry of player.reserved) {
      if (this.canAffordCard(player.id, entry.cardId)) {
        moves.push({ type: 'buy', cardId: entry.cardId, fromReserve: true });
      }
    }

    // Deadlock safety net: if nothing is playable (e.g. an emptied bank with no
    // affordable or reservable card), allow a pass so the game never stalls.
    if (moves.length === 0) moves.push({ type: 'pass' });
    return moves;
  }

  // ---- move application ----------------------------------------------------

  applyMove(move) {
    if (!move) return false;
    switch (move.type) {
      case 'take-three':
        return this.takeTokens(move.colors);
      case 'take-two':
        return this.takeTwo(move.color);
      case 'reserve':
        return this.reserveCard(move);
      case 'buy':
        return this.buyCard(move.cardId, { fromReserve: !!move.fromReserve });
      case 'discard-token':
        return this.discardToken(move.token);
      case 'choose-noble':
        return this.chooseNoble(move.nobleId);
      case 'pass':
        return this.passTurn();
      default:
        return false;
    }
  }

  takeTokens(colors) {
    if (this.phase !== 'play') return false;
    if (!Array.isArray(colors) || colors.length === 0 || colors.length > 3) return false;
    if (new Set(colors).size !== colors.length) return false;
    const available = GEMS.filter(gem => this.bank[gem] > 0);
    // Must take three when three colors are available; otherwise take all that exist.
    if (colors.length !== Math.min(3, available.length)) return false;
    for (const color of colors) {
      if (!GEMS.includes(color) || this.bank[color] <= 0) return false;
    }
    const player = this.getCurrentPlayer();
    for (const color of colors) {
      this.bank[color] -= 1;
      player.tokens[color] += 1;
    }
    this._log(`${player.name} took ${colors.map(c => this._gem(c)).join(', ')}.`);
    return this._finishAction();
  }

  takeTwo(color) {
    if (this.phase !== 'play') return false;
    if (!GEMS.includes(color) || this.bank[color] < TAKE_TWO_MIN) return false;
    const player = this.getCurrentPlayer();
    this.bank[color] -= 2;
    player.tokens[color] += 2;
    this._log(`${player.name} took 2 ${this._gem(color)}.`);
    return this._finishAction();
  }

  reserveCard(move) {
    if (this.phase !== 'play') return false;
    const player = this.getCurrentPlayer();
    if (player.reserved.length >= MAX_RESERVED) return false;

    let cardId = null;
    if (move.fromDeck) {
      const tier = move.tier;
      if (![1, 2, 3].includes(tier) || this.decks[tier].length === 0) return false;
      cardId = this.decks[tier].pop();
      player.reserved.push({ cardId, hidden: true });
      this._log(`${player.name} reserved a face-down tier ${tier} card.`);
    } else {
      cardId = move.cardId;
      const loc = this._findVisible(cardId);
      if (!loc) return false;
      this.visible[loc.tier][loc.index] = this.decks[loc.tier].pop() ?? null;
      player.reserved.push({ cardId, hidden: false });
      this._log(`${player.name} reserved a tier ${this.getCard(cardId).tier} card.`);
    }

    // Reserving grants one gold if any remain.
    if (this.bank[GOLD] > 0) {
      this.bank[GOLD] -= 1;
      player.tokens[GOLD] += 1;
    }
    return this._finishAction();
  }

  buyCard(cardId, { fromReserve = false } = {}) {
    if (this.phase !== 'play') return false;
    const player = this.getCurrentPlayer();
    const card = this.getCard(cardId);
    if (!card) return false;

    let source = null; // 'reserve' | {tier,index}
    if (fromReserve) {
      const idx = player.reserved.findIndex(entry => entry.cardId === cardId);
      if (idx < 0) return false;
      source = { reserveIndex: idx };
    } else {
      const loc = this._findVisible(cardId);
      if (!loc) return false;
      source = loc;
    }

    if (!this.canAfford(player.id, card.cost)) return false;
    this._payCard(player.id, card.cost);

    player.cards.push(cardId);
    player.bonuses[card.bonus] += 1;
    player.points = this.getVictoryPoints(player.id);

    if (source.reserveIndex != null) {
      player.reserved.splice(source.reserveIndex, 1);
    } else {
      this.visible[source.tier][source.index] = this.decks[source.tier].pop() ?? null;
    }

    const pts = card.points ? `, +${card.points} prestige` : '';
    this._log(`${player.name} bought a ${this._gem(card.bonus)} card${pts}.`);
    return this._finishAction();
  }

  discardToken(token) {
    if (this.phase !== 'discard') return false;
    const player = this.getCurrentPlayer();
    if (!ALL_TOKENS.includes(token) || player.tokens[token] <= 0) return false;
    player.tokens[token] -= 1;
    this.bank[token] += 1;
    this._log(`${player.name} returned 1 ${this._gem(token)}.`);
    if (this.getTokenTotal(player.id) <= MAX_TOKENS) {
      return this._resolveNoblesThenEnd();
    }
    this.lastAction = `${player.name} must return down to ${MAX_TOKENS} tokens.`;
    this._captureState();
    return true;
  }

  chooseNoble(nobleId) {
    if (this.phase !== 'noble-choice') return false;
    if (!this.pendingNobles.includes(nobleId)) return false;
    this._claimNoble(nobleId);
    this.pendingNobles = [];
    return this._advanceTurn();
  }

  passTurn() {
    if (this.phase !== 'play') return false;
    this._log(`${this.getCurrentPlayer().name} passed.`);
    return this._advanceTurn();
  }

  // ---- turn flow -----------------------------------------------------------

  // After a play-phase action: enforce the token limit, then resolve nobles.
  _finishAction() {
    const player = this.getCurrentPlayer();
    if (this.getTokenTotal(player.id) > MAX_TOKENS) {
      this.phase = 'discard';
      this.lastAction = `${player.name} must return down to ${MAX_TOKENS} tokens.`;
      this._captureState();
      return true;
    }
    return this._resolveNoblesThenEnd();
  }

  getQualifyingNobles(playerId = this.currentPlayer) {
    const player = this.players[playerId];
    return this.nobles.filter(nobleId => {
      const req = this.getNoble(nobleId).requirement;
      return GEMS.every(gem => player.bonuses[gem] >= (req[gem] || 0));
    });
  }

  _resolveNoblesThenEnd() {
    const qualifying = this.getQualifyingNobles(this.currentPlayer);
    if (qualifying.length === 0) return this._advanceTurn();
    if (qualifying.length === 1) {
      this._claimNoble(qualifying[0]);
      return this._advanceTurn();
    }
    // Rare: more than one noble qualifies; the player picks exactly one.
    this.pendingNobles = qualifying;
    this.phase = 'noble-choice';
    this.lastAction = `${this.getCurrentPlayer().name} may receive a noble.`;
    this._captureState();
    return true;
  }

  _claimNoble(nobleId) {
    const player = this.getCurrentPlayer();
    this.nobles = this.nobles.filter(id => id !== nobleId);
    player.nobles.push(nobleId);
    player.points = this.getVictoryPoints(player.id);
    this._log(`${player.name} was visited by a noble (+3 prestige).`);
  }

  _advanceTurn() {
    const current = this.currentPlayer;
    if (this.getVictoryPoints(current) >= this.victoryTarget) this.endTriggered = true;

    const next = this._nextPlayerId(current);
    const wraps = next === this.firstPlayer;

    if (wraps && this.endTriggered) return this._endGame('target');
    if (wraps) this.turnNumber++;
    if (this.turnNumber > MAX_GAME_TURNS) return this._endGame('limit');

    this.currentPlayer = next;
    this.phase = 'play';
    this.pendingNobles = [];
    this.lastAction = turnLabel(this.players[next].name);
    this._captureState();
    return true;
  }

  // Winner: most prestige; tiebreak fewest development cards; then lowest seat
  // (a deterministic stand-in for the rulebook's shared victory).
  _endGame(reason) {
    const ids = this.getPlayerIds();
    let winner = ids[0];
    for (const id of ids) {
      const wp = this.getVictoryPoints(winner);
      const ip = this.getVictoryPoints(id);
      if (ip > wp) { winner = id; continue; }
      if (ip === wp) {
        const wc = this.players[winner].cards.length;
        const ic = this.players[id].cards.length;
        if (ic < wc) winner = id;
      }
    }
    this.phase = 'game-over';
    this.winner = winner;
    this.winningPoints = this.getVictoryPoints(winner);
    this.lastAction = reason === 'limit'
      ? `${this.players[winner].name} wins on points (game-length limit).`
      : `${this.players[winner].name} wins with ${this.winningPoints} prestige!`;
    this._log(this.lastAction);
    this._captureState();
    return true;
  }

  // ---- helpers -------------------------------------------------------------

  _findVisible(cardId) {
    for (const tier of [1, 2, 3]) {
      const index = this.visible[tier].indexOf(cardId);
      if (index >= 0) return { tier, index };
    }
    return null;
  }

  _gem(token) {
    return token; // human-readable label is applied in the UI via GEM_LABELS
  }

  _log(message) {
    this.lastAction = message;
    this.log.push(message);
    if (this.log.length > 60) this.log.shift();
  }

  startNewGame(seed = Date.now()) {
    const next = new SplendorBoard({ seed, playerCount: this.playerCount });
    Object.assign(this, next);
    this._captureState();
  }

  // ---- hashing / serialization / history -----------------------------------

  getStateHash() {
    const players = this.getPlayerIds().map(id => {
      const p = this.players[id];
      const tok = ALL_TOKENS.map(t => p.tokens[t]).join(',');
      const bon = GEMS.map(g => p.bonuses[g]).join(',');
      return `${this.getVictoryPoints(id)}:${tok}:${bon}:${p.reserved.length}`;
    }).join('|');
    const market = [1, 2, 3].map(t => this.visible[t].map(c => c || '_').join(',')).join(';');
    const bank = ALL_TOKENS.map(t => this.bank[t]).join(',');
    return `${this.phase}|${this.currentPlayer}|${this.turnNumber}|${players}|${market}|${bank}|${this.nobles.join(',')}`;
  }

  serializeState() {
    return {
      seed: this.seed,
      playerCount: this.playerCount,
      playerIds: [...this.playerIds],
      victoryTarget: this.victoryTarget,
      decks: { 1: [...this.decks[1]], 2: [...this.decks[2]], 3: [...this.decks[3]] },
      visible: { 1: [...this.visible[1]], 2: [...this.visible[2]], 3: [...this.visible[3]] },
      bank: { ...this.bank },
      nobles: [...this.nobles],
      players: Object.fromEntries(Object.entries(this.players).map(([id, p]) => [id, {
        ...p,
        tokens: { ...p.tokens },
        bonuses: { ...p.bonuses },
        cards: [...p.cards],
        reserved: p.reserved.map(entry => ({ ...entry })),
        nobles: [...p.nobles],
      }])),
      firstPlayer: this.firstPlayer,
      currentPlayer: this.currentPlayer,
      phase: this.phase,
      pendingNobles: [...this.pendingNobles],
      endTriggered: this.endTriggered,
      turnNumber: this.turnNumber,
      winner: this.winner,
      winningPoints: this.winningPoints,
      lastAction: this.lastAction,
      log: [...this.log],
      stateHistory: this.stateHistory,
      historyIndex: this.historyIndex,
      maxHistoryLength: this.maxHistoryLength,
    };
  }

  static fromSerializedState(state) {
    const board = new SplendorBoard({
      seed: state.seed,
      playerCount: state.playerCount || 4,
      skipInitialHistory: true,
    });
    board.playerCount = state.playerCount;
    board.playerIds = [...state.playerIds];
    board.victoryTarget = state.victoryTarget ?? VICTORY_POINTS;
    board.decks = { 1: [...state.decks[1]], 2: [...state.decks[2]], 3: [...state.decks[3]] };
    board.visible = { 1: [...state.visible[1]], 2: [...state.visible[2]], 3: [...state.visible[3]] };
    board.bank = { ...state.bank };
    board.nobles = [...state.nobles];
    board.players = Object.fromEntries(Object.entries(state.players).map(([id, p]) => [Number(id), {
      ...p,
      tokens: { ...p.tokens },
      bonuses: { ...p.bonuses },
      cards: [...p.cards],
      reserved: p.reserved.map(entry => ({ ...entry })),
      nobles: [...p.nobles],
    }]));
    board.firstPlayer = state.firstPlayer;
    board.currentPlayer = state.currentPlayer;
    board.phase = state.phase;
    board.pendingNobles = [...(state.pendingNobles || [])];
    board.endTriggered = !!state.endTriggered;
    board.turnNumber = state.turnNumber;
    board.winner = state.winner;
    board.winningPoints = state.winningPoints;
    board.lastAction = state.lastAction;
    board.log = [...(state.log || [])];
    board.stateHistory = state.stateHistory || [];
    board.historyIndex = state.historyIndex ?? -1;
    board.maxHistoryLength = state.maxHistoryLength || 100;
    return board;
  }

  clone() {
    return SplendorBoard.fromSerializedState(this.serializeState());
  }

  _captureState() {
    if (this._skipHistory) return;
    const state = this.serializeState();
    state.stateHistory = [];
    state.historyIndex = -1;

    if (this.historyIndex < this.stateHistory.length - 1) {
      this.stateHistory = this.stateHistory.slice(0, this.historyIndex + 1);
    }
    this.stateHistory.push(JSON.stringify(state));
    if (this.stateHistory.length > this.maxHistoryLength) {
      this.stateHistory.shift();
    }
    this.historyIndex = this.stateHistory.length - 1;
  }

  canUndo() {
    return this.historyIndex > 0;
  }

  canRedo() {
    return this.historyIndex < this.stateHistory.length - 1;
  }

  undo() {
    if (!this.canUndo()) return false;
    this.historyIndex--;
    this._restoreFromHistory();
    return true;
  }

  redo() {
    if (!this.canRedo()) return false;
    this.historyIndex++;
    this._restoreFromHistory();
    return true;
  }

  _restoreFromHistory() {
    const parsed = JSON.parse(this.stateHistory[this.historyIndex]);
    parsed.stateHistory = this.stateHistory;
    parsed.historyIndex = this.historyIndex;
    const restored = SplendorBoard.fromSerializedState(parsed);
    Object.assign(this, restored);
  }
}

export { GEMS, GOLD, ALL_TOKENS, VICTORY_POINTS, MAX_TOKENS, MAX_RESERVED };
