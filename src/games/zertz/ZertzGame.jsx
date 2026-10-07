import MatchBoundary, { useSavedMatch } from '../../MatchBoundary.jsx';
import { encodeBoard, decodeMatch } from './matchSnapshot.js';
// ZertzGame.jsx - React UI + SVG rendering for Zertz
import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Link } from 'react-router-dom';
import ZertzBoard from './ZertzBoard.js';
import useAIWorker from './hooks/useAIWorker.js';
import { MCTS } from './engine/mcts.js';
import { applyAIMove } from './engine/aiPlayer.js';
import './zertz.css';

const DIFFICULTY_CONFIG = {
  easy: { simulations: 100, evaluationMode: 'heuristic' },
  advanced: { simulations: 200, evaluationMode: 'heuristic' },
  expert: { simulations: 300, evaluationMode: 'nn', modelPath: '/models/zertz-value-v1.onnx' },
};

// Toggle component
const Toggle = ({ label, checked, onChange }) => (
  <div className="flex items-center justify-between">
    <span style={{ color: 'var(--color-text-primary)' }}>{label}</span>
    <button
      type="button"
      onClick={onChange}
      role="switch"
      aria-label={label}
      aria-checked={checked}
      className="w-10 h-6 rounded-full transition-colors relative"
      style={{ backgroundColor: checked ? 'var(--color-toggle-active)' : 'var(--color-toggle-inactive)' }}
    >
      <div
        className={`w-4 h-4 rounded-full absolute top-1 transition-transform ${checked ? 'right-1' : 'left-1'}`}
        style={{ backgroundColor: 'var(--color-toggle-knob)' }}
      />
    </button>
  </div>
);

const FOCUSABLE = 'button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

