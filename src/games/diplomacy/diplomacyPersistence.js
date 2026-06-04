// Full versioned game persistence for Diplomacy ([Negotiation Loop] PR3).
//
// ONE versioned save object lives under the `diplomacyGameState` localStorage
// key. It carries the board snapshot, the UI phase, per-power controllers,
// personas, the HUMAN-VISIBLE conversations, and the HIDDEN AI↔AI diplomatic
// state. The visible and hidden stores are kept strictly separate — AI↔AI text
// is never rendered, and the loader/saver never moves one into the other.
//
// All access is guarded: JSON parse/stringify in try/catch; an over-cap save is
// trimmed (oldest conversation turns dropped first); a QuotaExceededError is
// caught and the save degrades (trim then retry) rather than throwing; corrupt
// or wrong-version data loads as null so the app starts fresh. Pure of React.

const SAVE_KEY = 'diplomacyGameState';
export const SAVE_VERSION = 1;

// Soft byte cap for the serialized save. Above this we trim conversation turns
// (oldest first) before writing. Generous — a full game's board + state is small;
// conversations are the only unbounded growth, and they degrade gracefully.
const BYTE_CAP = 400_000;

// Keep at least this many of the most-recent turns per conversation thread even
// when trimming, so a reload never loses the live exchange.
const MIN_TURNS_PER_THREAD = 4;

// Approximate UTF-8 byte length of a string (good enough for a soft cap).
function byteLength(str) {
  try {
    return new Blob([str]).size;
  } catch (_) {
    // Blob unavailable (older test envs): fall back to char length.
    return str.length;
  }
}

// Deep clone via JSON so trimming never mutates the caller's live stores.
function jsonClone(value) {
  return JSON.parse(JSON.stringify(value));
}

// Trim the oldest messages from each conversation thread, keeping the most
// recent `keepPerThread`. Returns a new conversations object (input untouched).
function trimConversations(conversations, keepPerThread) {
  if (!conversations || typeof conversations !== 'object') return conversations;
  const threads = conversations.threads;
  if (!threads || typeof threads !== 'object') return conversations;
  const out = { ...conversations, threads: {} };
  for (const [power, thread] of Object.entries(threads)) {
    if (thread && Array.isArray(thread.messages) && thread.messages.length > keepPerThread) {
      out.threads[power] = {
        ...thread,
        messages: thread.messages.slice(thread.messages.length - keepPerThread),
      };
    } else {
      out.threads[power] = thread;
    }
  }
  return out;
}

// Build the versioned envelope. `state` is the live, in-memory game state.
function buildEnvelope(state) {
  return {
    version: SAVE_VERSION,
    savedAt: Date.now(),
    board: state.board && typeof state.board.serializeState === 'function'
      ? state.board.serializeState()
      : state.board,
    uiPhase: state.uiPhase,
    controllers: state.controllers || null,
    personas: state.personas || null,
    // Human-VISIBLE thread store only.
    conversations: state.conversations || null,
    // Hidden AI↔AI diplomatic state — persisted but never rendered.
    diplomaticState: state.diplomaticState || null,
  };
}

// Serialize an envelope, trimming conversations until it fits under the byte cap
// (down to a floor) so an oversized history can't block a save.
function serializeWithinCap(envelope) {
  let payload = JSON.stringify(envelope);
  if (byteLength(payload) <= BYTE_CAP) return { payload, envelope };

  let keep = 24; // start generous, shrink toward the floor
  let trimmed = envelope;
  while (keep >= MIN_TURNS_PER_THREAD) {
    trimmed = { ...envelope, conversations: trimConversations(envelope.conversations, keep) };
    payload = JSON.stringify(trimmed);
    if (byteLength(payload) <= BYTE_CAP) break;
    keep = Math.floor(keep / 2);
  }
  return { payload, envelope: trimmed };
}

// saveGame(state) — persist the whole game. Never throws.
//   state = { board, uiPhase, controllers, personas, conversations, diplomaticState }
// `board` may be a live DiplomacyBoard (serialized here) or an already-serialized
// snapshot. Returns true on success, false if the write degraded/failed.
export function saveGame(state) {
  if (!state) return false;
  let envelope;
  try {
    envelope = buildEnvelope(state);
  } catch (_) {
    return false;
  }

  try {
    const { payload } = serializeWithinCap(envelope);
    try {
      localStorage.setItem(SAVE_KEY, payload);
      return true;
    } catch (err) {
      if (!isQuotaError(err)) return false;
      // Quota: trim hard to the floor and retry once. Never throw.
      try {
        const trimmed = { ...envelope, conversations: trimConversations(envelope.conversations, MIN_TURNS_PER_THREAD) };
        localStorage.setItem(SAVE_KEY, JSON.stringify(trimmed));
        return true;
      } catch (_) {
        return false; // give up silently
      }
    }
  } catch (_) {
    return false;
  }
}

function isQuotaError(err) {
  return (
    err &&
    (err.name === 'QuotaExceededError' ||
      err.name === 'NS_ERROR_DOM_QUOTA_REACHED' ||
      err.code === 22 ||
      err.code === 1014)
  );
}

// loadGame() — read and validate the saved game. Returns the envelope (a plain
// object with `board` as a serialized snapshot) or null when there is no save,
// the JSON is corrupt, or the version is unknown. Never throws.
export function loadGame() {
  let raw;
  try {
    raw = localStorage.getItem(SAVE_KEY);
  } catch (_) {
    return null;
  }
  if (!raw) return null;

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (_) {
    return null; // corrupt JSON
  }

  if (!parsed || typeof parsed !== 'object') return null;
  if (parsed.version !== SAVE_VERSION) return null; // unknown / old version
  if (!parsed.board || typeof parsed.board !== 'object') return null; // partial

  return {
    version: parsed.version,
    savedAt: parsed.savedAt || null,
    board: parsed.board,
    uiPhase: parsed.uiPhase || 'negotiation',
    controllers: parsed.controllers || null,
    personas: parsed.personas || null,
    conversations: parsed.conversations || null,
    diplomaticState: parsed.diplomaticState || null,
  };
}

// clearGame() — remove the saved game AND every diplomacy*-prefixed key except
// the shared cross-game `gipfApiKey` (which belongs to the whole app, not this
// game). Never throws.
export function clearGame() {
  try {
    const keys = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key && key.startsWith('diplomacy')) keys.push(key);
    }
    for (const key of keys) localStorage.removeItem(key);
  } catch (_) {
    /* ignore storage failures */
  }
}

// Exported for tests.
export { trimConversations, jsonClone, BYTE_CAP, MIN_TURNS_PER_THREAD };
