// SplendorGame.jsx - React UI for Splendor.

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import SplendorBoard from './SplendorBoard.js';
import {
  GEMS,
  GOLD,
  ALL_TOKENS,
  GEM_LABELS,
  CARDS_BY_ID,
  NOBLES_BY_ID,
  MAX_RESERVED,
  TAKE_TWO_MIN,
} from './splendorCards.js';
import useAIWorker from './hooks/useAIWorker.js';
import { MCTS } from './engine/mcts.js';
import { applyAIMove } from './engine/aiPlayer.js';
import { askRules, setApiKey as setRulesKey, hasApiKey as hasRulesKey } from './coach/rulesClient.js';
import './splendor.css';

const HUMAN_PLAYER = 1;

// Splendor's small branching factor lets search go deep cheaply (~0.4ms/sim);
// more search is the reliable strength lever.
const DIFFICULTY_CONFIG = {
  strong: { simulations: 1200, maxChildren: 36, rolloutSteps: 20 },
  expert: { simulations: 2500, maxChildren: 44, rolloutSteps: 26 },
  brutal: { simulations: 5000, maxChildren: 50, rolloutSteps: 30 },
};

const DIFFICULTY_LABELS = { strong: 'Strong', expert: 'Expert', brutal: 'Brutal' };

// Gems are rendered as faceted cut stones via CSS (.gem-<color>); JS only
// supplies the color class. Roman numerals give the tiers an heirloom feel.
const gemClass = token => `gem gem-${token}`;
const ROMAN = { 1: 'I', 2: 'II', 3: 'III' };

function makeSeed() {
  return Math.floor(Math.random() * 1e9) + 1;
}

function loadInitialConfig() {
  const difficulty = localStorage.getItem('splendorDifficulty') || 'strong';
  const playerCount = parseInt(localStorage.getItem('splendorPlayerCount') || '4', 10);
  return {
    difficulty: DIFFICULTY_CONFIG[difficulty] ? difficulty : 'strong',
    playerCount: Math.max(2, Math.min(4, playerCount || 4)),
  };
}

// ---- small presentational pieces ------------------------------------------

function TokenChip({ token, count, onClick, selected, disabled, small }) {
  return (
    <button
      type="button"
      className={`spl-token ${gemClass(token)} ${small ? 'spl-token-sm' : ''} ${selected ? 'spl-token-selected' : ''}`}
      onClick={onClick}
      disabled={disabled || !onClick}
      aria-label={`${GEM_LABELS[token]}${count != null ? `: ${count}` : ''}`}
    >
      {token === GOLD ? <span className="spl-token-star">✦</span> : null}
      {count != null && <span className="spl-token-count">{count}</span>}
    </button>
  );
}

function CostPips({ cost }) {
  return (
    <div className="spl-cost">
      {GEMS.filter(g => cost[g]).map(g => (
        <span key={g} className={`spl-cost-pip ${gemClass(g)}`}>{cost[g]}</span>
      ))}
    </div>
  );
}

function DevCard({ card, faceDown, onBuy, onReserve, canBuy, canReserve, style }) {
  if (faceDown) {
    return (
      <div className={`spl-card spl-card-back tier-${card?.tier || 1}`} style={style}>
        <span className="spl-card-crest">❖</span>
      </div>
    );
  }
  return (
    <div className={`spl-card tier-${card.tier}`} style={style}>
      <div className="spl-card-top">
        <span className="spl-card-points">{card.points > 0 ? card.points : ''}</span>
        <span className={`spl-card-bonus ${gemClass(card.bonus)}`} />
      </div>
      <div className="spl-card-bottom">
        <CostPips cost={card.cost} />
        <div className="spl-card-actions">
          {onBuy && (
            <button type="button" className="spl-btn spl-btn-buy" onClick={onBuy} disabled={!canBuy}>Buy</button>
          )}
          {onReserve && (
            <button type="button" className="spl-btn spl-btn-reserve" onClick={onReserve} disabled={!canReserve}>Reserve</button>
          )}
        </div>
      </div>
    </div>
  );
}