// Accessible modal: dialog semantics, initial focus, Tab containment, Escape,
// inert background, and focus restoration to the opener.
const Dialog = ({ label, onClose, overlayClass, panelClass, panelStyle, children }) => {
  const overlayRef = useRef(null);
  const panelRef = useRef(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  useEffect(() => {
    const overlay = overlayRef.current;
    const opener = document.activeElement;
    const siblings = [...overlay.parentNode.children].filter(el => el !== overlay);
    const saved = siblings.map(el => [el, el.hasAttribute('inert'), el.getAttribute('aria-hidden')]);
    siblings.forEach(el => { el.setAttribute('inert', ''); el.setAttribute('aria-hidden', 'true'); });
    const panel = panelRef.current;
    const first = panel.querySelector(FOCUSABLE);
    (first || panel).focus();
    return () => {
      saved.forEach(([el, hadInert, hidden]) => {
        if (!hadInert) el.removeAttribute('inert');
        if (hidden === null) el.removeAttribute('aria-hidden'); else el.setAttribute('aria-hidden', hidden);
      });
      if (opener && opener.isConnected && typeof opener.focus === 'function') opener.focus();
    };
  }, []);

  const onKeyDown = (e) => {
    if (e.key === 'Escape') {
      e.stopPropagation();
      closeRef.current();
      return;
    }
    if (e.key !== 'Tab') return;
    const items = [...panelRef.current.querySelectorAll(FOCUSABLE)];
    if (items.length === 0) { e.preventDefault(); return; }
    const firstEl = items[0];
    const lastEl = items[items.length - 1];
    if (e.shiftKey && (document.activeElement === firstEl || document.activeElement === panelRef.current)) {
      e.preventDefault(); lastEl.focus();
    } else if (!e.shiftKey && document.activeElement === lastEl) {
      e.preventDefault(); firstEl.focus();
    }
  };

  return (
    <div
      ref={overlayRef}
      className={overlayClass}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
      onKeyDown={onKeyDown}
    >
      <div ref={panelRef} role="dialog" aria-modal="true" aria-label={label} tabIndex={-1} className={panelClass} style={panelStyle}>
        {children}
      </div>
    </div>
  );
};

const closeButtonClass = 'text-2xl font-bold leading-none min-w-[44px] min-h-[44px] flex items-center justify-center';

// --- SVG Helpers ---

const HEX_SIZE = 34;

const axialToScreen = (q, r) => {
  const x = HEX_SIZE * (Math.sqrt(3) * q + (Math.sqrt(3) / 2) * r);
  const y = HEX_SIZE * (1.5 * r);
  return [x, y];
};

const hexPoints = (cx, cy, size) => {
  const points = [];
  for (let i = 0; i < 6; i++) {
    const angle = (Math.PI / 180) * (60 * i - 30);
    points.push(`${cx + size * Math.cos(angle)},${cy + size * Math.sin(angle)}`);
  }
  return points.join(' ');
};

const MARBLE_LABEL = { white: 'White', grey: 'Grey', black: 'Black' };

const ZertzGame = () => {
  const savedMatch = useSavedMatch();
  const resumed = savedMatch?.restored;
  const savedUI = resumed?.ui || {};
  const [board, commitBoard] = useState(() => resumed?.board || new ZertzBoard());
  const [darkMode, setDarkMode] = useState(() => {
    const saved = localStorage.getItem('zertzDarkMode');
    return saved ? JSON.parse(saved) : false;
  });
  const [showPossibleMoves, setShowPossibleMoves] = useState(() => {
    const saved = localStorage.getItem('zertzShowMoves');
    return saved ? JSON.parse(saved) : true;
  });
  const [twoPlayerMode, setTwoPlayerMode] = useState(() => {
    if (savedUI.twoPlayerMode !== undefined) return savedUI.twoPlayerMode;
    const saved = localStorage.getItem('zertzTwoPlayer');
    return saved ? JSON.parse(saved) : false;
  });
  const [humanPlayer, setHumanPlayer] = useState(() => savedUI.humanPlayer || (Math.random() < 0.5 ? 1 : 2));
  const [difficulty, setDifficulty] = useState(() => {
    if (savedUI.difficulty) return savedUI.difficulty;
    const saved = localStorage.getItem('zertzDifficulty');
    return saved || 'advanced';
  });
  const [isAiThinking, setIsAiThinking] = useState(false);
  const [aiSuggestion, setAiSuggestion] = useState(null);
  const [showModal, setShowModal] = useState(() => savedUI.showModal ?? true);
  const [showSettings, setShowSettings] = useState(false);
  const [showRules, setShowRules] = useState(false);
  const [lastMoveKeys, setLastMoveKeys] = useState(() => savedUI.lastMoveKeys || []);

  useEffect(() => { savedMatch?.persist(encodeBoard(board), { humanPlayer, twoPlayerMode, showModal, difficulty, lastMoveKeys }); }, [board, humanPlayer, twoPlayerMode, showModal, difficulty, lastMoveKeys, savedMatch]);

  const { computeMove, cancelPending, isSupported: workerSupported } = useAIWorker();
  const stateVersion = useRef(0);
  const [aiFallback, setAiFallback] = useState(false);
  const invalidateAI = useCallback(() => {
    stateVersion.current += 1;
    cancelPending();
    setIsAiThinking(false);
    setAiSuggestion(null);
  }, [cancelPending]);
  const setBoard = useCallback((nextBoard) => {
    invalidateAI();
    commitBoard(nextBoard);
  }, [invalidateAI]);
  useEffect(() => () => { stateVersion.current += 1; }, []);

  const aiTimerRef = useRef(null);

  useEffect(() => {
    localStorage.setItem('zertzDarkMode', JSON.stringify(darkMode));
    savedMatch?.setTheme(darkMode);
  }, [darkMode, savedMatch]);
  useEffect(() => {
    localStorage.setItem('zertzShowMoves', JSON.stringify(showPossibleMoves));
  }, [showPossibleMoves]);
  useEffect(() => {
    localStorage.setItem('zertzTwoPlayer', JSON.stringify(twoPlayerMode));
  }, [twoPlayerMode]);
  useEffect(() => {
    localStorage.setItem('zertzDifficulty', difficulty);
  }, [difficulty]);

  // Undo/redo against the AI moves to the nearest human decision point and
  // holds AI autoplay there until the human acts, so history is not replayed.
  const [aiPaused, setAiPaused] = useState(false);
  const navigateHistory = useCallback((direction) => {
    const can = () => (direction < 0 ? board.canUndo() : board.canRedo());
    if (!can()) return;
    do {
      if (direction < 0) board.undo(); else board.redo();
    } while (!twoPlayerMode && board.currentPlayer !== humanPlayer && can());
    setBoard(board.clone());
    setAiPaused(!twoPlayerMode && board.currentPlayer !== humanPlayer && board.canRedo());
    setLastMoveKeys([]);
  }, [board, twoPlayerMode, humanPlayer, setBoard]);

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'z' && !e.shiftKey) {
        e.preventDefault();
        navigateHistory(-1);
      }
      if (((e.ctrlKey || e.metaKey) && e.key === 'y') ||
          ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === 'z')) {
        e.preventDefault();
        navigateHistory(1);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [navigateHistory]);

  // --- AI Logic ---

  const getAISuggestion = useCallback((autoPlay = false) => {
    if (isAiThinking) return;
    if (board.gamePhase === 'game-over') return;

    const config = DIFFICULTY_CONFIG[difficulty] || DIFFICULTY_CONFIG.advanced;
    const version = ++stateVersion.current;
    if (autoPlay) setAiPaused(false);
    setIsAiThinking(true);
    setAiSuggestion(null);

    const onSuccess = (move, stats) => {
      if (!savedMatch?.isCurrent() || version !== stateVersion.current) return;
      setAiFallback(config.evaluationMode === 'nn' && stats?.evaluationMode !== 'nn');
      setIsAiThinking(false);
      if (!move) return;

      if (autoPlay) {
        // Track affected positions for last-move indicator
        const newKeys = [];
        if (move.type === 'place-marble') newKeys.push(`${move.q},${move.r}`);
        else if (move.type === 'remove-ring') newKeys.push(`${move.q},${move.r}`);
        else if (move.type === 'capture') { newKeys.push(move.fromKey); newKeys.push(move.toKey); }

        applyAIMove(board, move);
        setBoard(board.clone());
        setLastMoveKeys(prev => [...prev, ...newKeys]);
        if (board.gamePhase === 'game-over') setShowModal(true);
      } else {
        setAiSuggestion(move);
      }
    };

    const onError = (err) => {
      if (!savedMatch?.isCurrent() || version !== stateVersion.current) return;
      console.warn('AI error:', err);
      setIsAiThinking(false);
    };

    if (workerSupported) {
      const boardState = board.serializeState();
      computeMove(
        boardState,
        config.simulations,
        onSuccess,
        onError,
        config.evaluationMode,
        config.modelPath || null
      );
    } else {
      // Fallback: run MCTS on main thread (blocking but functional)
      const mcts = new MCTS({ evaluationMode: 'heuristic' });
      mcts.getBestMove(board.clone(), config.simulations).then(onSuccess).catch(onError);
    }
  }, [board, difficulty, isAiThinking, workerSupported, computeMove]);

  // Auto-play: when it's the AI's turn, trigger after a short delay
  useEffect(() => {
    if (twoPlayerMode) return;
    if (board.gamePhase === 'game-over') return;
    if (isAiThinking) return;
    if (showModal) return;
    if (aiPaused) return;
    if (board.currentPlayer === humanPlayer) return;

    aiTimerRef.current = setTimeout(() => {
      getAISuggestion(true);
    }, 500);

    return () => {
      if (aiTimerRef.current) clearTimeout(aiTimerRef.current);
    };
  }, [board.gamePhase, board.currentPlayer, twoPlayerMode, humanPlayer, isAiThinking, showModal, aiPaused, getAISuggestion]);

  // --- Derived state ---
  const {
    rings, marbles, pool, captures, currentPlayer, gamePhase,
    winner, winConditionMet, selectedColor, jumpingMarble
  } = board;

  const isHumanTurn = twoPlayerMode || currentPlayer === humanPlayer;

  const validPlacements = gamePhase === 'place-marble' && selectedColor
    ? board.getValidPlacements() : [];
  const freeRings = gamePhase === 'remove-ring' ? board.getFreeRings() : [];
  const availableCaptures = gamePhase === 'capture' ? board.getAvailableCaptures() : [];
  const jumpTargets = (gamePhase === 'capture' && jumpingMarble)
    ? board.getJumpTargets(jumpingMarble).map(t => t.target) : [];

  const positions = ZertzBoard.generateValidPositions();

  // AI suggestion target key for visual highlight
  const suggestionKey = aiSuggestion ? (
    aiSuggestion.type === 'place-marble' ? `${aiSuggestion.q},${aiSuggestion.r}` :
    aiSuggestion.type === 'remove-ring' ? `${aiSuggestion.q},${aiSuggestion.r}` :
    aiSuggestion.type === 'capture' ? aiSuggestion.toKey : null
  ) : null;

  const suggestionFromKey = aiSuggestion && aiSuggestion.type === 'capture' ? aiSuggestion.fromKey : null;
  const suggestionColor = aiSuggestion && aiSuggestion.type === 'place-marble' ? aiSuggestion.color : null;
  const describeSquare = (key) => {
    const [q, r] = key.split(',');
    return `(${q},${r})`;
  };
  const suggestionText = (() => {
    if (!aiSuggestion) return '';
    if (aiSuggestion.type === 'place-marble') return `AI suggests: place ${MARBLE_LABEL[aiSuggestion.color]} on ${describeSquare(`${aiSuggestion.q},${aiSuggestion.r}`)}`;
    if (aiSuggestion.type === 'remove-ring') return `AI suggests: remove the ring at ${describeSquare(`${aiSuggestion.q},${aiSuggestion.r}`)}`;
    if (aiSuggestion.type === 'capture') return `AI suggests: jump the marble at ${describeSquare(aiSuggestion.fromKey)} to ${describeSquare(aiSuggestion.toKey)}`;
    return '';
  })();

  const tileLabel = (key, marble, isFreeRing, isPlacement, isJumpTarget, isJumpableMarble) => {
    const parts = [`Ring ${describeSquare(key)}`, marble ? `${MARBLE_LABEL[marble]} marble` : 'empty'];
    if (isFreeRing) parts.push('can be removed');
    if (isPlacement && !marble) parts.push('can be placed on');
    if (isJumpTarget && !marble) parts.push('jump destination');
    if (isJumpableMarble) parts.push('can jump');
    if (jumpingMarble === key) parts.push('selected');
    return parts.join(', ');
  };

  // --- Handlers ---

  const handleHexClick = useCallback((q, r) => {
    if (gamePhase === 'game-over') return;
    if (!isHumanTurn) return; // Block clicks during AI turn
    setAiPaused(false);
    setLastMoveKeys([]);
    board.handleClick(q, r);
    setBoard(board.clone());
    // Keep a capture hint while its source marble is being selected.
    if (aiSuggestion && aiSuggestion.type === 'capture' && board.jumpingMarble === aiSuggestion.fromKey && !board.captureStarted) {
      setAiSuggestion(aiSuggestion);
    }
    if (board.gamePhase === 'game-over') setShowModal(true);
  }, [board, gamePhase, isHumanTurn, aiSuggestion]);

  const handleColorSelect = useCallback((color) => {
    if (!isHumanTurn) return;
    setAiPaused(false);
    setLastMoveKeys([]);
    board.selectMarbleColor(color);
    setBoard(board.clone());
    // Keep a placement hint when the recommended color is chosen.
    if (aiSuggestion && aiSuggestion.type === 'place-marble' && aiSuggestion.color === color) {
      setAiSuggestion(aiSuggestion);
    }
  }, [board, isHumanTurn, aiSuggestion]);

  const handleUndo = () => navigateHistory(-1);
  const handleRedo = () => navigateHistory(1);

  const startNewGame = () => {
    savedMatch?.startNew();
    board.startNewGame();
    setBoard(board.clone());
    setShowModal(false);
    setAiSuggestion(null);
    setIsAiThinking(false);
    setAiPaused(false);
    setLastMoveKeys([]);
    if (aiTimerRef.current) clearTimeout(aiTimerRef.current);
    if (!twoPlayerMode) {
      setHumanPlayer(Math.random() < 0.5 ? 1 : 2);
    }
  };

  // --- Rendering helpers ---

  const getPhaseText = () => {
    if (isAiThinking) return 'Thinking...';
    switch (gamePhase) {
      case 'place-marble':
        if (!selectedColor) return 'Select a marble';
        return 'Place on the board';
      case 'remove-ring':
        return 'Remove a ring';
      case 'capture':
        if (jumpingMarble) return 'Continue jumping';
        return 'Select a marble to jump';
      case 'game-over':
        return winner ? `Player ${winner} wins!` : 'Game Over';
      default:
        return '';
    }
  };

  const getPlayerLabel = (player) => {
    if (twoPlayerMode) return `Player ${player}`;
    return player === humanPlayer ? 'You' : 'AI';
  };

  const getWinConditionLabel = () => {
    if (!winConditionMet) return '';
    const { white, grey, black } = winConditionMet;
    if (white === 3 && grey === 3 && black === 3) return '3 of each color';
    if (white === 4) return '4 white marbles';
    if (grey === 5) return '5 grey marbles';
    if (black === 6) return '6 black marbles';
    return '';
  };

  // SVG dimensions
  const SVG_SIZE = 600;
  const CENTER = SVG_SIZE / 2;

  // Settings
  const renderSettingsToggles = () => (
    <div className="space-y-4">
      {/* AI Difficulty */}
      <div>
        <span className="text-[10px] font-semibold uppercase tracking-widest block mb-2" style={{ color: 'var(--color-text-muted)' }}>
          AI Difficulty
        </span>
        <div className="flex gap-1" role="group" aria-label="AI difficulty">
          {['easy', 'advanced', 'expert'].map(d => (
            <button
              key={d}
              type="button"
              aria-pressed={difficulty === d}
              onClick={() => { invalidateAI(); setAiFallback(false); setDifficulty(d); }}
              className="flex-1 py-1.5 px-2 rounded text-xs font-semibold capitalize transition-all"
              style={{
                backgroundColor: difficulty === d ? 'var(--color-btn-primary-bg)' : 'transparent',
                color: difficulty === d ? 'var(--color-btn-primary-text)' : 'var(--color-text-muted)',
                border: difficulty === d ? 'none' : '1px solid var(--color-border-panel)',
              }}
            >
              {d}
            </button>
          ))}
        </div>
      </div>
      <Toggle label="Two Players" checked={twoPlayerMode} onChange={() => { invalidateAI(); setTwoPlayerMode(!twoPlayerMode); }} />
      <Toggle label="Dark Mode" checked={darkMode} onChange={() => setDarkMode(!darkMode)} />
      <Toggle label="Show Valid Moves" checked={showPossibleMoves} onChange={() => setShowPossibleMoves(!showPossibleMoves)} />
      <button
        onClick={() => setShowRules(true)}
        className="w-full py-2 px-4 rounded-lg text-sm font-semibold transition-colors border-2"
        style={{
          borderColor: 'var(--color-border-button)',
          color: 'var(--color-text-secondary)',
          backgroundColor: 'transparent',
        }}
      >
        Rules
      </button>
    </div>
  );

  // ---- Capture panel for a player ----
  const renderCaptureDisplay = (player) => {
    const caps = captures[player];
    const isActive = currentPlayer === player && gamePhase !== 'game-over';
    const conditions = ZertzBoard.WIN_CONDITIONS;

    return (
      <div
        className="rounded-lg p-3 md:p-4 transition-all"
        style={{
          backgroundColor: 'var(--color-bg-panel)',
          border: isActive ? '2px solid var(--color-player-active)' : '1px solid var(--color-border-panel)',
        }}
      >
        {/* Player label */}
        <div className="flex items-center gap-2 mb-3">
          <div
            className="w-2 h-2 rounded-full transition-colors"
            style={{
              backgroundColor: isActive ? 'var(--color-player-active)' : 'var(--color-border-panel)',
            }}
          />
          <span
            className="text-xs font-semibold uppercase tracking-widest"
            style={{ color: isActive ? 'var(--color-text-primary)' : 'var(--color-text-muted)' }}
          >
            {getPlayerLabel(player)}
          </span>
        </div>

        {/* Captured marbles */}
        <div className="flex gap-3 mb-4">
          {['white', 'grey', 'black'].map(color => (
            <div key={color} className="flex items-center gap-1.5">
              <svg width="18" height="18" viewBox="0 0 18 18">
                <circle cx="9" cy="9" r="7.5"
                  fill={`var(--color-marble-${color})`}
                  stroke={`var(--color-marble-${color}-stroke)`}
                  strokeWidth="1"
                />
                {color === 'white' && (
                  <circle cx="6.5" cy="6.5" r="2" fill="white" opacity="0.6" />
                )}
              </svg>
              <span
                className="text-sm font-semibold tabular-nums"
                style={{ color: 'var(--color-text-primary)', fontFamily: 'Outfit, sans-serif' }}
              >
                {caps[color]}
              </span>
            </div>
          ))}
        </div>

        {/* Win condition progress */}
        <div className="space-y-1.5">
          {conditions.map((cond, i) => {
            const label = cond.white === 3 ? 'Mix' :
              cond.white === 4 ? '4W' :
              cond.grey === 5 ? '5G' : '6B';

            const colors = ['white', 'grey', 'black'].filter(c => cond[c] > 0);
            const progress = colors.flatMap(c =>
              Array.from({ length: cond[c] }).map((_, j) => ({
                color: c,
                filled: j < caps[c],
              }))
            );

            const totalNeeded = colors.reduce((sum, c) => sum + cond[c], 0);
            const totalHave = colors.reduce((sum, c) => sum + Math.min(caps[c], cond[c]), 0);

            return (
              <div key={i} className="flex items-center gap-2">
                <span
                  className="text-[10px] w-6 font-semibold tracking-tight"
                  style={{ color: totalHave === totalNeeded ? 'var(--color-jump-target-stroke)' : 'var(--color-text-muted)' }}
                >
                  {label}
                </span>
                <div className="flex gap-[3px]">
                  {progress.map(({ color, filled }, j) => (
                    <div
                      key={j}
                      className="w-[10px] h-[10px] rounded-full transition-colors"
                      style={{
                        backgroundColor: filled ? `var(--color-marble-${color})` : 'var(--color-capture-progress-empty)',
                        border: filled ? `1px solid var(--color-marble-${color}-stroke)` : '1px solid var(--color-capture-progress-border)',
                      }}
                    />
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    );
  };

  // ---- Marble pool tray ----
  const renderMarblePool = () => {
    const availableColors = board.getAvailableColors();
    const isPlacing = gamePhase === 'place-marble';
    const fromCaptures = board._mustPlaceFromCaptures();

    return (
      <div
        className="rounded-lg p-3"
        style={{ backgroundColor: 'var(--color-bg-tray)' }}
      >
        <div className="flex items-center justify-between mb-2">
          <span
            className="text-[10px] font-semibold uppercase tracking-widest"
            style={{ color: 'var(--color-text-muted)' }}
          >
            {fromCaptures ? 'Place from captures' : 'Marble pool'}
          </span>
          <span
            className="text-[10px] tabular-nums"
            style={{ color: 'var(--color-text-muted)', fontFamily: 'Outfit, sans-serif' }}
          >
            {fromCaptures ? 'Pool empty · use your captures' : `${board.getPoolTotal()} remaining`}
          </span>
        </div>
        <div className="flex gap-2 justify-center">
          {['white', 'grey', 'black'].map(color => {
            const count = fromCaptures ? captures[currentPlayer][color] : pool[color];
            const isAvailable = isPlacing && availableColors.includes(color) && isHumanTurn;
            const isSelected = selectedColor === color;

            return (
              <button
                key={color}
                onClick={() => isAvailable && handleColorSelect(color)}
                disabled={!isAvailable}
                className={`flex items-center gap-2 py-2 px-3 rounded-lg transition-all ${
                  isAvailable ? 'cursor-pointer hover:scale-[1.03]' : 'opacity-30 cursor-default'
                }`}
                style={{
                  backgroundColor: isSelected ? 'var(--color-bg-accent)' : 'transparent',
                  border: isSelected ? '2px solid var(--color-player-active)' : (suggestionColor === color ? '2px dashed var(--color-jump-target-stroke)' : '2px solid transparent'),
                }}
              >
                <svg width="28" height="28" viewBox="0 0 28 28">
                  <circle cx="14" cy="14" r="12"
                    fill={`url(#pool-grad-${color})`}
                    stroke={`var(--color-marble-${color}-stroke)`}
                    strokeWidth="1"
                  />
                  {color === 'white' && (
                    <circle cx="10" cy="10" r="3" fill="white" opacity="0.5" />
                  )}
                  {color === 'grey' && (
                    <circle cx="10" cy="10" r="2.5" fill="#B0B0B0" opacity="0.4" />
                  )}
                  {color === 'black' && (
                    <circle cx="10" cy="10" r="2.5" fill="#555" opacity="0.3" />
                  )}
                </svg>
                <div className="flex flex-col items-start">
                  <span className="text-[10px] uppercase tracking-wide" style={{ color: 'var(--color-text-muted)' }}>
                    {MARBLE_LABEL[color]}
                  </span>
                  <span
                    className="text-sm font-semibold tabular-nums leading-none"
                    style={{ color: 'var(--color-text-primary)', fontFamily: 'Outfit, sans-serif' }}
                  >
                    {count}
                  </span>
                </div>
              </button>
            );
          })}
        </div>
      </div>
    );
  };

  // Button style (mirrors Yinsh)
  const btnClass = `border-2 border-[var(--color-border-button)] text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] py-3 px-4 md:py-2 md:px-4 rounded-lg font-semibold transition-colors text-sm min-h-[44px]`;

  return (
    <div className={`game-zertz min-h-screen flex flex-col items-center font-body bg-[var(--color-bg-page)] ${darkMode ? 'dark' : ''}`}>

      {/* ---- Modal ---- */}
      {showModal && (
        <Dialog
          label={gamePhase === 'game-over' ? 'Game over' : 'Welcome to ZERTZ'}
          onClose={() => setShowModal(false)}
          overlayClass="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50"
          panelClass="p-8 rounded-lg shadow-2xl max-w-md w-full mx-4 border bg-[var(--color-bg-modal)] border-[var(--color-border-panel)] max-h-[92vh] overflow-y-auto"
        >
          <div>
            <h2
              className="text-xl font-bold text-center mb-6"
              style={{ color: 'var(--color-text-primary)' }}
            >
              {gamePhase === 'game-over'
                ? (winner ? `${getPlayerLabel(winner)} wins!` : 'Draw')
                : 'Welcome to ZERTZ!'}
            </h2>
            {gamePhase === 'game-over' && winConditionMet && (
              <p className="text-center -mt-4 mb-6 text-sm" style={{ color: 'var(--color-text-muted)' }}>
                {getWinConditionLabel()}
              </p>
            )}
            <div className="flex justify-center mb-6">
              <button
                onClick={startNewGame}
                className="py-3 px-6 rounded-lg font-semibold hover:opacity-90 transition-colors bg-[var(--color-btn-primary-bg)] text-[var(--color-btn-primary-text)]"
              >
                New Game
              </button>
            </div>
            {renderSettingsToggles()}
          </div>
        </Dialog>
      )}

      {/* ---- Settings Panel ---- */}
      {showSettings && (
        <Dialog
          label="Settings"
          onClose={() => setShowSettings(false)}
          overlayClass="fixed inset-0 bg-black bg-opacity-50 z-50"
          panelClass="settings-panel fixed right-0 top-0 bottom-0 w-80 max-w-full shadow-2xl overflow-y-auto border-l bg-[var(--color-bg-panel)] border-[var(--color-border-panel)]"
        >
          <div>
            <div
              className="flex items-center justify-between p-6 border-b"
              style={{ borderColor: 'var(--color-border-panel)' }}
            >
              <h2
                className="text-xl font-bold"
                style={{ color: 'var(--color-text-primary)' }}
              >
                Settings
              </h2>
              <button
                type="button"
                onClick={() => setShowSettings(false)}
                aria-label="Close settings"
                className={closeButtonClass}
                style={{ color: 'var(--color-text-secondary)' }}
              >
                &times;
              </button>
            </div>
            <div className="p-6">{renderSettingsToggles()}</div>
          </div>
        </Dialog>
      )}

      {/* Rules Modal */}
      {showRules && (
        <Dialog
          label="How to Play ZERTZ"
          onClose={() => setShowRules(false)}
          overlayClass="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-[60]"
          panelClass="rounded-lg shadow-2xl max-w-2xl w-full mx-4 border max-h-[85vh] flex flex-col overflow-hidden bg-[var(--color-bg-modal)] border-[var(--color-border-panel)]"
        >
            <div className="flex items-center justify-between px-6 pt-4 pb-3 shrink-0 border-b" style={{ borderColor: 'var(--color-border-panel)' }}>
              <h2 className="text-xl font-bold" style={{ color: 'var(--color-text-primary)' }}>
                How to Play ZERTZ
              </h2>
              <button
                type="button"
                onClick={() => setShowRules(false)}
                aria-label="Close rules"
                className={closeButtonClass}
                style={{ color: 'var(--color-text-secondary)' }}
              >
                &times;
              </button>
            </div>
            <div className="space-y-6 text-sm leading-relaxed overflow-y-auto px-6 pt-4 pb-6" style={{ color: 'var(--color-text-secondary)' }}>

              {/* Overview */}
              <div>
                <h3 className="font-bold text-base mb-2" style={{ color: 'var(--color-text-primary)' }}>Overview</h3>
                <p>ZERTZ is a two-player abstract strategy game and one of the GIPF Project series. Both players share the same pieces and compete to capture marbles from a hexagonal board that shrinks every turn. The marbles belong to no one until captured — what matters is who takes them.</p>
              </div>

              {/* Components */}
              <div>
                <h3 className="font-bold text-base mb-2" style={{ color: 'var(--color-text-primary)' }}>Components</h3>
                <div className="flex items-center gap-6 my-3 justify-center">
                  <svg width="240" height="55" viewBox="0 0 240 55">
                    <defs>
                      <radialGradient id="rules-grad-w" cx="38%" cy="35%">
                        <stop offset="0%" stopColor="#FFFFFF" />
                        <stop offset="100%" stopColor="#C8C8C8" />
                      </radialGradient>
                      <radialGradient id="rules-grad-g" cx="38%" cy="35%">
                        <stop offset="0%" stopColor="#ABABAB" />
                        <stop offset="100%" stopColor="#505050" />
                      </radialGradient>
                      <radialGradient id="rules-grad-b" cx="38%" cy="35%">
                        <stop offset="0%" stopColor="#4A4A4A" />
                        <stop offset="100%" stopColor="#050505" />
                      </radialGradient>
                    </defs>
                    {/* White */}
                    <circle cx="40" cy="22" r="14" fill="url(#rules-grad-w)" stroke="#999" strokeWidth="0.75" />
                    <circle cx="35" cy="17" r="3" fill="white" opacity="0.5" />
                    <text x="40" y="50" textAnchor="middle" fill="var(--color-text-muted)" fontSize="9" fontFamily="Outfit, sans-serif">White (6)</text>
                    {/* Grey */}
                    <circle cx="120" cy="22" r="14" fill="url(#rules-grad-g)" stroke="#555" strokeWidth="0.75" />
                    <circle cx="115" cy="17" r="2.5" fill="#B0B0B0" opacity="0.4" />
                    <text x="120" y="50" textAnchor="middle" fill="var(--color-text-muted)" fontSize="9" fontFamily="Outfit, sans-serif">Grey (8)</text>
                    {/* Black */}
                    <circle cx="200" cy="22" r="14" fill="url(#rules-grad-b)" stroke="#222" strokeWidth="0.75" />
                    <circle cx="195" cy="17" r="2.5" fill="#555" opacity="0.3" />
                    <text x="200" y="50" textAnchor="middle" fill="var(--color-text-muted)" fontSize="9" fontFamily="Outfit, sans-serif">Black (10)</text>
                  </svg>
                </div>
                <p>The game uses <strong style={{ color: 'var(--color-text-primary)' }}>37 rings</strong> forming the hexagonal board and a shared supply of <strong style={{ color: 'var(--color-text-primary)' }}>24 marbles</strong>: 6 white (most valuable), 8 grey, and 10 black. Neither player "owns" a color — both draw from the same supply and both try to capture marbles.</p>
              </div>

              {/* Placing a Marble */}
              <div>
                <h3 className="font-bold text-base mb-2" style={{ color: 'var(--color-text-primary)' }}>Turn Option 1: Place a Marble</h3>
                <p className="mb-3">If you have no jump available (see Forced Captures), you must place a marble. This has two steps:</p>

                {/* Placing diagram */}
                <div className="flex justify-center my-3">
                  <svg width="300" height="80" viewBox="0 0 300 80">
                    {/* Step 1 */}
                    <text x="75" y="12" textAnchor="middle" fill="var(--color-text-muted)" fontSize="9" fontFamily="Outfit, sans-serif" fontWeight="600">1. PLACE MARBLE</text>
                    {/* Board rings */}
                    {[30, 75, 120].map((x, i) => (
                      <polygon key={i} points={`${x},25 ${x+15},33 ${x+15},48 ${x},55 ${x-15},48 ${x-15},33`}
                        fill="var(--color-ring-fill, #e8e0d4)" stroke="var(--color-ring-stroke, #c4b8a8)" strokeWidth="1" />
                    ))}
                    {/* Marble placed on middle ring */}
                    <circle cx="75" cy="41" r="10" fill="url(#rules-grad-g)" stroke="#555" strokeWidth="0.75" />
                    <text x="75" y="72" textAnchor="middle" fill="var(--color-accent, #6366f1)" fontSize="8" fontFamily="Outfit, sans-serif">choose any ring</text>

                    {/* Arrow */}
                    <text x="160" y="44" fill="var(--color-text-muted)" fontSize="20">&#8594;</text>

                    {/* Step 2 */}
                    <text x="235" y="12" textAnchor="middle" fill="var(--color-text-muted)" fontSize="9" fontFamily="Outfit, sans-serif" fontWeight="600">2. REMOVE EDGE RING</text>
                    {[195, 240, 280].map((x, i) => (
                      <polygon key={i} points={`${x},25 ${x+15},33 ${x+15},48 ${x},55 ${x-15},48 ${x-15},33`}
                        fill={i === 2 ? 'transparent' : 'var(--color-ring-fill, #e8e0d4)'}
                        stroke={i === 2 ? 'var(--color-accent, #6366f1)' : 'var(--color-ring-stroke, #c4b8a8)'}
                        strokeWidth={i === 2 ? 2 : 1}
                        strokeDasharray={i === 2 ? '4 3' : 'none'}
                      />
                    ))}
                    <circle cx="240" cy="41" r="10" fill="url(#rules-grad-g)" stroke="#555" strokeWidth="0.75" />
                    <text x="280" y="44" textAnchor="middle" fill="var(--color-accent, #6366f1)" fontSize="14">&#10005;</text>
                    <text x="235" y="72" textAnchor="middle" fill="var(--color-accent, #6366f1)" fontSize="8" fontFamily="Outfit, sans-serif">board shrinks</text>
                  </svg>
                </div>

                <ol className="list-decimal pl-5 space-y-1">
                  <li><strong style={{ color: 'var(--color-text-primary)' }}>Choose a marble color</strong> from the shared pool and place it on any empty ring.</li>
                  <li><strong style={{ color: 'var(--color-text-primary)' }}>Remove one free ring</strong> from the board. A free ring has no marble on it and can slide out without moving any other ring: at least two adjacent sides of it must face the empty space outside the board. A ring with only one open side cannot be removed.</li>
                </ol>
                <p className="mt-2">This means the board gets smaller every turn. Choosing which ring to remove is as important as where you place your marble.</p>
              </div>

              {/* Capturing */}
              <div>
                <h3 className="font-bold text-base mb-2" style={{ color: 'var(--color-text-primary)' }}>Turn Option 2: Capture by Jumping</h3>
                <p className="mb-3">A marble captures by jumping over an adjacent marble and landing on the empty ring directly beyond it. The jumped marble is removed from the board and added to your captures.</p>

                {/* Capture diagram */}
                <div className="flex justify-center my-3">
                  <svg width="280" height="70" viewBox="0 0 280 70">
                    <defs>
                      <marker id="arrowhead-zertz-rules" markerWidth="8" markerHeight="6" refX="8" refY="3" orient="auto">
                        <polygon points="0 0, 8 3, 0 6" fill="var(--color-accent, #6366f1)" />
                      </marker>
                    </defs>
                    {/* Three rings in a line */}
                    {[60, 140, 220].map((x, i) => (
                      <polygon key={i} points={`${x},15 ${x+20},25 ${x+20},45 ${x},55 ${x-20},45 ${x-20},25`}
                        fill="var(--color-ring-fill, #e8e0d4)" stroke="var(--color-ring-stroke, #c4b8a8)" strokeWidth="1" />
                    ))}
                    {/* Jumping marble */}
                    <circle cx="60" cy="35" r="12" fill="url(#rules-grad-b)" stroke="#222" strokeWidth="0.75" />
                    {/* Jumped marble (being captured) */}
                    <circle cx="140" cy="35" r="12" fill="url(#rules-grad-w)" stroke="#999" strokeWidth="0.75" />
                    <circle cx="140" cy="35" r="14" fill="none" stroke="var(--color-accent, #6366f1)" strokeWidth="1.5" strokeDasharray="3 2" />
                    {/* Arrow */}
                    <line x1="80" y1="35" x2="200" y2="35" stroke="var(--color-accent, #6366f1)" strokeWidth="2" markerEnd="url(#arrowhead-zertz-rules)" />
                    {/* Labels */}
                    <text x="60" y="66" textAnchor="middle" fill="var(--color-text-muted)" fontSize="8" fontFamily="Outfit, sans-serif">jumper</text>
                    <text x="140" y="66" textAnchor="middle" fill="var(--color-accent, #6366f1)" fontSize="8" fontFamily="Outfit, sans-serif">captured</text>
                    <text x="220" y="66" textAnchor="middle" fill="var(--color-text-muted)" fontSize="8" fontFamily="Outfit, sans-serif">lands here</text>
                  </svg>
                </div>

                <p><strong style={{ color: 'var(--color-text-primary)' }}>Key rules for capturing:</strong></p>
                <ul className="list-disc pl-5 space-y-1 mt-1">
                  <li>Any marble on the board can jump any other marble — colors don't matter.</li>
                  <li>The jumped marble is captured by the <strong style={{ color: 'var(--color-text-primary)' }}>player making the jump</strong>, regardless of who placed either marble.</li>
                  <li>The landing ring must be empty and directly adjacent to the jumped marble (in a straight line).</li>
                </ul>
              </div>

              {/* Multi-jump */}
              <div>
                <h3 className="font-bold text-base mb-2" style={{ color: 'var(--color-text-primary)' }}>Multi-Jump Sequences</h3>
                <p className="mb-3">After a marble lands from a jump, if it can jump again from its new position, it <strong style={{ color: 'var(--color-text-primary)' }}>must continue jumping</strong> in the same turn. Each jump captures another marble. The direction can change between jumps.</p>

                {/* Multi-jump diagram */}
                <div className="flex justify-center my-3">
                  <svg width="220" height="100" viewBox="0 0 220 100">
                    {/* Rings */}
                    {[[40,30],[100,30],[160,30],[160,75]].map(([x,y], i) => (
                      <polygon key={i} points={`${x},${y-15} ${x+15},${y-7} ${x+15},${y+7} ${x},${y+15} ${x-15},${y+7} ${x-15},${y-7}`}
                        fill="var(--color-ring-fill, #e8e0d4)" stroke="var(--color-ring-stroke, #c4b8a8)" strokeWidth="1" />
                    ))}
                    {/* Jumping marble */}
                    <circle cx="40" cy="30" r="10" fill="url(#rules-grad-b)" stroke="#222" strokeWidth="0.75" />
                    {/* First jumped marble */}
                    <circle cx="100" cy="30" r="10" fill="url(#rules-grad-w)" stroke="#999" strokeWidth="0.75" opacity="0.5" />
                    <line x1="93" y1="23" x2="107" y2="37" stroke="var(--color-accent, #6366f1)" strokeWidth="2" />
                    {/* Arrow 1 */}
                    <path d="M 55 30 L 145 30" fill="none" stroke="var(--color-accent, #6366f1)" strokeWidth="1.5" strokeDasharray="4 3" />
                    {/* Second jumped marble */}
                    <circle cx="160" cy="30" r="10" fill="url(#rules-grad-g)" stroke="#555" strokeWidth="0.75" opacity="0.5" />
                    <line x1="153" y1="23" x2="167" y2="37" stroke="var(--color-accent, #6366f1)" strokeWidth="2" />
                    {/* Arrow 2 turning down */}
                    <path d="M 160 45 L 160 60" fill="none" stroke="var(--color-accent, #6366f1)" strokeWidth="1.5" strokeDasharray="4 3" />
                    {/* Final position */}
                    <circle cx="160" cy="75" r="10" fill="url(#rules-grad-b)" stroke="#222" strokeWidth="0.75" />
                    {/* Labels */}
                    <text x="40" y="50" textAnchor="middle" fill="var(--color-text-muted)" fontSize="7" fontFamily="Outfit, sans-serif">start</text>
                    <text x="160" y="95" textAnchor="middle" fill="var(--color-accent, #6366f1)" fontSize="7" fontFamily="Outfit, sans-serif">2 captures!</text>
                  </svg>
                </div>

                <p>You cannot stop a sequence early: the turn ends only when the jumping marble has no further jump. Only the first jump involves a choice of which marble to move.</p>
              </div>

              {/* Forced Captures */}
              <div>
                <h3 className="font-bold text-base mb-2" style={{ color: 'var(--color-text-primary)' }}>Forced Captures</h3>
                <div className="rounded-lg p-3 my-2" style={{ backgroundColor: 'var(--color-bg-panel)', border: '1px solid var(--color-border-panel)' }}>
                  <p><strong style={{ color: 'var(--color-text-primary)' }}>Important:</strong> If any marble on the board can make a jump for you, you <strong style={{ color: 'var(--color-text-primary)' }}>must</strong> capture. You cannot choose to place a marble instead. This rule creates tactical depth — sometimes placing a marble sets up a forced capture for your opponent on their next turn.</p>
                </div>
                <p className="mt-2">When a player finishes placing a marble and removing a ring, the turn passes to the opponent. If the opponent has any jump available at the start of that turn, they must jump instead of placing a marble.</p>
              </div>

              {/* Isolated Rings */}
              <div>
                <h3 className="font-bold text-base mb-2" style={{ color: 'var(--color-text-primary)' }}>Isolated Rings</h3>
                <p className="mb-3">When removing a ring splits the board into separate groups, a group cut off from the main (largest) group is captured only if <strong style={{ color: 'var(--color-text-primary)' }}>every ring in it holds a marble</strong>. Its rings and marbles are then removed, and the marbles go to the player who made the move. A cut-off group that still has a vacant ring stays on the board; if you later place a marble on its last vacant ring, you capture the whole group.</p>

                {/* Isolation diagram */}
                <div className="flex justify-center my-3">
                  <svg width="260" height="70" viewBox="0 0 260 70">
                    {/* Main board cluster */}
                    {[30, 65, 100, 135].map((x, i) => (
                      <polygon key={i} points={`${x},15 ${x+13},22 ${x+13},35 ${x},42 ${x-13},35 ${x-13},22`}
                        fill="var(--color-ring-fill, #e8e0d4)" stroke="var(--color-ring-stroke, #c4b8a8)" strokeWidth="1" />
                    ))}
                    <text x="82" y="56" textAnchor="middle" fill="var(--color-text-muted)" fontSize="8" fontFamily="Outfit, sans-serif">main board</text>

                    {/* Gap — removed ring */}
                    <polygon points="170,15 183,22 183,35 170,42 157,35 157,22"
                      fill="transparent" stroke="var(--color-text-muted)" strokeWidth="1" strokeDasharray="3 2" opacity="0.4" />
                    <text x="170" y="32" textAnchor="middle" fill="var(--color-text-muted)" fontSize="9">&#10005;</text>
                    <text x="170" y="56" textAnchor="middle" fill="var(--color-accent, #6366f1)" fontSize="8" fontFamily="Outfit, sans-serif">removed</text>

                    {/* Isolated ring with marble */}
                    <polygon points="210,15 223,22 223,35 210,42 197,35 197,22"
                      fill="var(--color-ring-fill, #e8e0d4)" stroke="var(--color-accent, #6366f1)" strokeWidth="1.5" strokeDasharray="4 2" />
                    <circle cx="210" cy="28" r="8" fill="url(#rules-grad-w)" stroke="#999" strokeWidth="0.75" />
                    <text x="210" y="56" textAnchor="middle" fill="var(--color-accent, #6366f1)" fontSize="8" fontFamily="Outfit, sans-serif">isolated!</text>

                    {/* Captured label */}
                    <text x="245" y="32" fill="var(--color-accent, #6366f1)" fontSize="14">&#8594;</text>
                  </svg>
                </div>
                <p>This can be a powerful tactic — strategically removing a ring to cut off a fully occupied section of the board and claim all the marbles on it.</p>
              </div>

              {/* Winning */}
              <div>
                <h3 className="font-bold text-base mb-2" style={{ color: 'var(--color-text-primary)' }}>Winning Conditions</h3>
                <p className="mb-3">You win by being the first player to capture <strong style={{ color: 'var(--color-text-primary)' }}>any one</strong> of these sets:</p>

                {/* Win conditions diagram */}
                <div className="flex justify-center my-3">
                  <svg width="280" height="130" viewBox="0 0 280 130">
                    {/* 4 White */}
                    <text x="65" y="14" textAnchor="middle" fill="var(--color-text-muted)" fontSize="9" fontFamily="Outfit, sans-serif" fontWeight="600">4 White</text>
                    {[25, 50, 75, 100].map((x, i) => (
                      <circle key={i} cx={x} cy="30" r="9" fill="url(#rules-grad-w)" stroke="#999" strokeWidth="0.75" />
                    ))}

                    {/* 5 Grey */}
                    <text x="65" y="58" textAnchor="middle" fill="var(--color-text-muted)" fontSize="9" fontFamily="Outfit, sans-serif" fontWeight="600">5 Grey</text>
                    {[15, 40, 65, 90, 115].map((x, i) => (
                      <circle key={i} cx={x} cy="74" r="9" fill="url(#rules-grad-g)" stroke="#555" strokeWidth="0.75" />
                    ))}

                    {/* 6 Black */}
                    <text x="75" y="102" textAnchor="middle" fill="var(--color-text-muted)" fontSize="9" fontFamily="Outfit, sans-serif" fontWeight="600">6 Black</text>
                    {[15, 37, 59, 81, 103, 125].map((x, i) => (
                      <circle key={i} cx={x} cy="118" r="9" fill="url(#rules-grad-b)" stroke="#222" strokeWidth="0.75" />
                    ))}

                    {/* OR divider */}
                    <text x="170" y="48" textAnchor="middle" fill="var(--color-text-muted)" fontSize="10" fontFamily="Outfit, sans-serif" fontWeight="600">OR</text>

                    {/* 3 of each */}
                    <text x="220" y="14" textAnchor="middle" fill="var(--color-text-muted)" fontSize="9" fontFamily="Outfit, sans-serif" fontWeight="600">3 of each</text>
                    {[190, 215, 240].map((x, i) => (
                      <circle key={i} cx={x} cy="30" r="9" fill="url(#rules-grad-w)" stroke="#999" strokeWidth="0.75" />
                    ))}
                    {[190, 215, 240].map((x, i) => (
                      <circle key={i} cx={x} cy="55" r="9" fill="url(#rules-grad-g)" stroke="#555" strokeWidth="0.75" />
                    ))}
                    {[190, 215, 240].map((x, i) => (
                      <circle key={i} cx={x} cy="80" r="9" fill="url(#rules-grad-b)" stroke="#222" strokeWidth="0.75" />
                    ))}

                    {/* Trophy */}
                    <text x="220" y="108" textAnchor="middle" fill="var(--color-accent, #6366f1)" fontSize="18">&#127942;</text>
                  </svg>
                </div>

                <p>White marbles are the rarest (only 6 in the game) and require the fewest captures to win. Black marbles are the most common but require 6 to win. The "3 of each" condition rewards balanced capturing.</p>
              </div>

              {/* Pool Exhaustion */}
              <div>
                <h3 className="font-bold text-base mb-2" style={{ color: 'var(--color-text-primary)' }}>Pool Exhaustion</h3>
                <p>If the marble pool runs out of a color, players may place marbles from their own captures back onto the board. If a player has no marbles to place at all, the game ends — the player with more progress toward any winning condition wins.</p>
              </div>

              {/* Strategy Tips */}
              <div className="rounded-lg p-4 mt-2" style={{ backgroundColor: 'var(--color-bg-panel)', border: '1px solid var(--color-border-panel)' }}>
                <h3 className="font-bold text-base mb-2" style={{ color: 'var(--color-text-primary)' }}>Strategy Tips</h3>
                <ul className="list-disc pl-5 space-y-1">
                  <li>White marbles are the most valuable — capturing even one puts you a quarter of the way to winning.</li>
                  <li>Forced captures can backfire. Placing a marble near your opponent's pieces may force them into a beneficial jump on their turn.</li>
                  <li>Removing rings strategically can isolate sections of the board, capturing multiple marbles at once.</li>
                  <li>Pay attention to the board's shrinking shape — edge rings become critical as the board gets smaller.</li>
                  <li>Sometimes placing a black marble (least valuable) is the safest move when the board position is tense.</li>
                </ul>
              </div>

            </div>
        </Dialog>
      )}

      {aiFallback && <p role="status" className="text-sm px-4 py-2">
        Neural model unavailable — using heuristic AI.
      </p>}

      {/* AI Thinking Overlay */}
      {isAiThinking && (
        <div className="fixed inset-0 bg-black bg-opacity-30 flex items-center justify-center z-40 pointer-events-none">
          <div className="p-6 rounded-lg shadow-2xl border-2 bg-[var(--color-bg-modal)] border-[var(--color-border-panel)]">
            <div className="flex flex-col items-center gap-3">
              <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-[var(--color-accent)]"></div>
              <p className="text-lg font-semibold" style={{ color: 'var(--color-text-primary)' }}>
                AI Thinking...
              </p>
            </div>
          </div>
        </div>
      )}

      {/* ---- Header ---- */}
      <div className="flex flex-col items-center pt-3 md:pt-5 shrink-0">
        <Link
          to="/"
          className="text-sm font-semibold uppercase tracking-[0.15em] whitespace-nowrap inline-flex items-center min-h-[44px] px-3 hover:underline"
          style={{ color: 'var(--color-text-secondary)' }}
        >
          &larr; Games
        </Link>
        <h1
          className="font-heading text-3xl md:text-4xl lg:text-5xl font-extrabold tracking-[0.3em] uppercase"
          style={{ color: 'var(--color-text-primary)' }}
        >
          ZERTZ
        </h1>

        {/* Phase indicator with player dot */}
        <div className="flex items-center gap-2 mt-1.5">
          {gamePhase !== 'game-over' && (
            <div
              className="w-2.5 h-2.5 rounded-full"
              style={{ backgroundColor: 'var(--color-player-active)' }}
            />
          )}
          <span
            className="text-sm md:text-base font-medium"
            style={{ color: 'var(--color-text-secondary)' }}
          >
            {gamePhase !== 'game-over' && (
              <span style={{ color: 'var(--color-text-primary)' }} className="font-semibold">
                {twoPlayerMode ? `P${currentPlayer}` : (currentPlayer === humanPlayer ? 'You' : 'AI')}
              </span>
            )}
            {gamePhase !== 'game-over' && <span className="mx-1.5" style={{ color: 'var(--color-text-muted)' }}>&middot;</span>}
            {getPhaseText()}
          </span>
        </div>
      </div>

      {suggestionText && (
        <p role="status" className="text-sm font-semibold px-4 text-center" style={{ color: 'var(--color-text-primary)' }}>
          {suggestionText}
        </p>
      )}

      {/* ---- Main content: 3-column ---- */}
      <div className="flex-1 flex flex-col md:flex-row items-center md:items-start justify-center gap-3 md:gap-5 p-3 md:p-4 w-full max-w-[1200px]">

        {/* Left panel — Player 1 */}
        <div className="hidden md:flex flex-col gap-3 w-52 lg:w-56 order-1 shrink-0">
          {renderCaptureDisplay(1)}
        </div>

        {/* Center — Board + Pool + Controls */}
        <div className="flex flex-col items-center gap-3 order-2 w-full md:w-auto md:flex-1 md:min-w-0 md:max-w-[620px]">

          {/* Board container matching Yinsh pattern */}
          <div
            className="p-2 md:p-3 rounded-xl shadow-lg w-full"
            style={{ backgroundColor: 'var(--color-bg-board)' }}
          >
            <svg
              viewBox="88 108 424 384"
              className="w-full h-auto mx-auto block md:max-w-[600px]"
              role="group"
              aria-label="Zertz game board"
            >
              <defs>
                {/* Marble gradients — board */}
                <radialGradient id="grad-white" cx="38%" cy="35%">
                  <stop offset="0%" stopColor="#FFFFFF" />
                  <stop offset="60%" stopColor="#ECECEC" />
                  <stop offset="100%" stopColor="#C8C8C8" />
                </radialGradient>
                <radialGradient id="grad-grey" cx="38%" cy="35%">
                  <stop offset="0%" stopColor="#ABABAB" />
                  <stop offset="60%" stopColor="#808080" />
                  <stop offset="100%" stopColor="#505050" />
                </radialGradient>
                <radialGradient id="grad-black" cx="38%" cy="35%">
                  <stop offset="0%" stopColor="#4A4A4A" />
                  <stop offset="50%" stopColor="#1A1A1A" />
                  <stop offset="100%" stopColor="#050505" />
                </radialGradient>

                {/* Pool tray gradients (outside SVG but defined here for shared defs) */}
                <radialGradient id="pool-grad-white" cx="38%" cy="35%">
                  <stop offset="0%" stopColor="#FFFFFF" />
                  <stop offset="100%" stopColor="#CCCCCC" />
                </radialGradient>
                <radialGradient id="pool-grad-grey" cx="38%" cy="35%">
                  <stop offset="0%" stopColor="#A8A8A8" />
                  <stop offset="100%" stopColor="#585858" />
                </radialGradient>
                <radialGradient id="pool-grad-black" cx="38%" cy="35%">
                  <stop offset="0%" stopColor="#484848" />
                  <stop offset="100%" stopColor="#080808" />
                </radialGradient>

                {/* Marble shadow */}
                <filter id="marble-shadow" x="-20%" y="-10%" width="140%" height="150%">
                  <feDropShadow dx="0" dy="2" stdDeviation="2" floodColor="#000" floodOpacity="0.2"/>
                </filter>

                {/* Tile inner bevel */}
                <filter id="tile-bevel" x="-5%" y="-5%" width="110%" height="115%">
                  <feDropShadow dx="0" dy="1" stdDeviation="1" floodColor="#000" floodOpacity="0.1"/>
                </filter>
              </defs>

              {/* Background layer: hex tiles (clickable) */}
              {positions.map(([q, r]) => {
                const key = `${q},${r}`;
                if (!rings.has(key)) return null;
                const [sx, sy] = axialToScreen(q, r);
                const cx = CENTER + sx;
                const cy = CENTER + sy;
                const isFree = showPossibleMoves && freeRings.includes(key);
                return (
                  <g
                    key={key}
                    role="button"
                    tabIndex={0}
                    aria-label={tileLabel(key, marbles[key], freeRings.includes(key), validPlacements.includes(key), jumpTargets.includes(key), availableCaptures.includes(key))}
                    onClick={() => handleHexClick(q, r)}
                    onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); handleHexClick(q, r); } }}
                    style={{ cursor: 'pointer' }}
                  >
                    <polygon
                      points={hexPoints(cx, cy, HEX_SIZE - 1)}
                      fill={isFree ? 'var(--color-ring-free)' : 'var(--color-ring-fill)'}
                      stroke={isFree ? 'var(--color-ring-free-stroke)' : 'var(--color-ring-stroke)'}
                      strokeWidth={isFree ? 1.5 : 0.75}
                      filter="url(#tile-bevel)"
                    />
                    <polygon
                      points={hexPoints(cx, cy - 0.5, HEX_SIZE - 5)}
                      fill={isFree ? 'none' : 'var(--color-ring-fill-inner)'}
                      stroke={isFree ? 'none' : 'var(--color-ring-stroke-inner)'}
                      strokeWidth="0.5"
                    />
                  </g>
                );
              })}

              {/* Foreground layer: indicators + marbles (non-interactive, above all tiles) */}
              {positions.map(([q, r]) => {
                const key = `${q},${r}`;
                if (!rings.has(key)) return null;
                const [sx, sy] = axialToScreen(q, r);
                const cx = CENTER + sx;
                const cy = CENTER + sy;
                const marble = marbles[key];
                const isValidPlacement = showPossibleMoves && validPlacements.includes(key);
                const isJumpTarget = showPossibleMoves && jumpTargets.includes(key);
                const isJumpable = showPossibleMoves && availableCaptures.includes(key);
                const isJumping = jumpingMarble === key;
                const isSuggestion = suggestionKey === key || suggestionFromKey === key;
                const isLastMove = lastMoveKeys.includes(key);

                return (
                  <g key={key} pointerEvents="none">
                    {/* Valid placement dot */}
                    {isValidPlacement && !marble && (
                      <circle cx={cx} cy={cy} r={6}
                        fill="var(--color-valid-placement)"
                        stroke="var(--color-player-active)"
                        strokeWidth={1}
                        opacity={0.8}
                      />
                    )}

                    {/* Jump target */}
                    {isJumpTarget && !marble && (
                      <circle cx={cx} cy={cy} r={8}
                        fill="var(--color-jump-target)"
                        stroke="var(--color-jump-target-stroke)"
                        strokeWidth={1.5}
                      />
                    )}

                    {/* Last move indicator — purple ring */}
                    {isLastMove && (
                      <circle cx={cx} cy={cy} r={HEX_SIZE * 0.62}
                        fill="none"
                        stroke="var(--color-last-move)"
                        strokeWidth={2.5}
                      />
                    )}

                    {/* AI suggestion highlight */}
                    {isSuggestion && (
                      <circle cx={cx} cy={cy} r={HEX_SIZE * 0.65}
                        fill="none"
                        stroke="var(--color-jump-target-stroke)"
                        strokeWidth={2.5}
                        strokeDasharray="6 3"
                        className="jumpable-pulse"
                      />
                    )}

                    {/* Marble */}
                    {marble && (
                      <g className="piece-enter" filter="url(#marble-shadow)">
                        <circle
                          cx={cx} cy={cy} r={HEX_SIZE * 0.5}
                          fill={`url(#grad-${marble})`}
                          stroke={`var(--color-marble-${marble}-stroke)`}
                          strokeWidth={marble === 'white' ? 0.75 : 0.5}
                        />
                        <ellipse
                          cx={cx - HEX_SIZE * 0.12}
                          cy={cy - HEX_SIZE * 0.14}
                          rx={HEX_SIZE * 0.15}
                          ry={HEX_SIZE * 0.1}
                          fill="white"
                          opacity={marble === 'white' ? 0.5 : marble === 'grey' ? 0.3 : 0.25}
                        />
                        {isJumpable && (
                          <circle
                            cx={cx} cy={cy} r={HEX_SIZE * 0.57}
                            fill="none"
                            stroke="var(--color-jumpable-marble)"
                            strokeWidth={2}
                            className="jumpable-pulse"
                          />
                        )}
                        {isJumping && (
                          <circle
                            cx={cx} cy={cy} r={HEX_SIZE * 0.6}
                            fill="none"
                            stroke="var(--color-text-primary)"
                            strokeWidth={2}
                            strokeDasharray="5 3"
                          />
                        )}
                      </g>
                    )}
                  </g>
                );
              })}
            </svg>
          </div>

          {/* Marble Pool */}
          {renderMarblePool()}

          {/* Controls row */}
          <div className="flex gap-2 items-center flex-wrap justify-center">
            <button onClick={handleUndo} disabled={!board.canUndo()} className={`${btnClass} ${!board.canUndo() ? 'opacity-30 cursor-not-allowed' : ''}`} title="Undo (Ctrl+Z)">
              Undo
            </button>
            <button onClick={handleRedo} disabled={!board.canRedo()} className={`${btnClass} ${!board.canRedo() ? 'opacity-30 cursor-not-allowed' : ''}`} title="Redo (Ctrl+Shift+Z)">
              Redo
            </button>
            {/* AI Suggest — visible when human's turn or 2-player mode */}
            {(twoPlayerMode || (!twoPlayerMode && currentPlayer === humanPlayer && !isAiThinking)) && gamePhase !== 'game-over' && (
              <button
                onClick={() => getAISuggestion(false)}
                disabled={isAiThinking}
                className={`${btnClass} ${isAiThinking ? 'opacity-50 cursor-not-allowed' : ''}`}
              >
                {isAiThinking ? 'Thinking...' : 'AI Suggest'}
              </button>
            )}
            {/* AI Move — in 2-player mode, or when undo/redo paused the AI's turn */}
            {(twoPlayerMode || (aiPaused && !isHumanTurn)) && gamePhase !== 'game-over' && (
              <button
                onClick={() => getAISuggestion(true)}
                disabled={isAiThinking}
                className={`${btnClass} ${isAiThinking ? 'opacity-50 cursor-not-allowed' : ''}`}
              >
                {isAiThinking ? 'Thinking...' : 'AI Move'}
              </button>
            )}
            <button onClick={() => setShowSettings(true)} className={btnClass}>
              Settings
            </button>
            <button onClick={() => setShowModal(true)} className={btnClass}>
              New Game
            </button>
          </div>

          {/* Mobile capture displays */}
          <div className="flex md:hidden gap-2 w-full">
            <div className="flex-1 min-w-0">{renderCaptureDisplay(1)}</div>
            <div className="flex-1 min-w-0">{renderCaptureDisplay(2)}</div>
          </div>
        </div>

        {/* Right panel — Player 2 */}
        <div className="hidden md:flex flex-col gap-3 w-52 lg:w-56 order-3 shrink-0">
          {renderCaptureDisplay(2)}
        </div>
      </div>
    </div>
  );
};

export default function ResumableZertzGame() { return <MatchBoundary game="zertz" decode={decodeMatch}><ZertzGame /></MatchBoundary>; }
