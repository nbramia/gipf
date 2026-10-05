// Client for the Catan rules assistant (api/catanRules.js). Manages the
// bring-your-own Anthropic API key (a guest's in localStorage; a signed-in
// account's held on the server, see src/accountKeys.js) and sends the
// running conversation plus the current game context for grounded answers.

import { accountKeys, ACCOUNT_REQUEST_HEADERS } from '../../../accountKeys.js';

// One Anthropic key is shared across the whole app (chess coach + this rules
// chat), so a key saved in either game is reused by the other. Legacy per-game
// keys are migrated into the shared slot on first read. (The chess client keeps
// an identical copy of this logic — the games stay independent, no cross-import.)
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

export function setApiKey(key) {
  try {
    if (key) {
      localStorage.setItem(KEY_STORAGE, key);
    } else {
      localStorage.removeItem(KEY_STORAGE);
      LEGACY_KEYS.forEach(legacy => localStorage.removeItem(legacy));
    }
  } catch (_) {
    /* ignore storage failures */
  }
}

// A key on this device (guests), or one held on the signed-in account, which the
// server adds to each request so it never reaches the browser.
export function hasApiKey() {
  return !!getApiKey() || accountKeys().anthropic;
}

// messages: [{ role: 'user' | 'assistant', content: string }] — the full thread,
// including the latest user question. Returns { answer } or { error, message }.
export async function askRules({ context, messages }) {
  const apiKey = getApiKey();
  if (!apiKey && !accountKeys().anthropic) {
    return { error: 'no_key', message: 'Add your Anthropic API key to ask about the rules.' };
  }
  let res;
  try {
    res = await fetch(`${process.env.PUBLIC_URL || ''}/api/catanRules`, {
      method: 'POST',
      headers: ACCOUNT_REQUEST_HEADERS,
      body: JSON.stringify({ context, messages, ...(apiKey ? { apiKey } : {}) }),
    });
  } catch (_) {
    return { error: 'network', message: 'Could not reach the rules assistant. Check your connection.' };
  }
  if (!res.ok) {
    const message = res.status === 401
      ? 'Your API key was rejected. Check it under Sign in / add key.'
      : 'The rules assistant had trouble responding. Try again.';
    return { error: 'upstream', message };
  }
  const data = await res.json();
  if (data && data.answer) return { answer: data.answer };
  return { error: 'empty', message: 'No answer came back. Try rephrasing.' };
}
