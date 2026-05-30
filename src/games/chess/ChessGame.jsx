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
import { puzzlesForDifficulty, budgetPliesFor, evaluatePuzzleMove } from './coach/puzzles.js';
import { capturedPieces, materialBalance } from './coach/material.js';
import { playSound, moveSoundKind } from './coach/sound.js';
import { formatEval } from './coach/classify.js';
import { requestCommentary, setApiKey, hasApiKey } from './coach/coachClient.js';
import './chess.css';

const PIECE_GLYPH = { p: '♟', n: '♞', b: '♝', r: '♜', q: '♛', k: '♚' };

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

  // Polish (#21): eval bar, sounds.
  const [showEvalBar, setShowEvalBar] = useState(() => {
    const saved = localStorage.getItem('chessShowEvalBar');
    return saved ? JSON.parse(saved) : true;
  });
  const [soundOn, setSoundOn] = useState(() => {
    const saved = localStorage.getItem('chessSound');
    return saved ? JSON.parse(saved) : false;
  });
  const [evalWhite, setEvalWhite] = useState(0); // latest White-POV cp from analysis
  const [evalMate, setEvalMate] = useState(null);

  const { status: engineStatus, getMove, analyze } = useStockfish();
  const thinkingRef = useRef(false);
  const soundRef = useRef(soundOn); // latest value usable inside callbacks
  useEffect(() => { soundRef.current = soundOn; }, [soundOn]);
  const coachSeqRef = useRef(0); // ignores stale coaching results after new game/undo
  const transcriptRef = useRef(null);
  const fileInputRef = useRef(null);
  const [pgnError, setPgnError] = useState('');

  // Puzzle mode (#18). The pool is chosen by difficulty (mate-in-1/2/3); budget
  // is the remaining plies to force mate and shrinks as a multi-move puzzle plays.
  const [puzzleMode, setPuzzleMode] = useState(false);
  const [puzzlePool, setPuzzlePool] = useState([]);
  const [puzzleIndex, setPuzzleIndex] = useState(0);
  const [puzzleBudget, setPuzzleBudget] = useState(1);
  const [puzzleState, setPuzzleState] = useState('idle'); // idle | solving | solved | wrong
  const [puzzleMsg, setPuzzleMsg] = useState('');

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
  useEffect(() => {
    localStorage.setItem('chessShowEvalBar', JSON.stringify(showEvalBar));
  }, [showEvalBar]);
  useEffect(() => {
    localStorage.setItem('chessSound', JSON.stringify(soundOn));
  }, [soundOn]);

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
        // Update the eval bar (#21) from the post-move top line (White POV).
        const afterTop = analysisAfter && analysisAfter.lines && analysisAfter.lines[0];
        if (afterTop) {
          setEvalWhite(typeof afterTop.scoreCp === 'number' ? afterTop.scoreCp : 0);
          setEvalMate(typeof afterTop.mateIn === 'number' ? afterTop.mateIn : null);
        }
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

  // Drive the AI: whenever it's the engine's turn and the game is live, ask it.
  // Declared AFTER coachOnMove because it depends on it (avoid TDZ at render).
  useEffect(() => {
    if (puzzleMode) return; // no engine opponent while solving puzzles
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
          if (soundRef.current) playSound(moveSoundKind(applied, board.isCheck(), board.isGameOver()));
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
  }, [board, aiColor, engineStatus, difficulty, gameOver, getMove, coachOnMove, puzzleMode]);

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

  // Attempt the current puzzle. A move is correct if it keeps a forced mate
  // within the remaining budget; the engine then plays its toughest defense and
  // the player continues until mate. Coaching runs on each successful move.
  const tryPuzzleMove = useCallback(
    (from, to, promotion) => {
      if (puzzleState === 'solved') return false;
      const puzzle = puzzlePool[puzzleIndex];
      if (!puzzle) return false;

      const fenBefore = board.fen();
      const res = evaluatePuzzleMove(fenBefore, puzzleBudget, from, to, promotion || 'q');
      if (!res.legal) return false; // snap the piece back
      setSelected(null);

      if (!res.correct) {
        // Legal, but it lets the forced mate slip — snap back and hint.
        setPuzzleState('wrong');
        setPuzzleMsg(`${res.played} lets the win slip — ${puzzle.hint}`);
        return true;
      }

      // Correct: play the player's move on the real board.
      const mv = board.move(from, to, promotion || 'q');
      const fenAfterPlayer = board.fen();
      const ply = board.sanHistory().length;
      if (soundRef.current) playSound(moveSoundKind(mv, board.isCheck(), board.isGameOver()));

      if (res.solved) {
        setBoard(board.clone());
        setPuzzleState('solved');
        setPuzzleMsg(`Solved — ${res.played}! ${puzzle.theme}.`);
        coachOnMove(fenBefore, fenAfterPlayer, mv.san, mv.color, 'player-move', ply, board.sanHistory());
        return true;
      }

      // Not mate yet: engine plays its longest-resisting defense; keep solving.
      const rmv = board.move(res.reply.from, res.reply.to, res.reply.promotion);
      if (soundRef.current && rmv) playSound(moveSoundKind(rmv, board.isCheck(), false));
      setPuzzleBudget(res.budgetPlies);
      setPuzzleState('solving');
      setPuzzleMsg(`Good — ${res.played}. Now find the finish.`);
      setBoard(board.clone());
      coachOnMove(fenBefore, fenAfterPlayer, mv.san, mv.color, 'player-move', ply, board.sanHistory());
      return true;
    },
    [board, puzzlePool, puzzleIndex, puzzleBudget, puzzleState, coachOnMove]
  );

  const tryHumanMove = useCallback(
    (from, to, promotion) => {
      if (puzzleMode) {
        if (puzzleState === 'solved') return false;
        return tryPuzzleMove(from, to, promotion);
      }
      if (!humanToMove) return false;
      const fenBefore = board.fen();
      const mv = board.move(from, to, promotion || 'q');
      if (!mv) return false;
      const fenAfter = board.fen();
      const sanAfter = board.sanHistory();
      const ply = sanAfter.length;
      if (soundRef.current) playSound(moveSoundKind(mv, board.isCheck(), board.isGameOver()));
      setSelected(null);
      setBoard(board.clone());
      coachOnMove(fenBefore, fenAfter, mv.san, mv.color, 'player-move', ply, sanAfter);
      return true;
    },
    [board, humanToMove, coachOnMove, puzzleMode, puzzleState, tryPuzzleMove]
  );

  // Whether the user may move a piece right now (normal play or active puzzle).
  const canInteract = puzzleMode ? puzzleState !== 'solved' : humanToMove;

  const onPieceDrop = useCallback(
    (from, to, piece) => {
      if (!canInteract) return false;
      const isPawn = piece && piece[1] === 'P';
      const promoRank = to[1] === '8' || to[1] === '1';
      const promotion = isPawn && promoRank ? 'q' : undefined;
      return tryHumanMove(from, to, promotion);
    },
    [canInteract, tryHumanMove]
  );

  const onSquareClick = useCallback(
    (square) => {
      if (!canInteract) return;
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
    [selected, board, canInteract, tryHumanMove]
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
    setPuzzleMode(false);
    setHumanColor(c);
    setOrientation(c === 'w' ? 'white' : 'black');
    setResigned(null);
    setSelected(null);
    setDialogue([]);
    setMoveStats([]);
    setEvalWhite(0);
    setEvalMate(null);
    setCoaching(false);
    thinkingRef.current = false;
    setIsThinking(false);
    setBoard(new ChessBoard());
  };

  // Puzzle mode (#18): the pool is chosen by the difficulty tier, so the
  // difficulty selector controls puzzle hardness (mate-in-1/2/3).
  const loadPuzzle = (index) => {
    const pool = puzzlesForDifficulty(difficulty);
    const i = ((index % pool.length) + pool.length) % pool.length;
    const puzzle = pool[i];
    const next = new ChessBoard(puzzle.fen);
    coachSeqRef.current += 1;
    setPuzzlePool(pool);
    setPuzzleMode(true);
    setPuzzleIndex(i);
    setPuzzleBudget(budgetPliesFor(puzzle.mateIn));
    setPuzzleState('solving');
    setPuzzleMsg('');
    setSelected(null);
    setResigned(null);
    setDialogue([]);
    setMoveStats([]);
    setEvalWhite(0);
    setEvalMate(null);
    setCoaching(false);
    thinkingRef.current = false;
    setIsThinking(false);
    setOrientation(next.turn() === 'w' ? 'white' : 'black');
    setBoard(next);
  };
  const startPuzzles = () => loadPuzzle(0);
  const nextPuzzle = () => loadPuzzle(puzzleIndex + 1);
  const retryPuzzle = () => loadPuzzle(puzzleIndex);

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
  if (puzzleMode) {
    const puzzle = puzzlePool[puzzleIndex];
    const toMove = board.turn() === 'w' ? 'White' : 'Black';
    const movesLeft = Math.max(1, Math.ceil(puzzleBudget / 2));
    statusText =
      puzzleState === 'solved'
        ? `✓ ${puzzleMsg}`
        : puzzleState === 'wrong'
          ? puzzleMsg
          : `Puzzle ${puzzleIndex + 1}/${puzzlePool.length}: ${toMove} to play, mate in ${movesLeft}.${puzzle ? ` (${puzzle.theme})` : ''}`;
  } else if (gameResult) {
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

  // Material / captured pieces (#21).
  const boardArray = board.board();
  const capturedByWhite = capturedPieces(boardArray, 'b'); // black pieces White took
  const capturedByBlack = capturedPieces(boardArray, 'w');
  const material = materialBalance(boardArray);
  // Eval bar: White-advantage fraction [0,1]; mate pins to the extreme.
  const evalFraction = evalMate != null
    ? (evalMate > 0 ? 1 : 0)
    : 1 / (1 + Math.exp(-evalWhite / 400));
  const evalLabel = formatEval(evalWhite, evalMate);

  // A captured-pieces tray for one side, oriented to the board.
  const Tray = ({ pieces, plus }) => (
    <div className="flex items-center gap-0.5 min-h-[20px] text-lg leading-none" style={{ color: 'var(--color-text-secondary)' }}>
      {pieces.map((t, i) => (
        <span key={i}>{PIECE_GLYPH[t]}</span>
      ))}
      {plus > 0 && (
        <span className="ml-1 font-body text-xs" style={{ color: 'var(--color-text-muted)' }}>
          +{plus}
        </span>
      )}
    </div>
  );

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
              <div className="flex gap-3 w-full max-w-[600px] mx-auto">
                {showEvalBar && !puzzleMode && (
                  <div
                    className="w-3 sm:w-4 rounded overflow-hidden shrink-0 self-stretch flex flex-col"
                    style={{ backgroundColor: '#3f3f46' }}
                    title={`Evaluation ${evalLabel}`}
                    aria-label={`Evaluation ${evalLabel}`}
                  >
                    {/* Black share on top, White share on bottom (board orientation aside). */}
                    <div style={{ height: `${(1 - evalFraction) * 100}%`, transition: 'height 300ms ease' }} />
                    <div style={{ height: `${evalFraction * 100}%`, backgroundColor: '#fafafa', transition: 'height 300ms ease' }} />
                  </div>
                )}
                <div className="flex-1 min-w-0">
                  {/* Top tray = pieces captured by the side shown at top */}
                  <div className="flex items-center justify-between mb-1">
                    <Tray pieces={orientation === 'white' ? capturedByBlack : capturedByWhite} plus={0} />
                    {showEvalBar && !puzzleMode && (
                      <span className="font-body text-xs" style={{ color: 'var(--color-text-muted)' }}>
                        {material > 0 ? `White +${material}` : material < 0 ? `Black +${-material}` : 'Even'}
                      </span>
                    )}
                  </div>
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
                    arePiecesDraggable={canInteract}
                    animationDuration={200}
                  />
                  {/* Bottom tray = pieces captured by the side shown at bottom */}
                  <div className="mt-1">
                    <Tray pieces={orientation === 'white' ? capturedByWhite : capturedByBlack} plus={0} />
                  </div>
                </div>
              </div>

              {puzzleMode ? (
                <div className="flex flex-wrap gap-2 justify-center mt-4">
                  <button onClick={retryPuzzle} className="px-4 py-2 rounded-lg font-body text-sm panel">
                    Reset puzzle
                  </button>
                  <button onClick={nextPuzzle} className="px-4 py-2 rounded-lg font-body text-sm panel">
                    Next puzzle &rarr;
                  </button>
                  <button onClick={() => startGame()} className="px-4 py-2 rounded-lg font-body text-sm panel">
                    Exit puzzles
                  </button>
                </div>
              ) : (
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
                  <button onClick={startPuzzles} className="px-4 py-2 rounded-lg font-body text-sm panel">
                    Puzzles
                  </button>
                </div>
              )}
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
                <Toggle label="Evaluation bar" checked={showEvalBar} onChange={() => setShowEvalBar((v) => !v)} />
                <Toggle label="Sound" checked={soundOn} onChange={() => setSoundOn((v) => !v)} />

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