function NobleTile({ noble, claimable, onClick }) {
  return (
    <button
      type="button"
      className={`spl-noble ${claimable ? 'spl-noble-claimable' : ''}`}
      onClick={claimable ? onClick : undefined}
      disabled={!claimable}
      title="Noble — 3 prestige"
    >
      <span className="spl-noble-crown">♛</span>
      <span className="spl-noble-points">3</span>
      <span className="spl-noble-req">
        {GEMS.filter(g => noble.requirement[g]).map(g => (
          <span key={g} className={`spl-noble-pip ${gemClass(g)}`}>{noble.requirement[g]}</span>
        ))}
      </span>
    </button>
  );
}

function PlayerPanel({ player, board, isCurrent, isHuman, onBuyReserved, onDiscardToken, discardMode }) {
  const points = board.getVictoryPoints(player.id);
  return (
    <div className={`spl-player ${isCurrent ? 'spl-player-current' : ''}`} style={{ '--accent': player.color }}>
      <div className="spl-player-head">
        <span className="spl-player-name" style={{ color: player.color }}>
          {player.name}{isHuman ? ' (you)' : ''}
        </span>
        <span className="spl-player-points">{points} <small>pts</small></span>
      </div>
      <div className="spl-player-gems">
        {[...GEMS, GOLD].map(g => (
          <div key={g} className="spl-gemstack" title={GEM_LABELS[g]}>
            <span className={`spl-gemstack-bonus ${gemClass(g)}`}>
              <span className="spl-gemstack-val">{g === GOLD ? '✦' : player.bonuses[g]}</span>
            </span>
            <button
              type="button"
              className={`spl-gemstack-token ${discardMode && player.tokens[g] > 0 ? 'spl-discardable' : ''}`}
              onClick={discardMode && player.tokens[g] > 0 ? () => onDiscardToken(g) : undefined}
              disabled={!(discardMode && player.tokens[g] > 0)}
            >
              {player.tokens[g]}
            </button>
          </div>
        ))}
      </div>
      <div className="spl-player-foot">
        <span className="spl-player-meta">{player.cards.length} cards</span>
        {player.nobles.length > 0 && <span className="spl-player-meta">{player.nobles.length} noble{player.nobles.length > 1 ? 's' : ''}</span>}
        {player.reserved.length > 0 && (
          <div className="spl-reserved">
            {player.reserved.map((entry, i) => {
              const card = CARDS_BY_ID[entry.cardId];
              const reveal = isHuman; // opponents' reserves stay hidden to the human
              const canBuy = isHuman && isCurrent && board.phase === 'play' && board.canAffordCard(player.id, entry.cardId);
              return reveal ? (
                <div key={i} className="spl-reserved-card">
                  <DevCard
                    card={card}
                    onBuy={isHuman && isCurrent ? () => onBuyReserved(entry.cardId) : undefined}
                    canBuy={canBuy}
                  />
                </div>
              ) : (
                <div key={i} className="spl-card spl-card-back spl-reserved-back"><span className="spl-card-crest">❖</span></div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

// ---- main component --------------------------------------------------------

export default function SplendorGame() {
  const initial = useMemo(loadInitialConfig, []);
  const [difficulty, setDifficulty] = useState(initial.difficulty);
  const [playerCount, setPlayerCount] = useState(initial.playerCount);
  const [board, setBoard] = useState(() => new SplendorBoard({ seed: makeSeed(), playerCount: initial.playerCount }));
  // Dark velvet is the hero look; default to it unless the player opted out.
  const [darkMode, setDarkMode] = useState(() => localStorage.getItem('splendorDarkMode') !== 'false');
  const [showSettings, setShowSettings] = useState(false);
  const [showModal, setShowModal] = useState(false);
  const [isAiThinking, setIsAiThinking] = useState(false);
  const [pendingColors, setPendingColors] = useState([]);
  const [lastMoveKey, setLastMoveKey] = useState(null);

  // Rules chat
  const [chatOpen, setChatOpen] = useState(false);
  const [chatMessages, setChatMessages] = useState([]);
  const [chatInput, setChatInput] = useState('');
  const [chatBusy, setChatBusy] = useState(false);
  const [keyInput, setKeyInput] = useState('');
  const [hasKey, setHasKey] = useState(hasRulesKey());

  const { computeMove, isSupported: workerSupported } = useAIWorker();
  const aiTimerRef = useRef(null);

  const difficultyConfig = DIFFICULTY_CONFIG[difficulty] || DIFFICULTY_CONFIG.strong;
  const isHumanTurn = board.currentPlayer === HUMAN_PLAYER && board.phase !== 'game-over';

  useEffect(() => {
    document.title = 'Splendor';
  }, []);

  useEffect(() => {
    localStorage.setItem('splendorDarkMode', String(darkMode));
  }, [darkMode]);

  const startNewGame = useCallback((pc = playerCount) => {
    if (aiTimerRef.current) clearTimeout(aiTimerRef.current);
    const next = new SplendorBoard({ seed: makeSeed(), playerCount: pc });
    setBoard(next);
    setPendingColors([]);
    setLastMoveKey(null);
    setShowModal(false);
    setIsAiThinking(false);
  }, [playerCount]);

  const play = useCallback((move) => {
    if (!move) return false;
    const ok = board.applyMove(move);
    if (!ok) return false;
    setPendingColors([]);
    setBoard(board.clone());
    if (board.phase === 'game-over') setShowModal(true);
    return true;
  }, [board]);

  // ---- AI turn loop --------------------------------------------------------

  const computeAIMove = useCallback(() => {
    if (isAiThinking || board.phase === 'game-over') return;
    setIsAiThinking(true);

    const onSuccess = (move) => {
      setIsAiThinking(false);
      if (!move) return;
      applyAIMove(board, move);
      setLastMoveKey(`${board.currentPlayer}:${Date.now()}`);
      setBoard(board.clone());
      if (board.phase === 'game-over') setShowModal(true);
    };

    const onError = (error) => {
      console.warn('Splendor AI error:', error);
      setIsAiThinking(false);
      const fallback = new MCTS({ maxChildren: difficultyConfig.maxChildren, rolloutSteps: difficultyConfig.rolloutSteps });
      fallback.getBestMove(board, Math.max(60, Math.floor(difficultyConfig.simulations / 4)))
        .then((move) => {
          if (!move) return;
          applyAIMove(board, move);
          setBoard(board.clone());
          if (board.phase === 'game-over') setShowModal(true);
        })
        .catch((err) => console.warn('Splendor fallback AI error:', err));
    };

    if (workerSupported) {
      computeMove(board.serializeState(), difficultyConfig.simulations, onSuccess, onError, difficultyConfig.maxChildren, difficultyConfig.rolloutSteps);
    } else {
      const mcts = new MCTS({ maxChildren: difficultyConfig.maxChildren, rolloutSteps: difficultyConfig.rolloutSteps });
      mcts.getBestMove(board, difficultyConfig.simulations).then(onSuccess).catch(onError);
    }
  }, [board, computeMove, difficultyConfig, isAiThinking, workerSupported]);

  useEffect(() => {
    if (showModal || isHumanTurn || isAiThinking || board.phase === 'game-over') return;
    aiTimerRef.current = setTimeout(() => computeAIMove(), 300);
    return () => { if (aiTimerRef.current) clearTimeout(aiTimerRef.current); };
  }, [board.currentPlayer, board.phase, computeAIMove, isAiThinking, isHumanTurn, showModal]);

  // ---- human interactions --------------------------------------------------

  const availableColors = useMemo(() => GEMS.filter(g => board.bank[g] > 0), [board]);
  const takeCountNeeded = Math.min(3, availableColors.length);
  const canConfirmTake = isHumanTurn && board.phase === 'play' && pendingColors.length === takeCountNeeded && takeCountNeeded > 0;

  const toggleColor = useCallback((gem) => {
    if (!isHumanTurn || board.phase !== 'play') return;
    if (board.bank[gem] <= 0) return;
    setPendingColors(prev => {
      if (prev.includes(gem)) return prev.filter(g => g !== gem);
      if (prev.length >= 3) return prev;
      return [...prev, gem];
    });
  }, [board, isHumanTurn]);

  const confirmTake = useCallback(() => {
    if (!canConfirmTake) return;
    play({ type: 'take-three', colors: pendingColors });
  }, [canConfirmTake, pendingColors, play]);

  const takeTwo = useCallback((gem) => {
    play({ type: 'take-two', color: gem });
  }, [play]);

  const buyVisible = useCallback((cardId) => play({ type: 'buy', cardId }), [play]);
  const buyReserved = useCallback((cardId) => play({ type: 'buy', cardId, fromReserve: true }), [play]);
  const reserveVisible = useCallback((cardId, tier) => play({ type: 'reserve', cardId, tier }), [play]);
  const reserveDeck = useCallback((tier) => play({ type: 'reserve', tier, fromDeck: true }), [play]);
  const discardToken = useCallback((token) => play({ type: 'discard-token', token }), [play]);
  const chooseNoble = useCallback((nobleId) => play({ type: 'choose-noble', nobleId }), [play]);

  const humanDiscardMode = isHumanTurn && board.phase === 'discard';
  const humanNobleMode = isHumanTurn && board.phase === 'noble-choice';
  const humanReservedFull = board.players[HUMAN_PLAYER].reserved.length >= MAX_RESERVED;

  // ---- rules chat ----------------------------------------------------------

  const chatContext = useMemo(() => ({
    game: 'Splendor',
    edition: 'Base game (2-4 players)',
    playerCount: board.playerCount,
    victoryTarget: board.victoryTarget,
    note: 'This app implements base-game Splendor only (no Cities of Splendor expansions or Splendor Duel).',
  }), [board.playerCount, board.victoryTarget]);

  const sendChat = useCallback(async () => {
    const text = chatInput.trim();
    if (!text || chatBusy) return;
    const next = [...chatMessages, { role: 'user', content: text }];
    setChatMessages(next);
    setChatInput('');
    setChatBusy(true);
    const res = await askRules({ context: chatContext, messages: next });
    setChatBusy(false);
    setChatMessages([...next, { role: 'assistant', content: res.answer || res.message || 'No answer.' }]);
  }, [chatInput, chatBusy, chatMessages, chatContext]);

  const saveKey = useCallback(() => {
    setRulesKey(keyInput.trim());
    setHasKey(hasRulesKey());
    setKeyInput('');
  }, [keyInput]);

  // ---- render --------------------------------------------------------------

  const human = board.players[HUMAN_PLAYER];
  const opponents = board.getPlayerIds().filter(id => id !== HUMAN_PLAYER).map(id => board.players[id]);
  const qualifyingForHuman = humanNobleMode ? new Set(board.pendingNobles) : new Set();

  return (
    <div className={`game-splendor ${darkMode ? 'dark' : ''}`}>
      <div className="spl-app">
        <header className="spl-header">
          <div className="spl-header-left">
            <Link to="/" className="spl-back">← Games</Link>
            <div className="spl-titlewrap">
              <h1 className="spl-title">Splendor</h1>
              <span className="spl-tagline">Merchants of the Renaissance · race to 15 prestige</span>
            </div>
          </div>
          <div className="spl-header-right">
            <button type="button" className="spl-btn" onClick={() => setChatOpen(o => !o)}>Rules Help</button>
            <button type="button" className="spl-btn" onClick={() => setShowSettings(s => !s)}>Settings</button>
            <button type="button" className="spl-btn" onClick={() => setDarkMode(d => !d)}>{darkMode ? '☀' : '☾'}</button>
            <button type="button" className="spl-btn spl-btn-primary" onClick={() => startNewGame()}>New Game</button>
          </div>
        </header>

        {showSettings && (
          <div className="spl-settings">
            <div className="spl-setting">
              <label>Players</label>
              <div className="spl-seg">
                {[2, 3, 4].map(pc => (
                  <button
                    key={pc}
                    type="button"
                    className={`spl-seg-btn ${playerCount === pc ? 'active' : ''}`}
                    onClick={() => { setPlayerCount(pc); localStorage.setItem('splendorPlayerCount', String(pc)); startNewGame(pc); }}
                  >{pc}</button>
                ))}
              </div>
            </div>
            <div className="spl-setting">
              <label>Difficulty</label>
              <div className="spl-seg">
                {Object.keys(DIFFICULTY_CONFIG).map(level => (
                  <button
                    key={level}
                    type="button"
                    className={`spl-seg-btn ${difficulty === level ? 'active' : ''}`}
                    onClick={() => { setDifficulty(level); localStorage.setItem('splendorDifficulty', level); }}
                  >{DIFFICULTY_LABELS[level]}</button>
                ))}
              </div>
            </div>
            <div className="spl-setting spl-setting-key">
              <label>Anthropic API key (for Rules Help)</label>
              {hasKey ? (
                <div className="spl-key-row">
                  <span className="spl-key-ok">Key saved ✓</span>
                  <button type="button" className="spl-btn" onClick={() => { setRulesKey(''); setHasKey(false); }}>Remove</button>
                </div>
              ) : (
                <div className="spl-key-row">
                  <input type="password" value={keyInput} onChange={e => setKeyInput(e.target.value)} placeholder="sk-ant-..." />
                  <button type="button" className="spl-btn" onClick={saveKey}>Save</button>
                </div>
              )}
            </div>
          </div>
        )}

        <div className="spl-status">
          <span className="spl-status-text">{board.lastAction}</span>
          {isAiThinking && <span className="spl-thinking">thinking…</span>}
        </div>

        <div className="spl-main">
          <div className="spl-board">
            <div className="spl-section-label">Nobles</div>
            <div className="spl-nobles">
              {board.nobles.map(nobleId => (
                <NobleTile
                  key={nobleId}
                  noble={NOBLES_BY_ID[nobleId]}
                  claimable={qualifyingForHuman.has(nobleId)}
                  onClick={() => chooseNoble(nobleId)}
                />
              ))}
            </div>

            {[3, 2, 1].map(tier => (
              <div key={tier} className={`spl-row tier-row-${tier}`}>
                <div className="spl-deck">
                  <div className={`spl-card spl-card-back tier-${tier}`}>
                    <span className="spl-deck-tier">{ROMAN[tier]}</span>
                    <span className="spl-deck-count">{board.decks[tier].length}</span>
                  </div>
                  <button
                    type="button"
                    className="spl-btn spl-btn-reserve spl-deck-reserve"
                    onClick={() => reserveDeck(tier)}
                    disabled={!isHumanTurn || board.phase !== 'play' || humanReservedFull || board.decks[tier].length === 0}
                  >Reserve</button>
                </div>
                <div className="spl-cards">
                  {board.visible[tier].map((cardId, i) => cardId ? (
                    <DevCard
                      key={cardId}
                      card={CARDS_BY_ID[cardId]}
                      style={{ animationDelay: `${i * 60}ms` }}
                      onBuy={() => buyVisible(cardId)}
                      onReserve={() => reserveVisible(cardId, tier)}
                      canBuy={isHumanTurn && board.phase === 'play' && board.canAffordCard(HUMAN_PLAYER, cardId)}
                      canReserve={isHumanTurn && board.phase === 'play' && !humanReservedFull}
                    />
                  ) : <div key={`empty-${tier}-${i}`} className="spl-card spl-card-empty" />)}
                </div>
              </div>
            ))}

            <div className="spl-section-label">Gem Bank</div>
            <div className="spl-bank">
              {ALL_TOKENS.map(token => {
                const isGem = token !== GOLD;
                const selectable = isHumanTurn && board.phase === 'play' && isGem && board.bank[token] > 0;
                return (
                  <div key={token} className="spl-bank-slot">
                    <TokenChip
                      token={token}
                      count={board.bank[token]}
                      onClick={selectable ? () => toggleColor(token) : undefined}
                      selected={pendingColors.includes(token)}
                      disabled={!selectable}
                    />
                    {isGem && board.bank[token] >= TAKE_TWO_MIN && isHumanTurn && board.phase === 'play' && (
                      <button type="button" className="spl-take2" onClick={() => takeTwo(token)}>×2</button>
                    )}
                  </div>
                );
              })}
            </div>

            {isHumanTurn && board.phase === 'play' && pendingColors.length > 0 && (
              <div className="spl-take-bar">
                <span>Take: {pendingColors.map(c => GEM_LABELS[c]).join(', ')}</span>
                <button type="button" className="spl-btn spl-btn-primary" onClick={confirmTake} disabled={!canConfirmTake}>
                  Confirm
                </button>
                <button type="button" className="spl-btn" onClick={() => setPendingColors([])}>Clear</button>
              </div>
            )}
            {humanDiscardMode && (
              <div className="spl-take-bar spl-warn">
                Over the 10-token limit — click your tokens to return {board.getTokenTotal(HUMAN_PLAYER) - 10} more.
              </div>
            )}
            {humanNobleMode && (
              <div className="spl-take-bar">Choose a noble to receive (click a highlighted tile above).</div>
            )}
          </div>

          <aside className="spl-side">
            <div className="spl-players">
              {[human, ...opponents].map(player => (
                <PlayerPanel
                  key={player.id}
                  player={player}
                  board={board}
                  isCurrent={board.currentPlayer === player.id}
                  isHuman={player.id === HUMAN_PLAYER}
                  onBuyReserved={buyReserved}
                  onDiscardToken={discardToken}
                  discardMode={player.id === HUMAN_PLAYER && humanDiscardMode}
                />
              ))}
            </div>
            <div className="spl-log">
              <h3>Moves</h3>
              <ul>
                {[...board.log].slice(-12).reverse().map((entry, i) => <li key={i}>{entry}</li>)}
              </ul>
            </div>
          </aside>
        </div>

        {chatOpen && (
          <div className="spl-chat">
            <div className="spl-chat-head">
              <span>Rules Help</span>
              <button type="button" className="spl-btn" onClick={() => setChatOpen(false)}>×</button>
            </div>
            <div className="spl-chat-body">
              {!hasKey && <p className="spl-chat-hint">Add your Anthropic API key in Settings to ask about the rules.</p>}
              {chatMessages.map((m, i) => (
                <div key={i} className={`spl-chat-msg ${m.role}`}>{m.content}</div>
              ))}
              {chatBusy && <div className="spl-chat-msg assistant">…</div>}
            </div>
            <div className="spl-chat-input">
              <input
                value={chatInput}
                onChange={e => setChatInput(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') sendChat(); }}
                placeholder="Ask about Splendor rules…"
                disabled={!hasKey || chatBusy}
              />
              <button type="button" className="spl-btn spl-btn-primary" onClick={sendChat} disabled={!hasKey || chatBusy}>Send</button>
            </div>
          </div>
        )}

        {showModal && board.phase === 'game-over' && (
          <div className="spl-modal-overlay" onClick={() => setShowModal(false)}>
            <div className="spl-modal" onClick={e => e.stopPropagation()}>
              <h2>{board.winner === HUMAN_PLAYER ? 'You win!' : `${board.players[board.winner].name} wins`}</h2>
              <p>{board.winningPoints} prestige</p>
              <ul className="spl-modal-scores">
                {board.getPlayerIds().map(id => (
                  <li key={id} style={{ color: board.players[id].color }}>
                    {board.players[id].name}: {board.getVictoryPoints(id)} pts · {board.players[id].cards.length} cards
                  </li>
                ))}
              </ul>
              <button type="button" className="spl-btn spl-btn-primary" onClick={() => startNewGame()}>New Game</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
