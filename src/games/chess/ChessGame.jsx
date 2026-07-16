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
import useMistakeDrill from './hooks/useMistakeDrill.js';
import MistakeReviewPanel from './components/MistakeReviewPanel.jsx';
import { loadMistakes, saveMistakes, captureMistake, dueMistakes, weaknessProfile } from './coach/mistakeStore.js';
import { DIFFICULTY_TIERS, DEFAULT_TIER_KEY, RATING_LADDER } from './engine/difficulty.js';
import { DEFAULT_RATING, nearestRung, updateRating, scoreFor, isProvisional, mergeRating } from './engine/rating.js';
import { profileIdFromKey, fetchRemoteProfile, putRemoteProfile, mergeHistory, mergePuzzles, mergeMistakes } from './engine/profileSync.js';
import {
  loadOppHistory,
  saveOppHistory,
  recordGameResult,
  formatRecord,
} from './engine/playerHistory.js';
import { buildMovePayload } from './coach/analyzeMove.js';
import { detectOpening } from './coach/openings.js';
import {
  fetchOpeningStats,
  summarizeBookMove,
  OPENING_MAX_PLY,
  getLichessToken,
  setLichessToken,
  hasLichessToken,
} from './coach/openingCoach.js';
import { withHeaders, downloadPgn, readPgnFile, looksLikePgn } from './coach/pgn.js';
import { summarizeAccuracy } from './coach/accuracy.js';
import { PUZZLES, budgetPliesFor, evaluatePuzzleMove, evaluateSolutionMove } from './coach/puzzles.js';
import { loadProgress, saveProgress, recordPuzzleResult, selectSession } from './coach/puzzleProgress.js';
import { fetchDailyPuzzle } from './coach/lichessPuzzle.js';
import { hintFor, buildHintPayload, buildFailPayload, MAX_HINT_STAGE } from './coach/puzzleCoach.js';
import { capturedPieces, materialBalance } from './coach/material.js';
import { playSound, moveSoundKind } from './coach/sound.js';
import { formatEval } from './coach/classify.js';
import { requestCommentary, runThreadTurn, setApiKey, hasApiKey, getApiKey } from './coach/coachClient.js';
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
  // Rated mode: a single Elo that updates from wins/losses/draws vs ladder
  // opponents. While rated, undo/flip/coach/eval are disabled (see below) so the
  // result is honest. Color is randomized each rated game.
  const [rated, setRated] = useState(() => {
    const saved = localStorage.getItem('chessRated');
    return saved ? JSON.parse(saved) : false;
  });
  const [rating, setRating] = useState(() => {
    const saved = localStorage.getItem('chessRating');
    return saved ? JSON.parse(saved) : DEFAULT_RATING;
  });
  const [ratedGames, setRatedGames] = useState(() => {
    const saved = localStorage.getItem('chessRatedGames');
    return saved ? JSON.parse(saved) : 0;
  });
  const [ratedDelta, setRatedDelta] = useState(null); // {delta, opp} for the just-finished rated game
  // Cross-device rating sync (opt-in, keyed by a hash of the Anthropic key).
  const [syncId, setSyncId] = useState(null);
  const [syncStatus, setSyncStatus] = useState('off'); // off | local | syncing | synced | error
  const [history, setHistory] = useState(() => loadOppHistory()); // per-opponent W/L/D record
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

  // BYO Lichess token for master opening stats (the explorer is now auth-gated).
  const [lichessInput, setLichessInput] = useState('');
  const [lichessSet, setLichessSet] = useState(() => hasLichessToken());
  const [showLichessField, setShowLichessField] = useState(false);

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
  const ratedRef = useRef(rated); // latest value usable inside coachOnMove
  useEffect(() => { ratedRef.current = rated; }, [rated]);
  const ratedAppliedRef = useRef(false); // guard: score each rated game exactly once
  const historyAppliedRef = useRef(false); // guard: record opponent history once per game (casual + rated)
  const ratingRef = useRef(rating); // latest rating/games for the sync-pull closure
  const ratedGamesRef = useRef(ratedGames);
  useEffect(() => { ratingRef.current = rating; }, [rating]);
  useEffect(() => { ratedGamesRef.current = ratedGames; }, [ratedGames]);
  const coachSeqRef = useRef(0); // ignores stale coaching results after new game/undo
  const transcriptRef = useRef(null);
  const fileInputRef = useRef(null);
  const [pgnError, setPgnError] = useState('');

  // Puzzle mode (#18, overhauled #24). Sessions are adaptive: due reviews
  // first, then fresh puzzles nearest the player's puzzle rating; the Lichess
  // daily puzzle joins when reachable. Mate puzzles are solver-checked (budget
  // = remaining plies to force mate); 'solution'-kind puzzles follow a
  // scripted UCI line. Hints escalate theme -> piece; wrong attempts get
  // engine-grounded coaching. First outcome per puzzle rates + schedules it.
  const [puzzleMode, setPuzzleMode] = useState(false);
  const [puzzlePool, setPuzzlePool] = useState([]);
  const [puzzleIndex, setPuzzleIndex] = useState(0);
  const [puzzleBudget, setPuzzleBudget] = useState(1);
  const [puzzleState, setPuzzleState] = useState('idle'); // idle | solving | solved | wrong
  const [puzzleMsg, setPuzzleMsg] = useState('');
  const [puzzleSolution, setPuzzleSolution] = useState([]); // remaining scripted UCI line
  const [puzzleHintStage, setPuzzleHintStage] = useState(0);
  const [puzzleCoachMsg, setPuzzleCoachMsg] = useState('');
  const [puzzleProgressState, setPuzzleProgressState] = useState(() => loadProgress());
  const puzzleRecordedRef = useRef(new Set()); // one rating/schedule write per puzzle per session

  // Mistake library (#23): the mistakes captured this game (for the post-game
  // review panel), how many stored entries are due for drilling, and the drill
  // session itself. Capture is gated to normal play (not puzzles/drills/rated).
  const [gameMistakes, setGameMistakes] = useState([]);
  const [dueCount, setDueCount] = useState(() => dueMistakes(loadMistakes()).length);
  const puzzleModeRef = useRef(puzzleMode);
  useEffect(() => { puzzleModeRef.current = puzzleMode; }, [puzzleMode]);
  const drill = useMistakeDrill({
    analyze,
    onStoreChange: (list) => setDueCount(dueMistakes(list).length),
  });

  // Game/Settings panels auto-collapse once the first move is made, freeing the
  // screen for the board + coach. Native <details> keeps them user-toggleable.
  const [gamePanelOpen, setGamePanelOpen] = useState(true);
  const [settingsPanelOpen, setSettingsPanelOpen] = useState(true);
  const autoCollapsedRef = useRef(false);

  // Move-thread Q&A modal: the entry id whose conversation is open, the draft
  // question, busy state, and a live "analyzing …" status from tool calls.
  const [threadEntryId, setThreadEntryId] = useState(null);
  const [threadInput, setThreadInput] = useState('');
  const [threadBusy, setThreadBusy] = useState(false);
  const [threadStatus, setThreadStatus] = useState('');

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
  useEffect(() => {
    localStorage.setItem('chessRated', JSON.stringify(rated));
  }, [rated]);
  useEffect(() => {
    localStorage.setItem('chessRating', JSON.stringify(rating));
  }, [rating]);
  useEffect(() => {
    localStorage.setItem('chessRatedGames', JSON.stringify(ratedGames));
  }, [ratedGames]);

  // Derive the opaque sync id from the Anthropic key (or clear it when no key).
  useEffect(() => {
    let cancelled = false;
    const key = getApiKey();
    if (!key) {
      setSyncId(null);
      setSyncStatus('off');
      return undefined;
    }
    profileIdFromKey(key).then((id) => {
      if (!cancelled) setSyncId(id || null);
    });
    return () => { cancelled = true; };
  }, [keySet]);

  // On a fresh sync id, pull the remote profile and reconcile every domain with
  // local (rating, opponent history, puzzle progress, mistake library), then
  // write back only the domains where the merge moved past what the server had.
  // Runs once per id — reads latest local values via refs/localStorage.
  useEffect(() => {
    if (!syncId) return undefined;
    let cancelled = false;
    setSyncStatus('syncing');
    fetchRemoteProfile(syncId)
      .then((remote) => {
        if (cancelled) return;
        if (remote && remote.configured === false) {
          setSyncStatus('local'); // key present, but no store provisioned server-side
          return;
        }
        const push = {};

        const localRating = { rating: ratingRef.current, ratedGames: ratedGamesRef.current };
        const mergedRating = mergeRating(localRating, remote.rating);
        if (mergedRating !== localRating) {
          setRating(mergedRating.rating);
          setRatedGames(mergedRating.ratedGames);
        }
        if (JSON.stringify(mergedRating) !== JSON.stringify(remote.rating)) {
          push.rating = mergedRating;
        }

        const mergedHistory = mergeHistory(loadOppHistory(), remote.history);
        saveOppHistory(mergedHistory);
        setHistory(mergedHistory);
        if (JSON.stringify(mergedHistory) !== JSON.stringify(remote.history)) {
          push.history = mergedHistory;
        }

        const mergedPuzzles = mergePuzzles(loadProgress(), remote.puzzles);
        saveProgress(mergedPuzzles);
        setPuzzleProgressState(mergedPuzzles);
        if (JSON.stringify(mergedPuzzles) !== JSON.stringify(remote.puzzles)) {
          push.puzzles = mergedPuzzles;
        }

        const remoteMistakeEntries = remote.mistakes && remote.mistakes.entries;
        const mergedMistakes = mergeMistakes(loadMistakes(), remoteMistakeEntries);
        saveMistakes(mergedMistakes);
        setDueCount(dueMistakes(mergedMistakes).length);
        if (JSON.stringify(mergedMistakes) !== JSON.stringify(remoteMistakeEntries || null)) {
          push.mistakes = mergedMistakes;
        }

        if (Object.keys(push).length > 0) putRemoteProfile(syncId, push);
        setSyncStatus('synced');
      })
      .catch(() => { if (!cancelled) setSyncStatus('error'); });
    return () => { cancelled = true; };
  }, [syncId]);

  // Auto-scroll the transcript to the newest entry (now rendered at the top).
  useEffect(() => {
    if (transcriptRef.current) {
      transcriptRef.current.scrollTop = 0;
    }
  }, [dialogue]);

  // Auto-collapse Game/Settings once the first move of a game is made; re-expand
  // on a fresh game (no moves yet). User can still toggle manually in between.
  const movesPlayedCount = board.sanHistory().length;
  useEffect(() => {
    if (movesPlayedCount >= 1 && !autoCollapsedRef.current) {
      autoCollapsedRef.current = true;
      setGamePanelOpen(false);
      setSettingsPanelOpen(false);
    } else if (movesPlayedCount === 0 && autoCollapsedRef.current) {
      autoCollapsedRef.current = false;
      setGamePanelOpen(true);
      setSettingsPanelOpen(true);
    }
  }, [movesPlayedCount]);

  const aiColor = humanColor === 'w' ? 'b' : 'w';
  // Rated matchmaking: face the ladder rung nearest your rating. In casual play
  // the opponent is the chosen difficulty tier. moveSpec is what getMove uses.
  const ratedRung = useMemo(() => nearestRung(rating, RATING_LADDER), [rating]);
  const moveSpec = useMemo(
    () => (rated ? ratedRung.spec : difficulty),
    [rated, ratedRung, difficulty]
  );
  const gameResult = resigned
    ? { over: true, type: 'resign', winner: resigned === 'w' ? 'black' : 'white' }
    : board.result();
  const gameOver = !!gameResult;
  const lastMove = board.lastMove();
  const checkedSquare = board.checkedKingSquare();
  const humanToMove = !gameOver && board.turn() === humanColor;
  // The opponent identity used to key per-opponent history: the matched rated
  // rung, or the chosen casual difficulty tier.
  const opponentKey = rated ? String(ratedRung.rating) : difficulty;

  // Score a finished rated game exactly once: derive win/loss/draw from the
  // human's POV, update the Elo against the matched rung, and record the delta.
  useEffect(() => {
    if (!rated || puzzleMode || !gameResult || ratedAppliedRef.current) return;
    ratedAppliedRef.current = true;
    const humanWord = humanColor === 'w' ? 'white' : 'black';
    const result = gameResult.winner == null
      ? 'draw'
      : gameResult.winner === humanWord
        ? 'win'
        : 'loss';
    const opp = ratedRung.rating;
    const { rating: next, delta } = updateRating(rating, opp, scoreFor(result), ratedGames);
    setRating(next);
    setRatedGames((g) => g + 1);
    setRatedDelta({ delta, opp });
    // cross-device write-through
    if (syncId) putRemoteProfile(syncId, { rating: { rating: next, ratedGames: ratedGames + 1 } });
  }, [rated, puzzleMode, gameResult, humanColor, ratedRung, rating, ratedGames, syncId]);

  // Record per-opponent history at every game end (casual and rated), once per
  // game. Independent of rated scoring so casual games are tracked too; skipped
  // in puzzle mode and mistake drills (those aren't games vs an opponent).
  useEffect(() => {
    if (puzzleMode || drill.active || !gameResult || historyAppliedRef.current) return;
    historyAppliedRef.current = true;
    const humanWord = humanColor === 'w' ? 'white' : 'black';
    const result = gameResult.winner == null
      ? 'draw'
      : gameResult.winner === humanWord
        ? 'win'
        : 'loss';
    const h = recordGameResult(loadOppHistory(), { rated, opponentKey, result });
    saveOppHistory(h);
    setHistory(h);
    // Mistakes accumulated during the game get synced at game end too.
    if (syncId) putRemoteProfile(syncId, { history: h, mistakes: loadMistakes() });
  }, [puzzleMode, drill.active, gameResult, humanColor, rated, opponentKey, syncId]);

  // Produce coaching for a move that was just played. Runs two full-strength
  // analyses (position before + after the move) so commentary is engine-true,
  // then asks the coach (Claude or template fallback) to phrase it.
  const coachOnMove = useCallback(
    async (fenBefore, fenAfter, movePlayedSan, moverColor, kind, ply, sanAfter) => {
      if (ratedRef.current) return; // rated games are uncoached — no hints, no eval leak
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

        // Attach the player's recurring-weakness profile (#23) so the coach can
        // connect this move to patterns from earlier games.
        if (kind === 'player-move') {
          const weakness = weaknessProfile(loadMistakes());
          if (weakness) payload.weaknessProfile = weakness;
        }

        // Realistic opening coaching: openings have many sound paths, so don't
        // judge them by eval-loss vs. the single engine top move. Two layers:
        //  (1) Baseline (always available): if we're in the opening and the move
        //      isn't a real eval blunder, treat it as a sound book move.
        //  (2) Enhancement (when Lichess is reachable): attach real master-game
        //      popularity + alternatives so the prose reflects what humans play.
        const inOpening = ply <= OPENING_MAX_PLY;
        if (inOpening) {
          payload.inOpening = true;
          // A move is a sound "book" move — never inaccuracy/mistake — if EITHER
          // it's a recognized opening in our ECO table (deterministic, no deps),
          // OR it's within a generous eval band of best. (cpLoss is mover's POV.)
          const SOUND_OPENING_BAND = 90; // centipawns
          const recognizedOpening = opening.inBook; // still in known theory after this move
          if (
            (recognizedOpening || (payload.cpLoss || 0) <= SOUND_OPENING_BAND) &&
            ['good', 'inaccuracy', 'mistake'].includes(payload.classification)
          ) {
            payload.classification = 'book';
          }
          // Enhancement: real master practice (degrades to null if unreachable).
          const stats = await fetchOpeningStats(fenBefore);
          if (seq !== coachSeqRef.current) return;
          const book = summarizeBookMove(stats, movePlayedSan, moverColor);
          if (book) {
            payload.openingStats = book;
            // A recognized master move is book regardless of eval band.
            if (['good', 'inaccuracy', 'mistake'].includes(payload.classification)) {
              payload.classification = 'book';
            }
          }
        }

        // Mistake library (#23): capture human mistakes/blunders as replayable
        // drills. Normal games only — puzzle moves are excluded here, drill
        // moves never reach coachOnMove, and rated games return early above.
        if (
          kind === 'player-move' &&
          !puzzleModeRef.current &&
          (payload.classification === 'mistake' || payload.classification === 'blunder') &&
          payload.bestMove
        ) {
          const { list, entry } = captureMistake(loadMistakes(), {
            fenBefore,
            movePlayed: movePlayedSan,
            bestSan: payload.bestMove.san,
            bestPv: payload.bestMove.pv || [],
            cpLoss: payload.cpLoss || 0,
            classification: payload.classification,
            opening: opening.name || null,
            moveNo: Math.ceil(ply / 2),
          });
          saveMistakes(list);
          setGameMistakes((g) => [...g.filter((e) => e.id !== entry.id), entry]);
          setDueCount(dueMistakes(list).length);
        }

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
                : 'good'; // includes 'book'
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
                  // Context for follow-up Q&A threads (tool-use grounding).
                  analysis: {
                    fenBefore,
                    fenAfter,
                    movePlayed: payload.movePlayed && payload.movePlayed.san,
                    classification: payload.classification,
                    evalBefore: payload.evalBefore,
                    evalAfter: payload.evalAfter,
                    bestMove: payload.bestMove
                      ? `${payload.bestMove.san} (${payload.bestMove.eval})`
                      : undefined,
                    opening: opening.name || undefined,
                    commentary: text,
                  },
                  thread: [], // Anthropic message history for this move's conversation
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
    if (drill.active) return; // no engine opponent while drilling mistakes
    if (gameOver) return;
    if (board.turn() !== aiColor) return;
    if (engineStatus !== 'ready') return;
    if (thinkingRef.current) return;

    thinkingRef.current = true;
    setIsThinking(true);
    let cancelled = false;

    const fenBefore = board.fen();
    getMove(board.fen(), moveSpec)
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
  }, [board, aiColor, engineStatus, moveSpec, gameOver, getMove, coachOnMove, puzzleMode, drill.active]);

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
      const res =
        puzzle.kind === 'solution'
          ? evaluateSolutionMove(fenBefore, puzzleSolution, from, to, promotion || 'q')
          : evaluatePuzzleMove(fenBefore, puzzleBudget, from, to, promotion || 'q');
      if (!res.legal) return false; // snap the piece back
      setSelected(null);

      if (!res.correct) {
        // Legal, but it fails the puzzle — snap back, rate it, and coach the
        // refutation (#24). Retries stay open as practice.
        recordPuzzleOutcome(puzzle, false);
        setPuzzleState('wrong');
        setPuzzleMsg(
          puzzle.kind === 'solution'
            ? `${res.played} isn't it — try again.`
            : `${res.played} lets the win slip — ${puzzle.hint}`
        );
        coachPuzzleFail(puzzle, fenBefore, from, to, promotion, res.played);
        return true;
      }

      // Correct: play the player's move on the real board.
      const mv = board.move(from, to, promotion || 'q');
      const fenAfterPlayer = board.fen();
      const ply = board.sanHistory().length;
      if (soundRef.current) playSound(moveSoundKind(mv, board.isCheck(), board.isGameOver()));

      if (res.solved) {
        recordPuzzleOutcome(puzzle, true);
        setBoard(board.clone());
        setPuzzleState('solved');
        setPuzzleMsg(`Solved — ${res.played}! ${puzzle.theme}.`);
        setPuzzleCoachMsg('');
        coachOnMove(fenBefore, fenAfterPlayer, mv.san, mv.color, 'player-move', ply, board.sanHistory());
        return true;
      }

      // Not solved yet: the reply comes from the solver (mate puzzles, the
      // longest-resisting defense) or the script (solution puzzles).
      const rmv = board.move(res.reply.from, res.reply.to, res.reply.promotion);
      if (soundRef.current && rmv) playSound(moveSoundKind(rmv, board.isCheck(), false));
      if (puzzle.kind === 'solution') setPuzzleSolution(res.solution);
      else setPuzzleBudget(res.budgetPlies);
      setPuzzleState('solving');
      setPuzzleMsg(`Good — ${res.played}. Now find the finish.`);
      setBoard(board.clone());
      coachOnMove(fenBefore, fenAfterPlayer, mv.san, mv.color, 'player-move', ply, board.sanHistory());
      return true;
    },
    // recordPuzzleOutcome/coachPuzzleFail read fresh state via refs/storage,
    // so only the directly-closed-over state is listed here.
    [board, puzzlePool, puzzleIndex, puzzleBudget, puzzleSolution, puzzleState, coachOnMove]
  );

  // Attempt a drill move (#23): apply optimistically (drop callbacks must
  // answer synchronously), then let the hook judge it; wrong moves roll back.
  const tryDrillMove = useCallback(
    (from, to, promotion) => {
      if (drill.state !== 'solving') return false;
      const mv = board.move(from, to, promotion || 'q');
      if (!mv) return false;
      setSelected(null);
      if (soundRef.current) playSound(moveSoundKind(mv, board.isCheck(), board.isGameOver()));
      setBoard(board.clone());
      drill.evaluate(from, to, promotion || 'q').then((res) => {
        if (!res || res.stale || !res.legal) return;
        if (!res.correct) {
          board.undo();
          setBoard(board.clone());
        }
      });
      return true;
    },
    [board, drill]
  );

  const tryHumanMove = useCallback(
    (from, to, promotion) => {
      if (drill.active) {
        return tryDrillMove(from, to, promotion);
      }
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
    [board, humanToMove, coachOnMove, puzzleMode, puzzleState, tryPuzzleMove, drill.active, tryDrillMove]
  );

  // Whether the user may move a piece right now (normal play, puzzle, or drill).
  const canInteract = drill.active
    ? drill.state === 'solving'
    : puzzleMode
      ? puzzleState !== 'solved'
      : humanToMove;

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
    ratedAppliedRef.current = false;
    historyAppliedRef.current = false;
    setRatedDelta(null);
    setPuzzleMode(false);
    drill.exit();
    setGameMistakes([]);
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

  // Switch rated mode on/off. Always starts a fresh game so a half-played
  // casual position is never scored (and vice-versa).
  const toggleRated = () => {
    setRated((v) => !v);
    startGame();
  };

  // Puzzle mode (#18, overhauled #24): sessions come from the adaptive
  // selector over the whole bank (due reviews first, then fresh puzzles
  // nearest the player's rating); the difficulty tier no longer gates them.
  const loadPuzzleFrom = (pool, index) => {
    if (!pool.length) return;
    const i = ((index % pool.length) + pool.length) % pool.length;
    const puzzle = pool[i];
    const next = new ChessBoard(puzzle.fen);
    coachSeqRef.current += 1;
    drill.exit();
    setGameMistakes([]);
    setPuzzlePool(pool);
    setPuzzleMode(true);
    setPuzzleIndex(i);
    setPuzzleBudget(puzzle.mateIn ? budgetPliesFor(puzzle.mateIn) : 1);
    setPuzzleSolution(puzzle.solution || []);
    setPuzzleHintStage(0);
    setPuzzleCoachMsg('');
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
  const startPuzzles = () => {
    const progress = loadProgress();
    setPuzzleProgressState(progress);
    puzzleRecordedRef.current = new Set();
    loadPuzzleFrom(selectSession(progress, PUZZLES), 0);
    // The Lichess daily puzzle joins the session when reachable (and not
    // already solved recently); offline it just isn't there.
    fetchDailyPuzzle().then((daily) => {
      if (!daily) return;
      const rec = progress.puzzles[daily.id];
      if (rec && (rec.nextDueAt || 0) > Date.now()) return;
      setPuzzlePool((cur) =>
        cur.length && !cur.some((p) => p.id === daily.id) ? [...cur, daily] : cur
      );
    });
  };
  const nextPuzzle = () => loadPuzzleFrom(puzzlePool, puzzleIndex + 1);
  const retryPuzzle = () => loadPuzzleFrom(puzzlePool, puzzleIndex);

  // First outcome per puzzle per session rates the player and (re)schedules
  // the puzzle; retries and further attempts are practice.
  const recordPuzzleOutcome = (puzzle, solved) => {
    if (!puzzle || puzzleRecordedRef.current.has(puzzle.id)) return;
    puzzleRecordedRef.current.add(puzzle.id);
    const next = recordPuzzleResult(loadProgress(), puzzle, solved);
    saveProgress(next);
    setPuzzleProgressState(next);
    if (syncId) putRemoteProfile(syncId, { puzzles: next });
  };

  // Coaching after a failed attempt (#24): analyze the position the wrong
  // move creates and explain the refutation — never the solution. Works
  // keyless via the deterministic template.
  const coachPuzzleFail = (puzzle, fenBefore, from, to, promotion, playedSan) => {
    const tmp = new ChessBoard(fenBefore);
    if (!tmp.move(from, to, promotion || 'q')) return;
    const fenAfter = tmp.fen();
    const seq = coachSeqRef.current;
    analyze(fenAfter, { multipv: 1 })
      .then((analysisAfter) => {
        if (seq !== coachSeqRef.current) return;
        const payload = buildFailPayload({ puzzle, fen: fenBefore, fenAfter, playedSan, analysisAfter });
        return requestCommentary(payload).then(({ text }) => {
          if (seq === coachSeqRef.current && text) setPuzzleCoachMsg(text);
        });
      })
      .catch(() => {});
  };

  // Staged hints (#24): theme first, then the key piece + square. The piece
  // hint spends the puzzle (counts as a miss). Claude rephrases when a key is
  // set; the deterministic text is shown either way.
  const requestPuzzleHint = () => {
    const puzzle = puzzlePool[puzzleIndex];
    if (!puzzle || puzzleState === 'solved') return;
    const stage = Math.min(puzzleHintStage + 1, MAX_HINT_STAGE);
    setPuzzleHintStage(stage);
    setPuzzleCoachMsg(`Hint: ${hintFor(puzzle, stage, board.fen())}`);
    if (stage >= MAX_HINT_STAGE) recordPuzzleOutcome(puzzle, false);
    const seq = coachSeqRef.current;
    requestCommentary(buildHintPayload(puzzle, stage, board.fen())).then(({ text, source }) => {
      if (seq === coachSeqRef.current && source === 'claude' && text) {
        setPuzzleCoachMsg(`Hint: ${text}`);
      }
    });
  };

  // Mistake drills (#23): load an entry's position; the drill hook owns the
  // session state, this glue owns the board.
  const loadDrillBoard = (entry) => {
    const next = new ChessBoard(entry.fenBefore);
    setOrientation(next.turn() === 'w' ? 'white' : 'black');
    setSelected(null);
    setBoard(next);
  };
  const startDrills = (entries) => {
    const first = drill.start(entries);
    if (!first) return;
    coachSeqRef.current += 1; // invalidate any in-flight coaching
    setPuzzleMode(false);
    setResigned(null);
    setDialogue([]);
    setMoveStats([]);
    setEvalWhite(0);
    setEvalMate(null);
    setCoaching(false);
    thinkingRef.current = false;
    setIsThinking(false);
    loadDrillBoard(first);
  };
  const trainMistakes = () => startDrills(dueMistakes(loadMistakes()));
  const retryMistake = (entry) => startDrills([entry]);
  const nextDrill = () => {
    const entry = drill.next();
    if (entry) loadDrillBoard(entry);
    else startGame(humanColor);
  };
  const exitDrills = () => startGame(humanColor);

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

  const saveLichess = () => {
    setLichessToken(lichessInput.trim());
    setLichessSet(hasLichessToken());
    setLichessInput('');
    setShowLichessField(false);
  };
  const removeLichess = () => {
    setLichessToken('');
    setLichessSet(false);
    setShowLichessField(false);
  };

  // --- Move-thread Q&A (tool-use) ---
  const threadEntry = dialogue.find((e) => e.id === threadEntryId) || null;

  const sendThreadQuestion = useCallback(async () => {
    const question = threadInput.trim();
    if (!question || threadBusy) return;
    const entry = dialogue.find((e) => e.id === threadEntryId);
    if (!entry || !entry.analysis) return;

    setThreadBusy(true);
    setThreadStatus('');
    setThreadInput('');
    // Optimistically show the user's question in the thread.
    setDialogue((d) =>
      d.map((e) =>
        e.id === threadEntryId
          ? { ...e, thread: [...(e.thread || []), { role: 'user', content: question }] }
          : e
      )
    );

    const result = await runThreadTurn({
      context: entry.analysis,
      history: entry.threadApi || [],
      question,
      analyze,
      onToolCall: (input) => {
        const where = input && input.from === 'after' ? 'resulting position' : 'this position';
        const line = input && input.moves && input.moves.length ? input.moves.join(' ') : '';
        setThreadStatus(`Analyzing ${line ? line + ' from ' : ''}${where}…`);
      },
    });

    setDialogue((d) =>
      d.map((e) =>
        e.id === threadEntryId
          ? {
              ...e,
              thread: [...(e.thread || []), { role: 'assistant', content: result.text }],
              threadApi: result.messages || e.threadApi, // full Anthropic history for continuity
            }
          : e
      )
    );
    setThreadStatus('');
    setThreadBusy(false);
  }, [threadInput, threadBusy, dialogue, threadEntryId, analyze]);

  // Close the thread modal on Escape.
  useEffect(() => {
    if (!threadEntryId) return undefined;
    const onKey = (e) => {
      if (e.key === 'Escape') setThreadEntryId(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [threadEntryId]);

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
      drill.exit();
      setGameMistakes([]);
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
  if (drill.active) {
    const e = drill.entry;
    statusText = e
      ? `Mistake ${drill.index + 1}/${drill.total}: you played ${e.movePlayed} here${e.opening ? ` (${e.opening})` : ''}. Find a better move.`
      : 'No mistakes to drill.';
  } else if (puzzleMode) {
    const puzzle = puzzlePool[puzzleIndex];
    const toMove = board.turn() === 'w' ? 'White' : 'Black';
    const movesLeft = Math.max(1, Math.ceil(puzzleBudget / 2));
    statusText =
      puzzleState === 'solved'
        ? `✓ ${puzzleMsg}`
        : puzzleState === 'wrong'
          ? puzzleMsg
          : puzzle && puzzle.kind === 'solution'
            ? `Puzzle ${puzzleIndex + 1}/${puzzlePool.length}: ${toMove} to play — find the best move. (${puzzle.theme} · rated ${puzzle.rating})`
            : `Puzzle ${puzzleIndex + 1}/${puzzlePool.length}: ${toMove} to play, mate in ${movesLeft}.${puzzle ? ` (${puzzle.theme} · rated ${puzzle.rating})` : ''}`;
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
        <div className="max-w-[1400px] mx-auto">
          <div className="flex items-center justify-between mb-6">
            <Link to="/" className="font-body text-sm" style={{ color: 'var(--color-text-secondary)' }}>
              &larr; GIPF Project
            </Link>
            <h1 className="font-display text-2xl font-bold tracking-wide" style={{ color: 'var(--color-text-primary)' }}>
              CHESS
            </h1>
            <div className="w-24" />
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 items-start">
            <div>
              <div className="mb-3 font-body text-sm" style={{ color: 'var(--color-text-secondary)' }} aria-live="polite">
                {statusText}
              </div>
              {gameOver && !puzzleMode && !drill.active && formatRecord(history, rated, opponentKey) && (
                <div className="mb-3 font-body text-xs" style={{ color: 'var(--color-text-muted)' }}>
                  Record vs this opponent: {formatRecord(history, rated, opponentKey)}
                </div>
              )}
              {rated && (
                <div className="mb-3 flex items-center gap-2 font-body text-sm" aria-live="polite">
                  <span className="px-2 py-0.5 rounded font-semibold" style={{ backgroundColor: 'var(--color-accent-soft)', color: 'var(--color-text-primary)' }}>
                    Rated
                  </span>
                  <span style={{ color: 'var(--color-text-secondary)' }}>
                    You {rating}{isProvisional(ratedGames) ? '?' : ''} · Opponent {ratedRung.rating}
                  </span>
                  {ratedDelta && (
                    <span
                      className="font-semibold"
                      style={{ color: ratedDelta.delta >= 0 ? 'var(--color-accent)' : 'var(--tone-bad, #dc2626)' }}
                    >
                      {ratedDelta.delta >= 0 ? `+${ratedDelta.delta}` : ratedDelta.delta}
                    </span>
                  )}
                </div>
              )}
              <div className="flex gap-3 w-full max-w-[680px] mx-auto">
                {showEvalBar && !puzzleMode && !drill.active && !rated && (
                  <div
                    className="w-3 sm:w-4 rounded overflow-hidden shrink-0 self-stretch flex flex-col border"
                    style={{ backgroundColor: '#3f3f46', borderColor: 'var(--color-border)' }}
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
                    {showEvalBar && !puzzleMode && !drill.active && !rated && (
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
                    customNotationStyle={{
                      color: '#ffffff',
                      fontWeight: 700,
                      textShadow:
                        '0 0 2px rgba(0,0,0,0.85), 0 1px 1px rgba(0,0,0,0.7), 0 -1px 1px rgba(0,0,0,0.7)',
                    }}
                    arePiecesDraggable={canInteract}
                    animationDuration={200}
                  />
                  {/* Bottom tray = pieces captured by the side shown at bottom */}
                  <div className="mt-1">
                    <Tray pieces={orientation === 'white' ? capturedByWhite : capturedByBlack} plus={0} />
                  </div>
                </div>
              </div>

              {drill.active ? (
                <>
                  <div className="flex flex-wrap gap-2 justify-center mt-4">
                    <button
                      onClick={drill.reveal}
                      disabled={drill.state !== 'solving'}
                      className="px-4 py-2 rounded-lg font-body text-sm panel disabled:opacity-40"
                    >
                      Show solution
                    </button>
                    <button onClick={nextDrill} className="px-4 py-2 rounded-lg font-body text-sm panel">
                      {drill.index + 1 < drill.total ? 'Next mistake →' : 'Finish'}
                    </button>
                    <button onClick={exitDrills} className="px-4 py-2 rounded-lg font-body text-sm panel">
                      Exit drills
                    </button>
                  </div>
                  {drill.message && (
                    <p
                      className="mt-3 font-body text-sm text-center w-full max-w-[680px] mx-auto"
                      style={{ color: 'var(--color-text-secondary)' }}
                      aria-live="polite"
                    >
                      {drill.message}
                    </p>
                  )}
                </>
              ) : puzzleMode ? (
                <>
                  <div className="flex flex-wrap gap-2 justify-center mt-4">
                    <button
                      onClick={requestPuzzleHint}
                      disabled={puzzleState === 'solved' || puzzleHintStage >= MAX_HINT_STAGE}
                      className="px-4 py-2 rounded-lg font-body text-sm panel disabled:opacity-40"
                      title={puzzleHintStage === 0 ? 'Theme hint (free)' : 'Piece hint (counts as a miss)'}
                    >
                      Hint{puzzleHintStage > 0 ? ` (${puzzleHintStage}/${MAX_HINT_STAGE})` : ''}
                    </button>
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
                  {puzzleCoachMsg && (
                    <p
                      className="mt-3 font-body text-sm text-center w-full max-w-[680px] mx-auto"
                      style={{ color: 'var(--color-text-secondary)' }}
                      aria-live="polite"
                    >
                      {puzzleCoachMsg}
                    </p>
                  )}
                  <p className="mt-2 font-body text-xs text-center" style={{ color: 'var(--color-text-muted)' }}>
                    Your puzzle rating: {puzzleProgressState.rating}
                  </p>
                </>
              ) : (
                <div className="flex flex-wrap gap-2 justify-center mt-4">
                  <button onClick={() => startGame()} className="px-4 py-2 rounded-lg font-body text-sm panel">
                    {rated ? 'New Rated Game' : 'New Game'}
                  </button>
                  {!rated && (
                    <button
                      onClick={undo}
                      disabled={!board.canUndo() || isThinking}
                      className="px-4 py-2 rounded-lg font-body text-sm panel disabled:opacity-40"
                    >
                      Undo
                    </button>
                  )}
                  {!rated && (
                    <button onClick={flip} className="px-4 py-2 rounded-lg font-body text-sm panel">
                      Flip
                    </button>
                  )}
                  <button
                    onClick={resign}
                    disabled={gameOver}
                    className="px-4 py-2 rounded-lg font-body text-sm panel disabled:opacity-40"
                  >
                    Resign
                  </button>
                  {!rated && (
                    <button onClick={startPuzzles} className="px-4 py-2 rounded-lg font-body text-sm panel">
                      Puzzles
                    </button>
                  )}
                  {!rated && (
                    <button
                      onClick={trainMistakes}
                      disabled={dueCount === 0}
                      className="px-4 py-2 rounded-lg font-body text-sm panel disabled:opacity-40"
                      title={dueCount === 0 ? 'No mistakes due for review — play some games first' : undefined}
                    >
                      Train my mistakes{dueCount > 0 ? ` (${dueCount})` : ''}
                    </button>
                  )}
                </div>
              )}

              {/* Moves — below the board */}
              <div className="panel rounded-xl p-4 mt-4 w-full max-w-[680px] mx-auto">
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

            <div className="flex flex-col gap-4 lg:min-h-[calc(100vh-7rem)]">
              {/* Post-game mistake review (#23) — retry this game's mistakes */}
              {accuracyReport && !rated && gameMistakes.length > 0 && (
                <MistakeReviewPanel mistakes={gameMistakes} onRetry={retryMistake} />
              )}

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

              {/* Coaching dialogue (#8 / #10) — grows to fill remaining height.
                  Hidden in rated mode: live coaching would leak best moves. */}
              {rated ? (
                <div className="panel rounded-xl p-4 flex-1 min-h-0 flex items-center justify-center text-center">
                  <p className="font-body text-sm" style={{ color: 'var(--color-text-muted)' }}>
                    Coaching, the evaluation bar, undo and flip are off in rated games.
                    Toggle Rated off in the Game panel to practice with the coach.
                  </p>
                </div>
              ) : (
              <div className="panel rounded-xl p-4 flex flex-col flex-1 min-h-0">
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
                  className="flex-1 min-h-0 overflow-y-auto pr-1 space-y-2 max-h-[55vh] lg:max-h-none"
                  aria-live="polite"
                >
                  {dialogue.length === 0 ? (
                    <p className="font-body text-sm" style={{ color: 'var(--color-text-muted)' }}>
                      Make a move and I’ll explain what’s happening — your moves and mine.
                      {!keySet && ' Add your Anthropic API key below for richer coaching.'}
                    </p>
                  ) : (
                    dialogue.slice().reverse().map((e) => (
                      <div
                        key={e.id}
                        className={`coach-entry font-body text-sm ${
                          e.kind === 'ai-move' ? 'coach-entry--opp' : 'coach-entry--mine'
                        }`}
                      >
                        <div className="flex items-baseline gap-2">
                          <span
                            className="coach-who text-[10px] font-semibold uppercase tracking-wide"
                          >
                            {e.kind === 'ai-move' ? 'Opponent' : 'You'}
                          </span>
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
                        {!e.pending && e.analysis && (
                          <button
                            onClick={() => setThreadEntryId(e.id)}
                            className="mt-1 text-xs font-body"
                            style={{ color: 'var(--color-accent)' }}
                          >
                            {e.thread && e.thread.length
                              ? `Continue (${e.thread.filter((m) => m.role === 'user').length})`
                              : 'Ask about this move'} →
                          </button>
                        )}
                      </div>
                    ))
                  )}
                </div>
              </div>
              )}

              <details
                className="panel rounded-xl p-4"
                open={gamePanelOpen}
                onToggle={(e) => setGamePanelOpen(e.currentTarget.open)}
              >
                <summary className="font-heading text-sm font-semibold cursor-pointer select-none" style={{ color: 'var(--color-text-primary)' }}>
                  Game
                </summary>
                <div className="space-y-3 mt-3">
                <Toggle label="Rated mode" checked={rated} onChange={toggleRated} />

                {rated ? (
                  <div className="rounded-lg p-3" style={{ backgroundColor: 'var(--color-bg-panel)' }}>
                    <div className="flex items-baseline justify-between">
                      <span className="font-body text-xs" style={{ color: 'var(--color-text-secondary)' }}>
                        Your rating
                      </span>
                      <span className="font-display text-2xl font-bold" style={{ color: 'var(--color-text-primary)' }}>
                        {rating}
                      </span>
                    </div>
                    <p className="font-body text-xs mt-1" style={{ color: 'var(--color-text-muted)' }}>
                      {isProvisional(ratedGames)
                        ? `Provisional — ${ratedGames}/20 games played. Facing ${ratedRung.rating}.`
                        : `${ratedGames} games played. Facing ${ratedRung.rating}.`}
                    </p>
                    {formatRecord(history, true, String(ratedRung.rating)) && (
                      <p className="font-body text-xs mt-1" style={{ color: 'var(--color-text-muted)' }}>
                        Record: {formatRecord(history, true, String(ratedRung.rating))}
                      </p>
                    )}
                    <p className="font-body text-xs mt-2" style={{ color: 'var(--color-text-muted)' }}>
                      Random color each game. Undo, flip, and coaching are disabled so the result is honest. Resigning counts as a loss.
                    </p>
                    <p
                      className="font-body text-xs mt-2"
                      style={{ color: syncStatus === 'synced' ? 'var(--color-accent)' : 'var(--color-text-muted)' }}
                    >
                      {syncStatus === 'synced' && '☁ Synced to your API key — your rating follows you across devices.'}
                      {syncStatus === 'syncing' && '☁ Syncing…'}
                      {syncStatus === 'error' && '⚠ Couldn’t reach the rating store — using your rating on this device.'}
                      {syncStatus === 'local' && 'Saved on this device. (Rating sync isn’t configured on the server.)'}
                      {syncStatus === 'off' && 'Add an Anthropic API key in Settings to sync your rating across devices.'}
                    </p>
                  </div>
                ) : (
                  <>
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
                      {formatRecord(history, false, difficulty) && (
                        <p className="font-body text-xs mt-1" style={{ color: 'var(--color-text-muted)' }}>
                          Record: {formatRecord(history, false, difficulty)}
                        </p>
                      )}
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
                  </>
                )}
                </div>
              </details>

              <details
                className="panel rounded-xl p-4"
                open={settingsPanelOpen}
                onToggle={(e) => setSettingsPanelOpen(e.currentTarget.open)}
              >
                <summary className="font-heading text-sm font-semibold cursor-pointer select-none" style={{ color: 'var(--color-text-primary)' }}>
                  Settings
                </summary>
                <div className="space-y-3 mt-3">
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

                <div>
                  <label className="block font-body text-xs mb-1" style={{ color: 'var(--color-text-secondary)' }}>
                    Lichess token (for master opening stats)
                  </label>
                  {lichessSet && !showLichessField ? (
                    <div className="flex items-center gap-2">
                      <span className="font-body text-sm" style={{ color: 'var(--color-text-secondary)' }}>
                        Token saved ✓
                      </span>
                      <button onClick={() => setShowLichessField(true)} className="px-2 py-1 rounded font-body text-xs panel">
                        Change
                      </button>
                      <button onClick={removeLichess} className="px-2 py-1 rounded font-body text-xs panel">
                        Remove
                      </button>
                    </div>
                  ) : (
                    <div className="flex gap-2">
                      <input
                        type="password"
                        value={lichessInput}
                        onChange={(e) => setLichessInput(e.target.value)}
                        placeholder="lip_…"
                        className="flex-1 min-w-0 px-3 py-2 rounded-lg font-body text-sm panel"
                        style={{ color: 'var(--color-text-primary)', backgroundColor: 'var(--color-bg-panel)' }}
                      />
                      <button onClick={saveLichess} disabled={!lichessInput.trim()} className="px-3 py-2 rounded-lg font-body text-sm panel disabled:opacity-40">
                        Save
                      </button>
                    </div>
                  )}
                  <p className="mt-1 font-body text-xs" style={{ color: 'var(--color-text-muted)' }}>
                    Optional. Stored only in your browser, sent only to Lichess. Adds “masters play X% here” to opening moves. Get a free read-only token at lichess.org → Preferences → API access tokens. Without it you still get the “Book” label.
                  </p>
                </div>
                </div>
              </details>
            </div>
          </div>
        </div>
      </div>

      {/* Move-thread Q&A modal (tool-use, Stockfish-grounded) */}
      {threadEntry && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          style={{ backgroundColor: 'rgba(0,0,0,0.5)' }}
          onClick={() => setThreadEntryId(null)}
          role="dialog"
          aria-modal="true"
        >
          <div
            className="panel rounded-2xl w-full max-w-lg max-h-[85vh] flex flex-col"
            onClick={(ev) => ev.stopPropagation()}
          >
            <div className="flex items-start justify-between p-4 border-b" style={{ borderColor: 'var(--color-border)' }}>
              <div>
                <h3 className="font-heading text-sm font-semibold" style={{ color: 'var(--color-text-primary)' }}>
                  {Math.ceil(threadEntry.ply / 2)}.{threadEntry.kind === 'ai-move' ? '..' : ''} {threadEntry.san}
                </h3>
                <p className="font-body text-xs mt-1" style={{ color: 'var(--color-text-muted)' }}>
                  Ask follow-ups — answers are checked against Stockfish live.
                </p>
              </div>
              <button
                onClick={() => setThreadEntryId(null)}
                aria-label="Close"
                className="px-2 py-1 rounded font-body text-sm panel"
              >
                ✕
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-4 space-y-3">
              <div className="coach-entry font-body text-sm" style={{ color: 'var(--color-text-secondary)' }}>
                {threadEntry.text}
              </div>
              {(threadEntry.thread || []).map((m, i) => (
                <div
                  key={i}
                  className="font-body text-sm rounded-lg px-3 py-2"
                  style={
                    m.role === 'user'
                      ? { backgroundColor: 'var(--color-accent-soft)', color: 'var(--color-text-primary)' }
                      : { color: 'var(--color-text-secondary)' }
                  }
                >
                  {m.content}
                </div>
              ))}
              {threadBusy && (
                <div className="font-body text-xs" style={{ color: 'var(--color-text-muted)' }}>
                  {threadStatus || 'Thinking…'}
                </div>
              )}
            </div>

            <div className="p-4 border-t" style={{ borderColor: 'var(--color-border)' }}>
              {keySet ? (
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={threadInput}
                    onChange={(ev) => setThreadInput(ev.target.value)}
                    onKeyDown={(ev) => {
                      if (ev.key === 'Enter' && !ev.shiftKey) {
                        ev.preventDefault();
                        sendThreadQuestion();
                      }
                    }}
                    placeholder="e.g. What if I'd played Nf3 instead?"
                    disabled={threadBusy}
                    className="flex-1 min-w-0 px-3 py-2 rounded-lg font-body text-sm panel"
                    style={{ color: 'var(--color-text-primary)', backgroundColor: 'var(--color-bg-panel)' }}
                  />
                  <button
                    onClick={sendThreadQuestion}
                    disabled={threadBusy || !threadInput.trim()}
                    className="px-3 py-2 rounded-lg font-body text-sm panel disabled:opacity-40"
                  >
                    Ask
                  </button>
                </div>
              ) : (
                <p className="font-body text-xs" style={{ color: 'var(--color-text-muted)' }}>
                  Add your Anthropic API key in Settings to ask questions about moves.
                </p>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
