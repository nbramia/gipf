// coachClient.js — browser-side coaching client.
//
// Owns the BRING-YOUR-OWN Anthropic key (localStorage only) and turns engine
// analysis into commentary by calling /api/chessCoach. On any failure — no key,
// network error, upstream error — it falls back to deterministic, engine-
// grounded templates so the dialogue never breaks and never fabricates lines.

import { describeAiMove, describePlayerMove } from './templates';

const KEY_STORAGE = 'chessApiKey';

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

export function clearApiKey() {
  setApiKey('');
}

export function hasApiKey() {
  return !!getApiKey();
}

// Request commentary for a move.
//   payload: { kind, fen, sideToMove, movePlayed, evalBefore, evalAfter,
//              candidates, classification, bestMove, learningGoal }
// Returns { text, source: 'claude' | 'template' }.
export async function requestCommentary(payload) {
  const fallback = () => ({
    text:
      payload.kind === 'player-move'
        ? describePlayerMove(payload)
        : describeAiMove(payload),
    source: 'template',
  });

  const apiKey = getApiKey();
  if (!apiKey) return fallback();

  try {
    const res = await fetch('/api/chessCoach', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...payload, apiKey }),
    });
    if (!res.ok) return fallback();
    const data = await res.json();
    if (data && data.commentary) return { text: data.commentary, source: 'claude' };
    return fallback();
  } catch (_) {
    return fallback();
  }
}
