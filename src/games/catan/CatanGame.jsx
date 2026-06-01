// CatanGame.jsx - React UI + SVG rendering for Catan.

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import CatanBoard, { RESOURCES, COSTS, resourceTotal } from './CatanBoard.js';
import { CATAN_RULESETS, RULESET_GROUPS, getDefaultScenario, getRuleset, normalizePlayerCount } from './catanRulesets.js';
import useAIWorker from './hooks/useAIWorker.js';
import { MCTS } from './engine/mcts.js';
import { applyAIMove } from './engine/aiPlayer.js';
import './catan.css';

const HUMAN_PLAYER = 1;
const BOARD_VIEWBOX = { width: 760, height: 720, pad: 56 };

const DIFFICULTY_CONFIG = {
  strong: { simulations: 260, maxChildren: 34 },
  expert: { simulations: 420, maxChildren: 42 },
  brutal: { simulations: 650, maxChildren: 50 },
};

const RESOURCE_LABELS = {
  brick: 'Brick',
  lumber: 'Lumber',
  wool: 'Wool',
  grain: 'Grain',
  ore: 'Ore',
};

const DEV_LABELS = {
  knight: 'Knight',
  victoryPoint: 'VP',
  roadBuilding: 'Roads',
  yearOfPlenty: 'Plenty',
  monopoly: 'Monopoly',
};

const ACTIONS = [
  { id: 'road', label: 'Road', cost: COSTS.road },
  { id: 'settlement', label: 'Settlement', cost: COSTS.settlement },
  { id: 'city', label: 'City', cost: COSTS.city },
];

function formatCost(cost) {
  return Object.entries(cost)
    .map(([resource, amount]) => `${amount} ${RESOURCE_LABELS[resource]}`)
    .join(', ');
}

function getStoredRulesetId() {
  const stored = localStorage.getItem('catanRulesetId') || 'base-classic';
  return getRuleset(stored).id;
}

function getStoredPlayerCount(ruleset) {
  return normalizePlayerCount(ruleset, localStorage.getItem('catanPlayerCount') || ruleset.defaultPlayerCount);
}

function getStoredScenarioId(ruleset) {
  const stored = localStorage.getItem('catanScenarioId');
  if (stored && ruleset.scenarios?.some(scenario => scenario.id === stored)) return stored;
  return getDefaultScenario(ruleset)?.id || null;
}

function loadInitialConfig() {
  const ruleset = getRuleset(getStoredRulesetId());
  return {
    rulesetId: ruleset.id,
    playerCount: getStoredPlayerCount(ruleset),
    scenarioId: getStoredScenarioId(ruleset),
  };
}

// ----- Terrain illustration helpers (purely decorative, pointer-events: none) -----
// Motifs are authored in a -50..50 coordinate space centred on the tile, then
// translated/scaled to the tile's on-screen radius. Silhouettes use black/white
// alpha so they read correctly over both the light and dark resource base colours.
const T_SHADOW = 'rgba(38,26,14,0.34)';
const T_SHADOW_DEEP = 'rgba(28,18,10,0.52)';
const T_LIGHT = 'rgba(255,255,255,0.30)';
const T_FLEECE = 'rgba(255,255,255,0.86)';
const T_SNOW = 'rgba(255,255,255,0.78)';
const T_SUN = 'rgba(255,248,224,0.55)';

function pine(key, x, base, s) {
  const w = 17 * s;
  const h = 25 * s;
  const trunk = 6 * s;
  const top = base - trunk;
  return (
    <g key={key}>
      <rect x={x - 1.7 * s} y={top - 1} width={3.4 * s} height={trunk + 1.5} rx={1} fill={T_SHADOW_DEEP} />
      <polygon points={`${x},${top - h} ${x - w / 2},${top} ${x + w / 2},${top}`} fill={T_SHADOW} />
      <polygon points={`${x},${top - h} ${x - w * 0.3},${top - h * 0.46} ${x + w * 0.3},${top - h * 0.46}`} fill={T_LIGHT} />
    </g>
  );
}

function sheep(key, x, y, s) {
  return (
    <g key={key}>
      <ellipse cx={x} cy={y} rx={11 * s} ry={8 * s} fill={T_FLEECE} />
      <ellipse cx={x - 9 * s} cy={y - 2 * s} rx={4 * s} ry={4 * s} fill="rgba(36,26,18,0.72)" />
      <rect x={x - 3 * s} y={y + 5 * s} width={2 * s} height={5 * s} fill="rgba(36,26,18,0.6)" />
      <rect x={x + 3 * s} y={y + 5 * s} width={2 * s} height={5 * s} fill="rgba(36,26,18,0.6)" />
    </g>
  );
}

function stalk(key, x, base, h) {
  const top = base - h;
  return (
    <g key={key}>
      <line x1={x} y1={base} x2={x} y2={top} stroke={T_SHADOW} strokeWidth={1.6} />
      <ellipse cx={x} cy={top - 1} rx={2.6} ry={5} fill={T_SHADOW} />
      <ellipse cx={x - 0.8} cy={top - 2} rx={1} ry={3} fill={T_LIGHT} />
    </g>
  );
}

function tileTerrain(resource, cx, cy, r) {
  const s = r / 50;
  let motif = null;
  switch (resource) {
    case 'lumber':
      motif = (
        <>
          {pine('p1', -24, 16, 1.0)}
          {pine('p2', 22, 12, 1.0)}
          {pine('p3', -10, -4, 0.78)}
          {pine('p4', 10, 0, 0.82)}
          {pine('p5', -2, 24, 1.35)}
        </>
      );
      break;
    case 'brick':
      motif = (
        <>
          <path d="M-46 22 Q-22 -6 2 18 Q22 0 46 20 L46 32 L-46 32 Z" fill={T_SHADOW} />
          {[0, 1, 2].map(row => {
            const y = 4 + row * 7;
            const offset = row % 2 ? 5 : 0;
            return [0, 1, 2, 3].map(col => {
              const x = -20 + offset + col * 10;
              if (x > 22) return null;
              return <rect key={`b${row}-${col}`} x={x} y={y} width={9} height={6} rx={1} fill={T_SHADOW_DEEP} stroke={T_LIGHT} strokeWidth={0.8} />;
            });
          })}
        </>
      );
      break;
    case 'wool':
      motif = (
        <>
          <path d="M-46 24 Q0 4 46 24 L46 32 L-46 32 Z" fill={T_LIGHT} />
          {sheep('s1', -16, 8, 1.1)}
          {sheep('s2', 16, 18, 0.95)}
          {sheep('s3', 4, -6, 0.78)}
        </>
      );
      break;
    case 'grain':
      motif = (
        <>
          <path d="M-46 26 Q0 12 46 26 L46 32 L-46 32 Z" fill={T_SHADOW} />
          {[-22, -14, -6, 2, 10, 18, 26].map((x, i) => stalk(`w${i}`, x, 27, 22 + (i % 2) * 6))}
        </>
      );
      break;
    case 'ore':
      motif = (
        <>
          <polygon points="-20,-12 -42,24 2,24" fill={T_SHADOW_DEEP} />
          <polygon points="22,-6 4,24 42,24" fill={T_SHADOW_DEEP} />
          <polygon points="0,-30 -26,24 26,24" fill={T_SHADOW} />
          <polygon points="0,-30 0,24 26,24" fill={T_LIGHT} />
          <polygon points="0,-30 -8,-15 8,-15" fill={T_SNOW} />
          <polygon points="-20,-12 -27,0 -13,0" fill={T_SNOW} />
          <polygon points="22,-6 16,4 28,4" fill={T_SNOW} />
        </>
      );
      break;
    case 'desert':
      motif = (
        <>
          <circle cx={26} cy={-22} r={9} fill={T_SUN} />
          <path d="M-46 18 Q-20 6 4 16 Q26 24 46 12 L46 32 L-46 32 Z" fill={T_SHADOW} />
          <path d="M-46 24 Q-16 16 8 24 Q28 30 46 22 L46 32 L-46 32 Z" fill={T_SHADOW_DEEP} />
          <g fill={T_SHADOW_DEEP}>
            <rect x={-12} y={-8} width={7} height={28} rx={3.5} />
            <rect x={-18} y={2} width={5} height={12} rx={2.5} />
            <rect x={-18} y={2} width={12} height={5} rx={2.5} />
            <rect x={-4} y={-2} width={5} height={10} rx={2.5} />
            <rect x={-7} y={-2} width={11} height={5} rx={2.5} />
          </g>
        </>
      );
      break;
    default:
      motif = null;
  }
  if (!motif) return null;
  return <g transform={`translate(${cx}, ${cy}) scale(${s})`}>{motif}</g>;
}

