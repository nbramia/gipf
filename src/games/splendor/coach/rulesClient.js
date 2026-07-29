// Client for the Splendor rules assistant (api/splendorRules.js). Manages the
// bring-your-own Anthropic API key (browser-only, localStorage) and sends the
// running conversation plus the current game context for grounded answers.

// One Anthropic key is shared across the whole app (chess coach + Catan rules
// chat + this one), so a key saved in any game is reused by the others. Legacy
// per-game keys are migrated into the shared slot on first read. (Each game
// keeps an identical copy of this logic — the games stay independent, no
// cross-import.)
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

// messages: [{ role: 'user' | 'assistant', content: string }] — the full thread,
// including the latest user question. Returns { answer } or { error, message }.
export async function askRules({ context, messages }) {
  const apiKey = getApiKey();
  if (!apiKey) {
    return { error: 'no_key', message: 'Add your Anthropic API key to ask about the rules.' };
  }
  let res;
  try {
    res = await fetch(`${process.env.PUBLIC_URL || ''}/api/splendorRules`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ context, messages, apiKey }),
    });
  } catch (_) {
    return { error: 'network', message: 'Could not reach the rules assistant. Check your connection.' };
  }
  if (!res.ok) {
    const message = res.status === 401
      ? 'Your API key was rejected. Check it in Settings.'
      : 'The rules assistant had trouble responding. Try again.';
    return { error: 'upstream', message };
  }
  const data = await res.json();
  if (data && data.answer) return { answer: data.answer };
  return { error: 'empty', message: 'No answer came back. Try rephrasing.' };
}
