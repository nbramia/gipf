// CatanGame.jsx - React UI + SVG rendering for Catan.

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import CatanBoard, { RESOURCES, COSTS, resourceTotal } from './CatanBoard.js';
import useAIWorker from './hooks/useAIWorker.js';
import { MCTS } from './engine/mcts.js';
import { applyAIMove } from './engine/aiPlayer.js';
import './catan.css';

const HUMAN_PLAYER = 1;
const BOARD_SCALE = 58;
const BOARD_CENTER = { x: 360, y: 335 };

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

function screenPoint(point) {
  return {
    x: point.x * BOARD_SCALE + BOARD_CENTER.x,
    y: point.y * BOARD_SCALE + BOARD_CENTER.y,
  };
}

function formatCost(cost) {
  return Object.entries(cost)
    .map(([resource, amount]) => `${amount} ${RESOURCE_LABELS[resource]}`)
    .join(', ');
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
  const [board, setBoard] = useState(() => new CatanBoard({ seed: Date.now() }));
  const [darkMode, setDarkMode] = useState(() => JSON.parse(localStorage.getItem('catanDarkMode') || 'false'));
  const [showPossibleMoves, setShowPossibleMoves] = useState(() => JSON.parse(localStorage.getItem('catanShowMoves') || 'true'));
  const [difficulty, setDifficulty] = useState(() => localStorage.getItem('catanDifficulty') || 'expert');
  const [selectedAction, setSelectedAction] = useState(null);
  const [isAiThinking, setIsAiThinking] = useState(false);
  const [showModal, setShowModal] = useState(true);
  const [showSettings, setShowSettings] = useState(false);
  const [showRules, setShowRules] = useState(false);
  const [lastMove, setLastMove] = useState(null);
  const aiTimerRef = useRef(null);
  const { computeMove, isSupported: workerSupported } = useAIWorker();

  useEffect(() => localStorage.setItem('catanDarkMode', JSON.stringify(darkMode)), [darkMode]);
  useEffect(() => localStorage.setItem('catanShowMoves', JSON.stringify(showPossibleMoves)), [showPossibleMoves]);
  useEffect(() => localStorage.setItem('catanDifficulty', difficulty), [difficulty]);

  const isHumanTurn = board.currentPlayer === HUMAN_PLAYER && board.phase !== 'game-over';
  const currentPlayer = board.players[board.currentPlayer];
  const human = board.players[HUMAN_PLAYER];
  const config = DIFFICULTY_CONFIG[difficulty] || DIFFICULTY_CONFIG.expert;

  const applyMove = useCallback((move) => {
    const applied = board.applyMove(move);
    if (!applied) return false;
    setLastMove(move);
    setSelectedAction(null);
    setBoard(board.clone());
    if (board.phase === 'game-over') setShowModal(true);
    return true;
  }, [board]);

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
      const fallback = new MCTS({ maxChildren: config.maxChildren });
      fallback.getBestMove(board, Math.max(60, Math.floor(config.simulations / 4)))
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
        config.simulations,
        onSuccess,
        onError,
        config.maxChildren
      );
    } else {
      const mcts = new MCTS({ maxChildren: config.maxChildren });
      mcts.getBestMove(board, config.simulations).then(onSuccess).catch(onError);
    }
  }, [applyAIMove, board, computeMove, config.maxChildren, config.simulations, isAiThinking, workerSupported]);

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
    applyMove({
      type: 'move-robber',
      tileId,
      stealPlayerId: board.getRobberVictims(tileId).filter(playerId => playerId !== HUMAN_PLAYER)[0] || null,
    });
  };

  const newGame = () => {
    const next = new CatanBoard({ seed: Date.now() });
    setBoard(next);
    setSelectedAction(null);
    setLastMove(null);
    setIsAiThinking(false);
    setShowModal(false);
  };

  const statusText = () => {
    if (board.phase === 'game-over') return `${board.players[board.winner]?.name || 'Player'} wins`;
    if (isAiThinking) return `${currentPlayer.name} is thinking`;
    if (board.phase === 'setup-settlement') return `${currentPlayer.name}: settlement`;
    if (board.phase === 'setup-road') return `${currentPlayer.name}: road`;
    if (board.phase === 'roll') return `${currentPlayer.name}: roll`;
    if (board.phase === 'robber') return `${currentPlayer.name}: robber`;
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

    if (board.phase === 'robber') {
      return (
        <p className="text-sm leading-relaxed" style={{ color: 'var(--color-text-secondary)' }}>
          Select a non-robber tile.
        </p>
      );
    }

    const trades = board.getStrategicTradeOptions(HUMAN_PLAYER, 8);
    const playableDev = human.playedDevThisTurn ? [] : [
      human.devCards.knight > 0 && { type: 'play-knight', label: 'Knight' },
      human.devCards.roadBuilding > 0 && { type: 'play-road-building', label: 'Road Building' },
      human.devCards.yearOfPlenty > 0 && {
        type: 'play-year-of-plenty',
        label: 'Year of Plenty',
        resourceA: board._mostNeededResources(HUMAN_PLAYER)[0],
        resourceB: board._mostNeededResources(HUMAN_PLAYER)[1],
      },
      human.devCards.monopoly > 0 && {
        type: 'play-monopoly',
        label: 'Monopoly',
        resource: board._bestMonopolyResource(HUMAN_PLAYER),
      },
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
              <button key={card.type} className="catan-tool-btn" onClick={() => applyMove(card)}>
                {card.label}
              </button>
            ))}
          </div>
        )}

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
          End Turn
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

  const renderBoard = () => (
    <svg className="catan-board-svg" viewBox="0 0 720 670" role="img" aria-label="Catan board">
      <defs>
        <filter id="catan-piece-shadow" x="-40%" y="-40%" width="180%" height="180%">
          <feDropShadow dx="0" dy="2" stdDeviation="2" floodOpacity="0.22" />
        </filter>
      </defs>

      {board.tiles.map(tile => {
        const points = tile.vertices
          .map(vertexId => screenPoint(board.vertices[vertexId]))
          .map(({ x, y }) => `${x},${y}`)
          .join(' ');
        const center = screenPoint(tile);
        const isRobber = board.robberTileId === tile.id;
        const isRobberTarget = validRobberTiles.includes(tile.id);
        const pips = CatanBoard.getPipCount(tile.number);
        return (
          <g
            key={tile.id}
            role={board.phase === 'robber' && isHumanTurn ? 'button' : undefined}
            tabIndex={board.phase === 'robber' && isHumanTurn ? 0 : undefined}
            onClick={() => handleTileClick(tile.id)}
            className={isRobberTarget ? 'catan-clickable' : ''}
          >
            <polygon
              points={points}
              className={`catan-tile tile-${tile.resource} ${isRobberTarget ? 'robber-target' : ''}`}
            />
            {tile.number && (
              <g>
                <circle
                  cx={center.x}
                  cy={center.y}
                  r="18"
                  className={`catan-number-token ${tile.number === 6 || tile.number === 8 ? 'hot' : ''}`}
                />
                <text x={center.x} y={center.y - 1} textAnchor="middle" dominantBaseline="central" className="catan-number">
                  {tile.number}
                </text>
                <text x={center.x} y={center.y + 12} textAnchor="middle" className="catan-pips">
                  {'.'.repeat(pips)}
                </text>
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
        return (
          <g key={edge.id} role="button" tabIndex={0} onClick={() => handleEdgeClick(edge.id)} className={isValid ? 'catan-clickable' : ''}>
            <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} className="catan-edge-hit" />
            <line
              x1={a.x}
              y1={a.y}
              x2={b.x}
              y2={b.y}
              className={`catan-road ${isValid ? 'valid' : ''} ${isLast ? 'last' : ''}`}
              style={{ stroke: edge.owner ? board.players[edge.owner].color : undefined }}
            />
            {edge.port && (
              <text
                x={(a.x + b.x) / 2}
                y={(a.y + b.y) / 2}
                className="catan-port"
                textAnchor="middle"
                dominantBaseline="central"
              >
                {edge.port === 'any' ? '3:1' : '2:1'}
              </text>
            )}
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
                    stroke="var(--color-piece-stroke)"
                    strokeWidth="2"
                  />
                ) : (
                  <path
                    d={`M${point.x - 12} ${point.y + 9} L${point.x - 12} ${point.y - 3} L${point.x} ${point.y - 14} L${point.x + 12} ${point.y - 3} L${point.x + 12} ${point.y + 9} Z`}
                    fill={board.players[building.player].color}
                    stroke="var(--color-piece-stroke)"
                    strokeWidth="2"
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
          <div className="catan-modal w-full max-w-md p-7">
            <h2 className="text-2xl font-bold" style={{ color: 'var(--color-text-primary)' }}>
              {board.phase === 'game-over' ? `${board.players[board.winner]?.name} wins` : 'CATAN'}
            </h2>
            <p className="mt-2 text-sm leading-relaxed" style={{ color: 'var(--color-text-secondary)' }}>
              {board.phase === 'game-over'
                ? `${board.winningPoints} victory points on turn ${board.turnNumber}.`
                : 'Four-player base game against three MCTS opponents.'}
            </p>
            <div className="mt-6 flex gap-3">
              <button className="catan-primary-btn flex-1" onClick={newGame}>New Game</button>
              <button className="catan-tool-btn flex-1" onClick={() => setShowModal(false)}>Continue</button>
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
              <p>Reach 10 victory points through settlements, cities, development cards, largest army, and longest road.</p>
              <p>Setup uses snake order. The second settlement pays starting resources from adjacent non-desert tiles.</p>
              <p>Roll 7 to move the robber. Players above 7 cards discard automatically, then the robber blocks one tile and steals from an adjacent opponent.</p>
              <p>Bank and port trades are supported. Opponent-to-opponent negotiation is intentionally omitted for fast solo play.</p>
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
                <h1 className="mt-1 font-display text-3xl font-bold tracking-wide" style={{ color: 'var(--color-text-primary)' }}>CATAN</h1>
              </div>
              <button className="catan-tool-btn px-3" onClick={() => setShowSettings(true)}>Settings</button>
            </div>
            <div className="mt-4 rounded-lg px-3 py-2" style={{ backgroundColor: 'var(--color-bg-soft)' }}>
              <div className="text-sm font-semibold" style={{ color: 'var(--color-text-primary)' }}>{statusText()}</div>
              <div className="mt-1 text-xs" style={{ color: 'var(--color-text-muted)' }}>
                Turn {board.turnNumber}{board.lastRoll ? ` - Rolled ${board.lastRoll}` : ''}
              </div>
            </div>
          </div>

          {[1, 2, 3, 4].map(renderPlayerPanel)}
        </aside>

        <main className="order-1 flex min-h-[520px] flex-1 items-center justify-center lg:order-2">
          <div className="catan-board-shell">
            {renderBoard()}
          </div>
        </main>

        <aside className="order-3 flex w-full flex-col gap-3 lg:w-[330px]">
          <div className="catan-panel p-4">
            <div className="mb-3 flex items-center justify-between gap-3">
              <h2 className="text-lg font-bold" style={{ color: 'var(--color-text-primary)' }}>Actions</h2>
              <button className="catan-tool-btn px-3" onClick={newGame}>New</button>
            </div>
            {renderActionButtons()}
          </div>

          <div className="catan-panel p-4">
            <div className="catan-panel-label mb-2">Board</div>
            <div className="grid grid-cols-2 gap-2 text-sm" style={{ color: 'var(--color-text-secondary)' }}>
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
        </aside>
      </div>
    </div>
  );
}
