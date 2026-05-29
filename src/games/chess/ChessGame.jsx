// ChessGame.jsx — React UI for the Chess game.
//
// Interactive react-chessboard wired to ChessBoard.js via the suite's
// click -> Board -> clone -> setState flow, now with a Stockfish opponent
// (CDN Web Worker) and adjustable difficulty tiers. The coaching dialogue
// (issues #6–#10) layers on in later increments.

import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { Link } from 'react-router-dom';
import { Chessboard } from 'react-chessboard';
import ChessBoard from './ChessBoard.js';
import useStockfish from './hooks/useStockfish.js';
import { DIFFICULTY_TIERS, DEFAULT_TIER_KEY } from './engine/difficulty.js';
import './chess.css';

const Toggle = ({ label, checked, onChange }) => (
  <div className="flex items-center justify-between gap-4">
    <span style={{ color: 'var(--color-text-primary)' }}>{label}</span>
    <button
      onClick={onChange}
      role="switch"
      aria-checked={checked}
      aria-label={label}
      className="w-10 h-6 rounded-full transition-colors relative shrink-0"
      style={{ backgroundColor: checked ? 'var(--color-accent)' : 'var(--color-border)' }}
    >
      <span
        className={`w-4 h-4 rounded-full absolute top-1 transition-all ${checked ? 'right-1' : 'left-1'}`}
        style={{ backgroundColor: '#ffffff' }}
      />
    </button>
  </div>
);

