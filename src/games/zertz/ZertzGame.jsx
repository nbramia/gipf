// ZertzGame.jsx - React UI + SVG rendering for Zertz
import React, { useState, useEffect, useCallback } from 'react';
import './zertz.css';
import ZertzBoard from './ZertzBoard.js';

// Toggle component
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
  const [board, setBoard] = useState(() => new ZertzBoard());
  const [darkMode, setDarkMode] = useState(() => {
    const saved = localStorage.getItem('zertzDarkMode');
    return saved ? JSON.parse(saved) : false;
  });
  const [showPossibleMoves, setShowPossibleMoves] = useState(() => {
    const saved = localStorage.getItem('zertzShowMoves');
    return saved ? JSON.parse(saved) : true;
  });
  const [showModal, setShowModal] = useState(true);
  const [showSettings, setShowSettings] = useState(false);

  useEffect(() => {
    localStorage.setItem('zertzDarkMode', JSON.stringify(darkMode));
  }, [darkMode]);
  useEffect(() => {
    localStorage.setItem('zertzShowMoves', JSON.stringify(showPossibleMoves));
  }, [showPossibleMoves]);

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'z' && !e.shiftKey) {
        e.preventDefault();
        if (board.canUndo()) { board.undo(); setBoard(board.clone()); }
      }
      if (((e.ctrlKey || e.metaKey) && e.key === 'y') ||
          ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === 'z')) {
        e.preventDefault();
        if (board.canRedo()) { board.redo(); setBoard(board.clone()); }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [board]);

  // --- Derived state ---
  const {
    rings, marbles, pool, captures, currentPlayer, gamePhase,
    winner, winConditionMet, selectedColor, jumpingMarble
  } = board;

  const validPlacements = gamePhase === 'place-marble' && selectedColor
    ? board.getValidPlacements() : [];
  const freeRings = gamePhase === 'remove-ring' ? board.getFreeRings() : [];
  const availableCaptures = gamePhase === 'capture' ? board.getAvailableCaptures() : [];
  const jumpTargets = (gamePhase === 'capture' && jumpingMarble)
    ? board.getJumpTargets(jumpingMarble).map(t => t.target) : [];

  const positions = ZertzBoard.generateValidPositions();

  // --- Handlers ---

  const handleHexClick = useCallback((q, r) => {
    if (gamePhase === 'game-over') return;
    board.handleClick(q, r);
    setBoard(board.clone());
    if (board.gamePhase === 'game-over') setShowModal(true);
  }, [board, gamePhase]);

  const handleColorSelect = useCallback((color) => {
    board.selectMarbleColor(color);
    setBoard(board.clone());
  }, [board]);

  const handleUndo = () => { if (board.canUndo()) { board.undo(); setBoard(board.clone()); } };
  const handleRedo = () => { if (board.canRedo()) { board.redo(); setBoard(board.clone()); } };

  const startNewGame = () => {
    board.startNewGame();
    setBoard(board.clone());
    setShowModal(false);
  };

  // --- Rendering helpers ---

  const getPhaseText = () => {
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
      <Toggle label="Dark Mode" checked={darkMode} onChange={() => setDarkMode(!darkMode)} />
      <Toggle label="Show Valid Moves" checked={showPossibleMoves} onChange={() => setShowPossibleMoves(!showPossibleMoves)} />
    </div>
  );

  // ---- Capture panel for a player ----
  const renderCaptureDisplay = (player) => {
    const caps = captures[player];
    const isActive = currentPlayer === player && gamePhase !== 'game-over';
    const conditions = ZertzBoard.WIN_CONDITIONS;

    return (
      <div
        className="rounded-lg p-4 transition-all"
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
            Player {player}
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
                        border: filled ? `1px solid var(--color-marble-${color}-stroke)` : '1px solid transparent',
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
            {board.getPoolTotal()} remaining
          </span>
        </div>
        <div className="flex gap-2 justify-center">
          {['white', 'grey', 'black'].map(color => {
            const count = fromCaptures ? captures[currentPlayer][color] : pool[color];
            const isAvailable = isPlacing && availableColors.includes(color);
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
                  border: isSelected ? '2px solid var(--color-player-active)' : '2px solid transparent',
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

  // Button style
  const btnClass = `border text-sm font-medium py-2 px-3 rounded-lg transition-all min-h-[40px]`;
  const btnStyle = {
    borderColor: 'var(--color-border-button)',
    color: 'var(--color-text-secondary)',
  };

  return (
    <div className={`game-zertz min-h-screen flex flex-col items-center font-body bg-[var(--color-bg-page)] ${darkMode ? 'dark' : ''}`}>

      {/* ---- Modal ---- */}
      {showModal && (
        <div
          className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 backdrop-blur-sm"
          onClick={(e) => { if (e.target === e.currentTarget) setShowModal(false); }}
        >
          <div
            className="p-8 rounded-xl shadow-2xl max-w-sm w-full mx-4"
            style={{
              backgroundColor: 'var(--color-bg-modal)',
              border: '1px solid var(--color-border-panel)',
            }}
          >
            <h2
              className="font-heading text-2xl font-extrabold text-center tracking-wider uppercase mb-1"
              style={{ color: 'var(--color-text-primary)' }}
            >
              {gamePhase === 'game-over' ? (winner ? `Player ${winner} wins` : 'Draw') : 'ZERTZ'}
            </h2>
            {gamePhase === 'game-over' && winConditionMet ? (
              <p className="text-center mb-6 text-sm" style={{ color: 'var(--color-text-muted)' }}>
                {getWinConditionLabel()}
              </p>
            ) : (
              <p className="text-center mb-6 text-xs" style={{ color: 'var(--color-text-muted)' }}>
                A game of the GIPF project
              </p>
            )}
            <div className="flex justify-center mb-6">
              <button
                onClick={startNewGame}
                className="py-2.5 px-8 rounded-lg font-semibold text-sm hover:opacity-90 transition-all tracking-wide"
                style={{
                  backgroundColor: 'var(--color-btn-primary-bg)',
                  color: 'var(--color-btn-primary-text)',
                }}
              >
                {gamePhase === 'game-over' ? 'Play Again' : 'New Game'}
              </button>
            </div>
            {renderSettingsToggles()}
          </div>
        </div>
      )}

      {/* ---- Settings Panel ---- */}
      {showSettings && (
        <div
          className="fixed inset-0 bg-black/40 z-50 backdrop-blur-sm"
          onClick={(e) => { if (e.target === e.currentTarget) setShowSettings(false); }}
        >
          <div
            className="settings-panel fixed right-0 top-0 bottom-0 w-72 shadow-2xl overflow-y-auto"
            style={{
              backgroundColor: 'var(--color-bg-panel)',
              borderLeft: '1px solid var(--color-border-panel)',
            }}
          >
            <div className="flex items-center justify-between p-5 border-b" style={{ borderColor: 'var(--color-border-panel)' }}>
              <h2 className="text-base font-bold" style={{ color: 'var(--color-text-primary)' }}>Settings</h2>
              <button
                onClick={() => setShowSettings(false)}
                className="text-xl leading-none"
                style={{ color: 'var(--color-text-muted)' }}
              >
                &times;
              </button>
            </div>
            <div className="p-5">{renderSettingsToggles()}</div>
          </div>
        </div>
      )}

      {/* ---- Header ---- */}
      <div className="flex flex-col items-center pt-3 md:pt-5 shrink-0">
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
                P{currentPlayer}
              </span>
            )}
            {gamePhase !== 'game-over' && <span className="mx-1.5" style={{ color: 'var(--color-text-muted)' }}>&middot;</span>}
            {getPhaseText()}
          </span>
        </div>
      </div>

      {/* ---- Main content: 3-column ---- */}
      <div className="flex-1 flex flex-col md:flex-row items-center md:items-start justify-center gap-3 md:gap-5 p-3 md:p-4 w-full max-w-[1200px]">

        {/* Left panel — Player 1 */}
        <div className="hidden md:flex flex-col gap-3 w-52 lg:w-56 order-1 shrink-0">
          {renderCaptureDisplay(1)}
        </div>

        {/* Center — Board + Pool + Controls */}
        <div className="flex flex-col items-center gap-3 order-2">

          {/* Board container matching Yinsh pattern */}
          <div
            className="p-3 md:p-5 lg:p-7 rounded-xl shadow-lg"
            style={{ backgroundColor: 'var(--color-bg-board)' }}
          >
            <svg
              viewBox={`0 0 ${SVG_SIZE} ${SVG_SIZE}`}
              className="w-full max-w-[440px] md:max-w-[480px] lg:max-w-[500px]"
              role="img"
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

              {/* Hex tiles */}
              {positions.map(([q, r]) => {
                const key = `${q},${r}`;
                if (!rings.has(key)) return null;

                const [sx, sy] = axialToScreen(q, r);
                const cx = CENTER + sx;
                const cy = CENTER + sy;

                const isFree = freeRings.includes(key);
                const isValidPlacement = showPossibleMoves && validPlacements.includes(key);
                const isJumpTarget = showPossibleMoves && jumpTargets.includes(key);
                const marble = marbles[key];
                const isJumpable = showPossibleMoves && availableCaptures.includes(key);
                const isJumping = jumpingMarble === key;

                return (
                  <g
                    key={key}
                    role="button"
                    tabIndex={0}
                    onClick={() => handleHexClick(q, r)}
                    onKeyDown={(e) => { if (e.key === 'Enter') handleHexClick(q, r); }}
                    style={{ cursor: 'pointer' }}
                  >
                    {/* Outer hex — ring platform */}
                    <polygon
                      points={hexPoints(cx, cy, HEX_SIZE - 1)}
                      fill={isFree ? 'var(--color-ring-free)' : 'var(--color-ring-fill)'}
                      stroke={isFree ? 'var(--color-ring-free-stroke)' : 'var(--color-ring-stroke)'}
                      strokeWidth={isFree ? 1.5 : 0.75}
                      filter="url(#tile-bevel)"
                    />

                    {/* Inner hex — raised center */}
                    <polygon
                      points={hexPoints(cx, cy - 0.5, HEX_SIZE - 5)}
                      fill={isFree ? 'none' : 'var(--color-ring-fill-inner)'}
                      stroke={isFree ? 'none' : 'var(--color-ring-stroke-inner)'}
                      strokeWidth="0.5"
                    />

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

                    {/* Marble */}
                    {marble && (
                      <g className="piece-enter" filter="url(#marble-shadow)">
                        {/* Main sphere */}
                        <circle
                          cx={cx} cy={cy} r={HEX_SIZE * 0.5}
                          fill={`url(#grad-${marble})`}
                          stroke={`var(--color-marble-${marble}-stroke)`}
                          strokeWidth={marble === 'white' ? 0.75 : 0.5}
                        />

                        {/* Specular highlight */}
                        <ellipse
                          cx={cx - HEX_SIZE * 0.12}
                          cy={cy - HEX_SIZE * 0.14}
                          rx={HEX_SIZE * 0.15}
                          ry={HEX_SIZE * 0.1}
                          fill="white"
                          opacity={marble === 'white' ? 0.5 : marble === 'grey' ? 0.3 : 0.12}
                        />

                        {/* Jumpable highlight ring */}
                        {isJumpable && (
                          <circle
                            cx={cx} cy={cy} r={HEX_SIZE * 0.57}
                            fill="none"
                            stroke="var(--color-jumpable-marble)"
                            strokeWidth={2}
                            className="jumpable-pulse"
                          />
                        )}

                        {/* Currently jumping indicator */}
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
          <div className="flex gap-2 items-center">
            <button onClick={handleUndo} disabled={!board.canUndo()} className={`${btnClass} ${!board.canUndo() ? 'opacity-25' : 'hover:opacity-80'}`} style={btnStyle} title="Undo (Ctrl+Z)">
              Undo
            </button>
            <button onClick={handleRedo} disabled={!board.canRedo()} className={`${btnClass} ${!board.canRedo() ? 'opacity-25' : 'hover:opacity-80'}`} style={btnStyle} title="Redo (Ctrl+Shift+Z)">
              Redo
            </button>
            <button onClick={() => setShowSettings(true)} className={`${btnClass} hover:opacity-80`} style={btnStyle}>
              Settings
            </button>
            <button onClick={() => setShowModal(true)} className={`${btnClass} hover:opacity-80`} style={btnStyle}>
              Menu
            </button>
          </div>

          {/* Mobile capture displays */}
          <div className="flex md:hidden gap-2 w-full">
            <div className="flex-1">{renderCaptureDisplay(1)}</div>
            <div className="flex-1">{renderCaptureDisplay(2)}</div>
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

export default ZertzGame;
