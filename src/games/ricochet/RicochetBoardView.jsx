// RicochetBoardView.jsx - SVG board for Ricochet: walls, targets, robots, arrows.
// Presentational only; all rules live in RicochetBoard.

import React, { useRef } from 'react';
import { SIZE, CELLS, ROBOTS, CENTER_CELLS, rowOf, colOf, hasWall } from './engine/geometry.js';

export const ROBOT_LETTER = { red: 'R', green: 'G', blue: 'B', yellow: 'Y' };
export const DIR_NAME = { N: 'north', E: 'east', S: 'south', W: 'west' };
export const COLOR_LABEL = { red: 'Red', green: 'Green', blue: 'Blue', yellow: 'Yellow' };

const S = 40;
const PAD = 8;
const FULL = SIZE * S + PAD * 2;
const cx = cell => PAD + colOf(cell) * S + S / 2;
const cy = cell => PAD + rowOf(cell) * S + S / 2;
const SWIPE_PX = 24;

const DIR_VEC = { N: [0, -1], E: [1, 0], S: [0, 1], W: [-1, 0] };

function polygon(n, r, rot = -Math.PI / 2) {
  return Array.from({ length: n }, (_, i) => {
    const a = rot + (i * 2 * Math.PI) / n;
    return `${(r * Math.cos(a)).toFixed(2)},${(r * Math.sin(a)).toFixed(2)}`;
  }).join(' ');
}

// A target symbol centred on (0,0). `color` null draws the vortex.
export function TargetGlyph({ shape, color, r = 12 }) {
  if (shape === 'vortex' || color == null) {
    const wedge = (i) => {
      const a1 = (i * Math.PI) / 2;
      const a2 = a1 + Math.PI / 2;
      return `M0 0 L${(r * Math.cos(a1)).toFixed(2)} ${(r * Math.sin(a1)).toFixed(2)} A${r} ${r} 0 0 1 ${(r * Math.cos(a2)).toFixed(2)} ${(r * Math.sin(a2)).toFixed(2)}Z`;
    };
    return (
      <g className="ricochet-glyph ricochet-vortex">
        {ROBOTS.map((name, i) => <path key={name} d={wedge(i)} fill={`var(--rc-${name})`} />)}
        <circle r={r} fill="none" stroke="var(--rc-glyph-edge)" strokeWidth="1.6" />
        <circle r={r * 0.42} fill="var(--rc-glyph-edge)" />
        <circle r={r * 0.2} fill="var(--rc-board)" />
      </g>
    );
  }
  const fill = `var(--rc-${color})`;
  const common = { fill, stroke: 'var(--rc-glyph-edge)', strokeWidth: 1.6, strokeLinejoin: 'round' };
  return (
    <g className="ricochet-glyph">
      {shape === 'circle' && <circle r={r} {...common} />}
      {shape === 'square' && <rect x={-r * 0.86} y={-r * 0.86} width={r * 1.72} height={r * 1.72} rx="1.5" {...common} />}
      {shape === 'triangle' && <polygon points={`0,${-r * 1.05} ${r * 1.0},${r * 0.8} ${-r * 1.0},${r * 0.8}`} {...common} />}
      {shape === 'hexagon' && <polygon points={polygon(6, r * 1.08, 0)} {...common} />}
    </g>
  );
}

function wallSegments(walls) {
  const segs = [];
  for (let cell = 0; cell < CELLS; cell++) {
    const x = PAD + colOf(cell) * S;
    const y = PAD + rowOf(cell) * S;
    if (hasWall(walls, cell, 1)) segs.push(`M${x + S} ${y}V${y + S}`);
    if (hasWall(walls, cell, 2)) segs.push(`M${x} ${y + S}H${x + S}`);
    if (colOf(cell) === 0 && hasWall(walls, cell, 3)) segs.push(`M${x} ${y}V${y + S}`);
    if (rowOf(cell) === 0 && hasWall(walls, cell, 0)) segs.push(`M${x} ${y}H${x + S}`);
  }
  return segs.join('');
}

