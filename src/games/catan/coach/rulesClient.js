// Client for the Catan rules assistant (api/catanRules.js). Manages the
// bring-your-own Anthropic API key (browser-only, localStorage) and sends the
// running conversation plus the current game context for grounded answers.

const KEY_STORAGE = 'catanApiKey';

export function getApiKey() {
  try {
    return localStorage.getItem(KEY_STORAGE) || '';
  } catch (_) {
    return '';
  }
}

export function setApiKey(key) {
  try {
    if (key) localStorage.setItem(KEY_STORAGE, key);
    else localStorage.removeItem(KEY_STORAGE);
  } catch (_) {
    /* ignore storage failures */
  }
}

export function hasApiKey() {
  return !!getApiKey();
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
    res = await fetch('/api/catanRules', {
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
