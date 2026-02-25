// YinshGame.jsx - Build: 2025-01-23 v3 (UI Overhaul)
import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Link } from 'react-router-dom';
import './yinsh.css';
import YinshBoard from './YinshBoard.js';
import MCTS from './engine/mcts.js';
import { useAIWorker } from './hooks/useAIWorker.js';
import { applyAIMove } from './engine/aiPlayer.js';
import testPositions from './engine/testPositions.js';

// Configuration
const AI_MODE = 'local'; // Local mode now fixed - removed excessive logging
const API_ENDPOINT = '/api/aiMove'; // Use relative URL to work from any domain

// Difficulty presets: model path, simulations, evaluation mode
const DIFFICULTY_CONFIG = {
  easy:     { modelPath: '/models/yinsh-value-easy.onnx',     simulations: 100, evaluationMode: 'nn' },
  advanced: { modelPath: '/models/yinsh-value-advanced.onnx', simulations: 150, evaluationMode: 'nn' },
  expert:   { modelPath: '/models/yinsh-value-v1.onnx',       simulations: 200, evaluationMode: 'nn' },
};

// Toggle component — extracted from repeated settings markup
const Toggle = ({ label, checked, onChange }) => (
  <div className="flex items-center justify-between">
    <span style={{ color: 'var(--color-text-primary)' }}>{label}</span>
    <button
      onClick={onChange}
      role="switch"
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

// PieceIcon — small inline SVG for move history
const PieceIcon = ({ player }) => (
  <svg width="14" height="14" viewBox="0 0 14 14" className="inline-block align-middle">
    <circle
      cx="7" cy="7" r="6"
      fill={player === 1 ? 'var(--color-piece-white)' : 'var(--color-piece-black)'}
      stroke={player === 1 ? 'var(--color-ring-neutral)' : 'none'}
      strokeWidth={player === 1 ? 1 : 0}
    />
  </svg>
);

const YinshGame = () => {
  // We'll keep darkMode, showModal, etc. in React as UI states
  const getLocalStorageValue = (key, defaultValue) => {
    try {
      const saved = localStorage.getItem(key);
      return saved ? JSON.parse(saved) : defaultValue;
    } catch (e) {
      return defaultValue;
    }
  };

  // Add new state for modal - must be before other state that might use it
  const [showModal, setShowModal] = useState(true);  // Initialize to true like in OldYinshGame

  const [yinshBoard, setYinshBoard] = useState(() => new YinshBoard());

  // Initialize AI Web Worker
  const { computeMove, isSupported: isWorkerSupported } = useAIWorker();

  const [darkMode, setDarkMode] = useState(() => {
    const saved = localStorage.getItem('yinshDarkMode');
    return saved ? JSON.parse(saved) : false;
  });
  const [showPossibleMoves, setShowPossibleMoves] = useState(() => {
    const saved = localStorage.getItem('yinshShowMoves');
    return saved ? JSON.parse(saved) : true;
  });
  const [useRandomSetup, setUseRandomSetup] = useState(() => {
    const saved = localStorage.getItem('yinshRandomSetup');
    return saved ? JSON.parse(saved) : false;
  });
  const [selectedSetupRing, setSelectedSetupRing] = useState(null);
  const [showInvalidFlash, setShowInvalidFlash] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [showMoveHistory, setShowMoveHistory] = useState(() => {
    const saved = localStorage.getItem('yinshShowMoveHistory');
    return saved ? JSON.parse(saved) : true;
  });
  const [difficulty, setDifficulty] = useState(() => {
    // Check new key first
    const saved = localStorage.getItem('yinshDifficulty');
    if (saved) return saved;
    // Migrate from old key
    const oldMode = localStorage.getItem('yinshEvaluationMode');
    if (oldMode === 'heuristic') return 'easy';
    if (oldMode === 'nn') return 'expert';
    return 'expert'; // default
  });

  const [twoPlayerMode, setTwoPlayerMode] = useState(() => {
    const saved = localStorage.getItem('yinshTwoPlayer');
    return saved ? JSON.parse(saved) : false;
  });
  const [humanPlayer, setHumanPlayer] = useState(() => Math.random() < 0.5 ? 1 : 2);

  // Add new state for keeping score
  const [keepScore, setKeepScore] = useState(() => {
    const saved = localStorage.getItem('yinshKeepScore');
    return saved ? JSON.parse(saved) : false;
  });

  // Update wins state initialization to load from localStorage
  const [wins, setWins] = useState(() => {
    if (!keepScore) return { 1: 0, 2: 0 };
    const saved = localStorage.getItem('yinshWins');
    return saved ? JSON.parse(saved) : { 1: 0, 2: 0 };
  });

  // Add effect to save wins when they change
  useEffect(() => {
    if (keepScore) {
      localStorage.setItem('yinshWins', JSON.stringify(wins));
    }
  }, [wins, keepScore]);

  // Update the keepScore toggle handler to clear wins from storage when disabled
  const handleKeepScoreToggle = () => {
    const newKeepScore = !keepScore;
    setKeepScore(newKeepScore);
    if (!newKeepScore) {
      setWins({ 1: 0, 2: 0 });
      localStorage.removeItem('yinshWins'); // Clear wins from storage when disabled
    }
  };

  // For "invalid move" flash, keep it in UI
  useEffect(() => {
    if (showInvalidFlash) {
      const timer = setTimeout(() => setShowInvalidFlash(false), 150);
      return () => clearTimeout(timer);
    }
  }, [showInvalidFlash]);

  // Save darkMode/showMoves prefs
  useEffect(() => {
    localStorage.setItem('yinshDarkMode', JSON.stringify(darkMode));
  }, [darkMode]);
  useEffect(() => {
    localStorage.setItem('yinshShowMoves', JSON.stringify(showPossibleMoves));
  }, [showPossibleMoves]);
  useEffect(() => {
    localStorage.setItem('yinshRandomSetup', JSON.stringify(useRandomSetup));
  }, [useRandomSetup]);

  // Add effect to save preference
  useEffect(() => {
    localStorage.setItem('yinshKeepScore', JSON.stringify(keepScore));
  }, [keepScore]);
  useEffect(() => {
    localStorage.setItem('yinshShowMoveHistory', JSON.stringify(showMoveHistory));
  }, [showMoveHistory]);
  useEffect(() => {
    localStorage.setItem('yinshDifficulty', difficulty);
    // Keep old key in sync for backward compat
    localStorage.setItem('yinshEvaluationMode', difficulty === 'easy' ? 'heuristic' : 'nn');
  }, [difficulty]);
  useEffect(() => {
    localStorage.setItem('yinshTwoPlayer', JSON.stringify(twoPlayerMode));
  }, [twoPlayerMode]);

  // Add keyboard shortcuts for undo/redo
  useEffect(() => {
    const handleKeyDown = (e) => {
      // Ctrl+Z or Cmd+Z for undo
      if ((e.ctrlKey || e.metaKey) && e.key === 'z' && !e.shiftKey) {
        e.preventDefault();
        if (yinshBoard.canUndo()) {
          yinshBoard.undo();
          setYinshBoard(yinshBoard.clone());
        }
      }
      // Ctrl+Y or Cmd+Shift+Z for redo
      if (((e.ctrlKey || e.metaKey) && e.key === 'y') ||
          ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === 'z')) {
        e.preventDefault();
        if (yinshBoard.canRedo()) {
          yinshBoard.redo();
          setYinshBoard(yinshBoard.clone());
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [yinshBoard]);

  // We can keep grid logic for rendering
  const generateGridPoints = () => {
    return YinshBoard.generateGridPoints();
  };

  const axialToScreen = (q, r) => {
    const x = q * 50 + r * 25 + 300;
    const y = r * 43.3 + 300;
    return [x, y];
  };

  const flashInvalidMove = () => {
    setShowInvalidFlash(true);
  };

  // Add this handler for setup ring clicks
  const handleSetupRingClick = (player, index) => {
    if (!twoPlayerMode && currentPlayer !== humanPlayer) return;
    if (yinshBoard.getCurrentPlayer() !== player) return;

    let newSelection;
    if (selectedSetupRing?.player === player && selectedSetupRing?.index === index) {
      newSelection = null;
    } else {
      newSelection = { player, index };
    }
    setSelectedSetupRing(newSelection);
    yinshBoard.selectedSetupRing = newSelection;
    setYinshBoard(yinshBoard.clone());
  };

  // Add this function to handle game over
  const handleGameOver = () => {
    if (keepScore && yinshBoard.getGamePhase() === 'game-over') {
      const winner = yinshBoard.getScores()[1] === 3 ? 1 : 2;
      setWins(prev => ({
        ...prev,
        [winner]: prev[winner] + 1
      }));
    }
    setShowModal(true);
  };

  // Update handleIntersectionClick to check for game over
  const handleIntersectionClick = (q, r) => {
    if (!twoPlayerMode && currentPlayer !== humanPlayer) return;

    const key = `${q},${r}`;
    const piece = yinshBoard.getBoardState()[key];

    if (yinshBoard.getGamePhase() === 'setup') {
      // Only allow placement if we have a ring selected and the spot is empty
      if (selectedSetupRing && !piece) {
        const currentPlayer = yinshBoard.getCurrentPlayer();
        if (selectedSetupRing.player === currentPlayer) {
          // Use YinshBoard.handleClick which handles notation, _captureState, etc.
          yinshBoard.handleClick(q, r);
          setSelectedSetupRing(null);
          setYinshBoard(yinshBoard.clone());
        }
      }
      return;
    }

    if (yinshBoard.getGamePhase() === 'play') {
      const selectedRing = yinshBoard.getSelectedRing();

      // If clicking the currently selected ring, deselect it
      if (selectedRing && q === selectedRing[0] && r === selectedRing[1]) {
        yinshBoard.selectedRing = null;
        setYinshBoard(yinshBoard.clone());
        return;
      }

      // If clicking a ring of the current player — clear previous move indicator
      if (piece?.type === 'ring' && piece.player === yinshBoard.getCurrentPlayer()) {
        setLastMove(null);
        yinshBoard.selectedRing = [q, r];
        yinshBoard.validMoves = yinshBoard.calculateValidMoves(q, r);
        setYinshBoard(yinshBoard.clone());
        return;
      }

      // If a ring is selected and this is a destination click, compute flipped markers
      if (selectedRing) {
        const from = selectedRing;
        const to = [q, r];
        const boardState = yinshBoard.getBoardState();
        const dq = Math.sign(to[0] - from[0]);
        const dr = Math.sign(to[1] - from[1]);
        const flipped = [];
        let pq = from[0] + dq, pr = from[1] + dr;
        while (pq !== to[0] || pr !== to[1]) {
          const p = boardState[`${pq},${pr}`];
          if (p?.type === 'marker') flipped.push([pq, pr]);
          pq += dq;
          pr += dr;
        }

        yinshBoard.handleClick(q, r);
        setYinshBoard(yinshBoard.clone());

        // If move succeeded (selectedRing was cleared), record the move
        if (!yinshBoard.getSelectedRing()) {
          setLastMove({ from, to, flipped });
        }

        if (yinshBoard.getGamePhase() === 'game-over') {
          handleGameOver();
        }
        setAiSuggestion(null);
        return;
      }
    }

    // Handle the regular click (this includes move validation)
    yinshBoard.handleClick(q, r);
    setYinshBoard(yinshBoard.clone());

    if (yinshBoard.getGamePhase() === 'game-over') {
      handleGameOver();
    }

    setAiSuggestion(null);
  };

  // Update startNewGame to remove the win counting (since it's now handled in handleGameOver)
  const startNewGame = () => {
    if (!twoPlayerMode) {
      setHumanPlayer(Math.random() < 0.5 ? 1 : 2);
    }
    yinshBoard.startNewGame(useRandomSetup);
    setYinshBoard(yinshBoard.clone());
    setShowModal(false);
    setSelectedSetupRing(null);
    setLastMove(null);
  };

  // Undo/Redo handlers
  const handleUndo = () => {
    if (yinshBoard.canUndo()) {
      yinshBoard.undo();
      if (!twoPlayerMode) {
        while (yinshBoard.canUndo() && yinshBoard.getCurrentPlayer() !== humanPlayer) {
          yinshBoard.undo();
        }
      }
      setYinshBoard(yinshBoard.clone());
      setAiSuggestion(null);
      setLastMove(null);
    }
  };

  const handleRedo = () => {
    if (yinshBoard.canRedo()) {
      yinshBoard.redo();
      if (!twoPlayerMode) {
        while (yinshBoard.canRedo() && yinshBoard.getCurrentPlayer() !== humanPlayer) {
          yinshBoard.redo();
        }
      }
      setYinshBoard(yinshBoard.clone());
      setAiSuggestion(null);
      setLastMove(null);
    }
  };

  // We'll read data from the board (just as we used to read from state)
  const boardState = yinshBoard.getBoardState();
  const gamePhase = yinshBoard.getGamePhase();
  const currentPlayer = yinshBoard.getCurrentPlayer();
  const ringsPlaced = yinshBoard.getRingsPlaced();
  const scores = yinshBoard.getScores();
  const selectedRing = yinshBoard.getSelectedRing();
  const validMoves = yinshBoard.getValidMoves();
  const rows = yinshBoard.getRows();

  // The rest of your rendering logic remains nearly identical:
  const gridPoints = generateGridPoints();

  const invalidFlashStyle = {
    position: 'fixed',
    inset: '0',
    backgroundColor: 'rgba(255, 0, 0, 0.1)',
    pointerEvents: 'none',
    transition: 'opacity 0.15s ease-in-out',
    opacity: showInvalidFlash ? 1 : 0
  };

  // Piece animation tracking
  const prevBoardRef = useRef({});
  const [animatingPieces, setAnimatingPieces] = useState({ entering: new Set(), flipping: new Set() });

  useEffect(() => {
    const prev = prevBoardRef.current;
    const current = boardState;
    const entering = new Set();
    const flipping = new Set();

    for (const key of Object.keys(current)) {
      if (!prev[key]) {
        entering.add(key);
      } else if (prev[key].type === 'marker' && current[key].type === 'marker' && prev[key].player !== current[key].player) {
        flipping.add(key);
      }
    }

    prevBoardRef.current = { ...current };

    if (entering.size > 0 || flipping.size > 0) {
      setAnimatingPieces({ entering, flipping });
      const timer = setTimeout(() => setAnimatingPieces({ entering: new Set(), flipping: new Set() }), 300);
      return () => clearTimeout(timer);
    }
  }, [boardState]);

  // Auto-scroll move history
  const moveHistoryRef = useRef(null);

  useEffect(() => {
    if (moveHistoryRef.current) {
      const currentEl = moveHistoryRef.current.querySelector('[data-current="true"]');
      if (currentEl) {
        currentEl.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      }
    }
  }, [boardState]);

  // Scoreboard
  const renderScoreIndicator = (player, position) => {
    const score = scores[player];
    const y = position === 'bottom' ? 560 : 40;
    return (
      <g>
        {[0, 1, 2].map((i) => {
          const x = position === 'bottom' ? 45 + i * 40 : 485 + i * 40;
          return (
            <g key={i}>
              {i < score ? (
                <>
                  <circle
                    cx={x}
                    cy={y}
                    r={15}
                    fill="var(--color-ring-bg)"
                    pointerEvents="none"
                  />
                  <circle
                    cx={x}
                    cy={y}
                    r={15}
                    fill="none"
                    stroke="var(--color-ring-neutral)"
                    strokeWidth={8}
                    pointerEvents="none"
                  />
                  <circle
                    cx={x}
                    cy={y}
                    r={15}
                    fill="none"
                    stroke={player === 1 ? 'var(--color-piece-white)' : 'var(--color-piece-black)'}
                    strokeWidth={6}
                    pointerEvents="none"
                  />
                </>
              ) : (
                <circle
                  cx={x}
                  cy={y}
                  r={15}
                  fill="none"
                  stroke="var(--color-score-empty)"
                  strokeWidth={1}
                />
              )}
            </g>
          );
        })}
      </g>
    );
  };

  // Setup ring tray - renders clickable ring elements outside the SVG to avoid board overlap
  const renderSetupRingTray = (player) => {
    const ringsToPlace = 5 - ringsPlaced[player];
    const isCurrentPlayer = currentPlayer === player;

    return Array.from({ length: ringsToPlace }).map((_, i) => {
      const isSelected = selectedSetupRing?.player === player && selectedSetupRing?.index === i;
      const showDot = isCurrentPlayer && (!selectedSetupRing || isSelected);

      return (
        <button
          key={i}
          onClick={() => handleSetupRingClick(player, i)}
          disabled={!isCurrentPlayer}
          className={`p-1 rounded-full transition-all ${
            isCurrentPlayer ? 'cursor-pointer hover:scale-110' : 'opacity-40 cursor-default'
          } ${isSelected ? 'scale-110' : ''}`}
        >
          <svg width="32" height="32" viewBox="0 0 40 40">
            <circle cx="20" cy="20" r="15" fill="var(--color-ring-bg)" />
            <circle cx="20" cy="20" r="15" fill="none" stroke="var(--color-ring-neutral)" strokeWidth={isSelected ? 10 : 6} />
            <circle cx="20" cy="20" r="15" fill="none" stroke={player === 1 ? 'var(--color-piece-white)' : 'var(--color-piece-black)'} strokeWidth={isSelected ? 8 : 4} />
            {showDot && (
              <circle cx="20" cy="20" r="4" fill="var(--color-valid-move)" />
            )}
          </svg>
        </button>
      );
    });
  };

  // Add useState for new states
  const [isThinking, setIsThinking] = useState(false);
  const [aiError, setAiError] = useState(null);
  const [numSimulations, setNumSimulations] = useState(1000);
  const [lastMoveConfidence, setLastMoveConfidence] = useState(null);

  // Add new state for AI suggestion and last AI move
  const [isAiThinking, setIsAiThinking] = useState(false);
  const [aiSuggestion, setAiSuggestion] = useState(null);
  const [lastMove, setLastMove] = useState(null); // Track last move (human or AI) for visual indicator

  // Position reviewer mode (?positions URL param)
  const isPositionReviewMode = new URLSearchParams(window.location.search).has('positions');
  const [selectedPositionId, setSelectedPositionId] = useState(null);

  const loadPosition = useCallback((posId) => {
    const pos = testPositions.find(p => p.id === posId);
    if (!pos) return;
    yinshBoard.loadFromPositionData(pos);
    setYinshBoard(yinshBoard.clone());
    setSelectedPositionId(posId);
    setAiSuggestion(null);
    setLastMove(null);
    setShowModal(false);
  }, [yinshBoard]);

  // Combined function to get AI suggestion - uses Web Worker if supported, falls back to main thread
  const getAISuggestion = async (autoExecute = false) => {
    if (isAiThinking) return;

    setIsAiThinking(true);
    setAiSuggestion(null);
    setLastMove(null);

    try {
      // Check if Web Workers are supported
      if (!isWorkerSupported) {
        console.warn('Web Workers not supported, falling back to main thread');

        // Fallback: Run MCTS on main thread with setTimeout to yield
        const config = DIFFICULTY_CONFIG[difficulty] || DIFFICULTY_CONFIG.expert;
        const mcts = new MCTS(100000, { evaluationMode: config.evaluationMode });
        await new Promise(resolve => setTimeout(resolve, 0));
        const result = await mcts.getBestMove(yinshBoard, config.simulations);

        if (result) {
          const suggestion = {
            from: result.move,
            to: result.destination,
            type: result.type || 'move',
            row: result.row || null
          };
          setAiSuggestion(suggestion);
          if (autoExecute) {
            executeAIMove(suggestion);
          }
        }
        setIsAiThinking(false);
        return;
      }

      // Use Web Worker for computation (prevents UI blocking)
      const serializedState = yinshBoard.serializeState();
      const config = DIFFICULTY_CONFIG[difficulty] || DIFFICULTY_CONFIG.expert;

      computeMove(
        serializedState,
        config.simulations,
        // onSuccess callback
        (result, stats) => {
          console.log(`AI computed move: ${stats.simulations} simulations in ${stats.phase} phase (${stats.evaluationMode || 'heuristic'})`);

          if (result) {
            const suggestion = {
              from: result.move,
              to: result.destination,
              type: result.type || 'move',
              row: result.row || null
            };
            setAiSuggestion(suggestion);
            if (autoExecute) {
              executeAIMove(suggestion);
            }
          }
          setIsAiThinking(false);
        },
        // onError callback
        (error) => {
          console.error('AI Worker Error:', error);
          setIsAiThinking(false);
        },
        config.evaluationMode,
        config.modelPath
      );
    } catch (error) {
      console.error('AI Error:', error.message);
      setIsAiThinking(false);
    }
  };

  // Function to execute AI move (uses shared applyAIMove for game logic)
  const executeAIMove = (moveToExecute = null) => {
    const move = moveToExecute || aiSuggestion;
    if (!move) return;

    const { from, to } = move;
    const { flipped } = applyAIMove(yinshBoard, move);

    // Store the AI move for visual indicator (only for regular play moves)
    if (from && to && flipped.length >= 0 && move.type !== 'remove-row' && move.type !== 'remove-ring' && move.type !== 'place-ring' && yinshBoard.getGamePhase() !== 'setup') {
      setLastMove({ from, to, flipped });
    }

    setYinshBoard(yinshBoard.clone());
    setAiSuggestion(null);

    if (yinshBoard.getGamePhase() === 'game-over') {
      handleGameOver();
    }
  };

  // Auto-AI: trigger AI when it's the computer's turn in 1P mode
  useEffect(() => {
    if (twoPlayerMode || gamePhase === 'game-over' || isAiThinking || showModal) return;
    if (currentPlayer === humanPlayer) return;

    const timer = setTimeout(() => getAISuggestion(true), 500);
    return () => clearTimeout(timer);
  }, [gamePhase, currentPlayer, twoPlayerMode, humanPlayer, isAiThinking, showModal]);

  // Settings toggles (shared between welcome modal and settings panel)
  const renderSettingsToggles = () => (
    <div className="space-y-4">
      <Toggle label="Two Players" checked={twoPlayerMode} onChange={() => setTwoPlayerMode(!twoPlayerMode)} />
      <Toggle label="Dark Mode" checked={darkMode} onChange={() => setDarkMode(!darkMode)} />
      <Toggle label="Show Valid Moves" checked={showPossibleMoves} onChange={() => setShowPossibleMoves(!showPossibleMoves)} />
      <Toggle label="Random Setup" checked={useRandomSetup} onChange={() => setUseRandomSetup(!useRandomSetup)} />
      <Toggle label="Keep Score" checked={keepScore} onChange={handleKeepScoreToggle} />
      <Toggle label="Show Move History" checked={showMoveHistory} onChange={() => setShowMoveHistory(!showMoveHistory)} />
      <div className="flex items-center justify-between">
        <span style={{ color: 'var(--color-text-primary)' }}>AI Difficulty</span>
        <div className="flex gap-1">
          {['easy', 'advanced', 'expert'].map(level => (
            <button
              key={level}
              onClick={() => setDifficulty(level)}
              className="px-2 py-1 rounded text-xs font-medium transition-colors"
              style={{
                backgroundColor: difficulty === level ? 'var(--color-toggle-active)' : 'var(--color-toggle-inactive)',
                color: difficulty === level ? '#fff' : 'var(--color-text-primary)',
              }}
            >
              {level.charAt(0).toUpperCase() + level.slice(1)}
            </button>
          ))}
        </div>
      </div>
    </div>
  );

  // Move history content (shared between desktop sidebar and mobile section)
  const renderMoveHistoryContent = () => (
    <>
      <div className="flex-1 overflow-y-auto p-4" ref={moveHistoryRef}>
        {yinshBoard.getMoveHistory().length === 0 ? (
          <p className="text-center" style={{ color: 'var(--color-text-muted)' }}>
            No moves yet
          </p>
        ) : (
          <div className="space-y-1">
            {yinshBoard.getMoveHistory().map((move, index) => {
              const moveNumber = index + 1;
              const player = Math.ceil(moveNumber / 2) % 2 === 1 ? 1 : 2;
              const historyPos = yinshBoard.getHistoryPosition();
              const isCurrentMove = index === historyPos.current - 2;

              return (
                <div
                  key={index}
                  data-current={isCurrentMove || undefined}
                  className={`px-3 py-2 rounded text-sm font-mono transition-colors ${
                    isCurrentMove
                      ? 'border-l-2'
                      : 'hover:bg-[var(--color-bg-hover)]'
                  }`}
                  style={isCurrentMove ? {
                    borderLeftColor: 'var(--color-accent)',
                    backgroundColor: 'var(--color-bg-accent)',
                    color: 'var(--color-text-primary)',
                  } : {
                    color: 'var(--color-text-secondary)',
                  }}
                >
                  <span className="font-semibold">{moveNumber}.</span>{' '}
                  <PieceIcon player={player} />{' '}
                  <span>{move}</span>
                </div>
              );
            })}
          </div>
        )}
      </div>
      <div
        className="p-3 border-t-2 text-sm text-center"
        style={{ borderColor: 'var(--color-border-panel)', color: 'var(--color-text-muted)' }}
      >
        {yinshBoard.getMoveHistory().length} move{yinshBoard.getMoveHistory().length !== 1 ? 's' : ''}
      </div>
    </>
  );

  // Button style helper - increased touch targets for mobile (44px minimum)
  const btnClass = `border-2 border-[var(--color-border-button)] text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] py-3 px-4 md:py-2 md:px-4 rounded-lg font-semibold transition-colors text-sm min-h-[44px]`;

  // The render
  return (
    <div className={`game-yinsh min-h-screen flex flex-col items-center font-body bg-[var(--color-bg-page)] ${darkMode ? 'dark' : ''}`}>
      {/* Welcome / Game-over Modal */}
      {showModal && (
        <div
          className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50"
          onClick={(e) => {
            if (e.target === e.currentTarget) {
              setShowModal(false);
            }
          }}
        >
          <div
            className="p-8 rounded-lg shadow-2xl max-w-md w-full mx-4 border bg-[var(--color-bg-modal)] border-[var(--color-border-panel)]"
          >
            <h2
              className="text-xl font-bold text-center mb-6"
              style={{ color: 'var(--color-text-primary)' }}
            >
              {yinshBoard.getGamePhase() === 'game-over'
                ? (yinshBoard.getScores()[1] === 3 ? 'White wins!' : 'Black wins!')
                : 'Welcome to YINSH!'}
            </h2>
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
        </div>
      )}

      {/* Settings Panel — slides in from right */}
      {showSettings && (
        <div
          className="fixed inset-0 bg-black bg-opacity-50 z-50"
          onClick={(e) => {
            if (e.target === e.currentTarget) {
              setShowSettings(false);
            }
          }}
        >
          <div className="settings-panel fixed right-0 top-0 bottom-0 w-80 shadow-2xl overflow-y-auto border-l bg-[var(--color-bg-panel)] border-[var(--color-border-panel)]">
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
                onClick={() => setShowSettings(false)}
                className="text-2xl font-bold"
                style={{ color: 'var(--color-text-secondary)' }}
              >
                ×
              </button>
            </div>
            <div className="p-6">
              {renderSettingsToggles()}
            </div>
          </div>
        </div>
      )}

      {/* AI Thinking Overlay */}
      {isAiThinking && (
        <div className="fixed inset-0 bg-black bg-opacity-30 flex items-center justify-center z-40 pointer-events-none">
          <div className="p-6 rounded-lg shadow-2xl border-2 bg-[var(--color-bg-modal)] border-[var(--color-border-panel)]">
            <div className="flex flex-col items-center gap-3">
              <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-[var(--color-accent)]"></div>
              <p
                className="text-lg font-semibold"
                style={{ color: 'var(--color-text-primary)' }}
              >
                AI Thinking...
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Header: Wordmark + Status */}
      <div className="flex flex-col items-center pt-2 md:pt-4 shrink-0">
        <Link
          to="/"
          className="text-[10px] font-semibold uppercase tracking-[0.2em] mb-1 opacity-40 hover:opacity-70 transition-opacity"
          style={{ color: 'var(--color-text-secondary)' }}
        >
          &larr; GIPF Project
        </Link>
        <h1
          className="font-heading text-4xl lg:text-6xl font-extrabold tracking-[0.25em] uppercase"
          style={{ color: 'var(--color-text-primary)' }}
        >
          YINSH
        </h1>
        <div className="text-center mt-1 md:mt-2" style={{ color: 'var(--color-text-primary)' }}>
          <div className="text-base md:text-xl lg:text-2xl font-bold">
            {(() => {
              const playerLabel = (player) => {
                const color = player === 1 ? 'White' : 'Black';
                if (twoPlayerMode) return color;
                return player === humanPlayer ? `${color} (You)` : `${color} (AI)`;
              };
              return (
                <>
                  {gamePhase === 'setup' && (
                    <span>
                      <span className="font-medium" style={{ color: 'var(--color-accent)' }}>
                        {playerLabel(currentPlayer)}
                      </span>
                      : Place a ring
                    </span>
                  )}
                  {gamePhase === 'play' && (
                    <span>
                      <span className="font-medium" style={{ color: 'var(--color-accent)' }}>
                        {playerLabel(currentPlayer)}
                      </span>
                      : {selectedRing ? 'Move ring' : 'Select a ring'}
                    </span>
                  )}
                  {gamePhase === 'remove-row' && (
                    <div>
                      <div>
                        <span className="font-medium" style={{ color: 'var(--color-accent)' }}>
                          {playerLabel(currentPlayer)}
                        </span>
                        : Select a row to remove
                      </div>
                      {yinshBoard.rowResolutionQueue && yinshBoard.rowResolutionQueue.length > 1 && (
                        <div className="text-sm md:text-base lg:text-lg mt-1" style={{ color: 'var(--color-text-secondary)' }}>
                          {playerLabel(yinshBoard.rowResolutionQueue[1].player)} will resolve rows next
                        </div>
                      )}
                    </div>
                  )}
                  {gamePhase === 'remove-ring' && (
                    <span>
                      <span className="font-medium" style={{ color: 'var(--color-accent)' }}>
                        {playerLabel(currentPlayer)}
                      </span>
                      : Select a ring to remove
                    </span>
                  )}
                  {gamePhase === 'game-over' && (
                    <span>
                      <span className="font-medium" style={{ color: 'var(--color-accent)' }}>
                        {playerLabel(yinshBoard.winner)}
                      </span>
                      {' '}wins!
                    </span>
                  )}
                </>
              );
            })()}
          </div>
        </div>
      </div>

      {/* Main content: 3-column on tablet+, stacked on mobile */}
      <div className="flex-1 flex flex-col md:flex-row items-center md:items-start justify-center gap-2 md:gap-4 p-2 md:p-4 w-full max-w-[1400px]">

        {/* Move History - left column on tablet+ */}
        {showMoveHistory && (
          <div
            className="hidden md:flex w-64 lg:w-72 max-h-[600px] border-2 rounded-lg shadow-lg flex-col order-1 shrink-0 bg-[var(--color-bg-panel)] border-[var(--color-border-panel)]"
          >
            <div
              className="flex items-center justify-between p-4 border-b-2"
              style={{ borderColor: 'var(--color-border-panel)' }}
            >
              <h3
                className="font-bold text-lg"
                style={{ color: 'var(--color-text-primary)' }}
              >
                Move History
              </h3>
              <button
                onClick={() => setShowMoveHistory(false)}
                className="font-bold text-xl"
                style={{ color: 'var(--color-text-secondary)' }}
              >
                ×
              </button>
            </div>
            {renderMoveHistoryContent()}
          </div>
        )}
        {!showMoveHistory && (
          <div className="hidden md:block w-64 lg:w-72 order-1 shrink-0">
            <button
              onClick={() => setShowMoveHistory(true)}
              className="border-2 py-3 px-6 rounded-lg font-semibold transition-colors shadow-lg border-[var(--color-border-button)] bg-[var(--color-bg-panel)] text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]"
            >
              ☰ History
            </button>
          </div>
        )}

        {/* Board - center */}
        <div className="order-2 w-full max-w-[min(75vh,600px)] md:max-w-[480px] lg:max-w-[600px]">
          <div className="p-2 md:p-4 lg:p-8 rounded-lg shadow-lg aspect-square bg-[var(--color-bg-board)]">
            <div className="relative h-full w-full">
              <svg width="100%" height="100%" viewBox="0 0 600 600" preserveAspectRatio="xMidYMid meet" role="img" aria-label="Yinsh game board">
                {/* SVG Definitions — shadows, gradients, patterns */}
                <defs>
                  <filter id="ring-shadow">
                    <feDropShadow dx="0" dy="1" stdDeviation="1.5" floodOpacity="0.2"/>
                  </filter>
                  <radialGradient id="marker-white-grad" cx="40%" cy="40%">
                    <stop offset="0%" stopColor="#FFFFFF"/>
                    <stop offset="100%" stopColor="#e8e8e8"/>
                  </radialGradient>
                  <radialGradient id="marker-black-grad" cx="40%" cy="40%">
                    <stop offset="0%" stopColor="#4a4a4a"/>
                    <stop offset="100%" stopColor="#000000"/>
                  </radialGradient>
                  <pattern id="crosshatch" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
                    <line x1="0" y1="0" x2="0" y2="6" stroke="rgba(255,255,255,0.15)" strokeWidth="1"/>
                  </pattern>
                </defs>

                {/* Score indicators */}
                {gamePhase !== 'setup' && (
                  <>
                    {renderScoreIndicator(1, 'bottom')}
                    {renderScoreIndicator(2, 'top')}
                  </>
                )}

                {/* Grid lines */}
                {YinshBoard.generateGridPoints().map(([q, r]) => {
                  const [x, y] = axialToScreen(q, r);
                  return (
                    <g key={`${q},${r}-lines`}>
                      {[
                        [1, 0],
                        [0, 1],
                        [-1, 1]
                      ].map(([dq, dr], i) => {
                        const nextQ = q + dq;
                        const nextR = r + dr;
                        if (YinshBoard.generateGridPoints().some(([q2, r2]) => q2 === nextQ && r2 === nextR)) {
                          const [x2, y2] = axialToScreen(nextQ, nextR);
                          return (
                            <line
                              key={i}
                              x1={x}
                              y1={y}
                              x2={x2}
                              y2={y2}
                              stroke="var(--color-grid-line)"
                              strokeWidth="1.5"
                              strokeLinecap="round"
                            />
                          );
                        }
                        return null;
                      })}
                    </g>
                  );
                })}

                {/* Intersection dots */}
                {gridPoints.map(([q, r]) => {
                  const [x, y] = axialToScreen(q, r);
                  return (
                    <circle key={`dot-${q},${r}`} cx={x} cy={y} r={1.5} fill="var(--color-grid-line)" opacity={0.5} pointerEvents="none" />
                  );
                })}

                {/* Grid and pieces */}
                {gridPoints.map(([q, r]) => {
                  const [x, y] = axialToScreen(q, r);
                  const key = `${q},${r}`;
                  const piece = boardState[key];
                  const ringIsSelected = selectedRing && selectedRing[0] === q && selectedRing[1] === r;
                  const moveIsValid = validMoves.some(([vq, vr]) => vq === q && vr === r);
                  const isEntering = animatingPieces.entering.has(key);
                  const isFlipping = animatingPieces.flipping.has(key);

                  return (
                    <g
                      key={key}
                      onClick={() => handleIntersectionClick(q, r)}
                      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); handleIntersectionClick(q, r); }}}
                      role="button"
                      tabIndex={0}
                      aria-label={piece ? `${piece.player === 1 ? 'White' : 'Black'} ${piece.type} at ${q},${r}` : `Empty intersection at ${q},${r}`}
                      style={{ cursor: 'pointer', outline: 'none' }}
                    >
                      <circle cx={x} cy={y} r={22} fill="transparent" />

                      {showPossibleMoves && moveIsValid && (
                        <circle
                          cx={x}
                          cy={y}
                          r={6}
                          fill="var(--color-valid-move)"
                          opacity={0.8}
                        />
                      )}

                      {piece && piece.type === 'ring' && (
                        <g filter="url(#ring-shadow)" className={isEntering ? 'piece-enter' : ''}>
                          <circle
                            cx={x}
                            cy={y}
                            r={15}
                            fill="var(--color-ring-bg)"
                            pointerEvents="none"
                          />
                          <circle
                            cx={x}
                            cy={y}
                            r={15}
                            fill="none"
                            stroke="var(--color-ring-neutral)"
                            strokeWidth={ringIsSelected ? 7 : 6}
                            pointerEvents="none"
                          />
                          <circle
                            cx={x}
                            cy={y}
                            r={15}
                            fill="none"
                            stroke={piece.player === 1 ? 'var(--color-piece-white)' : 'var(--color-piece-black)'}
                            strokeWidth={ringIsSelected ? 5 : 4}
                            pointerEvents="none"
                          />
                          {gamePhase === 'play' && currentPlayer === piece.player && (!selectedRing || ringIsSelected) && (
                            <circle
                              cx={x}
                              cy={y}
                              r={4}
                              fill="var(--color-valid-move)"
                              pointerEvents="none"
                            />
                          )}
                          {gamePhase === 'remove-ring' && currentPlayer === piece.player && (
                            <circle
                              cx={x}
                              cy={y}
                              r={6}
                              fill="var(--color-row-highlight)"
                              pointerEvents="none"
                            />
                          )}

                          {/* AI suggestion source — amber pulsing dot */}
                          {aiSuggestion &&
                           q === aiSuggestion.from[0] &&
                           r === aiSuggestion.from[1] && (
                            <circle
                              cx={x}
                              cy={y}
                              r={7}
                              fill="var(--color-ai-suggest)"
                              className="ai-suggest-pulse"
                              pointerEvents="none"
                            />
                          )}

                        </g>
                      )}

                      {piece && piece.type === 'marker' && (
                        <g className={isEntering ? 'piece-enter' : isFlipping ? 'marker-flip' : ''}>
                          <circle
                            cx={x}
                            cy={y}
                            r={12}
                            fill={piece.player === 1 ? 'url(#marker-white-grad)' : 'url(#marker-black-grad)'}
                            stroke={piece.player === 1 ? 'var(--color-piece-white-stroke)' : 'none'}
                            strokeWidth={1}
                          />
                          {/* Crosshatch overlay on black markers for colorblind accessibility */}
                          {piece.player === 2 && (
                            <circle
                              cx={x}
                              cy={y}
                              r={12}
                              fill="url(#crosshatch)"
                              pointerEvents="none"
                            />
                          )}
                          {gamePhase === 'remove-row' && rows.some(row => {
                            if (row.markers.length === 5) {
                              return row.markers.some(([mq, mr]) => mq === q && mr === r);
                            } else {
                              const firstMarker = row.markers[0];
                              const lastMarker = row.markers[row.markers.length - 1];
                              return (
                                (q === firstMarker[0] && r === firstMarker[1]) ||
                                (q === lastMarker[0] && r === lastMarker[1])
                              );
                            }
                          }) && (
                            <circle
                              cx={x}
                              cy={y}
                              r={6}
                              fill="var(--color-row-highlight)"
                              pointerEvents="none"
                            />
                          )}
                        </g>
                      )}

                      {/* AI suggestion destination — amber dashed circle */}
                      {aiSuggestion &&
                       q === aiSuggestion.to[0] &&
                       r === aiSuggestion.to[1] && (
                        <circle
                          cx={x}
                          cy={y}
                          r={18}
                          fill="none"
                          stroke="var(--color-ai-suggest)"
                          strokeWidth="2"
                          strokeDasharray="4,3"
                          className="ai-suggest-pulse"
                          pointerEvents="none"
                        />
                      )}

                      {/* Last move origin — small purple dot */}
                      {lastMove &&
                       q === lastMove.from[0] &&
                       r === lastMove.from[1] && (
                        <circle
                          cx={x}
                          cy={y}
                          r={5}
                          fill="var(--color-ai-last-move)"
                          pointerEvents="none"
                        />
                      )}

                      {/* Last move destination — purple ring outline */}
                      {lastMove &&
                       q === lastMove.to[0] &&
                       r === lastMove.to[1] && (
                        <circle
                          cx={x}
                          cy={y}
                          r={20}
                          fill="none"
                          stroke="var(--color-ai-last-move)"
                          strokeWidth="3"
                          pointerEvents="none"
                        />
                      )}

                      {/* Flipped markers along move path — light purple dots */}
                      {lastMove?.flipped?.some(([fq, fr]) => fq === q && fr === r) && (
                        <circle
                          cx={x}
                          cy={y}
                          r={5}
                          fill="var(--color-ai-flipped)"
                          pointerEvents="none"
                        />
                      )}
                    </g>
                  );
                })}

                {/* AI suggestion connecting line — dashed amber path */}
                {aiSuggestion && aiSuggestion.from && aiSuggestion.to && (() => {
                  const [x1, y1] = axialToScreen(aiSuggestion.from[0], aiSuggestion.from[1]);
                  const [x2, y2] = axialToScreen(aiSuggestion.to[0], aiSuggestion.to[1]);
                  return (
                    <line
                      x1={x1} y1={y1} x2={x2} y2={y2}
                      stroke="var(--color-ai-suggest)"
                      strokeWidth="2"
                      strokeDasharray="6,4"
                      className="ai-suggest-pulse"
                      pointerEvents="none"
                    />
                  );
                })()}
              </svg>
            </div>
          </div>

          {/* Setup Ring Tray - outside SVG to avoid board overlap */}
          {gamePhase === 'setup' && (
            <div className="flex justify-center items-center gap-4 py-2 mt-2 rounded-lg bg-[var(--color-bg-tray)]">
              <div className="flex items-center gap-0.5">
                {renderSetupRingTray(1)}
              </div>
              <div className="w-px h-8 bg-[var(--color-border-panel)]" />
              <div className="flex items-center gap-0.5">
                {renderSetupRingTray(2)}
              </div>
            </div>
          )}
        </div>

        {/* Controls - right column on tablet+, below board on mobile */}
        <div className="order-3 w-full md:w-auto shrink-0">
          <div className="grid grid-cols-2 md:grid-cols-1 gap-2 w-full md:w-auto">
            <button
              onClick={() => setShowSettings(true)}
              className={`${btnClass} col-span-2 md:col-span-1`}
              title="Settings"
            >
              Settings
            </button>
            <button
              onClick={() => setShowModal(true)}
              className={`${btnClass} col-span-2 md:col-span-1`}
            >
              New Game
            </button>
            <button
              onClick={handleUndo}
              disabled={!yinshBoard.canUndo()}
              title="Undo (Ctrl+Z)"
              className={`${btnClass} ${!yinshBoard.canUndo() ? 'opacity-30 cursor-not-allowed' : ''}`}
            >
              Undo
            </button>
            <button
              onClick={handleRedo}
              disabled={!yinshBoard.canRedo()}
              title="Redo (Ctrl+Y)"
              className={`${btnClass} ${!yinshBoard.canRedo() ? 'opacity-30 cursor-not-allowed' : ''}`}
            >
              Redo
            </button>
            {(twoPlayerMode || (!twoPlayerMode && currentPlayer === humanPlayer && !isAiThinking)) && (
              <button
                onClick={() => getAISuggestion(false)}
                disabled={isAiThinking}
                className={`${btnClass} ${isAiThinking ? 'opacity-50 cursor-not-allowed' : ''}`}
              >
                {isAiThinking ? 'Thinking...' : 'AI Suggest'}
              </button>
            )}
            {twoPlayerMode && (
              <button
                onClick={() => aiSuggestion ? executeAIMove() : getAISuggestion(true)}
                disabled={isAiThinking}
                className={`${btnClass} ${isAiThinking ? 'opacity-50 cursor-not-allowed' : ''}`}
              >
                {isAiThinking ? 'Thinking...' : 'AI Move'}
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Mobile-only move history (collapsible) */}
      {showMoveHistory && (
        <div className="md:hidden px-4 pb-4">
          <details
            className="border-2 rounded-lg shadow-lg bg-[var(--color-bg-panel)] border-[var(--color-border-panel)]"
          >
            <summary
              className="p-3 font-semibold cursor-pointer"
              style={{ color: 'var(--color-text-secondary)' }}
            >
              Move History ({yinshBoard.getMoveHistory().length})
            </summary>
            <div className="max-h-48 flex flex-col">
              {renderMoveHistoryContent()}
            </div>
          </details>
        </div>
      )}

      {/* Win scoreboard */}
      {keepScore && (
        <div className="pb-4 text-center" style={{ color: 'var(--color-text-primary)' }}>
          <div className="text-center mb-1 text-xl font-bold">Wins</div>
          <div className="flex gap-8 items-center justify-center">
            {/* White player wins */}
            <svg width="80" height="80" viewBox="0 0 80 80">
              <circle cx="40" cy="40" r="30" fill="var(--color-ring-bg)" pointerEvents="none" />
              <circle cx="40" cy="40" r="30" fill="none" stroke="var(--color-ring-neutral)" strokeWidth="8" pointerEvents="none" />
              <circle cx="40" cy="40" r="30" fill="none" stroke="var(--color-piece-white)" strokeWidth="6" pointerEvents="none" />
              <text x="40" y="43" textAnchor="middle" className="text-3xl font-bold font-body" fill="var(--color-text-primary)" dominantBaseline="middle">
                {wins[1]}
              </text>
            </svg>
            {/* Black player wins */}
            <svg width="80" height="80" viewBox="0 0 80 80">
              <circle cx="40" cy="40" r="30" fill="var(--color-ring-bg)" pointerEvents="none" />
              <circle cx="40" cy="40" r="30" fill="none" stroke="var(--color-ring-neutral)" strokeWidth="8" pointerEvents="none" />
              <circle cx="40" cy="40" r="30" fill="none" stroke="var(--color-piece-black)" strokeWidth="6" pointerEvents="none" />
              <text x="40" y="43" textAnchor="middle" className="text-3xl font-bold font-body" fill="var(--color-text-primary)" dominantBaseline="middle">
                {wins[2]}
              </text>
            </svg>
          </div>
        </div>
      )}

      {/* Position Reviewer Panel (?positions mode) */}
      {isPositionReviewMode && (
        <div
          className="fixed top-0 left-0 bottom-0 w-72 overflow-y-auto z-30 shadow-xl border-r-2 bg-[var(--color-bg-panel)] border-[var(--color-border-panel)]"
          style={{ color: 'var(--color-text-primary)' }}
        >
          <div className="p-4">
            <h2 className="font-bold text-lg mb-3">Position Reviewer</h2>
            <div className="space-y-2">
              {testPositions.map((pos) => {
                const isActive = selectedPositionId === pos.id;
                return (
                  <button
                    key={pos.id}
                    onClick={() => loadPosition(pos.id)}
                    className={`w-full text-left p-2 rounded text-sm transition-colors ${
                      isActive
                        ? 'bg-[var(--color-bg-accent)]'
                        : 'hover:bg-[var(--color-bg-hover)]'
                    }`}
                    style={isActive ? { color: 'var(--color-accent)' } : {}}
                  >
                    <div className="font-semibold">{pos.name}</div>
                    <div style={{ color: 'var(--color-text-muted)' }} className="text-xs">{pos.id}</div>
                  </button>
                );
              })}
            </div>
          </div>
          {selectedPositionId && (() => {
            const pos = testPositions.find(p => p.id === selectedPositionId);
            if (!pos) return null;
            return (
              <div className="p-4 border-t" style={{ borderColor: 'var(--color-border-panel)' }}>
                <h3 className="font-bold mb-1">{pos.name}</h3>
                <p className="text-xs mb-3" style={{ color: 'var(--color-text-muted)' }}>{pos.description}</p>
                <div className="space-y-2 text-xs">
                  <div>
                    <span className="font-semibold text-green-500">Great:</span>
                    {pos.moves.great.map((m, i) => (
                      <div key={i} className="ml-2">[{m.from?.join(',')}] → [{m.to?.join(',')}]</div>
                    ))}
                  </div>
                  <div>
                    <span className="font-semibold text-yellow-500">Good:</span>
                    {pos.moves.good.map((m, i) => (
                      <div key={i} className="ml-2">[{m.from?.join(',')}] → [{m.to?.join(',')}]</div>
                    ))}
                  </div>
                  <div>
                    <span className="font-semibold text-red-500">Bad:</span>
                    {pos.moves.bad.map((m, i) => (
                      <div key={i} className="ml-2">[{m.from?.join(',')}] → [{m.to?.join(',')}]</div>
                    ))}
                  </div>
                </div>
              </div>
            );
          })()}
        </div>
      )}

      {/* Invalid move flash - increased opacity for better visibility on mobile */}
      <div className={`fixed inset-0 bg-red-500 pointer-events-none transition-opacity duration-150 ${showInvalidFlash ? 'opacity-20' : 'opacity-0'}`} />
    </div>
  );
};

export default YinshGame;