// ----- Dice rendering -----
const DIE_PIPS = {
  1: [[50, 50]],
  2: [[30, 30], [70, 70]],
  3: [[30, 30], [50, 50], [70, 70]],
  4: [[30, 30], [70, 30], [30, 70], [70, 70]],
  5: [[30, 30], [70, 30], [50, 50], [30, 70], [70, 70]],
  6: [[30, 26], [70, 26], [30, 50], [70, 50], [30, 74], [70, 74]],
};

// The board only records the dice TOTAL, so we render a representative pair that
// sums to it (purely cosmetic — only the total ever drives gameplay).
function splitDice(total) {
  if (!total) return null;
  const d1 = Math.min(6, Math.max(1, Math.ceil(total / 2)));
  const d2 = total - d1;
  if (d2 < 1 || d2 > 6) return null;
  return [d1, d2];
}

function DieFace({ value, size = 40 }) {
  const pips = DIE_PIPS[value] || [];
  return (
    <svg width={size} height={size} viewBox="0 0 100 100" className="catan-die" role="img" aria-label={`Die showing ${value}`}>
      <rect x="5" y="5" width="90" height="90" rx="20" />
      {pips.map(([cx, cy], i) => <circle key={i} cx={cx} cy={cy} r="9" />)}
    </svg>
  );
}

// ----- Resource / dev card stack (the player's visible hand) -----
function CardStack({ variant, count, label }) {
  const layers = Math.min(Math.max(count - 1, 0), 2);
  return (
    <div className="catan-card-stack" title={`${count} ${label}`}>
      {Array.from({ length: layers }).map((_, i) => (
        <div key={i} className={`catan-card catan-card-layer catan-card-l${i + 1} card-${variant}`} aria-hidden="true" />
      ))}
      <div className={`catan-card catan-card-front card-${variant} ${count === 0 ? 'is-empty' : ''}`}>
        <span className="catan-card-count">{count}</span>
        <span className="catan-card-name">{label}</span>
      </div>
    </div>
  );
}

function Toggle({ label, checked, onChange }) {
  return (
    <div className="flex items-center justify-between gap-4">
      <span className="text-sm" style={{ color: 'var(--color-text-primary)' }}>{label}</span>
      <button
        type="button"
        onClick={onChange}
        role="switch"
        aria-checked={checked}
        className="relative h-6 w-10 rounded-full transition-colors"
        style={{ backgroundColor: checked ? 'var(--color-toggle-active)' : 'var(--color-toggle-inactive)' }}
      >
        <span
          className={`absolute top-1 h-4 w-4 rounded-full transition-transform ${checked ? 'translate-x-5' : 'translate-x-1'}`}
          style={{ backgroundColor: 'var(--color-toggle-knob)', left: 0 }}
        />
      </button>
    </div>
  );
}

