// Tests for full versioned persistence ([Negotiation Loop] PR3). Structural
// assertions only — round-trip equality, corruption/quota guards, key clearing,
// and the strict visible/hidden separation that keeps AI↔AI text out of the
// human-visible conversation store.

import DiplomacyBoard from './DiplomacyBoard.js';
import { saveGame, loadGame, clearGame, SAVE_VERSION } from './diplomacyPersistence.js';

// A minimal jsdom-style localStorage if the test env lacks one.
function installLocalStorage() {
  const store = new Map();
  const ls = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
    key: (i) => Array.from(store.keys())[i] ?? null,
    clear: () => store.clear(),
    get length() {
      return store.size;
    },
  };
  Object.defineProperty(global, 'localStorage', { value: ls, configurable: true, writable: true });
  return ls;
}

beforeEach(() => {
  installLocalStorage();
});

const SENTINEL = 'AI_TO_AI_SECRET_DO_NOT_SHOW_HUMAN';

// Build a representative game-state snapshot for persistence.
function makeState({ board, uiPhase = 'negotiation' } = {}) {
  const b = board || new DiplomacyBoard({ maxYears: 1905 });
  return {
    board: b,
    uiPhase,
    controllers: { austria: 'AI', england: 'human', france: 'AI', germany: 'AI', italy: 'AI', russia: 'AI', turkey: 'AI' },
    personas: { france: { name: 'France', temperament: { trust: 0.5 } } },
    conversations: {
      threads: {
        france: { power: 'france', messages: [{ role: 'user', content: 'hello', turn: 'Spring 1901' }], scratchpad: null, updatedAt: 1 },
      },
    },
    diplomaticState: {
      version: 1,
      humanPower: 'england',
      relations: {},
      agreements: [],
      promises: [],
      promiseLedger: {},
      // hidden AI↔AI transcript content carrying the sentinel.
      transcripts: { 'austria~france': [{ round: 0, power: 'austria', message: SENTINEL }] },
    },
  };
}

describe('diplomacyPersistence — round trip', () => {
  test('saveGame then loadGame restores the envelope fields', () => {
    const state = makeState();
    expect(saveGame(state)).toBe(true);

    const loaded = loadGame();
    expect(loaded).toBeTruthy();
    expect(loaded.version).toBe(SAVE_VERSION);
    expect(loaded.uiPhase).toBe('negotiation');
    expect(loaded.controllers.england).toBe('human');
    expect(loaded.personas.france.name).toBe('France');
    expect(loaded.conversations.threads.france.messages[0].content).toBe('hello');
    expect(loaded.diplomaticState.humanPower).toBe('england');
  });

  test('board snapshot reloads to an equal board snapshot', () => {
    const board = new DiplomacyBoard({ maxYears: 1905 });
    saveGame(makeState({ board }));
    const loaded = loadGame();
    const restored = DiplomacyBoard.fromSerializedState(loaded.board);
    // Deep equality of the canonical snapshot (ignoring undo history noise).
    const a = board.serializeState();
    const b = restored.serializeState();
    expect(b.units).toEqual(a.units);
    expect(b.supplyCenters).toEqual(a.supplyCenters);
    expect(b.phase).toBe(a.phase);
    expect(b.year).toBe(a.year);
    expect(b.maxYears).toBe(a.maxYears);
  });

  test('reload is identical for each UI phase (deep equality)', () => {
    for (const uiPhase of ['negotiation', 'orders', 'retreats', 'winter']) {
      installLocalStorage();
      const state = makeState({ uiPhase });
      saveGame(state);
      const loaded = loadGame();
      expect(loaded.uiPhase).toBe(uiPhase);
      expect(loaded.conversations).toEqual(state.conversations);
      expect(loaded.diplomaticState).toEqual(state.diplomaticState);
      expect(loaded.controllers).toEqual(state.controllers);
      expect(loaded.personas).toEqual(state.personas);
    }
  });
});

describe('diplomacyPersistence — guards', () => {
  test('saveGame never throws when setItem throws QuotaExceededError', () => {
    const state = makeState();
    const err = new Error('quota');
    err.name = 'QuotaExceededError';
    let calls = 0;
    localStorage.setItem = () => {
      calls += 1;
      throw err;
    };
    expect(() => saveGame(state)).not.toThrow();
    // It attempted to write (and the retry also threw) — never propagated.
    expect(calls).toBeGreaterThanOrEqual(1);
  });

  test('saveGame trims oldest conversation turns over the byte cap', () => {
    const board = new DiplomacyBoard({ maxYears: 1905 });
    const big = [];
    for (let i = 0; i < 5000; i++) big.push({ role: 'user', content: `msg-${i}-`.repeat(40), turn: 'Spring 1901' });
    const state = makeState({ board });
    state.conversations.threads.france.messages = big;

    expect(saveGame(state)).toBe(true);
    const loaded = loadGame();
    // Trimmed to a small recent slice — far fewer than 5000.
    expect(loaded.conversations.threads.france.messages.length).toBeLessThan(5000);
    expect(loaded.conversations.threads.france.messages.length).toBeGreaterThan(0);
    // The most-recent message survives.
    const last = loaded.conversations.threads.france.messages.slice(-1)[0];
    expect(last.content).toContain('msg-4999');
  });

  test('loadGame returns null for corrupt JSON', () => {
    localStorage.setItem('diplomacyGameState', '{not valid json');
    expect(loadGame()).toBeNull();
  });

  test('loadGame returns null for an unknown version', () => {
    localStorage.setItem('diplomacyGameState', JSON.stringify({ version: 999, board: {} }));
    expect(loadGame()).toBeNull();
  });

  test('loadGame returns null for a partial object missing the board', () => {
    localStorage.setItem('diplomacyGameState', JSON.stringify({ version: SAVE_VERSION, uiPhase: 'orders' }));
    expect(loadGame()).toBeNull();
  });

  test('loadGame returns null when no save exists', () => {
    expect(loadGame()).toBeNull();
  });
});

describe('diplomacyPersistence — clearGame', () => {
  test('removes every diplomacy*-prefixed key', () => {
    saveGame(makeState());
    localStorage.setItem('diplomacySettings', '{}');
    localStorage.setItem('diplomacyDarkMode', 'true');
    localStorage.setItem('gipfApiKey', 'sk-keep-me');

    clearGame();

    const remaining = [];
    for (let i = 0; i < localStorage.length; i++) remaining.push(localStorage.key(i));
    expect(remaining.filter((k) => k && k.startsWith('diplomacy'))).toHaveLength(0);
    // The shared cross-game key is NOT a diplomacy key, so it survives.
    expect(localStorage.getItem('gipfApiKey')).toBe('sk-keep-me');
  });
});

describe('diplomacyPersistence — visible/hidden separation', () => {
  test('AI↔AI sentinel never appears in the human-visible conversations after reload', () => {
    const state = makeState();
    saveGame(state);
    const loaded = loadGame();

    const visible = JSON.stringify(loaded.conversations);
    expect(visible).not.toContain(SENTINEL);
    // It IS retained in the hidden diplomatic state (persisted, never rendered).
    const hidden = JSON.stringify(loaded.diplomaticState);
    expect(hidden).toContain(SENTINEL);
  });
});
