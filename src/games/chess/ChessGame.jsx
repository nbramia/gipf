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
import { buildMovePayload } from './coach/analyzeMove.js';
import { detectOpening } from './coach/openings.js';
import { withHeaders, downloadPgn, readPgnFile, looksLikePgn } from './coach/pgn.js';
import { summarizeAccuracy } from './coach/accuracy.js';
import { requestCommentary, setApiKey, hasApiKey } from './coach/coachClient.js';
import './chess.css';

const TONE_CLASS = { great: 'tone-great', good: 'tone-good', warn: 'tone-warn', bad: 'tone-bad' };

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

  // Coaching state.
  const [dialogue, setDialogue] = useState([]); // [{id, ply, kind, san, tone, label, text, source, pending}]
  const [moveStats, setMoveStats] = useState([]); // [{ply, moverColor, cpLoss, classification}] for accuracy (#17)
  const [coaching, setCoaching] = useState(false);
  const [learningGoal, setLearningGoal] = useState(() => localStorage.getItem('chessLearningGoal') || '');
  const [apiKeyInput, setApiKeyInput] = useState('');
  const [keySet, setKeySet] = useState(() => hasApiKey());
  const [showKeyField, setShowKeyField] = useState(false);

  const { status: engineStatus, getMove, analyze } = useStockfish();
  const thinkingRef = useRef(false);
  const coachSeqRef = useRef(0); // ignores stale coaching results after new game/undo
  const transcriptRef = useRef(null);
  const fileInputRef = useRef(null);
  const [pgnError, setPgnError] = useState('');

  useEffect(() => {
    localStorage.setItem('chessDarkMode', JSON.stringify(darkMode));
  }, [darkMode]);
  useEffect(() => {
    localStorage.setItem('chessShowMoves', JSON.stringify(showMoves));
  }, [showMoves]);
  useEffect(() => {
    localStorage.setItem('chessDifficulty', difficulty);
  }, [difficulty]);
  useEffect(() => {
    localStorage.setItem('chessLearningGoal', learningGoal);
  }, [learningGoal]);

  // Auto-scroll the transcript to the newest entry.
  useEffect(() => {
    if (transcriptRef.current) {
      transcriptRef.current.scrollTop = transcriptRef.current.scrollHeight;
    }
  }, [dialogue]);

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

    const fenBefore = board.fen();
    getMove(board.fen(), difficulty)
      .then((mv) => {
        if (cancelled || !mv) return;
        const applied = board.move(mv.from, mv.to, mv.promotion || 'q');
        if (applied) {
          const fenAfter = board.fen();
          const sanAfter = board.sanHistory();
          const ply = sanAfter.length;
          setBoard(board.clone());
          coachOnMove(fenBefore, fenAfter, applied.san, applied.color, 'ai-move', ply, sanAfter);
        }
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
  }, [board, aiColor, engineStatus, difficulty, gameOver, getMove, coachOnMove]);

  // Produce coaching for a move that was just played. Runs two full-strength
  // analyses (position before + after the move) so commentary is engine-true,
  // then asks the coach (Claude or template fallback) to phrase it.
  const coachOnMove = useCallback(
    async (fenBefore, fenAfter, movePlayedSan, moverColor, kind, ply, sanAfter) => {
      const seq = coachSeqRef.current;
      const entryId = `${ply}-${kind}`;
      const opening = detectOpening(sanAfter || []);
      // Insert a pending entry immediately for responsive UX.
      setDialogue((d) => [
        ...d,
        { id: entryId, ply, kind, san: movePlayedSan, tone: 'good', label: '…', text: '', source: 'pending', pending: true },
      ]);
      setCoaching(true);
      try {
        const [analysisBefore, analysisAfter] = await Promise.all([
          analyze(fenBefore, { multipv: 3 }),
          analyze(fenAfter, { multipv: 1 }),
        ]);
        if (seq !== coachSeqRef.current) return; // superseded (new game / undo)
        const payload = buildMovePayload({
          fenBefore,
          fenAfter,
          movePlayedSan,
          moverColor,
          analysisBefore,
          analysisAfter,
          kind,
          learningGoal,
        });
        // Attach opening context (#15) so the coach can name it / flag leaving book.
        if (opening.name) payload.opening = opening.name;
        if (opening.leftBookAtPly === ply) payload.leftBook = true;
        // Record per-move accuracy data (#17), replacing any prior entry at this ply.
        setMoveStats((s) => [
          ...s.filter((x) => x.ply !== ply),
          { ply, moverColor, cpLoss: payload.cpLoss || 0, classification: payload.classification },
        ]);
        const { text, source } = await requestCommentary(payload);
        if (seq !== coachSeqRef.current) return;
        const tone =
          payload.classification === 'blunder' || payload.classification === 'mistake'
            ? 'bad'
            : payload.classification === 'inaccuracy'
              ? 'warn'
              : payload.classification === 'best' || payload.classification === 'excellent'
                ? 'great'
                : 'good';
        setDialogue((d) =>
          d.map((e) =>
            e.id === entryId
              ? {
                  ...e,
                  tone,
                  label: kind === 'player-move' ? payload.classification : 'engine',
                  text,
                  source,
                  opening: opening.name || null,
                  leftBook: opening.leftBookAtPly === ply,
                  pending: false,
                }
              : e
          )
        );
      } catch (_) {
        if (seq !== coachSeqRef.current) return;
        setDialogue((d) =>
          d.map((e) =>
            e.id === entryId
              ? { ...e, label: '', text: 'Analysis unavailable for this move.', source: 'error', pending: false }
              : e
          )
        );
      } finally {
        if (seq === coachSeqRef.current) setCoaching(false);
      }
    },
    [analyze, learningGoal]
  );

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
      const fenBefore = board.fen();
      const mv = board.move(from, to, promotion || 'q');
      if (!mv) return false;
      const fenAfter = board.fen();
      const sanAfter = board.sanHistory();
      const ply = sanAfter.length;
      setSelected(null);
      setBoard(board.clone());
      coachOnMove(fenBefore, fenAfter, mv.san, mv.color, 'player-move', ply, sanAfter);
      return true;
    },
    [board, humanToMove, coachOnMove]
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
    coachSeqRef.current += 1; // invalidate any in-flight coaching
    setHumanColor(c);
    setOrientation(c === 'w' ? 'white' : 'black');
    setResigned(null);
    setSelected(null);
    setDialogue([]);
    setMoveStats([]);
    setCoaching(false);
    thinkingRef.current = false;
    setIsThinking(false);
    setBoard(new ChessBoard());
  };

  const undo = () => {
    // Undo back to the human's turn: pop AI move + human move when possible.
    if (!board.canUndo() || isThinking) return;
    coachSeqRef.current += 1; // invalidate any in-flight coaching
    board.undo();
    if (board.turn() === aiColor && board.canUndo()) board.undo();
    setSelected(null);
    setResigned(null);
    // Drop dialogue + stats past the new ply count.
    const ply = board.sanHistory().length;
    setDialogue((d) => d.filter((e) => e.ply <= ply));
    setMoveStats((s) => s.filter((x) => x.ply <= ply));
    setCoaching(false);
    setBoard(board.clone());
  };

  const saveKey = () => {
    setApiKey(apiKeyInput.trim());
    setKeySet(hasApiKey());
    setApiKeyInput('');
    setShowKeyField(false);
  };
  const removeKey = () => {
    setApiKey('');
    setKeySet(false);
    setShowKeyField(false);
  };

  const exportPgn = () => {
    const text = withHeaders(board.pgn(), {
      white: humanColor === 'w' ? 'Human' : 'Stockfish',
      black: humanColor === 'w' ? 'Stockfish' : 'Human',
    });
    downloadPgn(text, 'gipf-chess.pgn');
  };

  const importPgn = async (e) => {
    setPgnError('');
    const file = e.target.files && e.target.files[0];
    if (!file) return;
    try {
      const text = await readPgnFile(file);
      if (!looksLikePgn(text)) {
        setPgnError("That file doesn't look like a PGN game.");
        return;
      }
      const next = new ChessBoard();
      if (!next.loadPgn(text)) {
        setPgnError('Could not parse that PGN.');
        return;
      }
      coachSeqRef.current += 1; // invalidate in-flight coaching
      setDialogue([]);
      setMoveStats([]);
      setCoaching(false);
      setSelected(null);
      setResigned(null);
      thinkingRef.current = false;
      setIsThinking(false);
      // Imported games are reviewed against Stockfish; default human = White.
      setHumanColor('w');
      setOrientation('white');
      setBoard(next);
    } catch (_) {
      setPgnError('Failed to read that file.');
    } finally {
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
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

  // Post-game accuracy summary (#17) — computed once the game is over and we
  // have at least some analysed moves.
  const accuracyReport =
    gameOver && moveStats.length > 0 ? summarizeAccuracy(moveStats) : null;
  const humanSide = accuracyReport ? (humanColor === 'w' ? accuracyReport.white : accuracyReport.black) : null;
  const aiSide = accuracyReport ? (humanColor === 'w' ? accuracyReport.black : accuracyReport.white) : null;

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
              {/* Post-game accuracy summary (#17) */}
              {accuracyReport && (
                <div className="panel rounded-xl p-4">
                  <h2 className="font-heading text-sm font-semibold mb-3" style={{ color: 'var(--color-text-primary)' }}>
                    Game summary
                  </h2>
                  <div className="grid grid-cols-2 gap-3">
                    {[
                      { label: 'You', side: humanSide },
                      { label: 'Stockfish', side: aiSide },
                    ].map(({ label, side }) => (
                      <div key={label}>
                        <div className="font-body text-xs mb-1" style={{ color: 'var(--color-text-muted)' }}>
                          {label}
                        </div>
                        <div className="font-display text-2xl font-bold" style={{ color: 'var(--color-text-primary)' }}>
                          {side && side.accuracy != null ? `${side.accuracy}%` : '—'}
                        </div>
                        <div className="font-body text-xs mt-1" style={{ color: 'var(--color-text-secondary)' }}>
                          {side
                            ? `${side.counts.blunder} blunder${side.counts.blunder === 1 ? '' : 's'}, ${side.counts.mistake} mistake${side.counts.mistake === 1 ? '' : 's'}, ${side.counts.inaccuracy} inaccurac${side.counts.inaccuracy === 1 ? 'y' : 'ies'}`
                            : ''}
                        </div>
                      </div>
                    ))}
                  </div>
                  <p className="font-body text-xs mt-3" style={{ color: 'var(--color-text-muted)' }}>
                    Accuracy from engine analysis of every move.
                  </p>
                </div>
              )}

              {/* Coaching dialogue (#8 / #10) */}
              <div className="panel rounded-xl p-4">
                <div className="flex items-center justify-between mb-2">
                  <h2 className="font-heading text-sm font-semibold" style={{ color: 'var(--color-text-primary)' }}>
                    Coach
                  </h2>
                  <span className="font-body text-xs" style={{ color: 'var(--color-text-muted)' }}>
                    {keySet ? (coaching ? 'thinking…' : 'Claude') : 'built-in'}
                  </span>
                </div>
                <div
                  ref={transcriptRef}
                  className="max-h-72 overflow-y-auto pr-1 space-y-2"
                  aria-live="polite"
                >
                  {dialogue.length === 0 ? (
                    <p className="font-body text-sm" style={{ color: 'var(--color-text-muted)' }}>
                      Make a move and I’ll explain what’s happening — your moves and mine.
                      {!keySet && ' Add your Anthropic API key below for richer coaching.'}
                    </p>
                  ) : (
                    dialogue.map((e) => (
                      <div key={e.id} className="coach-entry font-body text-sm">
                        <div className="flex items-baseline gap-2">
                          <span style={{ color: 'var(--color-text-muted)' }} className="text-xs">
                            {Math.ceil(e.ply / 2)}.{e.kind === 'ai-move' ? '..' : ''} {e.san}
                          </span>
                          {e.label && e.label !== 'engine' && (
                            <span className={`text-xs font-semibold ${TONE_CLASS[e.tone] || ''}`}>
                              {e.label}
                            </span>
                          )}
                          {e.opening && (
                            <span className="text-xs" style={{ color: 'var(--color-accent)' }}>
                              {e.opening}
                              {e.leftBook ? ' (left book)' : ''}
                            </span>
                          )}
                        </div>
                        <p style={{ color: 'var(--color-text-secondary)' }}>
                          {e.pending ? 'Analyzing…' : e.text}
                        </p>
                      </div>
                    ))
                  )}
                </div>
              </div>

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

                <div>
                  <label className="block font-body text-xs mb-1" style={{ color: 'var(--color-text-secondary)' }}>
                    What do you want to learn? (optional)
                  </label>
                  <input
                    type="text"
                    value={learningGoal}
                    onChange={(e) => setLearningGoal(e.target.value)}
                    placeholder="e.g. Italian Game openings"
                    className="w-full px-3 py-2 rounded-lg font-body text-sm panel"
                    style={{ color: 'var(--color-text-primary)', backgroundColor: 'var(--color-bg-panel)' }}
                  />
                </div>

                <div>
                  <label className="block font-body text-xs mb-1" style={{ color: 'var(--color-text-secondary)' }}>
                    Anthropic API key (for richer coaching)
                  </label>
                  {keySet && !showKeyField ? (
                    <div className="flex items-center gap-2">
                      <span className="font-body text-sm" style={{ color: 'var(--color-text-secondary)' }}>
                        Key saved ✓
                      </span>
                      <button onClick={() => setShowKeyField(true)} className="px-2 py-1 rounded font-body text-xs panel">
                        Change
                      </button>
                      <button onClick={removeKey} className="px-2 py-1 rounded font-body text-xs panel">
                        Remove
                      </button>
                    </div>
                  ) : (
                    <div className="flex gap-2">
                      <input
                        type="password"
                        value={apiKeyInput}
                        onChange={(e) => setApiKeyInput(e.target.value)}
                        placeholder="sk-ant-…"
                        className="flex-1 min-w-0 px-3 py-2 rounded-lg font-body text-sm panel"
                        style={{ color: 'var(--color-text-primary)', backgroundColor: 'var(--color-bg-panel)' }}
                      />
                      <button onClick={saveKey} disabled={!apiKeyInput.trim()} className="px-3 py-2 rounded-lg font-body text-sm panel disabled:opacity-40">
                        Save
                      </button>
                    </div>
                  )}
                  <p className="mt-1 font-body text-xs" style={{ color: 'var(--color-text-muted)' }}>
                    Stored only in your browser. Never sent anywhere but Anthropic. Coaching works without it using built-in analysis.
                  </p>
                </div>
              </div>

              <div className="panel rounded-xl p-4">
                <div className="flex items-center justify-between mb-2">
                  <h2 className="font-heading text-sm font-semibold" style={{ color: 'var(--color-text-primary)' }}>
                    Moves
                  </h2>
                  <div className="flex gap-2">
                    <button
                      onClick={exportPgn}
                      disabled={movePairs.length === 0}
                      className="px-2 py-1 rounded font-body text-xs panel disabled:opacity-40"
                    >
                      Export
                    </button>
                    <button onClick={() => fileInputRef.current && fileInputRef.current.click()} className="px-2 py-1 rounded font-body text-xs panel">
                      Import
                    </button>
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept=".pgn,text/plain"
                      onChange={importPgn}
                      className="hidden"
                    />
                  </div>
                </div>
                {pgnError && (
                  <p className="mb-2 font-body text-xs tone-bad">{pgnError}</p>
                )}
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