export default function CatanGame() {
  const [gameConfig, setGameConfig] = useState(loadInitialConfig);
  const [board, setBoard] = useState(() => new CatanBoard({ seed: Date.now(), ...loadInitialConfig() }));
  const [darkMode, setDarkMode] = useState(() => JSON.parse(localStorage.getItem('catanDarkMode') || 'false'));
  const [showPossibleMoves, setShowPossibleMoves] = useState(() => JSON.parse(localStorage.getItem('catanShowMoves') || 'true'));
  const [difficulty, setDifficulty] = useState(() => localStorage.getItem('catanDifficulty') || 'expert');
  const [selectedAction, setSelectedAction] = useState(null);
  const [isAiThinking, setIsAiThinking] = useState(false);
  const [showModal, setShowModal] = useState(true);
  const [showSettings, setShowSettings] = useState(false);
  const [showRules, setShowRules] = useState(false);
  const [lastMove, setLastMove] = useState(null);
  const [showTradeBuilder, setShowTradeBuilder] = useState(false);
  const [confirmNew, setConfirmNew] = useState(false);
  const [tradeGive, setTradeGive] = useState({ brick: 0, lumber: 0, wool: 0, grain: 0, ore: 0 });
  const [tradeReceive, setTradeReceive] = useState({ brick: 0, lumber: 0, wool: 0, grain: 0, ore: 0 });
  const [tradeTargets, setTradeTargets] = useState([]);
  const [showMonopolyPicker, setShowMonopolyPicker] = useState(false);
  const [showYopPicker, setShowYopPicker] = useState(false);
  const [yopPick, setYopPick] = useState([]);
  const [robberVictimPicker, setRobberVictimPicker] = useState(null);
  const [gameLog, setGameLog] = useState([]);
  const aiTimerRef = useRef(null);
  const lastLoggedActionRef = useRef(null);
  const logEndRef = useRef(null);
  const { computeMove, isSupported: workerSupported } = useAIWorker();

  useEffect(() => localStorage.setItem('catanDarkMode', JSON.stringify(darkMode)), [darkMode]);
  useEffect(() => localStorage.setItem('catanShowMoves', JSON.stringify(showPossibleMoves)), [showPossibleMoves]);
  useEffect(() => localStorage.setItem('catanDifficulty', difficulty), [difficulty]);
  useEffect(() => localStorage.setItem('catanRulesetId', gameConfig.rulesetId), [gameConfig.rulesetId]);
  useEffect(() => localStorage.setItem('catanPlayerCount', String(gameConfig.playerCount)), [gameConfig.playerCount]);
  useEffect(() => {
    if (gameConfig.scenarioId) localStorage.setItem('catanScenarioId', gameConfig.scenarioId);
  }, [gameConfig.scenarioId]);

  // Accumulate a human-readable game-log feed. The engine sets board.lastAction
  // on every move and the AI loop re-renders after each step, so comparing it to
  // the last-seen value (via a ref, to avoid loops) captures each distinct event.
  useEffect(() => {
    const action = board.lastAction;
    if (!action || action === lastLoggedActionRef.current) return;
    lastLoggedActionRef.current = action;
    setGameLog(prev => {
      if (prev.length > 0 && prev[prev.length - 1] === action) return prev;
      const next = [...prev, action];
      return next.length > 30 ? next.slice(next.length - 30) : next;
    });
  }, [board.lastAction]);

  // Auto-scroll the feed to the newest entry.
  useEffect(() => {
    if (logEndRef.current) logEndRef.current.scrollTop = logEndRef.current.scrollHeight;
  }, [gameLog]);

  const isHumanTurn = board.currentPlayer === HUMAN_PLAYER && board.phase !== 'game-over';
  const currentPlayer = board.players[board.currentPlayer];
  const human = board.players[HUMAN_PLAYER];
  const difficultyConfig = DIFFICULTY_CONFIG[difficulty] || DIFFICULTY_CONFIG.expert;
  const selectedRuleset = getRuleset(gameConfig.rulesetId);
  const selectedScenario = selectedRuleset.scenarios?.find(scenario => scenario.id === gameConfig.scenarioId) || getDefaultScenario(selectedRuleset);
  const activeRuleset = getRuleset(board.rulesetId);
  const activeScenario = activeRuleset.scenarios?.find(scenario => scenario.id === board.scenarioId) || getDefaultScenario(activeRuleset);
  const playerIds = board.getPlayerIds();
  const boardLayout = useMemo(() => {
    const points = Object.values(board.vertices);
    const minX = Math.min(...points.map(point => point.x));
    const maxX = Math.max(...points.map(point => point.x));
    const minY = Math.min(...points.map(point => point.y));
    const maxY = Math.max(...points.map(point => point.y));
    const width = Math.max(1, maxX - minX);
    const height = Math.max(1, maxY - minY);
    const scale = Math.min(
      (BOARD_VIEWBOX.width - BOARD_VIEWBOX.pad * 2) / width,
      (BOARD_VIEWBOX.height - BOARD_VIEWBOX.pad * 2) / height
    );

    return {
      scale,
      offsetX: (BOARD_VIEWBOX.width - width * scale) / 2 - minX * scale,
      offsetY: (BOARD_VIEWBOX.height - height * scale) / 2 - minY * scale,
    };
  }, [board.vertices]);
  const screenPoint = useCallback((point) => ({
    x: point.x * boardLayout.scale + boardLayout.offsetX,
    y: point.y * boardLayout.scale + boardLayout.offsetY,
  }), [boardLayout]);

  const applyMove = useCallback((move) => {
    const applied = board.applyMove(move);
    if (!applied) return false;
    setLastMove(move);
    setSelectedAction(null);
    setBoard(board.clone());
    if (board.phase === 'game-over') setShowModal(true);
    return true;
  }, [board]);

  const openTradeBuilder = useCallback(() => {
    const empty = { brick: 0, lumber: 0, wool: 0, grain: 0, ore: 0 };
    setTradeGive({ ...empty });
    setTradeReceive({ ...empty });
    setTradeTargets(playerIds.filter(id => id !== HUMAN_PLAYER));
    setShowTradeBuilder(true);
  }, [playerIds]);

  const submitTrade = useCallback(() => {
    const give = Object.fromEntries(Object.entries(tradeGive).filter(([, amount]) => amount > 0));
    const receive = Object.fromEntries(Object.entries(tradeReceive).filter(([, amount]) => amount > 0));
    const targets = tradeTargets.filter(id => id !== HUMAN_PLAYER);
    if (Object.keys(give).length === 0 || Object.keys(receive).length === 0 || targets.length === 0) return;
    if (applyMove({ type: 'propose-trade', give, receive, targets })) {
      setShowTradeBuilder(false);
    }
  }, [applyMove, tradeGive, tradeReceive, tradeTargets]);

  const submitMonopoly = useCallback((resource) => {
    if (applyMove({ type: 'play-monopoly', resource })) {
      setShowMonopolyPicker(false);
    }
  }, [applyMove]);

  // Only offer Year of Plenty pairs the bank can actually supply.
  const yopLegalPairs = useMemo(
    () => board.getLegalMoves().filter(move => move.type === 'play-year-of-plenty'),
    [board]
  );
  const yopLegalKeys = useMemo(
    () => new Set(yopLegalPairs.flatMap(({ resourceA, resourceB }) => [
      `${resourceA}|${resourceB}`,
      `${resourceB}|${resourceA}`,
    ])),
    [yopLegalPairs]
  );

  const openYopPicker = useCallback(() => {
    setYopPick([]);
    setShowYopPicker(true);
  }, []);

  // Toggle a resource into the (up to two) selected slots for Year of Plenty.
  const toggleYopPick = useCallback((resource) => {
    setYopPick(prev => {
      if (prev.length >= 2) return [resource];
      return [...prev, resource];
    });
  }, []);

  const submitYop = useCallback(() => {
    if (yopPick.length !== 2) return;
    const [resourceA, resourceB] = yopPick;
    if (applyMove({ type: 'play-year-of-plenty', resourceA, resourceB })) {
      setShowYopPicker(false);
      setYopPick([]);
    }
  }, [applyMove, yopPick]);

  const chooseRobberVictim = useCallback((stealPlayerId) => {
    const picker = robberVictimPicker;
    if (!picker) return;
    if (applyMove({ type: 'move-robber', tileId: picker.tileId, stealPlayerId })) {
      setRobberVictimPicker(null);
    }
  }, [applyMove, robberVictimPicker]);

  const computeAIMove = useCallback(() => {
    if (isAiThinking || board.phase === 'game-over') return;
    setIsAiThinking(true);

    const onSuccess = (move) => {
      setIsAiThinking(false);
      if (!move) return;
      applyAIMove(board, move);
      setLastMove(move);
      setBoard(board.clone());
      if (board.phase === 'game-over') setShowModal(true);
    };

    const onError = (error) => {
      console.warn('Catan AI error:', error);
      setIsAiThinking(false);
      const fallback = new MCTS({ maxChildren: difficultyConfig.maxChildren, rolloutSteps: 16 });
      fallback.getBestMove(board, Math.max(60, Math.floor(difficultyConfig.simulations / 4)))
        .then((move) => {
          if (!move) return;
          applyAIMove(board, move);
          setLastMove(move);
          setBoard(board.clone());
          if (board.phase === 'game-over') setShowModal(true);
        })
        .catch((err) => console.warn('Catan fallback AI error:', err));
    };

    if (workerSupported) {
      computeMove(
        board.serializeState(),
        difficultyConfig.simulations,
        onSuccess,
        onError,
        difficultyConfig.maxChildren
      );
    } else {
      const mcts = new MCTS({ maxChildren: difficultyConfig.maxChildren, rolloutSteps: 16 });
      mcts.getBestMove(board, difficultyConfig.simulations).then(onSuccess).catch(onError);
    }
  }, [applyAIMove, board, computeMove, difficultyConfig.maxChildren, difficultyConfig.simulations, isAiThinking, workerSupported]);

  useEffect(() => {
    if (showModal || isHumanTurn || isAiThinking || board.phase === 'game-over') return;

    aiTimerRef.current = setTimeout(() => {
      computeAIMove();
    }, board.phase === 'roll' ? 350 : 180);

    return () => {
      if (aiTimerRef.current) clearTimeout(aiTimerRef.current);
    };
  }, [board.currentPlayer, board.phase, board.setupIndex, computeAIMove, isAiThinking, isHumanTurn, showModal]);

  const validVertices = useMemo(() => {
    if (!showPossibleMoves || !isHumanTurn) return [];
    if (board.phase === 'setup-settlement') return board.getValidSettlementVertices(HUMAN_PLAYER, true);
    if (selectedAction === 'settlement') return board.getValidSettlementVertices(HUMAN_PLAYER, false);
    if (selectedAction === 'city') return board.getValidCityVertices(HUMAN_PLAYER);
    return [];
  }, [board, isHumanTurn, selectedAction, showPossibleMoves]);

  const validEdges = useMemo(() => {
    if (!showPossibleMoves || !isHumanTurn) return [];
    if (board.phase === 'setup-road') return board.getValidSetupRoadEdges(board.pendingSetupSettlement, HUMAN_PLAYER);
    if (selectedAction === 'road') return board.getValidRoadEdges(HUMAN_PLAYER, board.freeRoadsRemaining > 0);
    return [];
  }, [board, isHumanTurn, selectedAction, showPossibleMoves]);

  const validRobberTiles = useMemo(() => {
    if (!showPossibleMoves || !isHumanTurn || board.phase !== 'robber') return [];
    return board.tiles.filter(tile => tile.id !== board.robberTileId).map(tile => tile.id);
  }, [board, isHumanTurn, showPossibleMoves]);

  const handleVertexClick = (vertexId) => {
    if (!isHumanTurn) return;
    if (board.phase === 'setup-settlement') {
      applyMove({ type: 'setup-settlement', vertexId });
      return;
    }
    if (selectedAction === 'settlement') {
      applyMove({ type: 'build-settlement', vertexId });
      return;
    }
    if (selectedAction === 'city') {
      applyMove({ type: 'build-city', vertexId });
    }
  };

  const handleEdgeClick = (edgeId) => {
    if (!isHumanTurn) return;
    if (board.phase === 'setup-road') {
      applyMove({ type: 'setup-road', edgeId });
      return;
    }
    if (selectedAction === 'road') {
      applyMove({ type: 'build-road', edgeId, free: board.freeRoadsRemaining > 0 });
    }
  };

  const handleTileClick = (tileId) => {
    if (!isHumanTurn || board.phase !== 'robber') return;
    const victims = board.getRobberVictims(tileId).filter(playerId => playerId !== HUMAN_PLAYER);
    if (victims.length > 1) {
      // Multiple opponents touch this tile — let the human choose whom to rob.
      setRobberVictimPicker({ tileId, victims });
      return;
    }
    applyMove({ type: 'move-robber', tileId, stealPlayerId: victims[0] ?? null });
  };

  const updateRuleset = (rulesetId) => {
    const ruleset = getRuleset(rulesetId);
    setGameConfig((previous) => ({
      rulesetId: ruleset.id,
      playerCount: normalizePlayerCount(ruleset, previous.playerCount),
      scenarioId: ruleset.scenarios?.some(scenario => scenario.id === previous.scenarioId)
        ? previous.scenarioId
        : getDefaultScenario(ruleset)?.id || null,
    }));
  };

  const updatePlayerCount = (playerCount) => {
    setGameConfig((previous) => {
      const ruleset = getRuleset(previous.rulesetId);
      return {
        ...previous,
        playerCount: normalizePlayerCount(ruleset, playerCount),
      };
    });
  };

  const updateScenario = (scenarioId) => {
    setGameConfig((previous) => ({ ...previous, scenarioId }));
  };

  const newGame = (nextConfig = gameConfig) => {
    const resolvedConfig = nextConfig?.rulesetId ? nextConfig : gameConfig;
    const next = new CatanBoard({ seed: Date.now(), ...resolvedConfig });
    setBoard(next);
    setSelectedAction(null);
    setLastMove(null);
    setIsAiThinking(false);
    setShowModal(false);
    lastLoggedActionRef.current = next.lastAction;
    setGameLog(next.lastAction ? [next.lastAction] : []);
  };

  const statusText = () => {
    if (board.phase === 'game-over') return `${board.players[board.winner]?.name || 'Player'} wins`;
    if (isAiThinking) return `${currentPlayer.name} is thinking`;
    if (board.phase === 'setup-settlement') return `${currentPlayer.name}: settlement`;
    if (board.phase === 'setup-road') return `${currentPlayer.name}: road`;
    if (board.phase === 'roll') return `${currentPlayer.name}: roll`;
    if (board.phase === 'discard') return `${currentPlayer.name}: discard`;
    if (board.phase === 'trade-response') return `${currentPlayer.name}: respond to trade`;
    if (board.phase === 'robber') return `${currentPlayer.name}: robber`;
    if (board.phase === 'paired-action') return `${currentPlayer.name}: paired build`;
    return `${currentPlayer.name}: build or trade`;
  };

  const renderActionButtons = () => {
    if (!isHumanTurn) {
      return <p className="text-sm leading-relaxed" style={{ color: 'var(--color-text-secondary)' }}>{board.lastAction}</p>;
    }

    if (board.phase === 'setup-settlement' || board.phase === 'setup-road') {
      return (
        <p className="text-sm leading-relaxed" style={{ color: 'var(--color-text-secondary)' }}>
          {board.lastAction}
        </p>
      );
    }

    if (board.phase === 'roll') {
      return (
        <button className="catan-primary-btn w-full" onClick={() => applyMove({ type: 'roll' })}>
          Roll Dice
        </button>
      );
    }

    if (board.phase === 'discard') {
      const remaining = board.discardQueue[0]?.remaining || 0;
      return (
        <div className="space-y-3">
          <p className="text-sm leading-relaxed" style={{ color: 'var(--color-text-secondary)' }}>
            You rolled into a 7 and hold too many cards. Discard <strong>{remaining}</strong> more {remaining === 1 ? 'card' : 'cards'} by clicking them.
          </p>
          <div className="grid grid-cols-5 gap-1">
            {RESOURCES.map(resource => {
              const count = human.resources[resource];
              return (
                <button
                  key={resource}
                  className={`catan-resource-pill resource-${resource} catan-discard-pill`}
                  disabled={count <= 0}
                  title={`Discard 1 ${RESOURCE_LABELS[resource]}`}
                  onClick={() => applyMove({ type: 'discard', resource })}
                >
                  <span>{resource[0].toUpperCase()}</span>
                  <strong>{count}</strong>
                </button>
              );
            })}
          </div>
        </div>
      );
    }

    if (board.phase === 'trade-response') {
      const trade = board.pendingTrade;
      if (!trade) {
        return <p className="text-sm leading-relaxed" style={{ color: 'var(--color-text-secondary)' }}>Resolving trade...</p>;
      }
      const proposerName = board.players[trade.proposer]?.name || 'Opponent';
      const youReceive = Object.entries(trade.give).filter(([, amount]) => amount > 0);
      const youGive = Object.entries(trade.receive).filter(([, amount]) => amount > 0);
      const canAfford = youGive.every(([resource, amount]) => human.resources[resource] >= amount);
      const bundle = (entries) => entries.length === 0
        ? 'nothing'
        : entries.map(([resource, amount]) => `${amount} ${RESOURCE_LABELS[resource]}`).join(', ');
      return (
        <div className="space-y-3">
          <div className="catan-trade-offer">
            <div className="catan-panel-label mb-1">{proposerName} offers a trade</div>
            <div className="text-sm" style={{ color: 'var(--color-text-primary)' }}>
              You receive: <strong>{bundle(youReceive)}</strong>
            </div>
            <div className="text-sm" style={{ color: 'var(--color-text-primary)' }}>
              You give: <strong>{bundle(youGive)}</strong>
            </div>
            {!canAfford && (
              <div className="mt-1 text-xs" style={{ color: 'var(--color-text-muted)' }}>
                You cannot afford this trade.
              </div>
            )}
          </div>
          <div className="grid grid-cols-2 gap-2">
            <button
              className="catan-primary-btn"
              disabled={!canAfford}
              onClick={() => applyMove({ type: 'respond-trade', accept: true })}
            >
              Accept
            </button>
            <button className="catan-tool-btn" onClick={() => applyMove({ type: 'respond-trade', accept: false })}>
              Decline
            </button>
          </div>
        </div>
      );
    }

    if (board.phase === 'robber') {
      return (
        <p className="text-sm leading-relaxed" style={{ color: 'var(--color-text-secondary)' }}>
          Select a non-robber tile.
        </p>
      );
    }

    const trades = board.getStrategicTradeOptions(HUMAN_PLAYER, 8);
    const playableDev = human.playedDevThisTurn ? [] : [
      human.devCards.knight > 0 && { key: 'knight', label: 'Knight', onClick: () => applyMove({ type: 'play-knight' }) },
      human.devCards.roadBuilding > 0 && { key: 'roadBuilding', label: 'Road Building', onClick: () => applyMove({ type: 'play-road-building' }) },
      human.devCards.yearOfPlenty > 0 && { key: 'yearOfPlenty', label: 'Year of Plenty', onClick: openYopPicker },
      human.devCards.monopoly > 0 && { key: 'monopoly', label: 'Monopoly', onClick: () => setShowMonopolyPicker(true) },
    ].filter(Boolean);

    return (
      <div className="space-y-4">
        <div className="grid grid-cols-3 gap-2">
          {ACTIONS.map(action => {
            const disabled =
              action.id === 'road'
                ? board.getValidRoadEdges(HUMAN_PLAYER, board.freeRoadsRemaining > 0).length === 0
                : action.id === 'settlement'
                  ? board.getValidSettlementVertices(HUMAN_PLAYER, false).length === 0
                  : board.getValidCityVertices(HUMAN_PLAYER).length === 0;
            return (
              <button
                key={action.id}
                className={`catan-tool-btn ${selectedAction === action.id ? 'active' : ''}`}
                disabled={disabled}
                title={formatCost(action.cost)}
                onClick={() => setSelectedAction(selectedAction === action.id ? null : action.id)}
              >
                {action.label}
              </button>
            );
          })}
        </div>

        <button
          className="catan-tool-btn w-full"
          disabled={board.devDeck.length === 0 || !board.canAfford(HUMAN_PLAYER, COSTS.dev)}
          title={formatCost(COSTS.dev)}
          onClick={() => applyMove({ type: 'buy-dev' })}
        >
          Buy Development
        </button>

        {playableDev.length > 0 && (
          <div className="grid grid-cols-2 gap-2">
            {playableDev.map(card => (
              <button key={card.key} className="catan-tool-btn" onClick={card.onClick}>
                {card.label}
              </button>
            ))}
          </div>
        )}

        <button
          className="catan-tool-btn w-full"
          disabled={resourceTotal(human.resources) === 0 || board.tradeProposalsThisTurn >= board.maxTradeProposalsPerTurn}
          onClick={openTradeBuilder}
        >
          Propose Trade to Players
        </button>

        {trades.length > 0 && (
          <div>
            <div className="catan-panel-label mb-2">Bank Trades</div>
            <div className="grid grid-cols-2 gap-2">
              {trades.map((trade, index) => (
                <button
                  key={`${trade.give}-${trade.receive}-${index}`}
                  className="catan-trade-btn"
                  onClick={() => applyMove(trade)}
                >
                  {trade.ratio} {trade.give} &rarr; {trade.receive}
                </button>
              ))}
            </div>
          </div>
        )}

        <button className="catan-primary-btn w-full" onClick={() => applyMove({ type: 'end-turn' })}>
          {board.phase === 'paired-action' ? 'Finish Paired Phase' : 'End Turn'}
        </button>
      </div>
    );
  };

  const renderPlayerPanel = (playerId) => {
    const player = board.players[playerId];
    const isActive = board.currentPlayer === playerId && board.phase !== 'game-over';
    const points = playerId === HUMAN_PLAYER ? board.getVictoryPoints(playerId) : board.getPublicScores()[playerId];

    return (
      <div
        key={playerId}
        className="catan-player-panel"
        style={{
          borderColor: isActive ? player.color : 'var(--color-border-panel)',
        }}
      >
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2 min-w-0">
            <span className="h-3 w-3 rounded-full shrink-0" style={{ backgroundColor: player.color }} />
            <span className="truncate text-sm font-semibold" style={{ color: 'var(--color-text-primary)' }}>
              {player.name}
            </span>
          </div>
          <span className="text-sm tabular-nums" style={{ color: 'var(--color-text-primary)' }}>
            {points} VP
          </span>
        </div>
        {playerId === HUMAN_PLAYER ? (
          <>
            <div className="mt-3 grid grid-cols-5 gap-1">
              {RESOURCES.map(resource => (
                <div key={resource} className={`catan-resource-pill resource-${resource}`}>
                  <span>{resource[0].toUpperCase()}</span>
                  <strong>{player.resources[resource]}</strong>
                </div>
              ))}
            </div>
            <div className="mt-2 grid grid-cols-5 gap-1">
              {Object.keys(DEV_LABELS).map(card => (
                <div key={card} className="catan-dev-pill">
                  <span>{DEV_LABELS[card]}</span>
                  <strong>{player.devCards[card] + player.newDevCards[card]}</strong>
                </div>
              ))}
            </div>
          </>
        ) : (
          <div className="mt-3 flex items-center justify-between text-xs" style={{ color: 'var(--color-text-muted)' }}>
            <span>{resourceTotal(player.resources)} resources</span>
            <span>{Object.values(player.devCards).reduce((a, b) => a + b, 0) + Object.values(player.newDevCards).reduce((a, b) => a + b, 0)} dev</span>
            <span>{player.knightsPlayed} knights</span>
          </div>
        )}
      </div>
    );
  };

  const renderRulesetPicker = ({ compact = false } = {}) => (
    <div className="catan-config-stack">
      <div className="catan-config-section">
        <div className="catan-panel-label mb-2">Rule Set</div>
        <div className={compact ? 'catan-ruleset-grid compact' : 'catan-ruleset-grid'}>
          {RULESET_GROUPS.flatMap(group =>
            CATAN_RULESETS.filter(ruleset => ruleset.group === group).map(ruleset => (
              <button
                key={ruleset.id}
                type="button"
                className={`catan-ruleset-card ${gameConfig.rulesetId === ruleset.id ? 'active' : ''}`}
                onClick={() => updateRuleset(ruleset.id)}
              >
                <span className="catan-ruleset-kicker">{ruleset.group}</span>
                <strong>{ruleset.name}</strong>
                <span>{ruleset.edition}</span>
                <em>{ruleset.engineLevel}</em>
              </button>
            ))
          )}
        </div>
      </div>

      <div className="catan-config-section">
        <div className="catan-panel-label mb-2">Players</div>
        <div className="catan-segmented">
          {selectedRuleset.playerCounts.map(count => (
            <button
              key={count}
              type="button"
              className={gameConfig.playerCount === count ? 'active' : ''}
              onClick={() => updatePlayerCount(count)}
            >
              {count}
            </button>
          ))}
        </div>
      </div>

      {selectedRuleset.scenarios?.length > 0 && (
        <div className="catan-config-section">
          <div className="catan-panel-label mb-2">Map / Scenario</div>
          <div className="catan-scenario-list">
            {selectedRuleset.scenarios.map(scenario => (
              <button
                key={scenario.id}
                type="button"
                className={gameConfig.scenarioId === scenario.id ? 'active' : ''}
                onClick={() => updateScenario(scenario.id)}
              >
                <span>{scenario.name}</span>
                <strong>{scenario.target} VP</strong>
              </button>
            ))}
          </div>
        </div>
      )}

      <button className="catan-primary-btn w-full" onClick={() => newGame(gameConfig)}>
        Start {selectedRuleset.name}
      </button>
    </div>
  );

  const renderBoard = () => (
    <svg className="catan-board-svg" viewBox={`0 0 ${BOARD_VIEWBOX.width} ${BOARD_VIEWBOX.height}`} role="img" aria-label="Catan board">
      <defs>
        <filter id="catan-piece-shadow" x="-40%" y="-40%" width="180%" height="180%">
          <feDropShadow dx="0" dy="2" stdDeviation="2" floodOpacity="0.22" />
        </filter>
        <radialGradient id="catan-tile-sheen" cx="38%" cy="30%" r="75%">
          <stop offset="0%" stopColor="#ffffff" stopOpacity="0.34" />
          <stop offset="55%" stopColor="#ffffff" stopOpacity="0" />
        </radialGradient>
        <radialGradient id="catan-tile-vignette" cx="50%" cy="54%" r="62%">
          <stop offset="60%" stopColor="#000000" stopOpacity="0" />
          <stop offset="100%" stopColor="#1a0f06" stopOpacity="0.28" />
        </radialGradient>
        <radialGradient id="catan-token" cx="38%" cy="32%" r="78%">
          <stop offset="0%" stopColor="#FFFBEE" />
          <stop offset="100%" stopColor="#E9D6A8" />
        </radialGradient>
        <radialGradient id="catan-token-hot" cx="38%" cy="32%" r="78%">
          <stop offset="0%" stopColor="#FFEAE0" />
          <stop offset="100%" stopColor="#F4BCA9" />
        </radialGradient>
      </defs>

      {board.tiles.map(tile => {
        const screenVerts = tile.vertices.map(vertexId => screenPoint(board.vertices[vertexId]));
        const points = screenVerts.map(({ x, y }) => `${x},${y}`).join(' ');
        const center = screenPoint(tile);
        const tileR = Math.hypot(screenVerts[0].x - center.x, screenVerts[0].y - center.y);
        const isRobber = board.robberTileId === tile.id;
        const isRobberTarget = validRobberTiles.includes(tile.id);
        const pips = CatanBoard.getPipCount(tile.number);
        const hot = tile.number === 6 || tile.number === 8;
        // Token radius and pip dots scale with probability: a 5-pip (6/8) disc is
        // noticeably larger than a 1-pip (2/12) disc.
        const tokenR = 11 + pips * 2.2;
        const dotR = Math.max(1.6, tokenR * 0.092);
        const dotGap = dotR * 2.7;
        const dotsY = center.y + tokenR * 0.5;
        const dotsStartX = center.x - ((pips - 1) * dotGap) / 2;
        return (
          <g
            key={tile.id}
            role={board.phase === 'robber' && isHumanTurn ? 'button' : undefined}
            tabIndex={board.phase === 'robber' && isHumanTurn ? 0 : undefined}
            onClick={() => handleTileClick(tile.id)}
            className={isRobberTarget ? 'catan-clickable' : ''}
          >
            <clipPath id={`catan-clip-${tile.id}`}>
              <polygon points={points} />
            </clipPath>
            <polygon
              points={points}
              className={`catan-tile tile-${tile.resource} ${isRobberTarget ? 'robber-target' : ''}`}
            />
            <g className="catan-terrain" clipPath={`url(#catan-clip-${tile.id})`}>
              {tileTerrain(tile.resource, center.x, center.y, tileR)}
            </g>
            <polygon points={points} className="catan-tile-sheen" />
            <polygon points={points} className="catan-tile-vignette" />
            {tile.number && (
              <g className="catan-token-group" filter="url(#catan-piece-shadow)">
                <circle
                  cx={center.x}
                  cy={center.y}
                  r={tokenR}
                  className={`catan-number-token ${hot ? 'hot' : ''}`}
                />
                <text
                  x={center.x}
                  y={center.y - tokenR * 0.16}
                  textAnchor="middle"
                  dominantBaseline="central"
                  className={`catan-number ${hot ? 'hot' : ''}`}
                  style={{ fontSize: `${10 + pips * 1.5}px` }}
                >
                  {tile.number}
                </text>
                {Array.from({ length: pips }).map((_, i) => (
                  <circle
                    key={i}
                    cx={dotsStartX + i * dotGap}
                    cy={dotsY}
                    r={dotR}
                    className={`catan-pip-dot ${hot ? 'hot' : ''}`}
                  />
                ))}
              </g>
            )}
            {isRobber && (
              <g transform={`translate(${center.x}, ${center.y})`} className="catan-robber" filter="url(#catan-piece-shadow)">
                <circle cx="0" cy="-6" r="8" />
                <path d="M-11 17 C-8 2 8 2 11 17 Z" />
              </g>
            )}
          </g>
        );
      })}

      {Object.values(board.edges).map(edge => {
        const [a, b] = edge.vertices.map(vertexId => screenPoint(board.vertices[vertexId]));
        const isValid = validEdges.includes(edge.id);
        const isLast = lastMove?.edgeId === edge.id;
        const owned = Boolean(edge.owner);
        return (
          <g key={edge.id} role="button" tabIndex={0} onClick={() => handleEdgeClick(edge.id)} className={isValid ? 'catan-clickable' : ''}>
            <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} className="catan-edge-hit" />
            {owned && (
              <line
                x1={a.x}
                y1={a.y}
                x2={b.x}
                y2={b.y}
                className={`catan-road-casing ${isLast ? 'last' : ''}`}
              />
            )}
            <line
              x1={a.x}
              y1={a.y}
              x2={b.x}
              y2={b.y}
              className={`catan-road ${isValid ? 'valid' : ''} ${isLast ? 'last' : ''}`}
              style={{ stroke: edge.owner ? board.players[edge.owner].color : undefined }}
            />
            {edge.port && (() => {
              const mx = (a.x + b.x) / 2;
              const my = (a.y + b.y) / 2;
              const dirX = mx - BOARD_VIEWBOX.width / 2;
              const dirY = my - BOARD_VIEWBOX.height / 2;
              const len = Math.hypot(dirX, dirY) || 1;
              const bx = mx + (dirX / len) * 22;
              const by = my + (dirY / len) * 22;
              const isAny = edge.port === 'any';
              return (
                <g className="catan-port-group">
                  <line x1={a.x} y1={a.y} x2={bx} y2={by} className="catan-port-pier" />
                  <line x1={b.x} y1={b.y} x2={bx} y2={by} className="catan-port-pier" />
                  <g filter="url(#catan-piece-shadow)">
                    <rect x={bx - 15} y={by - 9} width="30" height="18" rx="6" className="catan-port-badge" />
                    {!isAny && (
                      <circle cx={bx} cy={by - 12} r="4.5" className={`catan-port-chip port-${edge.port}`} />
                    )}
                    <text x={bx} y={by + 0.5} textAnchor="middle" dominantBaseline="central" className="catan-port-label">
                      {isAny ? '3:1' : '2:1'}
                    </text>
                  </g>
                </g>
              );
            })()}
          </g>
        );
      })}

      {Object.values(board.vertices).map(vertex => {
        const point = screenPoint(vertex);
        const building = vertex.building;
        const isValid = validVertices.includes(vertex.id);
        const isPending = board.pendingSetupSettlement === vertex.id;
        const isLast = lastMove?.vertexId === vertex.id;
        return (
          <g key={vertex.id} role="button" tabIndex={0} onClick={() => handleVertexClick(vertex.id)} className={isValid ? 'catan-clickable' : ''}>
            <circle
              cx={point.x}
              cy={point.y}
              r={isValid ? 11 : 6}
              className={`catan-vertex ${isValid ? 'valid' : ''} ${isPending ? 'pending' : ''} ${isLast ? 'last' : ''}`}
            />
            {building && (
              <g filter="url(#catan-piece-shadow)">
                {building.type === 'city' ? (
                  <path
                    d={`M${point.x - 14} ${point.y + 10} L${point.x - 14} ${point.y - 4} L${point.x - 5} ${point.y - 13} L${point.x + 2} ${point.y - 6} L${point.x + 9} ${point.y - 13} L${point.x + 18} ${point.y - 4} L${point.x + 18} ${point.y + 10} Z`}
                    fill={board.players[building.player].color}
                    stroke="var(--color-piece-outline)"
                    strokeWidth="2.4"
                    strokeLinejoin="round"
                  />
                ) : (
                  <path
                    d={`M${point.x - 12} ${point.y + 9} L${point.x - 12} ${point.y - 3} L${point.x} ${point.y - 14} L${point.x + 12} ${point.y - 3} L${point.x + 12} ${point.y + 9} Z`}
                    fill={board.players[building.player].color}
                    stroke="var(--color-piece-outline)"
                    strokeWidth="2.4"
                    strokeLinejoin="round"
                  />
                )}
              </g>
            )}
          </g>
        );
      })}
    </svg>
  );

  return (
    <div className={`game-catan min-h-screen bg-[var(--color-bg-page)] font-body ${darkMode ? 'dark' : ''}`}>
      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4" onClick={(e) => { if (e.target === e.currentTarget) setShowModal(false); }}>
          <div className="catan-modal max-h-[90vh] w-full max-w-3xl overflow-y-auto p-7">
            <h2 className="text-2xl font-bold" style={{ color: 'var(--color-text-primary)' }}>
              {board.phase === 'game-over' ? `${board.players[board.winner]?.name} wins` : 'CATAN'}
            </h2>
            <p className="mt-2 text-sm leading-relaxed" style={{ color: 'var(--color-text-secondary)' }}>
              {board.phase === 'game-over'
                ? `${board.winningPoints} victory points on turn ${board.turnNumber}.`
                : `${selectedRuleset.name} - ${selectedScenario?.name || 'Random Island'} - ${gameConfig.playerCount} players.`}
            </p>
            <div className="mt-6 flex gap-3">
              <button className="catan-primary-btn flex-1" onClick={newGame}>New Game</button>
              <button className="catan-tool-btn flex-1" onClick={() => setShowModal(false)}>Continue</button>
            </div>
            <div className="mt-6">
              {renderRulesetPicker({ compact: true })}
            </div>
            <div className="mt-6 space-y-4">
              <Toggle label="Dark Mode" checked={darkMode} onChange={() => setDarkMode(!darkMode)} />
              <Toggle label="Show Legal Moves" checked={showPossibleMoves} onChange={() => setShowPossibleMoves(!showPossibleMoves)} />
              <button className="catan-tool-btn w-full" onClick={() => setShowRules(true)}>Rules</button>
            </div>
          </div>
        </div>
      )}

      {showSettings && (
        <div className="fixed inset-0 z-50 bg-black/50" onClick={(e) => { if (e.target === e.currentTarget) setShowSettings(false); }}>
          <div className="settings-panel fixed bottom-0 right-0 top-0 w-full max-w-sm overflow-y-auto border-l bg-[var(--color-bg-panel)] p-6">
            <div className="mb-6 flex items-center justify-between">
              <h2 className="text-xl font-bold" style={{ color: 'var(--color-text-primary)' }}>Settings</h2>
              <button className="text-2xl" style={{ color: 'var(--color-text-secondary)' }} onClick={() => setShowSettings(false)}>&times;</button>
            </div>
            <div className="space-y-5">
              <div>
                <div className="catan-panel-label mb-2">AI Strength</div>
                <div className="grid grid-cols-3 gap-2">
                  {Object.keys(DIFFICULTY_CONFIG).map(level => (
                    <button
                      key={level}
                      className={`catan-tool-btn capitalize ${difficulty === level ? 'active' : ''}`}
                      onClick={() => setDifficulty(level)}
                    >
                      {level}
                    </button>
                  ))}
                </div>
              </div>
              {renderRulesetPicker({ compact: true })}
              <Toggle label="Dark Mode" checked={darkMode} onChange={() => setDarkMode(!darkMode)} />
              <Toggle label="Show Legal Moves" checked={showPossibleMoves} onChange={() => setShowPossibleMoves(!showPossibleMoves)} />
              <button className="catan-tool-btn w-full" onClick={() => setShowRules(true)}>Rules</button>
            </div>
          </div>
        </div>
      )}

      {showRules && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 px-4" onClick={(e) => { if (e.target === e.currentTarget) setShowRules(false); }}>
          <div className="catan-modal max-h-[82vh] w-full max-w-2xl overflow-y-auto p-6">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-xl font-bold" style={{ color: 'var(--color-text-primary)' }}>Rules</h2>
              <button className="text-2xl" style={{ color: 'var(--color-text-secondary)' }} onClick={() => setShowRules(false)}>&times;</button>
            </div>
            <div className="space-y-4 text-sm leading-relaxed" style={{ color: 'var(--color-text-secondary)' }}>
              <p>Active game: {activeRuleset.name}, {activeScenario?.name || 'Random Island'}, {board.playerCount} players, {board.victoryTarget} VP target.</p>
              <p>Setup uses snake order. The second settlement pays starting resources from adjacent non-desert tiles.</p>
              <p>Roll 7 to move the robber. Each player holding more than 7 cards chooses which cards to discard (down to half), one at a time, then the roller moves the robber to block one tile and steals from an adjacent opponent.</p>
              <p>On your turn you can propose a trade to one or more opponents: pick the resources you give and the resources you want in return, then choose who to offer it to.</p>
              {board.pairedPlayers && (
                <p>5-6 player mode uses a paired-player build phase after the rolling player ends their action phase.</p>
              )}
              <div className="catan-rules-columns">
                {CATAN_RULESETS.map(ruleset => (
                  <div key={ruleset.id}>
                    <h3>{ruleset.name}</h3>
                    <ul>
                      {ruleset.modules.map(module => <li key={module}>{module}</li>)}
                    </ul>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

      {confirmNew && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/50 px-4" onClick={(e) => { if (e.target === e.currentTarget) setConfirmNew(false); }}>
          <div className="catan-modal w-full max-w-sm p-6">
            <h2 className="text-xl font-bold" style={{ color: 'var(--color-text-primary)' }}>Start a new game?</h2>
            <p className="mt-2 text-sm leading-relaxed" style={{ color: 'var(--color-text-secondary)' }}>
              Your current game will be lost.
            </p>
            <div className="mt-6 flex gap-3">
              <button className="catan-primary-btn flex-1" onClick={() => { setConfirmNew(false); newGame(); }}>New Game</button>
              <button className="catan-tool-btn flex-1" onClick={() => setConfirmNew(false)}>Cancel</button>
            </div>
          </div>
        </div>
      )}

      {showTradeBuilder && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 px-4" onClick={(e) => { if (e.target === e.currentTarget) setShowTradeBuilder(false); }}>
          <div className="catan-modal max-h-[88vh] w-full max-w-lg overflow-y-auto p-6">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-xl font-bold" style={{ color: 'var(--color-text-primary)' }}>Propose Trade</h2>
              <button className="text-2xl" style={{ color: 'var(--color-text-secondary)' }} onClick={() => setShowTradeBuilder(false)}>&times;</button>
            </div>

            <div className="space-y-5">
              <div>
                <div className="catan-panel-label mb-2">You give (you have)</div>
                <div className="catan-trade-rows">
                  {RESOURCES.map(resource => {
                    const owned = human.resources[resource];
                    const value = tradeGive[resource];
                    return (
                      <div key={resource} className="catan-trade-row">
                        <span className={`catan-trade-chip resource-${resource}`}>{RESOURCE_LABELS[resource]}</span>
                        <span className="catan-trade-have">{owned}</span>
                        <div className="catan-stepper">
                          <button
                            className="catan-tool-btn px-2"
                            disabled={value <= 0}
                            onClick={() => setTradeGive(prev => ({ ...prev, [resource]: Math.max(0, prev[resource] - 1) }))}
                          >
                            &minus;
                          </button>
                          <strong>{value}</strong>
                          <button
                            className="catan-tool-btn px-2"
                            disabled={value >= owned}
                            onClick={() => setTradeGive(prev => ({ ...prev, [resource]: Math.min(owned, prev[resource] + 1) }))}
                          >
                            +
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              <div>
                <div className="catan-panel-label mb-2">You receive</div>
                <div className="catan-trade-rows">
                  {RESOURCES.map(resource => {
                    const value = tradeReceive[resource];
                    return (
                      <div key={resource} className="catan-trade-row">
                        <span className={`catan-trade-chip resource-${resource}`}>{RESOURCE_LABELS[resource]}</span>
                        <span className="catan-trade-have">&nbsp;</span>
                        <div className="catan-stepper">
                          <button
                            className="catan-tool-btn px-2"
                            disabled={value <= 0}
                            onClick={() => setTradeReceive(prev => ({ ...prev, [resource]: Math.max(0, prev[resource] - 1) }))}
                          >
                            &minus;
                          </button>
                          <strong>{value}</strong>
                          <button
                            className="catan-tool-btn px-2"
                            onClick={() => setTradeReceive(prev => ({ ...prev, [resource]: prev[resource] + 1 }))}
                          >
                            +
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              <div>
                <div className="catan-panel-label mb-2">Offer to</div>
                <div className="grid grid-cols-2 gap-2">
                  {playerIds.filter(id => id !== HUMAN_PLAYER).map(id => {
                    const opponent = board.players[id];
                    const selected = tradeTargets.includes(id);
                    return (
                      <button
                        key={id}
                        className={`catan-tool-btn ${selected ? 'active' : ''}`}
                        onClick={() => setTradeTargets(prev => selected ? prev.filter(t => t !== id) : [...prev, id])}
                      >
                        <span className="mr-1 inline-block h-2.5 w-2.5 rounded-full align-middle" style={{ backgroundColor: opponent.color }} />
                        {opponent.name}
                      </button>
                    );
                  })}
                </div>
                <div className="mt-2 flex gap-2">
                  <button
                    className="catan-tool-btn flex-1"
                    onClick={() => setTradeTargets(playerIds.filter(id => id !== HUMAN_PLAYER))}
                  >
                    Select All
                  </button>
                  <button className="catan-tool-btn flex-1" onClick={() => setTradeTargets([])}>
                    Clear
                  </button>
                </div>
              </div>

              <button
                className="catan-primary-btn w-full"
                disabled={
                  resourceTotal(tradeGive) === 0 ||
                  resourceTotal(tradeReceive) === 0 ||
                  tradeTargets.filter(id => id !== HUMAN_PLAYER).length === 0
                }
                onClick={submitTrade}
              >
                Send Offer
              </button>
            </div>
          </div>
        </div>
      )}

      {showMonopolyPicker && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 px-4" onClick={(e) => { if (e.target === e.currentTarget) setShowMonopolyPicker(false); }}>
          <div className="catan-modal w-full max-w-sm p-6">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-xl font-bold" style={{ color: 'var(--color-text-primary)' }}>Monopoly</h2>
              <button className="text-2xl" style={{ color: 'var(--color-text-secondary)' }} onClick={() => setShowMonopolyPicker(false)}>&times;</button>
            </div>
            <p className="mb-4 text-sm leading-relaxed" style={{ color: 'var(--color-text-secondary)' }}>
              Choose a resource. Every opponent gives you all of theirs.
            </p>
            <div className="catan-picker-grid">
              {RESOURCES.map(resource => (
                <button
                  key={resource}
                  className={`catan-resource-pill resource-${resource} catan-picker-pill`}
                  title={RESOURCE_LABELS[resource]}
                  onClick={() => submitMonopoly(resource)}
                >
                  <span>{RESOURCE_LABELS[resource]}</span>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {showYopPicker && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 px-4" onClick={(e) => { if (e.target === e.currentTarget) setShowYopPicker(false); }}>
          <div className="catan-modal w-full max-w-sm p-6">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-xl font-bold" style={{ color: 'var(--color-text-primary)' }}>Year of Plenty</h2>
              <button className="text-2xl" style={{ color: 'var(--color-text-secondary)' }} onClick={() => setShowYopPicker(false)}>&times;</button>
            </div>
            <p className="mb-4 text-sm leading-relaxed" style={{ color: 'var(--color-text-secondary)' }}>
              Take two resources from the bank. Pick the same one twice for a double.
            </p>
            <div className="catan-picker-grid">
              {RESOURCES.map(resource => {
                const slots = yopPick.filter(pick => pick === resource).length;
                // A resource is unselectable if no legal pair starts with it given
                // the current first pick (handles the bank running low on a type).
                const disabled = yopPick.length === 0
                  ? !yopLegalKeys.has(`${resource}|${resource}`) && !RESOURCES.some(other => yopLegalKeys.has(`${resource}|${other}`))
                  : !yopLegalKeys.has(`${yopPick[0]}|${resource}`);
                return (
                  <button
                    key={resource}
                    className={`catan-resource-pill resource-${resource} catan-picker-pill ${slots > 0 ? 'selected' : ''}`}
                    disabled={disabled && slots === 0}
                    title={RESOURCE_LABELS[resource]}
                    onClick={() => toggleYopPick(resource)}
                  >
                    <span>{RESOURCE_LABELS[resource]}</span>
                    {slots > 0 && <strong className="catan-picker-badge">{slots}</strong>}
                  </button>
                );
              })}
            </div>
            <div className="mt-4 flex items-center justify-between gap-3">
              <span className="text-xs" style={{ color: 'var(--color-text-muted)' }}>
                {yopPick.length}/2 selected
              </span>
              <button
                className="catan-primary-btn flex-1"
                disabled={yopPick.length !== 2 || !yopLegalKeys.has(`${yopPick[0]}|${yopPick[1]}`)}
                onClick={submitYop}
              >
                Take Resources
              </button>
            </div>
          </div>
        </div>
      )}

      {robberVictimPicker && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 px-4" onClick={(e) => { if (e.target === e.currentTarget) setRobberVictimPicker(null); }}>
          <div className="catan-modal w-full max-w-sm p-6">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-xl font-bold" style={{ color: 'var(--color-text-primary)' }}>Steal From</h2>
              <button className="text-2xl" style={{ color: 'var(--color-text-secondary)' }} onClick={() => setRobberVictimPicker(null)}>&times;</button>
            </div>
            <p className="mb-4 text-sm leading-relaxed" style={{ color: 'var(--color-text-secondary)' }}>
              More than one opponent borders this tile. Choose whom to rob.
            </p>
            <div className="space-y-2">
              {robberVictimPicker.victims.map(victimId => {
                const opponent = board.players[victimId];
                const cards = board.getPlayerResourceTotal(victimId);
                return (
                  <button
                    key={victimId}
                    className="catan-tool-btn flex w-full items-center justify-between"
                    onClick={() => chooseRobberVictim(victimId)}
                  >
                    <span className="flex items-center gap-2">
                      <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ backgroundColor: opponent.color }} />
                      {opponent.name}
                    </span>
                    <span style={{ color: 'var(--color-text-muted)' }}>{cards} {cards === 1 ? 'card' : 'cards'}</span>
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      )}

      <div className="mx-auto flex min-h-screen w-full max-w-[1500px] flex-col gap-4 px-4 py-4 lg:flex-row lg:px-6">
        <aside className="order-2 flex w-full flex-col gap-3 lg:order-1 lg:w-[330px]">
          <div className="catan-panel p-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <Link to="/" className="catan-panel-label hover:opacity-80">GIPF Project</Link>
                <h1 className="mt-1 font-display text-3xl font-bold" style={{ color: 'var(--color-text-primary)' }}>CATAN</h1>
                <p className="mt-1 text-xs" style={{ color: 'var(--color-text-muted)' }}>
                  {activeRuleset.name} / {board.mapName}
                </p>
              </div>
              <button className="catan-tool-btn px-3" onClick={() => setShowSettings(true)}>Settings</button>
            </div>
            <div className="mt-4 rounded-lg px-3 py-2" style={{ backgroundColor: 'var(--color-bg-soft)' }}>
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <div className="text-sm font-semibold" style={{ color: 'var(--color-text-primary)' }}>{statusText()}</div>
                  <div className="mt-1 text-xs" style={{ color: 'var(--color-text-muted)' }}>Turn {board.turnNumber}</div>
                </div>
                {(() => {
                  const dice = splitDice(board.lastRoll);
                  if (!dice) return null;
                  return (
                    <div className="catan-dice-display" title={`Rolled ${board.lastRoll}`}>
                      <DieFace value={dice[0]} />
                      <DieFace value={dice[1]} />
                    </div>
                  );
                })()}
              </div>
            </div>
          </div>

          {playerIds.map(renderPlayerPanel)}
        </aside>

        <main className="order-1 flex min-h-[520px] flex-1 flex-col items-center justify-center gap-4 lg:order-2">
          <div className="catan-board-shell">
            {renderBoard()}
          </div>
          <div className="catan-hand">
            <div className="catan-panel-label mb-2 text-center">Your Hand</div>
            <div className="catan-card-tray">
              {RESOURCES.map(resource => (
                <CardStack key={resource} variant={resource} count={human.resources[resource]} label={RESOURCE_LABELS[resource]} />
              ))}
              {(() => {
                const devTotal = Object.values(human.devCards).reduce((a, b) => a + b, 0)
                  + Object.values(human.newDevCards).reduce((a, b) => a + b, 0);
                return devTotal > 0 ? <CardStack variant="dev" count={devTotal} label="Dev" /> : null;
              })()}
            </div>
          </div>
        </main>

        <aside className="order-3 flex w-full flex-col gap-3 lg:w-[330px]">
          <div className="catan-panel p-4">
            <div className="mb-3 flex items-center justify-between gap-3">
              <h2 className="text-lg font-bold" style={{ color: 'var(--color-text-primary)' }}>Actions</h2>
              <button className="catan-tool-btn px-3" onClick={() => setConfirmNew(true)}>New</button>
            </div>
            <div className="catan-vp-indicator mb-3">
              <span className="catan-vp-label">Your VP</span>
              <span className="catan-vp-value">
                <strong>{board.getVictoryPoints(HUMAN_PLAYER)}</strong>
                <span className="catan-vp-sep">/</span>
                {board.victoryTarget}
              </span>
            </div>
            {renderActionButtons()}
          </div>

          <div className="catan-panel p-4">
            <div className="catan-panel-label mb-2">Game Log</div>
            <div className="catan-log-feed" ref={logEndRef}>
              {gameLog.length === 0 ? (
                <p className="catan-log-empty">No moves yet.</p>
              ) : (
                gameLog.map((entry, index) => (
                  <div key={`${index}-${entry}`} className="catan-log-entry">
                    {entry}
                  </div>
                ))
              )}
            </div>
          </div>

          <div className="catan-panel p-4">
            <div className="catan-panel-label mb-2">Board</div>
            <div className="grid grid-cols-2 gap-2 text-sm" style={{ color: 'var(--color-text-secondary)' }}>
              <span>Rule set</span>
              <strong style={{ color: 'var(--color-text-primary)' }}>{activeRuleset.name}</strong>
              <span>Scenario</span>
              <strong style={{ color: 'var(--color-text-primary)' }}>{activeScenario?.name || 'Random'}</strong>
              <span>Target</span>
              <strong style={{ color: 'var(--color-text-primary)' }}>{board.victoryTarget} VP</strong>
              <span>Players</span>
              <strong style={{ color: 'var(--color-text-primary)' }}>{board.playerCount}</strong>
              <span>Longest road</span>
              <strong style={{ color: 'var(--color-text-primary)' }}>
                {board.longestRoadHolder ? board.players[board.longestRoadHolder].name : 'None'}
              </strong>
              <span>Largest army</span>
              <strong style={{ color: 'var(--color-text-primary)' }}>
                {board.largestArmyHolder ? board.players[board.largestArmyHolder].name : 'None'}
              </strong>
              <span>Dev deck</span>
              <strong style={{ color: 'var(--color-text-primary)' }}>{board.devDeck.length}</strong>
              <span>Robber</span>
              <strong style={{ color: 'var(--color-text-primary)' }}>{board.getTile(board.robberTileId)?.resource}</strong>
            </div>
          </div>

          <div className="catan-panel p-4">
            <div className="catan-panel-label mb-2">Expansion Modules</div>
            <div className="catan-module-list">
              {activeRuleset.modules.map(module => (
                <span key={module}>{module}</span>
              ))}
            </div>
          </div>
        </aside>
      </div>
    </div>
  );
}
