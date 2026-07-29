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
import ProgressPanel from './components/ProgressPanel.jsx';
import {
  loadGameLog,
  saveGameLog,
  recordGame,
  accuracyTrend,
  openingReportCard,
  overallStats,
} from './coach/gameHistory.js';
import {
  loadMistakes,
  saveMistakes,
  captureMistake,
  dueMistakes,
  weaknessProfile,
  listMistakeOpenings,
} from './coach/mistakeStore.js';
import { DIFFICULTY_TIERS, DEFAULT_TIER_KEY, RATING_LADDER, TIME_CONTROLS, getTimeControl } from './engine/difficulty.js';
import { DEFAULT_RATING, nearestRung, updateRating, scoreFor, isProvisional, mergeRating } from './engine/rating.js';
import { profileIdFromKey, fetchRemoteProfile, putRemoteProfile, mergeHistory, mergePuzzles, mergeMistakes } from './engine/profileSync.js';
import {
  deriveCredentials,
  encryptApiKey,
  decryptApiKey,
  createAccount,
  loginAccount,
  pushEncryptedKey,
  loadSession,
  saveSession,
  clearSession,
} from './engine/account.js';
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
import { withHeaders, downloadPgn, readPgnFile, looksLikePgn, parsePlayerHeaders } from './coach/pgn.js';
import { summarizeAccuracy } from './coach/accuracy.js';
import { PUZZLES, budgetPliesFor, evaluatePuzzleMove, evaluateSolutionMove, listThemeGroups } from './coach/puzzles.js';
import {
  loadProgress,
  saveProgress,
  recordPuzzleResult,
  selectSession,
  dueCount as puzzlesDueCount,
} from './coach/puzzleProgress.js';
import { fetchDailyPuzzle } from './coach/lichessPuzzle.js';
import { hintFor, buildHintPayload, buildFailPayload, MAX_HINT_STAGE } from './coach/puzzleCoach.js';
import { capturedPieces, materialBalance } from './coach/material.js';
import { playSound, moveSoundKind } from './coach/sound.js';
import { formatEval, CLASSIFICATION_LEGEND } from './coach/classify.js';
import { describeEngineError } from './engine/stockfishLoader.js';
import { requestCommentary, runThreadTurn, setApiKey, hasApiKey, getApiKey } from './coach/coachClient.js';
import './chess.css';

const PIECE_GLYPH = { p: '♟', n: '♞', b: '♝', r: '♜', q: '♛', k: '♚' };

const TONE_CLASS = { great: 'tone-great', good: 'tone-good', warn: 'tone-warn', bad: 'tone-bad' };

// --- In-progress game persistence -------------------------------------------
// A refresh used to destroy the game outright. We snapshot the live game (PGN +
// the UI state needed to resume it) after every move, exactly like Diplomacy's
// `diplomacyGameState`. Puzzle sessions and mistake drills are transient by
// design and are never persisted.
const GAME_STATE_KEY = 'chessGameState';
const GAME_STATE_VERSION = 1;

function saveGameState(snapshot) {
  try {
    localStorage.setItem(GAME_STATE_KEY, JSON.stringify({ v: GAME_STATE_VERSION, ...snapshot }));
  } catch (_) {
    /* quota/private-mode — persistence is best-effort, never breaks play */
  }
}

function loadGameState() {
  try {
    const raw = localStorage.getItem(GAME_STATE_KEY);
    if (!raw) return null;
    const s = JSON.parse(raw);
    if (!s || s.v !== GAME_STATE_VERSION || !s.pgn) return null;
    return s;
  } catch (_) {
    return null;
  }
}

function clearGameState() {
  try {
    localStorage.removeItem(GAME_STATE_KEY);
  } catch (_) {
    /* best-effort */
  }
}

// Rebuild a ChessBoard from a saved PGN, or null if it no longer parses or
// carries no moves — restoring an empty board while keeping the old dialogue
// would leave the transcript describing a game that isn't on the board.
function boardFromSnapshot(snapshot) {
  if (!snapshot || !snapshot.pgn) return null;
  const b = new ChessBoard();
  if (!b.loadPgn(snapshot.pgn)) return null;
  return b.sanHistory().length > 0 ? b : null;
}

