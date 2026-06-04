import {
  createMemory,
  getThread,
  appendMessage,
  updateScratchpad,
  validateScratchpad,
  serializeMemory,
  deserializeMemory,
} from './memory.js';

const VALID = {
  self: 'france',
  dispositions: {
    england: { trust: 0.2, stance: 'rival', intent: 'Lure into NTH, stab in Fall.', note: 'Offered ENG DMZ.' },
  },
  priority: 'Take Belgium; keep Italy calm.',
  confidence: 0.6,
};

const AI_POWERS = ['austria', 'england', 'germany', 'italy', 'russia', 'turkey'];

describe('createMemory', () => {
  test('has exactly one thread slot per AI power (6 when one of 7 is human)', () => {
    const store = createMemory(AI_POWERS);
    expect(Object.keys(store.threads)).toHaveLength(6);
    AI_POWERS.forEach((p) => {
      expect(store.threads[p]).toMatchObject({ power: p, messages: [], scratchpad: null });
    });
  });
});

describe('appendMessage', () => {
  test('preserves chronological order within a thread', () => {
    const store = createMemory(AI_POWERS);
    appendMessage(store, 'england', { role: 'user', content: 'first' });
    appendMessage(store, 'england', { role: 'assistant', content: 'second' });
    appendMessage(store, 'england', { role: 'user', content: 'third' });
    expect(store.threads.england.messages.map((m) => m.content)).toEqual(['first', 'second', 'third']);
  });

  test('does not mutate other powers threads', () => {
    const store = createMemory(AI_POWERS);
    appendMessage(store, 'england', { role: 'user', content: 'to england' });
    expect(store.threads.germany.messages).toHaveLength(0);
  });

  test('creates a thread on demand for an unknown power', () => {
    const store = createMemory([]);
    appendMessage(store, 'france', { role: 'user', content: 'hi' });
    expect(store.threads.france.messages).toHaveLength(1);
  });
});

describe('validateScratchpad', () => {
  test('accepts the documented example', () => {
    expect(validateScratchpad(VALID)).toBe(true);
  });

  test('rejects missing dispositions', () => {
    const bad = { self: 'france', confidence: 0.5 };
    expect(validateScratchpad(bad)).toBe(false);
  });

  test('rejects out-of-range trust', () => {
    const bad = { ...VALID, dispositions: { england: { trust: 5, stance: 'rival', intent: 'x' } } };
    expect(validateScratchpad(bad)).toBe(false);
  });

  test('rejects an unknown stance', () => {
    const bad = { ...VALID, dispositions: { england: { trust: 0.1, stance: 'frenemy', intent: 'x' } } };
    expect(validateScratchpad(bad)).toBe(false);
  });

  test('rejects out-of-range confidence', () => {
    expect(validateScratchpad({ ...VALID, confidence: 2 })).toBe(false);
  });

  test('rejects null / non-object without throwing', () => {
    expect(validateScratchpad(null)).toBe(false);
    expect(validateScratchpad('nope')).toBe(false);
    expect(validateScratchpad([])).toBe(false);
  });
});

describe('updateScratchpad', () => {
  test('persists a valid scratchpad on the thread', () => {
    const store = createMemory(AI_POWERS);
    updateScratchpad(store, 'france', { scratchpad: VALID });
    expect(store.threads.france.scratchpad).toEqual(VALID);
  });

  test('accepts a bare scratchpad object too', () => {
    const store = createMemory(AI_POWERS);
    updateScratchpad(store, 'france', VALID);
    expect(store.threads.france.scratchpad).toEqual(VALID);
  });

  test('ignores an invalid scratchpad, keeping the prior one', () => {
    const store = createMemory(AI_POWERS);
    updateScratchpad(store, 'france', { scratchpad: VALID });
    updateScratchpad(store, 'france', { scratchpad: { self: 'france', dispositions: { england: { trust: 9, stance: 'x' } } } });
    expect(store.threads.france.scratchpad).toEqual(VALID);
  });
});

describe('serialize / deserialize', () => {
  test('round-trip is lossless (deep-equal)', () => {
    const store = createMemory(AI_POWERS);
    appendMessage(store, 'england', { role: 'user', content: 'hello', turn: 'Spring 1901 orders' });
    updateScratchpad(store, 'england', { scratchpad: { ...VALID, self: 'england' } });

    const restored = deserializeMemory(serializeMemory(store));
    expect(restored).toEqual(store);
  });

  test('deserialize tolerates a bad blob', () => {
    expect(deserializeMemory('not json')).toEqual({ threads: {} });
    expect(deserializeMemory(null)).toEqual({ threads: {} });
  });
});

describe('scratchpad persists across turns', () => {
  test('a scratchpad set on turn N is readable on turn N+1', () => {
    let store = createMemory(AI_POWERS);
    appendMessage(store, 'france', { role: 'user', content: 'turn N', turn: 'Spring 1901 orders' });
    updateScratchpad(store, 'france', { scratchpad: VALID });

    // Simulate persistence across a turn boundary.
    store = deserializeMemory(serializeMemory(store));

    appendMessage(store, 'france', { role: 'user', content: 'turn N+1', turn: 'Fall 1901 orders' });
    expect(getThread(store, 'france').scratchpad).toEqual(VALID);
    expect(getThread(store, 'france').messages).toHaveLength(2);
  });
});
