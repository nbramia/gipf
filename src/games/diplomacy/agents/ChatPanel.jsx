// In-game negotiation chat. The human picks an AI power and talks to it; each
// power keeps a separate thread. When no Anthropic key is set, the panel shows a
// BYO-key entry prompt and makes NO network call until a key is saved.
//
// Visible chat is plain text only — the agent's private scratchpad is persisted
// in memory but NEVER rendered here. Scoped under .game-diplomacy.

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { POWER_NAMES, POWER_SHORT_NAMES } from '../DiplomacyBoard.js';
import {
  getApiKey,
  setApiKey,
  sendMessage,
  createMemory,
} from './agentClient.js';
import useHasApiKey from '../hooks/useApiKey.js';
import { appendMessage, getThread } from './memory.js';
import { serializeBoardContext } from './serializeContext.js';

export default function ChatPanel({
  board,
  humanPower,
  aiPowers,
  memory: memoryProp,
  setMemory: setMemoryProp,
  unreadByPower,
  onViewThread,
  onScratchpad,
  onDeal,
}) {
  // AI powers are everyone except the human's power.
  const agents = useMemo(
    () => (Array.isArray(aiPowers) ? aiPowers : board.powers.filter((p) => p !== humanPower)),
    [aiPowers, board, humanPower]
  );

  const [selected, setSelected] = useState(agents[0] || null);
  // Controlled by the parent's shared store when provided (so AI-initiated
  // messages show here); otherwise fall back to local state (standalone use).
  const [localMemory, setLocalMemory] = useState(() => createMemory(agents));
  const memory = memoryProp || localMemory;
  const setMemory = setMemoryProp || setLocalMemory;
  const [draft, setDraft] = useState('');
  const [keyDraft, setKeyDraft] = useState('');
  // Reactive: reflects a key set here OR in another tab / GIPF game, live.
  const hasKey = useHasApiKey();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  // Expand the whole panel into a centered modal overlay for more room.
  const [expanded, setExpanded] = useState(false);

  // Esc closes the expanded overlay.
  useEffect(() => {
    if (!expanded) return undefined;
    const onKey = (e) => { if (e.key === 'Escape') setExpanded(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [expanded]);

  const thread = selected ? getThread(memory, selected) : null;

  // Viewing a power's thread clears its unread badge. Re-runs when the open
  // thread gains messages (a live reply or an AI-initiated message).
  const openCount = thread ? thread.messages.length : 0;
  useEffect(() => {
    if (selected && onViewThread) onViewThread(selected);
  }, [selected, openCount, onViewThread]);

  // Keep the conversation scrolled to the latest message: on open, when the
  // selected power changes, when a new message arrives, and on expand/collapse.
  const threadRef = useRef(null);
  useEffect(() => {
    const el = threadRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [selected, openCount, expanded, busy, hasKey]);

  function saveKey() {
    const trimmed = keyDraft.trim();
    if (!trimmed) return;
    setApiKey(trimmed); // broadcasts -> useHasApiKey updates here and elsewhere
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
    // Fold the power's PRIVATE disposition (its true read of everyone, which may
    // differ from what it just told you) into its unified state of mind, so its
    // moves reflect this conversation — talking can win or lose you an ally.
    if (result.scratchpad && onScratchpad) onScratchpad(selected, result.scratchpad);
    // A concrete commitment it just voiced becomes a standing (non-binding)
    // agreement it may honour or stab — the cold math decides from its real state.
    if (result.deal && onDeal) onDeal(selected, result.deal);
    setBusy(false);
  }

  return (
    <>
      {expanded && <div className="dip-chat-backdrop" onClick={() => setExpanded(false)} />}
      <div className={`dip-chat ${expanded ? 'dip-chat--modal' : ''}`}>
      <div className="dip-chat-titlebar">
        <div className="dip-panel-label">Negotiation</div>
        <button
          type="button"
          className="dip-chat-expand"
          onClick={() => setExpanded((v) => !v)}
          aria-label={expanded ? 'Collapse negotiation panel' : 'Expand negotiation panel'}
        >
          {expanded ? '✕ Close' : '⤢ Expand'}
        </button>
      </div>

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
            {agents.map((power) => {
              const unread = (unreadByPower && unreadByPower[power]) || 0;
              return (
                <button
                  key={power}
                  type="button"
                  className={`dip-chat-power${selected === power ? ' is-active' : ''}${unread ? ' has-unread' : ''}`}
                  onClick={() => setSelected(power)}
                >
                  {POWER_SHORT_NAMES[power] || power}
                  {unread > 0 && <span className="dip-chat-power-badge">{unread}</span>}
                </button>
              );
            })}
          </div>

          <div className="dip-chat-thread" ref={threadRef}>
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
    </>
  );
}
