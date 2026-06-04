// In-game negotiation chat. The human picks an AI power and talks to it; each
// power keeps a separate thread. When no Anthropic key is set, the panel shows a
// BYO-key entry prompt and makes NO network call until a key is saved.
//
// Visible chat is plain text only — the agent's private scratchpad is persisted
// in memory but NEVER rendered here. Scoped under .game-diplomacy.

import React, { useMemo, useState } from 'react';
import { POWER_NAMES, POWER_SHORT_NAMES } from '../DiplomacyBoard.js';
import {
  getApiKey,
  setApiKey,
  hasApiKey,
  sendMessage,
  createMemory,
} from './agentClient.js';
import { appendMessage, getThread } from './memory.js';
import { serializeBoardContext } from './serializeContext.js';

export default function ChatPanel({ board, humanPower, aiPowers }) {
  // AI powers are everyone except the human's power.
  const agents = useMemo(
    () => (Array.isArray(aiPowers) ? aiPowers : board.powers.filter((p) => p !== humanPower)),
    [aiPowers, board, humanPower]
  );

  const [selected, setSelected] = useState(agents[0] || null);
  const [memory, setMemory] = useState(() => createMemory(agents));
  const [draft, setDraft] = useState('');
  const [keyDraft, setKeyDraft] = useState('');
  const [hasKey, setHasKey] = useState(() => hasApiKey());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const thread = selected ? getThread(memory, selected) : null;

  function saveKey() {
    const trimmed = keyDraft.trim();
    if (!trimmed) return;
    setApiKey(trimmed);
    setHasKey(true);
    setKeyDraft('');
  }

  async function send() {
    const text = draft.trim();
    if (!text || !selected || busy) return;
    setError('');

    // Optimistically append the human's message to the thread.
    const store = { threads: { ...memory.threads } };
    appendMessage(store, selected, { role: 'user', content: text, turn: board.getPhaseLabel() });
    setMemory(store);
    setDraft('');
    setBusy(true);

    const history = getThread(store, selected).messages.map((m) => ({ role: m.role, content: m.content }));
    const context = serializeBoardContext(board, { power: selected });

    const result = await sendMessage({
      power: selected,
      history,
      context,
      addressee: humanPower ? POWER_NAMES[humanPower] : undefined,
      store,
    });

    if (result.error) {
      setError(result.message || 'Something went wrong.');
    }
    // sendMessage already appended the assistant reply + scratchpad into `store`.
    setMemory({ threads: { ...store.threads } });
    setBusy(false);
  }

  return (
    <div className="dip-chat">
      <div className="dip-panel-label mb-2">Negotiation</div>

      {!hasKey ? (
        <div className="dip-chat-keygate">
          <p className="dip-chat-keygate-hint">
            Add your Anthropic API key to negotiate with the other powers. It is stored only in this
            browser and sent only to your own Anthropic account.
          </p>
          <input
            type="password"
            className="dip-chat-keyinput"
            placeholder="sk-ant-..."
            value={keyDraft}
            onChange={(e) => setKeyDraft(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && saveKey()}
          />
          <button type="button" className="dip-chat-keybtn" onClick={saveKey} disabled={!keyDraft.trim()}>
            Save key
          </button>
        </div>
      ) : (
        <>
          <div className="dip-chat-powers" role="tablist">
            {agents.map((power) => (
              <button
                key={power}
                type="button"
                className={`dip-chat-power${selected === power ? ' is-active' : ''}`}
                onClick={() => setSelected(power)}
              >
                {POWER_SHORT_NAMES[power] || power}
              </button>
            ))}
          </div>

          <div className="dip-chat-thread">
            {thread && thread.messages.length ? (
              thread.messages.map((m, i) => (
                <div key={i} className={`dip-chat-msg dip-chat-msg-${m.role}`}>
                  <span className="dip-chat-msg-who">
                    {m.role === 'user'
                      ? (humanPower ? POWER_SHORT_NAMES[humanPower] : 'You')
                      : (POWER_SHORT_NAMES[selected] || selected)}
                  </span>
                  <span className="dip-chat-msg-text">{m.content}</span>
                </div>
              ))
            ) : (
              <p className="dip-chat-empty">
                Open talks with {selected ? POWER_NAMES[selected] : 'a power'}. Offer a deal, probe their
                intentions, or bluff.
              </p>
            )}
            {busy && <p className="dip-chat-typing">{POWER_SHORT_NAMES[selected] || selected} is replying…</p>}
          </div>

          {error && <p className="dip-chat-error">{error}</p>}

          <div className="dip-chat-input">
            <textarea
              className="dip-chat-textarea"
              placeholder={`Message ${selected ? POWER_SHORT_NAMES[selected] : ''}…`}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  send();
                }
              }}
              rows={2}
              disabled={busy}
            />
            <button type="button" className="dip-chat-send" onClick={send} disabled={busy || !draft.trim()}>
              Send
            </button>
          </div>
        </>
      )}
    </div>
  );
}