const Toggle = ({ label, checked, onChange }) => (
  <div className="flex items-center justify-between gap-4 min-h-[44px]">
    <span style={{ color: 'var(--color-text-primary)' }}>{label}</span>
    <button
      onClick={onChange}
      role="switch"
      aria-checked={checked}
      aria-label={label}
      className="w-10 h-6 rounded-full transition-colors relative shrink-0 tap-target"
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
  // Read the saved in-progress game once, before any state initializer needs it.
  const restoredRef = useRef(undefined);
  if (restoredRef.current === undefined) {
    const snap = loadGameState();
    restoredRef.current = snap && boardFromSnapshot(snap) ? snap : null;
  }
  const restored = restoredRef.current;

  const [board, setBoard] = useState(() => boardFromSnapshot(restored) || new ChessBoard());
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
  // Cross-device rating sync (opt-in, keyed by a hash of the Anthropic key, or
  // by an account's password-derived profileId when signed in).
  const [syncId, setSyncId] = useState(null);
  const [syncStatus, setSyncStatus] = useState('off'); // off | local | syncing | synced | error

  // Username+password account (engine/account.js): unlocks the API key +
  // profile on any device via a password-derived id, no email/recovery.
  const [account, setAccount] = useState(() => loadSession());
  const [accountUsername, setAccountUsername] = useState('');
  const [accountPassword, setAccountPassword] = useState('');
  const [accountPassword2, setAccountPassword2] = useState('');
  const [creatingAccount, setCreatingAccount] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [accountBusy, setAccountBusy] = useState(false);
  const [accountError, setAccountError] = useState('');
  const [history, setHistory] = useState(() => loadOppHistory()); // per-opponent W/L/D record
  const [gameLog, setGameLog] = useState(() => loadGameLog()); // finished games, for the progress view
  const [humanColor, setHumanColor] = useState(() => (restored && restored.humanColor) || 'w'); // 'w' | 'b'
  const [orientation, setOrientation] = useState(() => (restored && restored.orientation) || 'white');
  const [selected, setSelected] = useState(null);
  // Read-only history browsing: a ply index into board.positions, or null when
  // showing the live position. Distinct from undo — nothing is discarded.
  const [reviewPly, setReviewPly] = useState(null);
  const [isThinking, setIsThinking] = useState(false);
  const [resigned, setResigned] = useState(() => (restored && restored.resigned) || null); // color that resigned

  // Optional clocks. Untimed by default; 'off' keeps the original behaviour.
  const [timeControl, setTimeControl] = useState(() => localStorage.getItem('chessTimeControl') || 'off');
  const [clock, setClock] = useState(() => {
    const tc = getTimeControl(localStorage.getItem('chessTimeControl') || 'off');
    return { w: tc.base * 1000, b: tc.base * 1000 };
  });
  const [flagged, setFlagged] = useState(null); // color that ran out of time

  // Coaching state.
  const [dialogue, setDialogue] = useState(() => (restored && restored.dialogue) || []); // [{id, ply, kind, san, tone, label, text, source, pending}]
  const [moveStats, setMoveStats] = useState(() => (restored && restored.moveStats) || []); // [{ply, moverColor, cpLoss, classification}] for accuracy (#17)
  const [coaching, setCoaching] = useState(false);
  const [learningGoal, setLearningGoal] = useState(() => localStorage.getItem('chessLearningGoal') || '');
  const [apiKeyInput, setApiKeyInput] = useState('');
  const [keySet, setKeySet] = useState(() => hasApiKey());
  const [showKeyField, setShowKeyField] = useState(false);
  const [showLegend, setShowLegend] = useState(false);
  const [drillOpeningFilter, setDrillOpeningFilter] = useState(null); // null = all openings
  const [puzzleThemeFilter, setPuzzleThemeFilter] = useState([]); // [] = adaptive default
  const [introSeen, setIntroSeen] = useState(() => localStorage.getItem('chessIntroSeen') === 'true');
  const [keyNudgeDismissed, setKeyNudgeDismissed] = useState(
    () => localStorage.getItem('chessKeyNudgeDismissed') === 'true'
  );
  // True when a key IS set but commentary still came back from the template
  // path — i.e. the Claude call failed and we degraded silently.
  const [coachKeyFailing, setCoachKeyFailing] = useState(false);

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

  const { status: engineStatus, getMove, analyze, errorLine: engineErrorLine, retry: retryEngine } = useStockfish();
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
  const [moveInput, setMoveInput] = useState('');
  const [moveInputError, setMoveInputError] = useState('');

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
  // Naming the mating pattern up front ("King & queen (corner)") is most of the
  // solve, so it's opt-in. Off by default: the theme is revealed on solve/fail.
  const [puzzleShowTheme, setPuzzleShowTheme] = useState(() => {
    const saved = localStorage.getItem('chessPuzzleShowTheme');
    return saved ? JSON.parse(saved) : false;
  });
  const [puzzleDelta, setPuzzleDelta] = useState(null); // rating change from the last graded attempt
  const [puzzleFlash, setPuzzleFlash] = useState(null); // 'solved' | 'wrong' — board feedback
  const [puzzleSessionDone, setPuzzleSessionDone] = useState(false);
  // Playable refutation of a failed attempt: {fen, pv, played} plus the
  // preview board and how many plies of the line are currently shown.
  const [refutation, setRefutation] = useState(null);
  const [refutationBoard, setRefutationBoard] = useState(null);
  const [refutationStep, setRefutationStep] = useState(0);
  const [puzzleSolvedCount, setPuzzleSolvedCount] = useState(0);
  const puzzleStartRatingRef = useRef(null);
  const puzzleRecordedRef = useRef(new Set()); // one rating/schedule write per puzzle per session
  // The game in progress when a puzzle session or drill started, so leaving one
  // returns you to your game instead of throwing it away.
  const stashedGameRef = useRef(null);

  // Mistake library (#23): the mistakes captured this game (for the post-game
  // review panel), how many stored entries are due for drilling, and the drill
  // session itself. Capture is gated to normal play (not puzzles/drills/rated).
  const [gameMistakes, setGameMistakes] = useState(() => (restored && restored.gameMistakes) || []);
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

  // Confirmation prompt for actions that destroy something the user can't get
  // back: abandoning a game in progress, resigning, deleting a stored secret.
  // {title, body, confirmLabel, onConfirm}
  const [confirmPrompt, setConfirmPrompt] = useState(null);
  const askConfirm = (prompt) => setConfirmPrompt(prompt);

  // After parsing an imported PGN, ask which side to review as.
  const [importPrompt, setImportPrompt] = useState(null); // {players:{white,black}, apply(color)}

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
    localStorage.setItem('chessKeyNudgeDismissed', JSON.stringify(keyNudgeDismissed));
  }, [keyNudgeDismissed]);
  useEffect(() => {
    localStorage.setItem('chessPuzzleShowTheme', JSON.stringify(puzzleShowTheme));
  }, [puzzleShowTheme]);
  useEffect(() => {
    localStorage.setItem('chessIntroSeen', JSON.stringify(introSeen));
  }, [introSeen]);
  useEffect(() => {
    localStorage.setItem('chessRated', JSON.stringify(rated));
  }, [rated]);
  useEffect(() => {
    localStorage.setItem('chessRating', JSON.stringify(rating));
  }, [rating]);
  useEffect(() => {
    localStorage.setItem('chessRatedGames', JSON.stringify(ratedGames));
  }, [ratedGames]);

  // Merge a remote profile snapshot into local storage/state for every domain
  // (rating, opponent history, puzzle progress, mistake library), returning
  // the subset that moved past what the server had (for the caller to push
  // back, if it wants to). Shared by the sync-pull effect below and the
  // one-time legacy-key merge on account sign-in/creation.
  const mergeRemoteProfileIntoLocal = useCallback((remote) => {
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

    return push;
  }, []);

  // Best-effort, one-time merge of a legacy key-hash profile into local
  // storage when an account is created/signed into while an Anthropic key is
  // already present under a *different* id. Never throws — called before the
  // account takes over syncId, so its [syncId] pull-effect below folds the
  // now-enriched local state into the account profile and pushes it up.
  const mergeLegacyProfile = useCallback(async (creds) => {
    const key = getApiKey();
    if (!key) return;
    try {
      const legacyId = await profileIdFromKey(key);
      if (!legacyId || legacyId === creds.profileId) return;
      const remote = await fetchRemoteProfile(legacyId);
      if (remote && remote.configured === false) return;
      mergeRemoteProfileIntoLocal(remote);
    } catch (_) {
      /* best-effort */
    }
  }, [mergeRemoteProfileIntoLocal]);

  // Derive the opaque sync id: an account's password-derived profileId takes
  // priority when signed in; otherwise fall back to a hash of the Anthropic
  // key (or clear it when neither is present).
  useEffect(() => {
    let cancelled = false;
    if (account) {
      setSyncId(account.profileId);
      return undefined;
    }
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
  }, [keySet, account]);

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
          setSyncStatus('local'); // key/account present, but no store provisioned server-side
          return;
        }
        const push = mergeRemoteProfileIntoLocal(remote);
        if (Object.keys(push).length > 0) putRemoteProfile(syncId, push);
        setSyncStatus('synced');
      })
      .catch(() => { if (!cancelled) setSyncStatus('error'); });
    return () => { cancelled = true; };
  }, [syncId, mergeRemoteProfileIntoLocal]);

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
      // Settings stays where the user left it: auto-hiding it is how the API
      // key / account / Lichess setup went undiscovered.
    }
  }, [movesPlayedCount]);

  // Any new move (or a new game) snaps the board back to the live position.
  useEffect(() => {
    setReviewPly(null);
  }, [movesPlayedCount]);

  // Arrow keys step through history; Escape returns to the live position.
  useEffect(() => {
    const onKey = (e) => {
      if (e.target && /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName)) return;
      const total = board.positions.length - 1;
      if (e.key === 'ArrowLeft') {
        setReviewPly((p) => Math.max(0, (p == null ? total : p) - 1));
      } else if (e.key === 'ArrowRight') {
        setReviewPly((p) => (p == null || p >= total ? null : p + 1 === total ? null : p + 1));
      } else if (e.key === 'Escape') {
        setReviewPly(null);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [board]);

  // Snapshot the live game so a refresh (or a closed tab) can resume it.
  // Puzzle sessions and drills are transient and deliberately not persisted.
  useEffect(() => {
    if (puzzleMode || drill.active) return;
    if (movesPlayedCount === 0) {
      clearGameState();
      return;
    }
    saveGameState({
      pgn: board.pgn(),
      humanColor,
      orientation,
      resigned,
      rated,
      difficulty,
      // Strip the Anthropic thread history: it can be large and is cheap to
      // lose, unlike the commentary itself.
      dialogue: dialogue.map(({ threadApi, ...rest }) => rest),
      moveStats,
      gameMistakes,
    });
  }, [
    board, movesPlayedCount, humanColor, orientation, resigned, rated, difficulty,
    dialogue, moveStats, gameMistakes, puzzleMode, drill.active,
  ]);

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
    : flagged
      ? { over: true, type: 'timeout', winner: flagged === 'w' ? 'black' : 'white' }
      : board.result();
  const gameOver = !!gameResult;
  const lastMove = board.lastMove();
  const checkedSquare = board.checkedKingSquare();
  const humanToMove = !gameOver && board.turn() === humanColor;
  // The opponent identity used to key per-opponent history: the matched rated
  // rung, or the chosen casual difficulty tier.
  const opponentKey = rated ? String(ratedRung.rating) : difficulty;

  // --- Clocks ---------------------------------------------------------------
  // Tick the side to move while a timed game is live. Increment is credited on
  // the move that was just completed, so it lands on the mover's clock.
  const tcSpec = getTimeControl(timeControl);
  const clockOn = tcSpec.base > 0 && !puzzleMode && !drill.active;
  const turnColor = board.turn();
  useEffect(() => {
    localStorage.setItem('chessTimeControl', timeControl);
  }, [timeControl]);

  useEffect(() => {
    if (!clockOn || gameOver || movesPlayedCount === 0) return undefined;
    const id = setInterval(() => {
      setClock((c) => {
        const left = Math.max(0, c[turnColor] - 200);
        if (left === 0) setFlagged(turnColor);
        return { ...c, [turnColor]: left };
      });
    }, 200);
    return () => clearInterval(id);
  }, [clockOn, gameOver, turnColor, movesPlayedCount]);

  // Credit the increment to whoever just moved.
  const lastCreditedPlyRef = useRef(0);
  useEffect(() => {
    if (!clockOn || movesPlayedCount === 0) return;
    if (movesPlayedCount === lastCreditedPlyRef.current) return;
    lastCreditedPlyRef.current = movesPlayedCount;
    if (!tcSpec.inc) return;
    const mover = turnColor === 'w' ? 'b' : 'w';
    setClock((c) => ({ ...c, [mover]: c[mover] + tcSpec.inc * 1000 }));
  }, [movesPlayedCount, clockOn, tcSpec.inc, turnColor]);

  const formatClock = (ms) => {
    const total = Math.ceil(ms / 1000);
    const m = Math.floor(total / 60);
    const s = total % 60;
    return `${m}:${String(s).padStart(2, '0')}`;
  };


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

  // Log the finished game for the cross-game progress view. Deliberately waits
  // for `coaching` to settle: the last move's analysis is still in flight when
  // the result lands, and recording early would bank an accuracy figure that
  // misses it. Guarded to fire exactly once per game.
  const gameLoggedRef = useRef(false);
  useEffect(() => {
    if (puzzleMode || drill.active || !gameResult || coaching || gameLoggedRef.current) return;
    if (moveStats.length === 0) return; // nothing analysed — nothing to say
    gameLoggedRef.current = true;
    const humanWord = humanColor === 'w' ? 'white' : 'black';
    const result = gameResult.winner == null ? 'draw' : gameResult.winner === humanWord ? 'win' : 'loss';
    const summary = summarizeAccuracy(moveStats);
    const side = humanColor === 'w' ? summary.white : summary.black;
    const opening = detectOpening(board.sanHistory());
    saveGameLog(
      recordGame(loadGameLog(), {
        playedAt: Date.now(),
        result,
        color: humanColor,
        rated,
        opponentKey,
        accuracy: side ? side.accuracy : null,
        counts: side ? side.counts : { blunder: 0, mistake: 0, inaccuracy: 0 },
        opening: opening.name || null,
        eco: opening.eco || null,
        leftBookAtPly: opening.leftBookAtPly,
        moves: board.sanHistory().length,
      })
    );
    setGameLog(loadGameLog());
  }, [
    puzzleMode, drill.active, gameResult, coaching, moveStats, humanColor,
    rated, opponentKey, board,
  ]);

  // Produce coaching for a move that was just played. Runs two full-strength
  // analyses (position before + after the move) so commentary is engine-true,
  // then asks the coach (Claude or template fallback) to phrase it.
  // Small FEN-keyed cache of coaching analyses (see coachOnMove). Bounded so a
  // long game can't grow it without limit; cleared whenever the game changes.
  const analysisCacheRef = useRef(new Map());
  const cachedAnalyze = useCallback(
    (fen) => {
      const cache = analysisCacheRef.current;
      const hit = cache.get(fen);
      if (hit) return hit;
      const p = analyze(fen, { multipv: 3 }).catch((e) => {
        cache.delete(fen); // don't cache failures — a retry should re-search
        throw e;
      });
      cache.set(fen, p);
      if (cache.size > 64) cache.delete(cache.keys().next().value);
      return p;
    },
    [analyze]
  );

  const coachOnMove = useCallback(
    async (fenBefore, fenAfter, movePlayedSan, moverColor, kind, ply, sanAfter) => {
      // Rated games run the same analysis but SILENTLY: no dialogue, no eval
      // bar, no live hints. We keep the per-move stats so the post-game
      // accuracy report still exists once the result is locked in.
      const silent = ratedRef.current;
      const seq = coachSeqRef.current;
      const entryId = `${ply}-${kind}`;
      const opening = detectOpening(sanAfter || []);
      if (!silent) {
        // Insert a pending entry immediately for responsive UX.
        setDialogue((d) => [
          ...d,
          { id: entryId, ply, kind, san: movePlayedSan, tone: 'good', label: '…', text: '', source: 'pending', pending: true },
        ]);
        setCoaching(true);
      }
      try {
        // Every move used to cost two full-strength searches (~1s each), and
        // the engine is single-flight, so they serialized into ~2s of dead air
        // before any commentary appeared. But the position *after* move N is
        // exactly the position *before* move N+1 — so the second search is the
        // next move's first search. Cache by FEN and each move pays for one
        // new search instead of two. Both run at MultiPV 3 so a cached entry
        // is usable as either (analyzeMove only reads lines[0] of the "after").
        const [analysisBefore, analysisAfter] = await Promise.all([
          cachedAnalyze(fenBefore),
          cachedAnalyze(fenAfter),
        ]);
        if (seq !== coachSeqRef.current) return; // superseded (new game / undo)
        // Update the eval bar (#21) from the post-move top line (White POV).
        const afterTop = !silent && analysisAfter && analysisAfter.lines && analysisAfter.lines[0];
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
        if (opening.idea) payload.openingIdea = opening.idea;
        if (opening.leftBookAtPly === ply) {
          payload.leftBook = true;
          // Leaving theory yourself is a different lesson from your opponent
          // doing it, so the prose can frame them differently.
          payload.leftBookBy = kind === 'player-move' ? 'you' : 'opponent';
        }

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
          // Skipped in rated games — nothing renders it, so don't pay the fetch.
          const stats = silent ? null : await fetchOpeningStats(fenBefore);
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

        // Mistake library (#23): capture the human's errors as replayable
        // drills. Inaccuracies are included — they're the most common and most
        // improvable category for an intermediate player, and excluding them
        // made the library's scope look arbitrary from the outside. They're
        // stored with their classification so review can prioritise the worst.
        // Normal games only — puzzle moves are excluded here and drill moves
        // never reach coachOnMove.
        if (
          kind === 'player-move' &&
          !puzzleModeRef.current &&
          ['inaccuracy', 'mistake', 'blunder'].includes(payload.classification) &&
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
        // Rated: stats are all we keep. No prose is generated or shown until
        // the game is over (the post-game summary reads moveStats).
        if (silent) return;
        const { text, source } = await requestCommentary(payload);
        if (seq !== coachSeqRef.current) return;
        // A key is set but we still got template prose ⇒ the Claude call
        // failed. Surface it instead of degrading silently forever.
        setCoachKeyFailing(hasApiKey() && source === 'template');
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
        if (seq !== coachSeqRef.current || silent) return;
        setDialogue((d) =>
          d.map((e) =>
            e.id === entryId
              ? { ...e, label: '', text: 'Analysis unavailable for this move.', source: 'error', pending: false }
              : e
          )
        );
      } finally {
        if (seq === coachSeqRef.current && !silent) setCoaching(false);
      }
    },
    [analyze, cachedAnalyze, learningGoal]
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

  // While reviewing history we show a past position and highlight the move that
  // produced it, rather than the live game's last move.
  const reviewing = reviewPly != null;
  const displayFen = refutationBoard
    ? refutationBoard.fen()
    : reviewing
      ? board.positions[reviewPly]
      : board.fen();
  const reviewedMove = reviewing && reviewPly > 0 ? board.moves[reviewPly - 1] : null;
  const highlightMove = reviewing ? reviewedMove : lastMove;

  const squareStyles = useMemo(() => {
    const styles = {};
    if (highlightMove) {
      styles[highlightMove.from] = { backgroundColor: 'var(--sq-highlight)' };
      styles[highlightMove.to] = { backgroundColor: 'var(--sq-highlight)' };
    }
    if (checkedSquare && !reviewing) {
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
  }, [board, selected, showMoves, highlightMove, checkedSquare, reviewing]);

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
        setPuzzleFlash('wrong');
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
        setPuzzleFlash('solved');
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
  // Browsing history is read-only, so pieces are frozen while reviewing.
  const canInteract = reviewing || refutationBoard
    ? false
    : drill.active
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
    // Rated games randomize color; casual games keep the colour you chose
    // rather than silently reassigning it (which used to happen on puzzle exit).
    const c = color || (rated ? (Math.random() < 0.5 ? 'w' : 'b') : humanColor);
    clearGameState();
    coachSeqRef.current += 1; // invalidate any in-flight coaching
    analysisCacheRef.current.clear();
    ratedAppliedRef.current = false;
    historyAppliedRef.current = false;
    gameLoggedRef.current = false;
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
    setFlagged(null);
    lastCreditedPlyRef.current = 0;
    const tc = getTimeControl(timeControl);
    setClock({ w: tc.base * 1000, b: tc.base * 1000 });
    setBoard(new ChessBoard());
  };

  // Switch rated mode on/off. Always starts a fresh game so a half-played
  // casual position is never scored (and vice-versa) — which means confirming
  // first when there's a game worth losing.
  const applyRatedToggle = () => {
    const goingRated = !rated;
    setRated(goingRated);
    clearGameState();
    stashedGameRef.current = null;
    // startGame reads `rated` from the current render, so pick the colour here:
    // rated games randomize, casual keeps yours.
    startGame(goingRated ? (Math.random() < 0.5 ? 'w' : 'b') : humanColor);
  };
  const toggleRated = () => {
    if (movesPlayedCount > 0 && !gameOver) {
      askConfirm({
        title: rated ? 'Leave rated mode?' : 'Switch to rated mode?',
        body: 'Switching modes starts a new game — this one will be discarded.',
        confirmLabel: 'Switch and start over',
        onConfirm: applyRatedToggle,
      });
      return;
    }
    applyRatedToggle();
  };

  // Puzzle mode (#18, overhauled #24): sessions come from the adaptive
  // selector over the whole bank (due reviews first, then fresh puzzles
  // nearest the player's rating); the difficulty tier no longer gates them.
  const loadPuzzleFrom = (pool, index) => {
    if (!pool.length) return;
    // Running off the end used to wrap silently back to puzzle 1, which read as
    // a bug. Finish the session explicitly instead.
    if (index >= pool.length) {
      setPuzzleSessionDone(true);
      return;
    }
    const i = Math.max(0, index);
    const puzzle = pool[i];
    setPuzzleDelta(null);
    setPuzzleFlash(null);
    setPuzzleSessionDone(false);
    setRefutation(null);
    setRefutationBoard(null);
    setRefutationStep(0);
    const next = new ChessBoard(puzzle.fen);
    coachSeqRef.current += 1;
    analysisCacheRef.current.clear();
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
  // Stash the live game (if there is one) before leaving it for puzzles/drills.
  const stashGame = () => {
    if (puzzleMode || drill.active) return; // already away from the game
    if (board.sanHistory().length === 0) return; // nothing worth keeping
    stashedGameRef.current = {
      pgn: board.pgn(),
      humanColor,
      orientation,
      resigned,
      dialogue: dialogue.map(({ threadApi, ...rest }) => rest),
      moveStats,
      gameMistakes,
    };
  };

  // Return to the stashed game, or start a fresh one if there wasn't one.
  const resumeStashedGame = () => {
    const snap = stashedGameRef.current;
    const next = boardFromSnapshot(snap);
    if (!snap || !next) {
      startGame(humanColor);
      return;
    }
    stashedGameRef.current = null;
    coachSeqRef.current += 1;
    analysisCacheRef.current.clear();
    drill.exit();
    setPuzzleMode(false);
    setSelected(null);
    setCoaching(false);
    thinkingRef.current = false;
    setIsThinking(false);
    setHumanColor(snap.humanColor);
    setOrientation(snap.orientation);
    setResigned(snap.resigned || null);
    setDialogue(snap.dialogue || []);
    setMoveStats(snap.moveStats || []);
    setGameMistakes(snap.gameMistakes || []);
    setBoard(next);
  };

  const startPuzzles = () => {
    stashGame();
    const progress = loadProgress();
    setPuzzleProgressState(progress);
    puzzleRecordedRef.current = new Set();
    puzzleStartRatingRef.current = progress.rating || 0;
    setPuzzleSolvedCount(0);
    setPuzzleSessionDone(false);
    const session = selectSession(progress, PUZZLES, Date.now(), undefined, {
      themes: selectedThemeLabels.length ? selectedThemeLabels : undefined,
    });
    if (!session.length) {
      // A filter that matches nothing returns empty rather than silently
      // falling back to the whole bank — say so instead of showing a blank.
      setPuzzlePool([]);
      setPuzzleMode(true);
      setPuzzleSessionDone(true);
      return;
    }
    loadPuzzleFrom(session, 0);
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
    const before = loadProgress();
    const next = recordPuzzleResult(before, puzzle, solved);
    saveProgress(next);
    setPuzzleProgressState(next);
    // Rated games show a +12/-8; puzzles used the same Elo math and showed
    // nothing. Report the delta and when this puzzle comes back.
    const delta = (next.rating || 0) - (before.rating || 0);
    const rec = next.puzzles && next.puzzles[puzzle.id];
    setPuzzleDelta({
      delta,
      nextDueAt: rec && rec.nextDueAt ? rec.nextDueAt : null,
      solved,
    });
    if (solved) setPuzzleSolvedCount((n) => n + 1);
    if (syncId) putRemoteProfile(syncId, { puzzles: next });
  };

  // Human-readable "you'll see this again in …" from a due timestamp.
  const describeNextDue = (ts) => {
    if (!ts) return '';
    const days = Math.max(1, Math.round((ts - Date.now()) / 86400000));
    return `Back in ${days} day${days === 1 ? '' : 's'}.`;
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
        // Tactics are a spatial skill: reading "after Ka7 Qb2 Ka6 the chance is
        // gone" is far weaker than watching it. Offer to play the refutation
        // out on the board from the position the wrong move created.
        if (payload.refutationPv && payload.refutationPv.length) {
          setRefutation({ fen: fenAfter, pv: payload.refutationPv, played: playedSan });
        }
        return requestCommentary(payload).then(({ text }) => {
          if (seq === coachSeqRef.current && text) setPuzzleCoachMsg(text);
        });
      })
      .catch(() => {});
  };

  // Step the refutation preview forward one ply on a throwaway board.
  const playRefutation = () => {
    if (!refutation) return;
    const preview = new ChessBoard(refutation.fen);
    const shown = refutationStep + 1;
    for (let i = 0; i < shown && i < refutation.pv.length; i += 1) {
      const mvs = preview.allLegalMoves().filter((m) => m.san.replace(/[+#]/g, '') === refutation.pv[i].replace(/[+#]/g, ''));
      if (!mvs.length) break;
      preview.move(mvs[0].from, mvs[0].to, mvs[0].promotion);
    }
    setRefutationBoard(preview);
    setRefutationStep(shown >= refutation.pv.length ? 0 : shown);
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
    stashGame();
    const first = drill.start(entries);
    if (!first) return;
    coachSeqRef.current += 1; // invalidate any in-flight coaching
    analysisCacheRef.current.clear();
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
  const trainMistakes = () => startDrills(dueMistakes(loadMistakes(), Date.now(), { opening: drillOpeningFilter }));
  // Drill only the mistakes made in one opening — the report card's "Drill"
  // button. Deliberate practice on a named weakness, rather than whatever the
  // spaced-repetition queue happens to surface.
  const drillOpening = (opening) => {
    const entries = dueMistakes(loadMistakes(), Date.now(), { opening });
    // Fall back to every stored mistake in that opening if none are due yet:
    // the user asked for this opening specifically, so an empty screen would
    // just look broken.
    const list = entries.length
      ? entries
      : loadMistakes().filter((e) => e.opening === opening);
    if (list.length) startDrills(list);
  };
  const retryMistake = (entry) => startDrills([entry]);
  const nextDrill = () => {
    const entry = drill.next();
    if (entry) loadDrillBoard(entry);
    else resumeStashedGame();
  };
  const exitDrills = () => resumeStashedGame();

  const undo = () => {
    // Undo back to the human's turn: pop AI move + human move when possible.
    if (!board.canUndo() || isThinking) return;
    coachSeqRef.current += 1; // invalidate any in-flight coaching
    analysisCacheRef.current.clear();
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

  // A mistyped key used to fail silently forever — the coach just quietly
  // stayed on templates. Catch the obvious shape errors at entry.
  const keyFormatWarning = (() => {
    const v = apiKeyInput.trim();
    if (!v) return '';
    if (!v.startsWith('sk-ant-')) return 'Anthropic keys start with “sk-ant-”. Double-check what you pasted.';
    if (v.length < 40) return 'That looks too short to be a complete key.';
    return '';
  })();

  const saveKey = () => {
    const trimmed = apiKeyInput.trim();
    setCoachKeyFailing(false);
    setApiKey(trimmed);
    setKeySet(hasApiKey());
    setApiKeyInput('');
    setShowKeyField(false);
    // Signed in + key changed: push the freshly-encrypted key to the account
    // so other devices pick it up. Fire-and-forget — never blocks the UI.
    if (account && trimmed) {
      encryptApiKey(account.aesKey, trimmed).then((enc) =>
        pushEncryptedKey({ usernameId: account.usernameId, authToken: account.authToken, enc }),
      );
    }
  };
  const removeKey = () =>
    askConfirm({
      title: 'Remove your Anthropic key?',
      body: "It's deleted from this browser. You'll need to paste it again (or sign in) to get Claude coaching back.",
      confirmLabel: 'Remove key',
      onConfirm: () => {
        setApiKey('');
        setKeySet(false);
        setShowKeyField(false);
      },
    });

  const handleCreateAccount = async () => {
    const username = accountUsername.trim();
    if (!username || accountPassword.length < 6) {
      setAccountError(!username ? 'Enter a username.' : 'Password must be at least 6 characters.');
      return;
    }
    if (accountPassword !== accountPassword2) {
      setAccountError("Those passwords don't match.");
      return;
    }
    setAccountBusy(true);
    setAccountError('');
    try {
      const creds = await deriveCredentials(username, accountPassword);
      if (!creds) {
        setAccountError("Your browser doesn't support the required crypto.");
        return;
      }
      const currentKey = getApiKey();
      const enc = currentKey ? await encryptApiKey(creds.aesKey, currentKey) : null;
      const token = getLichessToken();
      const encLichess = token ? await encryptApiKey(creds.aesKey, token) : null;
      let res;
      try {
        res = await createAccount({ usernameId: creds.usernameId, authToken: creds.authToken, enc, encLichess });
      } catch (_) {
        setAccountError('Network error — try again.');
        return;
      }
      if (res.configured === false) {
        setAccountError("Accounts aren't configured on the server.");
        return;
      }
      if (res.error === 'taken') {
        setAccountError('That username is taken.');
        return;
      }
      if (res.error) {
        setAccountError(res.message || 'Something went wrong.');
        return;
      }
      await mergeLegacyProfile(creds);
      saveSession(creds);
      setAccount(creds);
      setAccountUsername('');
      setAccountPassword('');
      setAccountPassword2('');
      setCreatingAccount(false);
    } finally {
      setAccountBusy(false);
    }
  };

  const handleSignIn = async () => {
    const username = accountUsername.trim();
    if (!username || !accountPassword) {
      setAccountError('Enter a username and password.');
      return;
    }
    setAccountBusy(true);
    setAccountError('');
    try {
      const creds = await deriveCredentials(username, accountPassword);
      if (!creds) {
        setAccountError("Your browser doesn't support the required crypto.");
        return;
      }
      let res;
      try {
        res = await loginAccount({ usernameId: creds.usernameId, authToken: creds.authToken });
      } catch (_) {
        setAccountError('Network error — try again.');
        return;
      }
      if (res.configured === false) {
        setAccountError("Accounts aren't configured on the server.");
        return;
      }
      if (res.error === 'no_account') {
        setAccountError('No account with that username.');
        return;
      }
      if (res.error === 'bad_credentials') {
        setAccountError('Wrong username or password.');
        return;
      }
      if (res.error) {
        setAccountError(res.message || 'Something went wrong.');
        return;
      }
      if (res.enc) {
        let key;
        try {
          key = await decryptApiKey(creds.aesKey, res.enc);
        } catch (_) {
          setAccountError('Wrong username or password.');
          return;
        }
        if (key) {
          setApiKey(key);
          setKeySet(hasApiKey());
        }
      }
      if (res.encLichess) {
        try {
          const token = await decryptApiKey(creds.aesKey, res.encLichess);
          if (token) {
            setLichessToken(token);
            setLichessSet(hasLichessToken());
          }
        } catch (_) {
          /* best-effort — the key decrypt already validated the password */
        }
      }
      await mergeLegacyProfile(creds);
      saveSession(creds);
      setAccount(creds);
      setAccountUsername('');
      setAccountPassword('');
      setAccountPassword2('');
      setCreatingAccount(false);
    } finally {
      setAccountBusy(false);
    }
  };

  const handleSignOut = () =>
    askConfirm({
      title: 'Sign out?',
      body:
        'Your saved Anthropic key and Lichess token stay on this device — signing out does not remove them. ' +
        'On a shared computer, remove them separately below.',
      confirmLabel: 'Sign out',
      onConfirm: () => {
        clearSession();
        setAccount(null);
      },
    });

  const saveLichess = () => {
    const trimmed = lichessInput.trim();
    setLichessToken(trimmed);
    setLichessSet(hasLichessToken());
    setLichessInput('');
    setShowLichessField(false);
    // Signed in + token changed: push the freshly-encrypted token to the
    // account so other devices pick it up. Fire-and-forget — never blocks
    // the UI. Mirrors saveKey's pattern.
    if (account && trimmed) {
      encryptApiKey(account.aesKey, trimmed).then((encLichess) =>
        pushEncryptedKey({ usernameId: account.usernameId, authToken: account.authToken, encLichess }),
      );
    }
  };
  const removeLichess = () =>
    askConfirm({
      title: 'Remove your Lichess token?',
      body: "It's deleted from this browser. Book moves keep working — you just lose the master-game statistics.",
      confirmLabel: 'Remove token',
      onConfirm: () => {
        setLichessToken('');
        setLichessSet(false);
        setShowLichessField(false);
      },
    });

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
      // Which side is "you" in the review? Guessing White mislabels every
      // move when the user played Black, so ask — seeded with the PGN's names.
      const players = parsePlayerHeaders(text);
      const applyImport = (color) => {
        coachSeqRef.current += 1; // invalidate in-flight coaching
    analysisCacheRef.current.clear();
        clearGameState();
        stashedGameRef.current = null;
        drill.exit();
        setPuzzleMode(false);
        setGameMistakes([]);
        setDialogue([]);
        setMoveStats([]);
        setCoaching(false);
        setSelected(null);
        setResigned(null);
        setReviewPly(null);
        thinkingRef.current = false;
        setIsThinking(false);
        setHumanColor(color);
        setOrientation(color === 'w' ? 'white' : 'black');
        setBoard(next);
      };
      setImportPrompt({ players, apply: applyImport });
    } catch (_) {
      setPgnError('Failed to read that file.');
    } finally {
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  // Resolve typed SAN ("Nf3", "exd5", "O-O") or UCI ("e2e4", "e7e8q") against
  // the legal moves in the current position, then play it through the normal
  // move path so puzzles/drills/coaching all behave identically.
  const submitTypedMove = () => {
    const raw = moveInput.trim();
    if (!raw) return;
    const candidates = board.allLegalMoves();
    const norm = (s) => s.replace(/[+#?!]/g, '').replace(/0/g, 'O');
    const uci = raw.toLowerCase().replace(/[^a-h1-8qrbn]/g, '');
    let match = candidates.find((m) => norm(m.san) === norm(raw));
    if (!match && /^[a-h][1-8][a-h][1-8][qrbn]?$/.test(uci)) {
      match = candidates.find(
        (m) => m.from === uci.slice(0, 2) && m.to === uci.slice(2, 4) &&
          (uci.length === 4 || (m.promotion || '') === uci[4])
      );
    }
    if (!match) {
      setMoveInputError(`“${raw}” isn’t a legal move here.`);
      return;
    }
    setMoveInputError('');
    setMoveInput('');
    tryHumanMove(match.from, match.to, match.promotion);
  };

  const flip = () => setOrientation((o) => (o === 'white' ? 'black' : 'white'));
  const resign = () => {
    if (gameOver) return;
    askConfirm({
      title: 'Resign this game?',
      body: rated
        ? 'This counts as a loss and will lower your rating.'
        : 'The game ends immediately and is scored as a loss.',
      confirmLabel: 'Resign',
      onConfirm: () => setResigned(humanColor),
    });
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
  // The player's own mistakes/blunders, newest last, as jump targets.
  const badPlies = accuracyReport
    ? moveStats
        .filter((m) => m.moverColor === humanColor && ['mistake', 'blunder'].includes(m.classification))
        .sort((a, b) => a.ply - b.ply)
        .map((m) => ({ ...m, san: sanHistory[m.ply - 1] }))
    : [];

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
    // Naming the pattern up front hands over most of the solve, so the theme
    // is hidden until the puzzle resolves (or the user opts in).
    const revealTheme = puzzleShowTheme || puzzleState === 'solved' || puzzleState === 'wrong';
    const tag = puzzle
      ? ` (${revealTheme ? `${puzzle.theme} · ` : ''}rated ${puzzle.rating})`
      : '';
    statusText = puzzleSessionDone
      ? 'Session complete.'
      : puzzleState === 'solved'
        ? `✓ ${puzzleMsg}`
        : puzzleState === 'wrong'
          ? puzzleMsg
          : puzzle && puzzle.kind === 'solution'
            ? `Puzzle ${puzzleIndex + 1}/${puzzlePool.length}: ${toMove} to play — find the best move.${tag}`
            : `Puzzle ${puzzleIndex + 1}/${puzzlePool.length}: ${toMove} to play${
                puzzleShowTheme ? `, mate in ${movesLeft}` : ' — find the win'
              }.${tag}`;
  } else if (gameResult) {
    statusText =
      gameResult.type === 'checkmate'
        ? `Checkmate — ${gameResult.winner === 'white' ? 'White' : 'Black'} wins`
        : gameResult.type === 'resign'
          ? `${gameResult.winner === 'white' ? 'White' : 'Black'} wins by resignation`
          : gameResult.type === 'timeout'
            ? `${gameResult.winner === 'white' ? 'White' : 'Black'} wins on time`
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
    statusText = describeEngineError(engineErrorLine);
  } else if (isThinking) {
    statusText = 'Stockfish is thinking…';
  } else {
    statusText = `${board.turn() === 'w' ? 'White' : 'Black'} to move${board.isCheck() ? ' — check' : ''}`;
  }

  // Live opening status — a durable "where am I in theory" readout, rather
  // than a flag on one transcript entry that scrolls away.
  const currentOpening = useMemo(
    () => (puzzleMode || drill.active ? null : detectOpening(sanHistory)),
    [sanHistory, puzzleMode, drill.active]
  );

  // Opening filters for mistake drills: which openings the stored mistakes
  // actually cover, and the one the user has narrowed to (null = all).
  const mistakeOpenings = useMemo(() => listMistakeOpenings(loadMistakes()), [dueCount, gameLog]);
  const drillableOpenings = useMemo(
    () => new Set(mistakeOpenings.map((o) => o.opening)),
    [mistakeOpenings]
  );

  // User-pickable puzzle themes, grouped into buckets a learner would actually
  // choose between ([] = the adaptive default).
  const puzzleThemes = useMemo(() => listThemeGroups(PUZZLES), []);
  // Selected groups expand to the raw theme labels selectSession filters on.
  const selectedThemeLabels = useMemo(
    () => puzzleThemes.filter((g) => puzzleThemeFilter.includes(g.group)).flatMap((g) => g.themes),
    [puzzleThemes, puzzleThemeFilter]
  );

  // Cross-game progress aggregation (coach/gameHistory.js).
  const progressTrend = useMemo(() => accuracyTrend(gameLog, { limit: 20 }), [gameLog]);
  const progressReport = useMemo(() => openingReportCard(gameLog), [gameLog]);
  const progressStats = useMemo(() => overallStats(gameLog), [gameLog]);

  // Spaced-repetition nudge: how many puzzles are due for review right now.
  // The mistake library already badges its button; puzzles never did.
  const puzzlesDue = useMemo(
    () => puzzlesDueCount(puzzleProgressState, PUZZLES),
    [puzzleProgressState]
  );

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
            {/* Balances the centred title on wide screens; collapses on small
                phones where a fixed 96px would crowd the row. */}
            <div className="hidden sm:block w-24" />
          </div>

          {/* First run: the app has coaching, puzzles, a rated ladder and a
              mistake library, and used to explain none of them. */}
          {!introSeen && (
            <div
              className="mb-4 rounded-xl px-4 py-3 flex items-start justify-between gap-3 font-body text-sm"
              style={{ backgroundColor: 'var(--color-accent-soft)', color: 'var(--color-text-primary)' }}
            >
              <span>
                <strong>New here?</strong> Just start playing — the coach explains every move, yours and the
                engine’s, for free. <em>Puzzles</em> drills tactics, <em>Rated</em> plays a ladder for a real Elo, and
                the moves you get wrong are saved so you can retrain them later.
              </span>
              <button
                onClick={() => setIntroSeen(true)}
                aria-label="Dismiss"
                className="shrink-0 tap-target"
                style={{ color: 'var(--color-text-muted)' }}
              >
                ✕
              </button>
            </div>
          )}

          {/* Two columns from md (tablets) and on short-but-wide viewports —
              a landscape phone is only ~390px tall, the worst place to be
              stuck in the tall single-column stack. */}
          <div className="grid grid-cols-1 md:grid-cols-2 landscape-2col gap-6 items-start">
            <div>
              <div className="mb-3 flex items-center gap-2 font-body text-sm" style={{ color: 'var(--color-text-secondary)' }} aria-live="polite">
                {(isThinking || engineStatus === 'loading') && <span className="engine-spinner" aria-hidden="true" />}
                <span>{statusText}</span>
                {engineStatus === 'error' && (
                  <button onClick={retryEngine} className="px-2 py-1 rounded font-body text-xs panel tap-target">
                    Retry
                  </button>
                )}
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
                  <span
                    style={{ color: 'var(--color-text-secondary)' }}
                    title={isProvisional(ratedGames) ? 'Provisional — still in your first 20 games, so the rating moves faster' : undefined}
                  >
                    You {rating}
                    {isProvisional(ratedGames) ? ' (provisional)' : ''} · Opponent {ratedRung.rating}
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
              {clockOn && (
                <div className="w-full max-w-[680px] mx-auto mb-2 flex items-center justify-between font-body">
                  {[
                    { c: orientation === 'white' ? 'b' : 'w', pos: 'top' },
                    { c: orientation === 'white' ? 'w' : 'b', pos: 'bottom' },
                  ].map(({ c, pos }) => (
                    <span
                      key={pos}
                      className={`px-3 py-1 rounded-lg text-lg font-semibold tabular-nums${
                        turnColor === c && !gameOver ? ' clock-active' : ''
                      }${clock[c] <= 10000 ? ' clock-low' : ''}`}
                      style={{ backgroundColor: 'var(--color-bg-panel)', color: 'var(--color-text-primary)' }}
                      aria-label={`${c === 'w' ? 'White' : 'Black'} clock`}
                    >
                      {c === 'w' ? '♔' : '♚'} {formatClock(clock[c])}
                    </span>
                  ))}
                </div>
              )}
              <div className="board-row flex gap-3 w-full max-w-[680px] mx-auto">
                {showEvalBar && !puzzleMode && !drill.active && !rated && (
                  <div
                    className="eval-bar w-3 sm:w-4 rounded overflow-hidden shrink-0 self-stretch flex flex-col border"
                    style={{ backgroundColor: '#3f3f46', borderColor: 'var(--color-border)' }}
                    title={`Evaluation ${evalLabel}`}
                    aria-label={`Evaluation ${evalLabel}`}
                  >
                    {/* Black share on top, White share on bottom (board orientation aside). */}
                    <div style={{ height: `${(1 - evalFraction) * 100}%`, transition: 'height 300ms ease' }} />
                    <div style={{ height: `${evalFraction * 100}%`, backgroundColor: '#fafafa', transition: 'height 300ms ease' }} />
                  </div>
                )}
                <div
                  className={`flex-1 min-w-0${puzzleFlash ? ` puzzle-flash-${puzzleFlash}` : ''}`}
                  onAnimationEnd={() => setPuzzleFlash(null)}
                >
                  {/* Top tray = pieces captured by the side shown at top.
                      Puzzles/drills start from composed positions, where a tray
                      of "captured" pieces is noise, not information. */}
                  <div className="flex items-center justify-between mb-1">
                    {!puzzleMode && !drill.active ? (
                      <Tray pieces={orientation === 'white' ? capturedByBlack : capturedByWhite} plus={0} />
                    ) : (
                      <span />
                    )}
                    {/* Material is arithmetic from the position, not an engine
                        hint, so it stays visible when the eval bar is off. */}
                    {!puzzleMode && !drill.active && (
                      <span className="font-body text-xs" style={{ color: 'var(--color-text-muted)' }}>
                        Material:{' '}
                        {material > 0 ? `White +${material}` : material < 0 ? `Black +${-material}` : 'even'}
                      </span>
                    )}
                  </div>
                  <Chessboard
                    position={displayFen}
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
                      // react-chessboard defaults rank/file labels to
                      // boardWidth/48, which is ~6px on a phone. It renders
                      // them as bare inline-styled divs with no class, so this
                      // prop is the only place the size can be set.
                      fontSize: 'clamp(11px, 3.2vw, 14px)',
                      textShadow:
                        '0 0 2px rgba(0,0,0,0.85), 0 1px 1px rgba(0,0,0,0.7), 0 -1px 1px rgba(0,0,0,0.7)',
                    }}
                    arePiecesDraggable={canInteract}
                    animationDuration={200}
                  />
                  {/* Bottom tray = pieces captured by the side shown at bottom */}
                  {!puzzleMode && !drill.active && (
                    <div className="mt-1">
                      <Tray pieces={orientation === 'white' ? capturedByWhite : capturedByBlack} plus={0} />
                    </div>
                  )}
                </div>
              </div>

              {reviewing && (
                <div
                  className="mt-3 w-full max-w-[680px] mx-auto flex items-center justify-between gap-2 rounded-lg px-3 py-2 font-body text-sm"
                  style={{ backgroundColor: 'var(--color-accent-soft)', color: 'var(--color-text-primary)' }}
                  aria-live="polite"
                >
                  <span>
                    Reviewing move {Math.ceil(reviewPly / 2)}
                    {reviewPly % 2 === 0 ? '…' : ''} — the board is read-only.
                  </span>
                  <span className="flex gap-2">
                    <button
                      onClick={() => setReviewPly((p) => Math.max(0, p - 1))}
                      disabled={reviewPly === 0}
                      className="px-2 py-1 rounded font-body text-xs panel disabled:opacity-40 tap-target"
                      aria-label="Previous move"
                    >
                      ←
                    </button>
                    <button
                      onClick={() => setReviewPly(null)}
                      className="px-3 py-1 rounded font-body text-xs btn-primary tap-target"
                    >
                      Back to live
                    </button>
                  </span>
                </div>
              )}

              {drill.active ? (
                <>
                  <div className="flex flex-wrap gap-2 justify-center mt-4">
                    <button
                      onClick={drill.reveal}
                      disabled={drill.state !== 'solving'}
                      className="px-4 py-2 rounded-lg font-body text-sm panel disabled:opacity-40 tap-target"
                    >
                      Show solution
                    </button>
                    <button onClick={nextDrill} className="px-4 py-2 rounded-lg font-body text-sm panel tap-target">
                      {drill.index + 1 < drill.total ? 'Next mistake →' : 'Finish'}
                    </button>
                    <button onClick={exitDrills} className="px-4 py-2 rounded-lg font-body text-sm panel tap-target">
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
              ) : puzzleMode && puzzleSessionDone ? (
                <div className="mt-4 w-full max-w-[680px] mx-auto panel rounded-xl p-4 text-center">
                  <h2 className="font-heading text-sm font-semibold mb-1" style={{ color: 'var(--color-text-primary)' }}>
                    {puzzlePool.length === 0 ? 'No puzzles match those themes' : 'Session complete'}
                  </h2>
                  {puzzlePool.length === 0 ? (
                    <p className="font-body text-sm" style={{ color: 'var(--color-text-secondary)' }}>
                      Nothing in the bank carries every theme you picked. Clear a theme or two in the Game panel and
                      try again.
                    </p>
                  ) : (
                  <p className="font-body text-sm" style={{ color: 'var(--color-text-secondary)' }}>
                    Solved {puzzleSolvedCount} of {puzzlePool.length}. Puzzle rating {puzzleProgressState.rating}
                    {puzzleStartRatingRef.current != null && (
                      <>
                        {' '}
                        ({puzzleProgressState.rating - puzzleStartRatingRef.current >= 0 ? '+' : ''}
                        {puzzleProgressState.rating - puzzleStartRatingRef.current})
                      </>
                    )}
                    .
                  </p>
                  )}
                  <div className="flex flex-wrap gap-2 justify-center mt-3">
                    <button onClick={startPuzzles} className="px-4 py-2 rounded-lg font-body text-sm btn-primary tap-target">
                      New session
                    </button>
                    <button onClick={resumeStashedGame} className="px-4 py-2 rounded-lg font-body text-sm panel tap-target">
                      {stashedGameRef.current ? 'Back to my game' : 'Exit puzzles'}
                    </button>
                  </div>
                </div>
              ) : puzzleMode ? (
                <>
                  <div className="flex flex-wrap gap-2 justify-center mt-4">
                    <button
                      onClick={requestPuzzleHint}
                      disabled={puzzleState === 'solved' || puzzleHintStage >= MAX_HINT_STAGE}
                      className="px-4 py-2 rounded-lg font-body text-sm panel disabled:opacity-40 tap-target"
                      title={puzzleHintStage === 0 ? 'Theme hint (free)' : 'Piece hint (counts as a miss)'}
                    >
                      Hint{puzzleHintStage > 0 ? ` (${puzzleHintStage}/${MAX_HINT_STAGE})` : ''}
                    </button>
                    <button onClick={retryPuzzle} className="px-4 py-2 rounded-lg font-body text-sm panel tap-target">
                      Reset puzzle
                    </button>
                    <button onClick={nextPuzzle} className="px-4 py-2 rounded-lg font-body text-sm panel tap-target">
                      Next puzzle &rarr;
                    </button>
                    <button onClick={resumeStashedGame} className="px-4 py-2 rounded-lg font-body text-sm panel tap-target">
                      {stashedGameRef.current ? 'Back to my game' : 'Exit puzzles'}
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
                  {refutation && puzzleState === 'wrong' && (
                    <div className="mt-2 flex flex-wrap gap-2 justify-center items-center">
                      <button onClick={playRefutation} className="px-3 py-2 rounded-lg font-body text-sm panel tap-target">
                        {refutationStep === 0 ? `Show why ${refutation.played} fails` : 'Next move'}
                      </button>
                      {refutationBoard && (
                        <>
                          <span className="font-body text-xs" style={{ color: 'var(--color-text-muted)' }}>
                            {refutation.pv.slice(0, refutationStep || refutation.pv.length).join(' ')}
                          </span>
                          <button
                            onClick={() => {
                              setRefutationBoard(null);
                              setRefutationStep(0);
                            }}
                            className="px-3 py-2 rounded-lg font-body text-sm panel tap-target"
                          >
                            Back to the puzzle
                          </button>
                        </>
                      )}
                    </div>
                  )}
                  <p className="mt-2 font-body text-xs text-center" style={{ color: 'var(--color-text-muted)' }}>
                    Your puzzle rating: {puzzleProgressState.rating}{puzzleDelta ? ' ' : ''}
                    {puzzleDelta && (
                      <span
                        className="font-semibold"
                        style={{ color: puzzleDelta.delta >= 0 ? 'var(--color-accent)' : 'var(--tone-bad, #dc2626)' }}
                      >
                        {puzzleDelta.delta >= 0 ? `+${puzzleDelta.delta}` : puzzleDelta.delta}
                      </span>
                    )}
                    {puzzleDelta && puzzleDelta.solved && puzzleDelta.nextDueAt
                      ? ` · ${describeNextDue(puzzleDelta.nextDueAt)}`
                      : ''}
                    {' · Tactics only — separate from your game rating.'}
                  </p>
                  <p className="mt-1 font-body text-xs text-center" style={{ color: 'var(--color-text-muted)' }}>
                    {puzzleHintStage === 0
                      ? 'First hint is free; the second names the piece and counts as a miss.'
                      : puzzleHintStage < MAX_HINT_STAGE
                        ? 'The next hint names the piece and counts as a miss.'
                        : 'Hints used.'}
                  </p>
                </>
              ) : (
                <div className="flex flex-wrap gap-2 justify-center mt-4">
                  {gameOver ? (
                    <>
                      <button
                        onClick={() => startGame(rated ? undefined : humanColor)}
                        className="px-4 py-2 rounded-lg font-body text-sm btn-primary tap-target"
                      >
                        {rated ? 'New Rated Game' : 'Rematch'}
                      </button>
                      {!rated && (
                        <button
                          onClick={() => startGame(humanColor === 'w' ? 'b' : 'w')}
                          className="px-4 py-2 rounded-lg font-body text-sm panel tap-target"
                        >
                          Play as {humanColor === 'w' ? 'Black' : 'White'}
                        </button>
                      )}
                    </>
                  ) : (
                    <button onClick={() => startGame()} className="px-4 py-2 rounded-lg font-body text-sm panel tap-target">
                      {rated ? 'New Rated Game' : 'New Game'}
                    </button>
                  )}
                  {!rated && (
                    <button
                      onClick={undo}
                      disabled={!board.canUndo() || isThinking}
                      className="px-4 py-2 rounded-lg font-body text-sm panel disabled:opacity-40 tap-target"
                    >
                      Undo
                    </button>
                  )}
                  {!rated && (
                    <button onClick={flip} className="px-4 py-2 rounded-lg font-body text-sm panel tap-target">
                      Flip
                    </button>
                  )}
                  <button
                    onClick={resign}
                    disabled={gameOver}
                    className="px-4 py-2 rounded-lg font-body text-sm panel disabled:opacity-40 tap-target"
                  >
                    Resign
                  </button>
                  {!rated && (
                    <button onClick={startPuzzles} className="px-4 py-2 rounded-lg font-body text-sm panel tap-target">
                      Puzzles{puzzlesDue > 0 ? ` (${puzzlesDue} due)` : ''}
                    </button>
                  )}
                  {!rated && (
                    <button
                      onClick={trainMistakes}
                      disabled={dueCount === 0}
                      className="px-4 py-2 rounded-lg font-body text-sm panel disabled:opacity-40 tap-target"
                      title={dueCount === 0 ? 'No mistakes due for review — play some games first' : undefined}
                    >
                      Train my mistakes{dueCount > 0 ? ` (${dueCount})` : ''}
                    </button>
                  )}
                </div>
              )}

            </div>

            <div className="flex flex-col gap-4 md:min-h-[calc(100vh-7rem)]">
              {/* Post-game mistake review (#23) — retry this game's mistakes */}
              {accuracyReport && gameMistakes.length > 0 && (
                <MistakeReviewPanel mistakes={gameMistakes} onRetry={retryMistake} />
              )}

              {/* Cross-game progress — shown between games, where a learner is
                  deciding what to work on, rather than competing with the
                  board mid-game. */}
              {(gameOver || movesPlayedCount === 0) && !puzzleMode && !drill.active && (
                <ProgressPanel
                  trend={progressTrend}
                  report={progressReport}
                  stats={progressStats}
                  drillableOpenings={drillableOpenings}
                  onDrillOpening={drillOpening}
                />
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
                        {/* Counting them isn't much use if you can't find
                            them — jump straight to the position. */}
                        {label === 'You' && badPlies.length > 0 && (
                          <div className="flex flex-wrap gap-1 mt-1">
                            {badPlies.map((m) => (
                              <button
                                key={m.ply}
                                onClick={() => setReviewPly(m.ply)}
                                className={`px-2 py-1 rounded font-body text-xs panel ${
                                  m.classification === 'blunder' ? 'tone-bad' : 'tone-warn'
                                }`}
                                title={`Show move ${Math.ceil(m.ply / 2)}`}
                              >
                                {Math.ceil(m.ply / 2)}
                                {m.moverColor === 'b' ? '…' : '.'} {m.san || ''}
                              </button>
                            ))}
                          </div>
                        )}
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
                    {gameOver
                      ? 'Game over — your accuracy and mistakes from this game are above, and any blunders were saved to your mistake library for drilling.'
                      : 'Coaching, the evaluation bar, undo and flip are off during rated games so the result is honest. Your moves are still analysed quietly — you’ll get the full review when the game ends.'}
                  </p>
                </div>
              ) : (
              <div className="panel rounded-xl p-4 flex flex-col flex-1 min-h-0">
                <div className="flex items-center justify-between mb-2">
                  <h2 className="font-heading text-sm font-semibold" style={{ color: 'var(--color-text-primary)' }}>
                    Coach
                  </h2>
                  <span className="flex items-center gap-2">
                    <button
                      onClick={() => setShowLegend((v) => !v)}
                      className="font-body text-xs tap-target"
                      style={{ color: 'var(--color-text-muted)' }}
                      aria-expanded={showLegend}
                      title="What do the move labels mean?"
                    >
                      ⓘ labels
                    </button>
                    <span className="font-body text-xs" style={{ color: 'var(--color-text-muted)' }}>
                      {keySet ? (coaching ? 'thinking…' : 'Claude (fast)') : 'built-in'}
                    </span>
                  </span>
                </div>

                {/* Where you are in theory right now, and what the opening is
                    actually trying to do — available with or without a key. */}
                {currentOpening && currentOpening.name && (
                  <div className="mb-2 font-body text-xs" style={{ color: 'var(--color-text-secondary)' }}>
                    <span style={{ color: 'var(--color-accent)' }}>{currentOpening.name}</span>
                    {currentOpening.inBook ? (
                      <span> · in book</span>
                    ) : (
                      <span> · out of book since move {Math.ceil(currentOpening.leftBookAtPly / 2)}</span>
                    )}
                    {currentOpening.idea && <p className="mt-0.5">{currentOpening.idea}</p>}
                    {!lichessSet && currentOpening.inBook && (
                      <button
                        onClick={() => {
                          setSettingsPanelOpen(true);
                          setShowLichessField(true);
                        }}
                        className="mt-1 tap-target"
                        style={{ color: 'var(--color-accent)' }}
                      >
                        Add a free Lichess token for real master statistics →
                      </button>
                    )}
                  </div>
                )}

                {/* What the six move labels actually mean, in centipawns. */}
                {showLegend && (
                  <ul className="mb-2 space-y-0.5 font-body text-xs" style={{ color: 'var(--color-text-secondary)' }}>
                    {CLASSIFICATION_LEGEND.map((c) => (
                      <li key={c.key}>
                        <span className="font-semibold">{c.label}</span> — {c.description}
                      </li>
                    ))}
                  </ul>
                )}

                {/* The single biggest drop-off in the coaching funnel was that
                    nobody knew richer coaching existed. This nudge persists
                    instead of vanishing after the first move. */}
                {!keySet && !keyNudgeDismissed && (
                  <div
                    className="mb-2 rounded-lg px-3 py-2 font-body text-xs flex items-start justify-between gap-2"
                    style={{ backgroundColor: 'var(--color-accent-soft)', color: 'var(--color-text-primary)' }}
                  >
                    <span>
                      You’re on built-in coaching. Add an Anthropic API key for explanations written for your
                      position — roughly a few cents per game.{' '}
                      <a
                        href="https://console.anthropic.com/settings/keys"
                        target="_blank"
                        rel="noreferrer"
                        style={{ color: 'var(--color-accent)' }}
                      >
                        Get a key
                      </a>
                      {', then paste it under Settings below.'}
                    </span>
                    <button
                      onClick={() => setKeyNudgeDismissed(true)}
                      aria-label="Dismiss"
                      className="shrink-0 tap-target"
                      style={{ color: 'var(--color-text-muted)' }}
                    >
                      ✕
                    </button>
                  </div>
                )}

                {/* A key that's present but failing looks exactly like no key
                    at all — which reads as "Claude coaching is mediocre". */}
                {keySet && coachKeyFailing && (
                  <p className="mb-2 font-body text-xs tone-warn">
                    ⚠ Couldn’t reach Claude — showing built-in analysis. Check that your API key is valid and has credit.
                  </p>
                )}
                <div
                  ref={transcriptRef}
                  className="flex-1 min-h-0 overflow-y-auto pr-1 space-y-2 max-h-[55vh] md:max-h-none"
                  aria-live="polite"
                >
                  {dialogue.length === 0 ? (
                    <p className="font-body text-sm" style={{ color: 'var(--color-text-muted)' }}>
                      Make a move and I’ll explain what’s happening — your moves and mine.
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
                            disabled={!keySet}
                            title={keySet ? undefined : 'Needs an Anthropic API key — add one in Settings'}
                            className="mt-1 px-2 py-1 -ml-2 rounded text-xs font-body tap-target disabled:opacity-40"
                            style={{ color: 'var(--color-accent)' }}
                          >
                            {e.thread && e.thread.length
                              ? `Continue (${e.thread.filter((m) => m.role === 'user').length})`
                              : 'Ask about this move'}{' '}
                            →
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
                {/* The lockouts used to be explained only after you'd already
                    switched (and lost your game). Say it before the click. */}
                {!rated && (
                  <p className="font-body text-xs -mt-2" style={{ color: 'var(--color-text-muted)' }}>
                    Plays a ladder opponent matched to your Elo. Undo, flip, the eval bar and live coaching switch off
                    so the result is honest — you still get the full review once the game ends. Starts a new game.
                  </p>
                )}

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
                        ? `Provisional — ${ratedGames} of 20 placement games played, so your rating still moves in big steps. Currently matched against a ${ratedRung.rating}-rated opponent.`
                        : `${ratedGames} games played. Currently matched against a ${ratedRung.rating}-rated opponent.`}
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
                      {syncStatus === 'synced' && (account
                        ? '☁ Synced to your account — your progress follows you across devices.'
                        : '☁ Synced to your API key — your rating follows you across devices.')}
                      {syncStatus === 'syncing' && '☁ Syncing…'}
                      {syncStatus === 'error' && '⚠ Couldn’t reach the rating store — using your rating on this device.'}
                      {syncStatus === 'local' && 'Saved on this device. (Rating sync isn’t configured on the server.)'}
                      {syncStatus === 'off' && 'Create an account or add an Anthropic API key in Settings to sync your rating across devices.'}
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
                      {/* Raw Elo means nothing to a player who doesn't know
                          their own rating — say what the tier plays like. */}
                      {(() => {
                        const tier = DIFFICULTY_TIERS.find((t) => t.key === difficulty);
                        return tier && tier.blurb ? (
                          <p className="font-body text-xs mt-1" style={{ color: 'var(--color-text-secondary)' }}>
                            {tier.blurb}.
                            {movesPlayedCount > 0 && !gameOver && ' Changing this takes effect on the opponent’s next move.'}
                          </p>
                        ) : null;
                      })()}
                      {formatRecord(history, false, difficulty) && (
                        <p className="font-body text-xs mt-1" style={{ color: 'var(--color-text-muted)' }}>
                          Record: {formatRecord(history, false, difficulty)}
                        </p>
                      )}
                    </div>
                    {/* Deliberate practice: pick what to drill instead of only
                        taking whatever the adaptive queue serves up. */}
                    <div>
                      <label className="block font-body text-xs mb-1" style={{ color: 'var(--color-text-secondary)' }}>
                        Puzzle themes
                      </label>
                      <div className="flex flex-wrap gap-1">
                        <button
                          onClick={() => setPuzzleThemeFilter([])}
                          className={`px-2 py-1 rounded-full font-body text-xs panel tap-target${
                            puzzleThemeFilter.length === 0 ? ' is-selected' : ''
                          }`}
                        >
                          Adaptive
                        </button>
                        {puzzleThemes.map(({ group, count }) => {
                          const on = puzzleThemeFilter.includes(group);
                          return (
                            <button
                              key={group}
                              onClick={() =>
                                setPuzzleThemeFilter((cur) =>
                                  cur.includes(group) ? cur.filter((t) => t !== group) : [...cur, group]
                                )
                              }
                              aria-pressed={on}
                              className={`px-2 py-1 rounded-full font-body text-xs panel tap-target${on ? ' is-selected' : ''}`}
                            >
                              {group} ({count})
                            </button>
                          );
                        })}
                      </div>
                      <p className="mt-1 font-body text-xs" style={{ color: 'var(--color-text-muted)' }}>
                        {puzzleThemeFilter.length === 0
                          ? 'Puzzles are picked for you: reviews first, then new ones near your rating.'
                          : 'Only these themes will appear in your next session.'}
                      </p>
                    </div>

                    {mistakeOpenings.length > 0 && (
                      <div>
                        <label className="block font-body text-xs mb-1" style={{ color: 'var(--color-text-secondary)' }}>
                          Drill mistakes from
                        </label>
                        <div className="flex flex-wrap gap-1">
                          <button
                            onClick={() => setDrillOpeningFilter(null)}
                            className={`px-2 py-1 rounded-full font-body text-xs panel tap-target${
                              drillOpeningFilter == null ? ' is-selected' : ''
                            }`}
                          >
                            Any opening
                          </button>
                          {mistakeOpenings.slice(0, 6).map(({ opening, count }) => (
                            <button
                              key={opening}
                              onClick={() => setDrillOpeningFilter((cur) => (cur === opening ? null : opening))}
                              aria-pressed={drillOpeningFilter === opening}
                              className={`px-2 py-1 rounded-full font-body text-xs panel tap-target${
                                drillOpeningFilter === opening ? ' is-selected' : ''
                              }`}
                            >
                              {opening} ({count})
                            </button>
                          ))}
                        </div>
                      </div>
                    )}

                    <div>
                      <label className="block font-body text-xs mb-1" style={{ color: 'var(--color-text-secondary)' }}>
                        Clock
                      </label>
                      <select
                        value={timeControl}
                        onChange={(e) => {
                          setTimeControl(e.target.value);
                          const tc = getTimeControl(e.target.value);
                          setClock({ w: tc.base * 1000, b: tc.base * 1000 });
                          setFlagged(null);
                        }}
                        className="w-full px-3 py-2 rounded-lg font-body text-sm panel"
                        style={{ color: 'var(--color-text-primary)', backgroundColor: 'var(--color-bg-panel)' }}
                      >
                        {TIME_CONTROLS.map((t) => (
                          <option key={t.key} value={t.key}>
                            {t.label}
                          </option>
                        ))}
                      </select>
                      <p className="font-body text-xs mt-1" style={{ color: 'var(--color-text-muted)' }}>
                        Clocks start on the first move. Takes effect on your next new game.
                      </p>
                    </div>
                    <div>
                      <label className="block font-body text-xs mb-1" style={{ color: 'var(--color-text-secondary)' }}>
                        Play as
                      </label>
                      <div className="flex gap-2">
                        {[
                          { c: 'w', label: 'White' },
                          { c: 'b', label: 'Black' },
                        ].map(({ c, label }) => (
                          <button
                            key={c}
                            onClick={() => startGame(c)}
                            aria-pressed={humanColor === c}
                            className={`flex-1 px-3 py-2 rounded-lg font-body text-sm panel tap-target${
                              humanColor === c ? ' is-selected' : ''
                            }`}
                          >
                            {label}
                          </button>
                        ))}
                      </div>
                      <p className="mt-1 font-body text-xs" style={{ color: 'var(--color-text-muted)' }}>
                        Picking a colour starts a new game.
                      </p>
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
                <h3 className="settings-section">Display</h3>
                <Toggle label="Dark mode" checked={darkMode} onChange={() => setDarkMode((v) => !v)} />
                <Toggle label="Show legal moves" checked={showMoves} onChange={() => setShowMoves((v) => !v)} />
                <Toggle label="Evaluation bar" checked={showEvalBar} onChange={() => setShowEvalBar((v) => !v)} />
                <Toggle label="Sound" checked={soundOn} onChange={() => setSoundOn((v) => !v)} />
                <Toggle
                  label="Tell me the puzzle theme up front"
                  checked={puzzleShowTheme}
                  onChange={() => setPuzzleShowTheme((v) => !v)}
                />

                <h3 className="settings-section">Coaching &amp; AI</h3>
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
                  <div className="flex flex-wrap gap-1 mt-1">
                    {['Tactics', 'Endgames', 'King safety', 'Openings', 'Stop blundering'].map((g) => (
                      <button
                        key={g}
                        onClick={() => setLearningGoal(g)}
                        className="px-2 py-1 rounded-full font-body text-xs panel tap-target"
                      >
                        {g}
                      </button>
                    ))}
                  </div>
                  <p className="mt-1 font-body text-xs" style={{ color: 'var(--color-text-muted)' }}>
                    Steers the coach toward what you’re working on.
                  </p>
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
                      <button onClick={() => setShowKeyField(true)} className="px-2 py-1 rounded font-body text-xs panel tap-target">
                        Change
                      </button>
                      <button onClick={removeKey} className="px-2 py-1 rounded font-body text-xs panel tap-target">
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
                      <button onClick={saveKey} disabled={!apiKeyInput.trim()} className="px-3 py-2 rounded-lg font-body text-sm panel disabled:opacity-40 tap-target">
                        Save
                      </button>
                    </div>
                  )}
                  {keyFormatWarning && (
                    <p className="mt-1 font-body text-xs tone-warn">{keyFormatWarning}</p>
                  )}
                  <p className="mt-1 font-body text-xs" style={{ color: 'var(--color-text-muted)' }}>
                    Stored only in your browser. Never sent anywhere but Anthropic. Coaching works without it using
                    built-in analysis. Costs roughly a few cents per game.{' '}
                    <a
                      href="https://console.anthropic.com/settings/keys"
                      target="_blank"
                      rel="noreferrer"
                      style={{ color: 'var(--color-accent)' }}
                    >
                      Create a key
                    </a>{' '}
                    (needs an Anthropic developer account with credit — separate from a claude.ai subscription).
                  </p>
                </div>

                <h3 className="settings-section">Account &amp; sync</h3>
                <div>
                  <label className="block font-body text-xs mb-1" style={{ color: 'var(--color-text-secondary)' }}>
                    Account
                  </label>
                  {account ? (
                    <>
                      <div className="flex items-center gap-2">
                        <span className="font-body text-sm" style={{ color: 'var(--color-text-secondary)' }}>
                          Signed in as {account.username}
                        </span>
                        <button onClick={handleSignOut} className="px-2 py-1 rounded font-body text-xs panel tap-target">
                          Sign out
                        </button>
                      </div>
                      <p className="mt-1 font-body text-xs" style={{ color: 'var(--color-text-muted)' }}>
                        Your API key and profile sync through this account.
                      </p>
                    </>
                  ) : (
                    <>
                      <div className="flex flex-col gap-2">
                        <input
                          type="text"
                          value={accountUsername}
                          onChange={(e) => setAccountUsername(e.target.value)}
                          placeholder="Username"
                          className="w-full px-3 py-2 rounded-lg font-body text-sm panel"
                          style={{ color: 'var(--color-text-primary)', backgroundColor: 'var(--color-bg-panel)' }}
                        />
                        <div className="flex gap-2">
                          <input
                            type={showPassword ? 'text' : 'password'}
                            value={accountPassword}
                            onChange={(e) => setAccountPassword(e.target.value)}
                            placeholder="Password"
                            className="flex-1 min-w-0 px-3 py-2 rounded-lg font-body text-sm panel"
                            style={{ color: 'var(--color-text-primary)', backgroundColor: 'var(--color-bg-panel)' }}
                          />
                          <button
                            onClick={() => setShowPassword((v) => !v)}
                            aria-label={showPassword ? 'Hide password' : 'Show password'}
                            className="px-3 py-2 rounded-lg font-body text-xs panel tap-target"
                          >
                            {showPassword ? 'Hide' : 'Show'}
                          </button>
                        </div>
                        {/* There is no password reset, so a typo at creation is
                            an unrecoverable account. Confirm it. */}
                        {creatingAccount && (
                          <input
                            type={showPassword ? 'text' : 'password'}
                            value={accountPassword2}
                            onChange={(e) => setAccountPassword2(e.target.value)}
                            placeholder="Confirm password"
                            className="w-full px-3 py-2 rounded-lg font-body text-sm panel"
                            style={{ color: 'var(--color-text-primary)', backgroundColor: 'var(--color-bg-panel)' }}
                          />
                        )}
                        <div className="flex gap-2">
                          <button
                            onClick={() => {
                              setCreatingAccount(false);
                              handleSignIn();
                            }}
                            disabled={accountBusy || !accountUsername.trim() || !accountPassword}
                            className="flex-1 px-3 py-2 rounded-lg font-body text-sm panel disabled:opacity-40 tap-target"
                          >
                            {accountBusy ? 'Working…' : 'Sign in'}
                          </button>
                          <button
                            onClick={() => {
                              if (!creatingAccount) {
                                setCreatingAccount(true);
                                setAccountError('');
                                return;
                              }
                              handleCreateAccount();
                            }}
                            disabled={accountBusy || !accountUsername.trim() || !accountPassword}
                            className="flex-1 px-3 py-2 rounded-lg font-body text-sm panel disabled:opacity-40 tap-target"
                          >
                            {accountBusy ? 'Working…' : 'Create account'}
                          </button>
                        </div>
                      </div>
                      {accountError && (
                        <p className="mt-1 font-body text-xs tone-bad">{accountError}</p>
                      )}
                      {creatingAccount && (
                        <p className="mt-2 rounded-lg px-3 py-2 font-body text-xs tone-warn" style={{ backgroundColor: 'var(--color-accent-soft)' }}>
                          There is no password reset and no email on file. If you forget this password, the account —
                          and the rating, puzzle progress and mistake library in it — is gone for good. Save it somewhere.
                        </p>
                      )}
                      <p className="mt-1 font-body text-xs" style={{ color: 'var(--color-text-muted)' }}>
                        One password unlocks your coach key, your Lichess token and your progress on any device — and
                        the same key powers the AI chat in Catan, Splendor and Diplomacy. Your password never leaves
                        this device: the server only ever stores an unreadable hash, and your keys only as ciphertext
                        it cannot decrypt. Usernames aren’t case-sensitive.
                      </p>
                    </>
                  )}
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
                      <button onClick={() => setShowLichessField(true)} className="px-2 py-1 rounded font-body text-xs panel tap-target">
                        Change
                      </button>
                      <button onClick={removeLichess} className="px-2 py-1 rounded font-body text-xs panel tap-target">
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
                      <button onClick={saveLichess} disabled={!lichessInput.trim()} className="px-3 py-2 rounded-lg font-body text-sm panel disabled:opacity-40 tap-target">
                        Save
                      </button>
                    </div>
                  )}
                  <p className="mt-1 font-body text-xs" style={{ color: 'var(--color-text-muted)' }}>
                    Optional. Stored only in your browser, sent only to Lichess. Adds “masters play X% here” to opening
                    moves; without it you still get the “Book” label.{' '}
                    <a
                      href="https://lichess.org/account/oauth/token"
                      target="_blank"
                      rel="noreferrer"
                      style={{ color: 'var(--color-accent)' }}
                    >
                      Create a free token
                    </a>{' '}
                    — read-only, it can’t play moves or post on your behalf. (Lichess put the explorer behind auth
                    after repeated DDoS attacks.)
                  </p>
                </div>

                {/* Sync applies to rating, opponent history, puzzles and
                    mistakes — not just rated play, where it used to hide. */}
                <p
                  className="font-body text-xs"
                  style={{ color: syncStatus === 'synced' ? 'var(--color-accent)' : 'var(--color-text-muted)' }}
                >
                  {syncStatus === 'synced' &&
                    (account
                      ? '☁ Synced — rating, opponent history, puzzles and mistakes follow your account across devices.'
                      : '☁ Synced to your API key — rating, history, puzzles and mistakes follow you across devices.')}
                  {syncStatus === 'syncing' && '☁ Syncing…'}
                  {syncStatus === 'error' && '⚠ Couldn’t reach the sync store — your progress is safe on this device.'}
                  {syncStatus === 'local' && 'Saved on this device. (Sync isn’t configured on this deployment.)'}
                  {syncStatus === 'off' && 'Not syncing. Create an account (or add an API key) to carry your progress between devices.'}
                </p>
                </div>
              </details>
            </div>
            {/* Keyboard move entry — the board is pointer-only, which locks out
                keyboard-only players. SAN or UCI, validated before it's played. */}
            {canInteract && (
              <div className="w-full max-w-[680px] mx-auto mt-3 md:col-start-1">
                <form
                  onSubmit={(ev) => {
                    ev.preventDefault();
                    submitTypedMove();
                  }}
                  className="flex gap-2"
                >
                  <label htmlFor="chess-move-input" className="sr-only">
                    Type a move
                  </label>
                  <input
                    id="chess-move-input"
                    type="text"
                    value={moveInput}
                    onChange={(e) => {
                      setMoveInput(e.target.value);
                      setMoveInputError('');
                    }}
                    placeholder="Type a move — e.g. e4, Nf3, e2e4"
                    autoComplete="off"
                    className="flex-1 min-w-0 px-3 py-2 rounded-lg font-body text-sm panel"
                    style={{ color: 'var(--color-text-primary)', backgroundColor: 'var(--color-bg-panel)' }}
                  />
                  <button
                    type="submit"
                    disabled={!moveInput.trim()}
                    className="px-3 py-2 rounded-lg font-body text-sm panel disabled:opacity-40 tap-target"
                  >
                    Play
                  </button>
                </form>
                {moveInputError && <p className="mt-1 font-body text-xs tone-bad">{moveInputError}</p>}
              </div>
            )}

            {/* Moves — a direct grid child: under the board on desktop,
                after the coach on phones (source order = mobile order). */}
            <div className="panel rounded-xl p-4 mt-4 w-full max-w-[680px] mx-auto moves-panel md:col-start-1">
                <div className="flex items-center justify-between mb-2">
                  <h2 className="font-heading text-sm font-semibold" style={{ color: 'var(--color-text-primary)' }}>
                    Moves
                  </h2>
                  <div className="flex gap-2">
                    <button
                      onClick={exportPgn}
                      disabled={movePairs.length === 0}
                      className="px-2 py-1 rounded font-body text-xs panel disabled:opacity-40 tap-target"
                    >
                      Export
                    </button>
                    <button onClick={() => fileInputRef.current && fileInputRef.current.click()} className="px-2 py-1 rounded font-body text-xs panel tap-target">
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
                        <li key={i} className="flex gap-3 items-center">
                          <span style={{ color: 'var(--color-text-muted)' }} className="w-6 text-right">
                            {i + 1}.
                          </span>
                          {[0, 1].map((side) => {
                            const san = pair[side];
                            if (!san) return <span key={side} className="min-w-[4rem]" />;
                            const ply = i * 2 + side + 1;
                            const isCurrent = reviewing ? reviewPly === ply : ply === sanHistory.length;
                            return (
                              <button
                                key={side}
                                onClick={() => setReviewPly(ply === sanHistory.length ? null : ply)}
                                // NB: no .tap-target here — these sit ~20px
                                // apart, so a 44px overlay would swallow the
                                // neighbouring move's clicks. Real padding
                                // gives the row height instead.
                                className={`min-w-[4rem] text-left break-words rounded px-2 py-2${isCurrent ? ' move-current' : ''}`}
                                title="Show this position"
                              >
                                {san}
                              </button>
                            );
                          })}
                        </li>
                      ))}
                    </ol>
                  )}
                </div>
              </div>
          </div>
        </div>
      </div>

      {/* Imported PGN: which side is "you"? */}
      {importPrompt && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center modal-safe-area"
          style={{ backgroundColor: 'rgba(0,0,0,0.5)' }}
          role="dialog"
          aria-modal="true"
          aria-label="Choose which side to review as"
        >
          <div className="panel rounded-2xl w-full max-w-sm p-5 modal-safe-bottom">
            <h3 className="font-heading text-sm font-semibold mb-2" style={{ color: 'var(--color-text-primary)' }}>
              Which side did you play?
            </h3>
            <p className="font-body text-sm mb-4" style={{ color: 'var(--color-text-secondary)' }}>
              Coaching labels moves as “you” or “opponent” based on this.
            </p>
            <div className="flex gap-2">
              {[
                { c: 'w', label: 'White', who: importPrompt.players.white },
                { c: 'b', label: 'Black', who: importPrompt.players.black },
              ].map(({ c, label, who }) => (
                <button
                  key={c}
                  onClick={() => {
                    importPrompt.apply(c);
                    setImportPrompt(null);
                  }}
                  className="flex-1 px-3 py-2 rounded-lg font-body text-sm panel tap-target"
                >
                  {label}
                  {who ? <span className="block text-xs" style={{ color: 'var(--color-text-muted)' }}>{who}</span> : null}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Confirmation for anything that destroys state the user can't recover */}
      {confirmPrompt && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center modal-safe-area"
          style={{ backgroundColor: 'rgba(0,0,0,0.5)' }}
          onClick={() => setConfirmPrompt(null)}
          role="dialog"
          aria-modal="true"
          aria-label={confirmPrompt.title}
        >
          <div
            className="panel rounded-2xl w-full max-w-sm p-5 modal-safe-bottom"
            onClick={(ev) => ev.stopPropagation()}
          >
            <h3 className="font-heading text-sm font-semibold mb-2" style={{ color: 'var(--color-text-primary)' }}>
              {confirmPrompt.title}
            </h3>
            <p className="font-body text-sm mb-4" style={{ color: 'var(--color-text-secondary)' }}>
              {confirmPrompt.body}
            </p>
            <div className="flex gap-2 justify-end">
              <button
                onClick={() => setConfirmPrompt(null)}
                className="px-4 py-2 rounded-lg font-body text-sm panel tap-target"
              >
                Cancel
              </button>
              <button
                onClick={() => {
                  const { onConfirm } = confirmPrompt;
                  setConfirmPrompt(null);
                  onConfirm();
                }}
                className="px-4 py-2 rounded-lg font-body text-sm btn-primary tap-target"
              >
                {confirmPrompt.confirmLabel}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Move-thread Q&A modal (tool-use, Stockfish-grounded) */}
      {threadEntry && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center modal-safe-area"
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
                    className="px-3 py-2 rounded-lg font-body text-sm panel disabled:opacity-40 tap-target"
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
