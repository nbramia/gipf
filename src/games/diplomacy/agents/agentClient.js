// Client for the Diplomacy agents (api/diplomacyAgent.js). Manages the
// bring-your-own Anthropic API key (browser-only, localStorage) and sends a
// per-power conversation plus the live board context to get an in-character
// reply and the agent's private scratchpad back.

import { getPersona } from './personas.js';
import {
  createMemory,
  appendMessage,
  updateScratchpad,
  validateScratchpad,
  serializeMemory,
  deserializeMemory,
} from './memory.js';

// One Anthropic key is shared across the whole app (chess coach + Catan rules
// chat + this Diplomacy chat), so a key saved in any game is reused everywhere.
// Legacy per-game keys are migrated into the shared slot on first read. (Each
// game keeps its OWN copy of this logic — the games stay independent, no
// cross-game import.)
const KEY_STORAGE = 'gipfApiKey';
const LEGACY_KEYS = ['chessApiKey', 'catanApiKey'];

export function getApiKey() {
  try {
    const shared = localStorage.getItem(KEY_STORAGE);
    if (shared) return shared;
    for (const legacy of LEGACY_KEYS) {
      const value = localStorage.getItem(legacy);
      if (value) {
        localStorage.setItem(KEY_STORAGE, value);
        return value;
      }
    }
    return '';
  } catch (_) {
    return '';
  }
}

// Same-tab broadcast event name. The shared key lives in localStorage, so the
// browser's native `storage` event already syncs OTHER tabs (and the other GIPF
// games) for free; this custom event covers same-tab listeners (the `storage`
// event does NOT fire in the tab that made the change).
const KEY_EVENT = 'gipf-apikey-change';

export function setApiKey(key) {
  try {
    if (key) {
      localStorage.setItem(KEY_STORAGE, key);
    } else {
      localStorage.removeItem(KEY_STORAGE);
      LEGACY_KEYS.forEach((legacy) => localStorage.removeItem(legacy));
    }
  } catch (_) {
    /* ignore storage failures */
  }
  // Notify same-tab listeners (cross-tab handled by the native `storage` event).
  try {
    if (typeof window !== 'undefined') window.dispatchEvent(new Event(KEY_EVENT));
  } catch (_) {
    /* ignore */
  }
}

export function hasApiKey() {
  return !!getApiKey();
}

// Per-game copy of the app-shared session read (see src/account.js) — just the
// signed-in username, so the key UI can explain why a key is already present.
export function getAccountUsername() {
  try {
    const s = JSON.parse(localStorage.getItem('gipfAccount'));
    return s && s.v === 1 && typeof s.username === 'string' ? s.username : null;
  } catch (_) { return null; }
}

// Subscribe to key changes from anywhere: this tab (our KEY_EVENT, e.g. saving a
// key in the Diplomacy chat) OR another tab / another GIPF game (the native
// `storage` event on the shared slot). Returns an unsubscribe fn.
export function subscribeApiKey(callback) {
  if (typeof window === 'undefined') return () => {};
  const onChange = () => callback();
  const onStorage = (e) => {
    if (!e || e.key === null || e.key === KEY_STORAGE || LEGACY_KEYS.includes(e.key)) callback();
  };
  window.addEventListener(KEY_EVENT, onChange);
  window.addEventListener('storage', onStorage);
  return () => {
    window.removeEventListener(KEY_EVENT, onChange);
    window.removeEventListener('storage', onStorage);
  };
}

// Re-export the memory helpers so callers (the chat panel) have one import for
// the whole agent substrate.
export { createMemory, serializeMemory, deserializeMemory, validateScratchpad };

// Send a message to one AI power.
//   power:   the AI power id being addressed
//   history: [{ role: 'user'|'assistant', content: string }] — the full thread,
//            including the latest human message
//   context: the serialized board context (serializeContext.js)
//   addressee: the human power id doing the talking (optional)
//   model:   optional per-request model override (e.g. 'claude-opus-4-8')
//   store:   optional memory store; when given, the result is wired through it
// Returns { message, scratchpad } on success, or { error, message } like askRules.
export async function sendMessage({ power, history, context, addressee, model, store } = {}) {
  const apiKey = getApiKey();
  if (!apiKey) {
    return { error: 'no_key', message: 'Add your Anthropic API key to talk to the other powers.' };
  }

  const persona = getPersona(power);
  const messages = Array.isArray(history) ? history : [];

  let res;
  try {
    res = await fetch('/api/diplomacyAgent', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ apiKey, power, persona, context, messages, addressee, model }),
    });
  } catch (_) {
    return { error: 'network', message: 'Could not reach the other power. Check your connection.' };
  }

  if (!res.ok) {
    const message = res.status === 401
      ? 'Your API key was rejected. Check it in Settings.'
      : 'That power could not be reached right now. Try again.';
    return { error: 'upstream', message };
  }

  const data = await res.json();
  if (!data || typeof data.message !== 'string' || !data.message) {
    return { error: 'empty', message: 'No reply came back. Try again.' };
  }

  const result = { message: data.message, scratchpad: data.scratchpad || null, summary: data.summary || '', deal: data.deal || null };

  // Wire the result through memory when a store is supplied: append the visible
  // reply and persist the latest scratchpad.
  if (store) {
    appendMessage(store, power, { role: 'assistant', content: result.message });
    updateScratchpad(store, power, result);
  }

  return result;
}

// askAgent — the orchestrator-facing call shape used by negotiator.js
// (runNegotiationPhase). It wraps the same BYO-key endpoint as sendMessage but
// adds AI↔AI negotiation fields (channel, counterparties) and never writes to any
// memory store itself — the orchestrator owns transcript/state persistence and
// keeps AI↔AI text out of the human-visible thread store.
//   { power, counterparties, channel, boardContext, persona, messages, model,
//     priorSummary, memory, proposedDeal }
//   - priorSummary:  a brief carried summary of where this channel stands (#44)
//   - memory:        the agent's own prior private note about this rival (#44)
//   - proposedDeal:  a deal the counterparty formally proposed; the endpoint
//                    requires an accept:true/false answer (bilateral consent)
// Returns { reply: { message, scratchpad, summary, deal, accept } } on success,
// or { error, reply } mirroring sendMessage's error contract.
export async function askAgent({
  power,
  counterparties = [],
  channel,
  boardContext,
  persona,
  messages,
  model,
  priorSummary,
  memory,
  proposedDeal,
  initiate,
} = {}) {
  const apiKey = getApiKey();
  if (!apiKey) {
    return { error: 'no_key', reply: { message: 'Add your Anthropic API key to enable AI negotiation.' } };
  }

  const resolvedPersona = persona || getPersona(power);
  const history = Array.isArray(messages) ? messages : [];

  let res;
  try {
    res = await fetch('/api/diplomacyAgent', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        apiKey,
        power,
        persona: resolvedPersona,
        context: boardContext,
        messages: history,
        counterparties,
        channel,
        model,
        priorSummary,
        memory,
        proposedDeal,
        initiate,
      }),
    });
  } catch (_) {
    return { error: 'network', reply: { message: '' } };
  }

  if (!res.ok) {
    return { error: 'upstream', reply: { message: '' } };
  }

  const data = await res.json();
  return {
    reply: {
      message: (data && data.message) || '',
      scratchpad: (data && data.scratchpad) || null,
      summary: (data && data.summary) || '',
      deal: (data && data.deal) || null,
      accept: data && typeof data.accept === 'boolean' ? data.accept : null,
    },
  };
}