export default function RicochetBoardView({
  board, robotCells, selected, arrows, onSelect, onMove, slideMs, interactive, showCurrent,
}) {
  const swipe = useRef(null);
  const swiped = useRef(false);
  const svgRef = useRef(null);

  const wallPath = React.useMemo(() => wallSegments(board.walls), [board.walls]);
  const current = showCurrent ? board.getTarget() : null;

  const cellAt = (clientX, clientY) => {
    const rect = svgRef.current.getBoundingClientRect();
    const k = FULL / rect.width;
    const col = Math.floor(((clientX - rect.left) * k - PAD) / S);
    const row = Math.floor(((clientY - rect.top) * k - PAD) / S);
    return col >= 0 && col < SIZE && row >= 0 && row < SIZE ? row * SIZE + col : -1;
  };

  const onPointerDown = (e) => {
    if (!interactive) return;
    const cell = cellAt(e.clientX, e.clientY);
    const robot = ROBOTS.find(r => robotCells[r] === cell) || null;
    swipe.current = { x: e.clientX, y: e.clientY, robot };
  };
  // A tap on empty board slides the selected robot along the dominant axis from
  // its centre to the tap point; a tap on a robot (or its arrows) is handled by
  // their own click handlers, and the robot's own cell is a dead zone.
  const tap = (e) => {
    if (e.target && e.target.closest && e.target.closest('.ricochet-arrow, .ricochet-robot')) return;
    const cell = cellAt(e.clientX, e.clientY);
    if (cell < 0) return;
    const occupant = ROBOTS.find(r => robotCells[r] === cell);
    if (occupant) { onSelect(occupant); return; }
    if (!selected) return;
    const rect = svgRef.current.getBoundingClientRect();
    const k = FULL / rect.width;
    const dx = (e.clientX - rect.left) * k - cx(robotCells[selected]);
    const dy = (e.clientY - rect.top) * k - cy(robotCells[selected]);
    const dir = Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'E' : 'W') : (dy > 0 ? 'S' : 'N');
    onMove(selected, dir);
  };
  const onPointerUp = (e) => {
    const s = swipe.current;
    swipe.current = null;
    if (!s || !interactive) return;
    const dx = e.clientX - s.x;
    const dy = e.clientY - s.y;
    if (Math.max(Math.abs(dx), Math.abs(dy)) < SWIPE_PX) { tap(e); return; }
    const dir = Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'E' : 'W') : (dy > 0 ? 'S' : 'N');
    const robot = s.robot || selected;
    if (!robot) return;
    swiped.current = true;
    setTimeout(() => { swiped.current = false; }, 0);
    onSelect(robot);
    onMove(robot, dir);
  };
  const guard = fn => (e) => {
    e.stopPropagation();
    if (swiped.current) return;
    fn(e);
  };

  return (
    <svg
      ref={svgRef}
      className="ricochet-svg"
      viewBox={`0 0 ${FULL} ${FULL}`}
      role="img"
      aria-label="Ricochet board, 16 by 16 grid"
      onPointerDown={onPointerDown}
      onPointerUp={onPointerUp}
      onPointerCancel={() => { swipe.current = null; }}
    >
      <rect x={PAD} y={PAD} width={SIZE * S} height={SIZE * S} fill="var(--rc-board)" />
      {Array.from({ length: CELLS }, (_, cell) => (
        (rowOf(cell) + colOf(cell)) % 2 === 0
          ? <rect key={cell} x={PAD + colOf(cell) * S} y={PAD + rowOf(cell) * S} width={S} height={S} fill="var(--rc-cell-alt)" />
          : null
      ))}
      <rect
        x={PAD + 7 * S} y={PAD + 7 * S} width={2 * S} height={2 * S}
        fill="var(--rc-center)" data-center={CENTER_CELLS.length}
      />

      <path d={wallPath} className="ricochet-walls" />

      {board.targets.map((t) => {
        const isCurrent = showCurrent && t.id === board.currentTargetId;
        const claimed = board.claimed.includes(t.id) && !isCurrent;
        return (
          <g
            key={t.id}
            transform={`translate(${cx(t.cell)} ${cy(t.cell)})`}
            className={`ricochet-target${isCurrent ? ' is-current' : ''}${claimed ? ' is-claimed' : ''}`}
            data-testid={isCurrent ? 'current-target' : undefined}
          >
            {isCurrent && <circle r="19" className="ricochet-target-ring" />}
            <TargetGlyph shape={t.shape} color={t.color} r={isCurrent ? 13 : 10.5} />
          </g>
        );
      })}

      {current && interactive && selected && arrows.map(({ dir, to }) => {
        const [vx, vy] = DIR_VEC[dir];
        const from = robotCells[selected];
        const ax = cx(from) + vx * S * 0.92;
        const ay = cy(from) + vy * S * 0.92;
        const rot = { N: 0, E: 90, S: 180, W: 270 }[dir];
        return (
          <g
            key={dir}
            transform={`translate(${ax} ${ay})`}
            className="ricochet-arrow"
            data-testid={`arrow-${dir}`}
            data-to={to}
            onClick={guard(() => onMove(selected, dir))}
          >
            <circle r={S * 0.55} className="ricochet-arrow-hit" />
            <polygon points="0,-14 13,8 0,2.5 -13,8" transform={`rotate(${rot})`} className="ricochet-arrow-shape" />
          </g>
        );
      })}

      {ROBOTS.map((name) => {
        const cell = robotCells[name];
        const isSel = selected === name;
        return (
          <g
            key={name}
            className={`ricochet-robot${isSel ? ' is-selected' : ''}`}
            data-testid={`robot-${name}`}
            data-cell={cell}
            style={{
              transform: `translate(${cx(cell)}px, ${cy(cell)}px)`,
              transitionDuration: `${slideMs}ms`,
            }}
            onClick={guard(() => onSelect(name))}
          >
            {isSel && <circle r="19.5" className="ricochet-select-ring" />}
            <ellipse cy="12" rx="11" ry="4" className="ricochet-robot-shadow" />
            <circle r="14" fill={`var(--rc-${name})`} className="ricochet-robot-body" />
            <text y="5.5" textAnchor="middle" className="ricochet-robot-letter">{ROBOT_LETTER[name]}</text>
          </g>
        );
      })}
    </svg>
  );
}