export default function ChessGame() {
  const [board, setBoard] = useState(() => new ChessBoard());
  const [darkMode, setDarkMode] = useState(() => {
    const saved = localStorage.getItem('chessDarkMode');
    return saved ? JSON.parse(saved) : false;
  });
  const [showMoves, setShowMoves] = useState(() => {
    const saved = localStorage.getItem('chessShowMoves');
    return saved ? JSON.parse(saved) : true;
  });
  const [difficulty, setDifficulty] = useState(() => {
    return localStorage.getItem('chessDifficulty') || DEFAULT_TIER_KEY;
  });
  const [humanColor, setHumanColor] = useState('w'); // 'w' | 'b'
  const [orientation, setOrientation] = useState('white');
  const [selected, setSelected] = useState(null);
  const [isThinking, setIsThinking] = useState(false);
  const [resigned, setResigned] = useState(null); // color that resigned

  const { status: engineStatus, getMove } = useStockfish();
  const thinkingRef = useRef(false);

  useEffect(() => {
    localStorage.setItem('chessDarkMode', JSON.stringify(darkMode));
  }, [darkMode]);
  useEffect(() => {
    localStorage.setItem('chessShowMoves', JSON.stringify(showMoves));
  }, [showMoves]);
  useEffect(() => {
    localStorage.setItem('chessDifficulty', difficulty);
  }, [difficulty]);

  const aiColor = humanColor === 'w' ? 'b' : 'w';
  const gameResult = resigned
    ? { over: true, type: 'resign', winner: resigned === 'w' ? 'black' : 'white' }
    : board.result();
  const gameOver = !!gameResult;
  const lastMove = board.lastMove();
  const checkedSquare = board.checkedKingSquare();
  const humanToMove = !gameOver && board.turn() === humanColor;

  // Drive the AI: whenever it's the engine's turn and the game is live, ask it.
  useEffect(() => {
    if (gameOver) return;
    if (board.turn() !== aiColor) return;
    if (engineStatus !== 'ready') return;
    if (thinkingRef.current) return;

    thinkingRef.current = true;
    setIsThinking(true);
    let cancelled = false;

    getMove(board.fen(), difficulty)
      .then((mv) => {
        if (cancelled || !mv) return;
        const applied = board.move(mv.from, mv.to, mv.promotion || 'q');
        if (applied) setBoard(board.clone());
      })
      .catch(() => {
        /* surfaced via engineStatus; leave turn to the human to retry */
      })
      .finally(() => {
        thinkingRef.current = false;
        if (!cancelled) setIsThinking(false);
      });

    return () => {
      cancelled = true;
    };
  }, [board, aiColor, engineStatus, difficulty, gameOver, getMove]);

  const squareStyles = useMemo(() => {
    const styles = {};
    if (lastMove) {
      styles[lastMove.from] = { backgroundColor: 'var(--sq-highlight)' };
      styles[lastMove.to] = { backgroundColor: 'var(--sq-highlight)' };
    }
    if (checkedSquare) {
      styles[checkedSquare] = { backgroundColor: 'var(--sq-check)' };
    }
    if (selected) {
      styles[selected] = { backgroundColor: 'var(--sq-select)' };
      if (showMoves) {
        for (const m of board.legalMovesFrom(selected)) {
          const isCapture = m.flags.includes('c') || m.flags.includes('e');
          styles[m.to] = {
            ...(styles[m.to] || {}),
            background: isCapture
              ? 'radial-gradient(circle, transparent 78%, var(--sq-legal) 80%)'
              : 'radial-gradient(circle, var(--sq-legal) 22%, transparent 24%)',
          };
        }
      }
    }
    return styles;
  }, [board, selected, showMoves, lastMove, checkedSquare]);

  const tryHumanMove = useCallback(
    (from, to, promotion) => {
      if (!humanToMove) return false;
      const mv = board.move(from, to, promotion || 'q');
      if (!mv) return false;
      setSelected(null);
      setBoard(board.clone());
      return true;
    },
    [board, humanToMove]
  );

  const onPieceDrop = useCallback(
    (from, to, piece) => {
      if (!humanToMove) return false;
      const isPawn = piece && piece[1] === 'P';
      const promoRank = to[1] === '8' || to[1] === '1';
      const promotion = isPawn && promoRank ? 'q' : undefined;
      return tryHumanMove(from, to, promotion);
    },
    [humanToMove, tryHumanMove]
  );

  const onSquareClick = useCallback(
    (square) => {
      if (!humanToMove) return;
      if (selected) {
        if (square === selected) {
          setSelected(null);
          return;
        }
        const legal = board.legalMovesFrom(selected).some((m) => m.to === square);
        if (legal) {
          tryHumanMove(selected, square);
          return;
        }
      }
      const moves = board.legalMovesFrom(square);
      // Only select own pieces (legalMovesFrom returns moves only for side to move).
      setSelected(moves.length ? square : null);
    },
    [selected, board, humanToMove, tryHumanMove]
  );

  const onPromotionPieceSelect = useCallback(
    (piece, from, to) => {
      if (!piece || !from || !to) return false;
      return tryHumanMove(from, to, piece[1].toLowerCase());
    },
    [tryHumanMove]
  );

  const startGame = (color) => {
    const c = color || (Math.random() < 0.5 ? 'w' : 'b');
    setHumanColor(c);
    setOrientation(c === 'w' ? 'white' : 'black');
    setResigned(null);
    setSelected(null);
    thinkingRef.current = false;
    setIsThinking(false);
    setBoard(new ChessBoard());
  };

  const undo = () => {
    // Undo back to the human's turn: pop AI move + human move when possible.
    if (!board.canUndo() || isThinking) return;
    board.undo();
    if (board.turn() === aiColor && board.canUndo()) board.undo();
    setSelected(null);
    setResigned(null);
    setBoard(board.clone());
  };

  const flip = () => setOrientation((o) => (o === 'white' ? 'black' : 'white'));
  const resign = () => {
    if (!gameOver) setResigned(humanColor);
  };

  const sanHistory = board.sanHistory();
  const movePairs = [];
  for (let i = 0; i < sanHistory.length; i += 2) {
    movePairs.push([sanHistory[i], sanHistory[i + 1]]);
  }

  let statusText;
  if (gameResult) {
    statusText =
      gameResult.type === 'checkmate'
        ? `Checkmate — ${gameResult.winner === 'white' ? 'White' : 'Black'} wins`
        : gameResult.type === 'resign'
          ? `${gameResult.winner === 'white' ? 'White' : 'Black'} wins by resignation`
          : gameResult.type === 'stalemate'
            ? 'Draw — stalemate'
            : gameResult.type === 'threefold'
              ? 'Draw — threefold repetition'
              : gameResult.type === 'insufficient'
                ? 'Draw — insufficient material'
                : gameResult.type === 'fifty-move'
                  ? 'Draw — fifty-move rule'
                  : 'Draw';
  } else if (engineStatus === 'loading') {
    statusText = 'Loading engine…';
  } else if (engineStatus === 'error') {
    statusText = 'Engine unavailable — check your connection and start a new game.';
  } else if (isThinking) {
    statusText = 'Stockfish is thinking…';
  } else {
    statusText = `${board.turn() === 'w' ? 'White' : 'Black'} to move${board.isCheck() ? ' — check' : ''}`;
  }

  return (
    <div className={`game-chess${darkMode ? ' dark' : ''}`}>
      <div className="min-h-screen px-4 sm:px-6 py-6">
        <div className="max-w-5xl mx-auto">
          <div className="flex items-center justify-between mb-6">
            <Link to="/" className="font-body text-sm" style={{ color: 'var(--color-text-secondary)' }}>
              &larr; GIPF Project
            </Link>
            <h1 className="font-display text-2xl font-bold tracking-wide" style={{ color: 'var(--color-text-primary)' }}>
              CHESS
            </h1>
            <div className="w-24" />
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_320px] gap-6">
            <div>
              <div className="mb-3 font-body text-sm" style={{ color: 'var(--color-text-secondary)' }} aria-live="polite">
                {statusText}
              </div>
              <div className="w-full max-w-[560px] mx-auto">
                <Chessboard
                  position={board.fen()}
                  onPieceDrop={onPieceDrop}
                  onSquareClick={onSquareClick}
                  onPromotionPieceSelect={onPromotionPieceSelect}
                  boardOrientation={orientation}
                  customSquareStyles={squareStyles}
                  customBoardStyle={{ borderRadius: '8px', boxShadow: '0 4px 16px rgba(0,0,0,0.18)' }}
                  customDarkSquareStyle={{ backgroundColor: 'var(--sq-dark)' }}
                  customLightSquareStyle={{ backgroundColor: 'var(--sq-light)' }}
                  arePiecesDraggable={humanToMove}
                />
              </div>

              <div className="flex flex-wrap gap-2 justify-center mt-4">
                <button onClick={() => startGame()} className="px-4 py-2 rounded-lg font-body text-sm panel">
                  New Game
                </button>
                <button
                  onClick={undo}
                  disabled={!board.canUndo() || isThinking}
                  className="px-4 py-2 rounded-lg font-body text-sm panel disabled:opacity-40"
                >
                  Undo
                </button>
                <button onClick={flip} className="px-4 py-2 rounded-lg font-body text-sm panel">
                  Flip
                </button>
                <button
                  onClick={resign}
                  disabled={gameOver}
                  className="px-4 py-2 rounded-lg font-body text-sm panel disabled:opacity-40"
                >
                  Resign
                </button>
              </div>
            </div>

            <div className="space-y-4">
              <div className="panel rounded-xl p-4 space-y-3">
                <h2 className="font-heading text-sm font-semibold" style={{ color: 'var(--color-text-primary)' }}>
                  Game
                </h2>
                <div>
                  <label className="block font-body text-xs mb-1" style={{ color: 'var(--color-text-secondary)' }}>
                    Difficulty
                  </label>
                  <select
                    value={difficulty}
                    onChange={(e) => setDifficulty(e.target.value)}
                    className="w-full px-3 py-2 rounded-lg font-body text-sm panel"
                    style={{ color: 'var(--color-text-primary)', backgroundColor: 'var(--color-bg-panel)' }}
                  >
                    {DIFFICULTY_TIERS.map((t) => (
                      <option key={t.key} value={t.key}>
                        {t.label} (~{t.elo})
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block font-body text-xs mb-1" style={{ color: 'var(--color-text-secondary)' }}>
                    Play as
                  </label>
                  <div className="flex gap-2">
                    <button onClick={() => startGame('w')} className="flex-1 px-3 py-2 rounded-lg font-body text-sm panel">
                      White
                    </button>
                    <button onClick={() => startGame('b')} className="flex-1 px-3 py-2 rounded-lg font-body text-sm panel">
                      Black
                    </button>
                  </div>
                </div>
              </div>

              <div className="panel rounded-xl p-4 space-y-3">
                <h2 className="font-heading text-sm font-semibold" style={{ color: 'var(--color-text-primary)' }}>
                  Settings
                </h2>
                <Toggle label="Dark mode" checked={darkMode} onChange={() => setDarkMode((v) => !v)} />
                <Toggle label="Show legal moves" checked={showMoves} onChange={() => setShowMoves((v) => !v)} />
              </div>

              <div className="panel rounded-xl p-4">
                <h2 className="font-heading text-sm font-semibold mb-2" style={{ color: 'var(--color-text-primary)' }}>
                  Moves
                </h2>
                <div className="max-h-56 overflow-y-auto font-body text-sm" style={{ color: 'var(--color-text-secondary)' }}>
                  {movePairs.length === 0 ? (
                    <p style={{ color: 'var(--color-text-muted)' }}>No moves yet.</p>
                  ) : (
                    <ol className="space-y-0.5">
                      {movePairs.map((pair, i) => (
                        <li key={i} className="flex gap-3">
                          <span style={{ color: 'var(--color-text-muted)' }} className="w-6 text-right">
                            {i + 1}.
                          </span>
                          <span className="w-16">{pair[0]}</span>
                          <span className="w-16">{pair[1] || ''}</span>
                        </li>
                      ))}
                    </ol>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
