// Conversation memory model for the Diplomacy agents. Pure helpers (no React,
// no network, no cross-game imports): a store keyed by power id, where each
// AI power has one thread (its visible message history) plus a private,
// persisted scratchpad (its latest disposition toward the other powers).
//
// This ships the SHAPE only. Wiring memory into full game-save persistence is a
// later issue ([Negotiation Loop]); here it round-trips losslessly so it can be
// stashed alongside the board state and carried across turns.

const STANCES = ['ally', 'friendly', 'neutral', 'rival', 'enemy'];

// Create an empty store with one thread slot per AI power. `aiPowers` is the
// list of powers controlled by an agent (e.g. all powers except the human's).
export function createMemory(aiPowers = []) {
  const threads = {};
  for (const power of aiPowers) {
    threads[power] = emptyThread(power);
  }
  return { threads };
}

function emptyThread(power) {
  return {
    power,
    messages: [],
    scratchpad: null,
    updatedAt: 0,
  };
}

// Return the thread for a power, creating it on demand (so a store built before
// controllers were assigned still works).
export function getThread(store, power) {
  if (!store.threads[power]) {
    store.threads[power] = emptyThread(power);
  }
  return store.threads[power];
}

// Append a message to a power's thread. Does not mutate other powers' threads.
// `message` is { role: 'user'|'assistant', content: string, turn?: string }.
// Returns the updated store (mutates in place, like a reducer on a draft).
export function appendMessage(store, power, message) {
  const thread = getThread(store, power);
  thread.messages.push({
    role: message.role === 'assistant' ? 'assistant' : 'user',
    content: String(message.content || ''),
    turn: message.turn || '',
  });
  thread.updatedAt = Date.now();
  return store;
}

// Update a power's persisted scratchpad from an agent response. Only a valid
// scratchpad overwrites the stored one; an invalid/null scratchpad is ignored so
// a malformed turn never wipes prior disposition. Returns the updated store.
export function updateScratchpad(store, power, response) {
  // Accept either a full response ({ scratchpad }) or a bare scratchpad object.
  const scratchpad =
    response && typeof response === 'object' && 'scratchpad' in response
      ? response.scratchpad
      : response;
  if (validateScratchpad(scratchpad)) {
    const thread = getThread(store, power);
    thread.scratchpad = scratchpad;
    thread.updatedAt = Date.now();
  }
  return store;
}

// True only for a well-formed scratchpad matching the documented shape:
//   { self: string, dispositions: { [power]: { trust∈[-1,1], stance∈enum, intent: string, note? } },
//     priority?: string, confidence∈[0,1] }
// Never throws.
export function validateScratchpad(obj) {
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return false;
  if (typeof obj.self !== 'string' || !obj.self) return false;
  if (!obj.dispositions || typeof obj.dispositions !== 'object' || Array.isArray(obj.dispositions)) return false;
  for (const key of Object.keys(obj.dispositions)) {
    const d = obj.dispositions[key];
    if (!d || typeof d !== 'object') return false;
    if (typeof d.trust !== 'number' || d.trust < -1 || d.trust > 1) return false;
    if (!STANCES.includes(d.stance)) return false;
    if (typeof d.intent !== 'string') return false;
  }
  if (typeof obj.confidence !== 'number' || obj.confidence < 0 || obj.confidence > 1) return false;
  return true;
}

// Serialize the memory blob to a plain JSON string (shape only — no engine
// state). Deserialize is its inverse.
export function serializeMemory(store) {
  return JSON.stringify(store && store.threads ? { threads: store.threads } : { threads: {} });
}

export function deserializeMemory(blob) {
  if (!blob) return { threads: {} };
  try {
    const parsed = typeof blob === 'string' ? JSON.parse(blob) : blob;
    if (parsed && parsed.threads && typeof parsed.threads === 'object') {
      return { threads: parsed.threads };
    }
  } catch (_) {
    /* fall through to empty */
  }
  return { threads: {} };
}
