// coachClient.js — browser-side coaching client.
//
// Owns the BRING-YOUR-OWN Anthropic key (localStorage only) and turns engine
// analysis into commentary by calling /api/chessCoach. On any failure — no key,
// network error, upstream error — it falls back to deterministic, engine-
// grounded templates so the dialogue never breaks and never fabricates lines.

import { describeAiMove, describePlayerMove } from './templates.js';
import { runTool } from './analysisTools.js';
import { getLichessToken } from './openingCoach.js';

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

// --- Threaded Q&A (tool-use agentic loop) ------------------------------------
//
// Drives a follow-up conversation about a move. Claude runs server-side but the
// Stockfish tool runs HERE in the browser, so this function owns the loop:
//   POST messages+tools -> if Claude asks for analyze_position, run it locally
//   and POST back the tool_result -> repeat until Claude returns a final answer.
//
// Q&A requires an API key (no template fallback can answer free-form questions).
//
//   context  — { fenBefore, fenAfter, movePlayed, classification, evalBefore,
//                evalAfter, bestMove, opening, commentary }
//   history  — prior thread messages (Anthropic format) to continue, or []
//   question — the new user question (string)
//   analyze  — async (fen, {multipv}) => { lines } — the engine (from useStockfish)
//   onToolCall — optional (call) => void, for live "Analyzing …" UI
//
// Returns { text, messages, toolCalls } where `messages` is the updated history
// to persist on the thread, and `toolCalls` lists the analyses performed.
const MAX_TOOL_ROUNDS = 6;

export async function runThreadTurn({ context, history, question, analyze, onToolCall }) {
  const apiKey = getApiKey();
  if (!apiKey) {
    return { error: 'no_key', text: 'Add your Anthropic API key to ask questions about this move.' };
  }

  const messages = [...(history || []), { role: 'user', content: question }];
  const toolCalls = [];

  for (let round = 0; round < MAX_TOOL_ROUNDS; round += 1) {
    let res;
    try {
      res = await fetch('/api/chessCoach', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode: 'thread', context, messages, apiKey }),
      });
    } catch (_) {
      return { error: 'network', text: 'Could not reach the coach. Check your connection.', messages };
    }
    if (!res.ok) {
      const msg = res.status === 401
        ? 'Your API key was rejected. Check it in Settings.'
        : 'The coach had trouble responding. Try again.';
      return { error: 'upstream', text: msg, messages };
    }

    const data = await res.json();
    const content = data.content || [];
    // Record the assistant turn verbatim (text + any tool_use blocks).
    messages.push({ role: 'assistant', content });

    if (data.stop_reason !== 'tool_use') {
      const text = content.filter((b) => b.type === 'text').map((b) => b.text).join('').trim();
      return { text, messages, toolCalls };
    }

    // Run every requested tool locally and feed results back.
    const toolUses = content.filter((b) => b.type === 'tool_use');
    const toolResults = [];
    for (const tu of toolUses) {
      if (onToolCall) onToolCall(tu.input || {});
      // eslint-disable-next-line no-await-in-loop
      const result = await runTool(tu.name, tu.input || {}, { ctx: context, analyze, getToken: getLichessToken });
      toolCalls.push({ input: tu.input || {}, result });
      toolResults.push({
        type: 'tool_result',
        tool_use_id: tu.id,
        content: JSON.stringify(result),
      });
    }
    messages.push({ role: 'user', content: toolResults });
  }

  return {
    text: 'I ran out of analysis steps for that question — try asking something more specific.',
    messages,
    toolCalls,
  };
}
