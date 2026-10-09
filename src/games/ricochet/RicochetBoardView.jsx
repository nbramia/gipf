// RicochetBoardView.jsx - SVG board for Ricochet: walls, targets, robots, arrows.
// Presentational only; all rules live in RicochetBoard.

import React, { useEffect, useLayoutEffect, useRef } from 'react';
import { SIZE, ROBOTS, centerCellsOf, rowOf, colOf, hasWall } from './engine/geometry.js';

export const ROBOT_LETTER = { red: 'R', green: 'G', blue: 'B', yellow: 'Y', black: 'K' };
export const DIR_NAME = { N: 'north', E: 'east', S: 'south', W: 'west' };
export const COLOR_LABEL = { red: 'Red', green: 'Green', blue: 'Blue', yellow: 'Yellow', black: 'Black' };

const S = 40;
const PAD = 8;
const fullOf = size => size * S + PAD * 2;
const cx = (cell, size = SIZE) => PAD + colOf(cell, size) * S + S / 2;
const cy = (cell, size = SIZE) => PAD + rowOf(cell, size) * S + S / 2;
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

function wallSegments(walls, size) {
  const segs = [];
  for (let cell = 0; cell < size * size; cell++) {
    const x = PAD + colOf(cell, size) * S;
    const y = PAD + rowOf(cell, size) * S;
    if (hasWall(walls, cell, 1)) segs.push(`M${x + S} ${y}V${y + S}`);
    if (hasWall(walls, cell, 2)) segs.push(`M${x} ${y + S}H${x + S}`);
    if (colOf(cell, size) === 0 && hasWall(walls, cell, 3)) segs.push(`M${x} ${y}V${y + S}`);
    if (rowOf(cell, size) === 0 && hasWall(walls, cell, 0)) segs.push(`M${x} ${y}H${x + S}`);
  }
  return segs.join('');
}

const ARROW_TIP_BACK = 15; // the arrowhead stops short of the end centre, which the robot covers
const ARROW_LEN = 9;
const ARROW_HALF = 5;
const BADGE_END_GAP = 24; // the number badge keeps this far from the stop centre (robot radius is 14)
const OVERLAP_STEP = 5; // lateral shift per earlier trace this one runs along
const BUMP_FROM = 14;
const BUMP_TO = 20;
const BUMP_X = 24;
const BUMP_ARM = 3;

const cellXY = (cell, size = SIZE) => [cx(cell, size), cy(cell, size)];
// Do two straight segments (pixel pairs) lie on one line and share more than a point?
function overlap([a0, a1], [b0, b1]) {
  const dx = a1[0] - a0[0];
  const dy = a1[1] - a0[1];
  const len = Math.hypot(dx, dy);
  if (!len) return false;
  const cross = p => (dx * (p[1] - a0[1]) - dy * (p[0] - a0[0])) / len;
  if (Math.abs(cross(b0)) > 1 || Math.abs(cross(b1)) > 1) return false;
  const along = p => (dx * (p[0] - a0[0]) + dy * (p[1] - a0[1])) / len;
  const [lo, hi] = [along(b0), along(b1)].sort((m, n) => m - n);
  return Math.min(hi, len) - Math.max(lo, 0) > 1;
}
const segmentsOf = (trace, size) => {
  const pts = trace.path.map(c => cellXY(c, size));
  return pts.slice(1).map((p, i) => [pts[i], p]);
};
// How many earlier traces each trace runs along; used to shift it sideways so a retraced
// or doubled segment stays visible.
function overlapCounts(traces, size) {
  const segs = traces.map(t => (t.blocked ? [] : segmentsOf(t, size)));
  return traces.map((_, i) => {
    let k = 0;
    for (let j = 0; j < i; j++) {
      if (segs[i].some(a => segs[j].some(b => overlap(a, b)))) k++;
    }
    return Math.min(k, 4);
  });
}

// A step that could not move: a short stub toward the obstacle and a cross.
function BumpTrace({ trace, size }) {
  const [x, y] = cellXY(trace.path[0], size);
  const [ux, uy] = DIR_VEC[trace.dir];
  const nx = -uy;
  const ny = ux;
  const colour = `var(--rc-${trace.robot})`;
  const bx = x + ux * BUMP_X;
  const by = y + uy * BUMP_X;
  const a = BUMP_ARM;
  const stub = `${x + ux * BUMP_FROM},${y + uy * BUMP_FROM} ${x + ux * BUMP_TO},${y + uy * BUMP_TO}`;
  const cross1 = `${bx - a},${by - a} ${bx + a},${by + a}`;
  const cross2 = `${bx - a},${by + a} ${bx + a},${by - a}`;
  // beside the robot, clear of it
  const badgeX = x + ux * 6 + nx * 21;
  const badgeY = y + uy * 6 + ny * 21;
  return (
    <g
      className="ricochet-trace is-blocked"
      data-testid="path-trace"
      data-blocked="true"
      data-robot={trace.robot}
      data-step={trace.n}
      data-from={trace.path[0]}
      data-dir={trace.dir}
    >
      <polyline points={stub} className="ricochet-trace-halo" />
      <polyline points={stub} className="ricochet-trace-line ricochet-trace-stub" stroke={colour} />
      <polyline points={cross1} className="ricochet-trace-line ricochet-trace-cross" stroke={colour} />
      <polyline points={cross2} className="ricochet-trace-line ricochet-trace-cross" stroke={colour} />
      <g transform={`translate(${badgeX} ${badgeY})`}>
        <circle r="7" className="ricochet-trace-badge" stroke={colour} />
        <text y="3.4" textAnchor="middle" className="ricochet-trace-num">{trace.n}</text>
      </g>
    </g>
  );
}

// One move's trace. `path` is a list of cells: the start, any bend, the end.
function PathTrace({ trace, shift, size }) {
  if (trace.blocked) return <BumpTrace trace={trace} size={size} />;
  const raw = trace.path.map(c => cellXY(c, size));
  const [ex0, ey0] = raw[raw.length - 1];
  const [px0, py0] = raw[raw.length - 2] || raw[0];
  const len0 = Math.hypot(ex0 - px0, ey0 - py0) || 1;
  const ux = (ex0 - px0) / len0;
  const uy = (ey0 - py0) / len0;
  const nx = -uy;
  const ny = ux;
  const pts = raw.map(([x, y]) => [x + nx * shift, y + ny * shift]);
  const [ex, ey] = pts[pts.length - 1];
  const [px, py] = pts[pts.length - 2] || pts[0];
  const tipX = ex - ux * ARROW_TIP_BACK;
  const tipY = ey - uy * ARROW_TIP_BACK;
  const baseX = tipX - ux * ARROW_LEN;
  const baseY = tipY - uy * ARROW_LEN;
  const head = `${tipX},${tipY} ${baseX + nx * ARROW_HALF},${baseY + ny * ARROW_HALF} ${baseX - nx * ARROW_HALF},${baseY - ny * ARROW_HALF}`;
  const line = [...pts.slice(0, -1), [baseX, baseY]].map(p => p.join(',')).join(' ');
  // Number badge on the last segment, midway but never within a robot's reach of the stop cell.
  const segLen = Math.hypot(ex - px, ey - py);
  const d = Math.max(Math.min(segLen / 2, segLen - BADGE_END_GAP), 8);
  const bx = px + ux * d;
  const by = py + uy * d;
  const colour = `var(--rc-${trace.robot})`;
  return (
    <g
      className={`ricochet-trace${trace.optimal ? ' is-optimal' : ''}`}
      data-testid="path-trace"
      data-robot={trace.robot}
      data-step={trace.n}
      data-from={trace.path[0]}
      data-to={trace.path[trace.path.length - 1]}
      data-source={trace.optimal ? 'optimal' : 'you'}
    >
      <polyline points={line} className="ricochet-trace-halo" />
      <polyline points={line} className="ricochet-trace-line" stroke={colour} />
      <polygon points={head} className="ricochet-trace-head" fill={colour} />
      <g transform={`translate(${bx} ${by})`}>
        <circle r="7" className="ricochet-trace-badge" stroke={colour} />
        <text y="3.4" textAnchor="middle" className="ricochet-trace-num">{trace.n}</text>
      </g>
    </g>
  );
}

const BARRIER_LETTER = { red: 'R', green: 'G', blue: 'B', yellow: 'Y' };
// A cue besides colour: each colour's bar is cut by dark gaps in its own rhythm (red is solid).
const BARRIER_DASH = { red: undefined, green: '10 4', blue: '3 3', yellow: '13 3 3 3' };
const BARRIER_INSET = 6;
const BARRIER_ROT = { '/': -45, '\\': 45 };

// A diagonal barrier: a slim bar corner to corner across its cell with square ends, on a
// dark underlay for contrast. The colour shows in the bar, its dash rhythm and a tiny initial
// written along it; no disc, so it cannot be mistaken for a robot.
function Barrier({ barrier, size }) {
  const x = PAD + colOf(barrier.cell, size) * S;
  const y = PAD + rowOf(barrier.cell, size) * S;
  const a = BARRIER_INSET;
  const [x1, y1, x2, y2] = barrier.orient === '/'
    ? [x + a, y + S - a, x + S - a, y + a]
    : [x + a, y + a, x + S - a, y + S - a];
  const colour = `var(--rc-${barrier.color})`;
  return (
    <g
      className="ricochet-barrier"
      data-testid="barrier"
      data-cell={barrier.cell}
      data-orient={barrier.orient}
      data-color={barrier.color}
    >
      <title>{`${COLOR_LABEL[barrier.color]} barrier ${barrier.orient}`}</title>
      <line x1={x1} y1={y1} x2={x2} y2={y2} className="ricochet-barrier-edge" />
      <line
        x1={x1} y1={y1} x2={x2} y2={y2} className="ricochet-barrier-bar" stroke={colour}
        strokeDasharray={BARRIER_DASH[barrier.color]}
      />
      <text
        transform={`translate(${x + S / 2} ${y + S / 2}) rotate(${BARRIER_ROT[barrier.orient]})`}
        y="3" textAnchor="middle" className="ricochet-barrier-letter"
      >{BARRIER_LETTER[barrier.color]}</text>
    </g>
  );
}

const SLIDE_EASING = 'cubic-bezier(0.22, 0.8, 0.3, 1)';
const canAnimate = () => typeof Element !== 'undefined' && typeof Element.prototype.animate === 'function';

export default function RicochetBoardView({
  board, robotCells, selected, arrows, onSelect, onMove, slideMs, interactive, showCurrent, bump, traces = null,
  slide = null,
}) {
  const swipe = useRef(null);
  const swiped = useRef(false);
  const svgRef = useRef(null);
  const robotEls = useRef({});
  const size = board.size || SIZE;
  const FULL = fullOf(size);
  const names = board.robotNames || ROBOTS;
  const barriers = board.barriers || [];
  const centre = centerCellsOf(size);
  const centreStart = size / 2 - 1;
  const animated = canAnimate();

  const shifts = React.useMemo(() => (traces ? overlapCounts(traces, size) : []), [traces, size]);
  const wallPath = React.useMemo(() => wallSegments(board.walls, size), [board.walls, size]);
  const current = showCurrent ? board.getTarget() : null;

  // A slide that bends at a barrier follows its path: one keyframe per corner, spaced by
  // distance, instead of the straight CSS transition between its two ends.
  useLayoutEffect(() => {
    if (!slide || !slideMs || !animated) return;
    const el = robotEls.current[slide.robot];
    if (!el) return;
    const pts = slide.path.map(c => [cx(c, size), cy(c, size)]);
    const dist = [0];
    for (let i = 1; i < pts.length; i++) {
      dist.push(dist[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
    }
    const total = dist[dist.length - 1] || 1;
    el.animate(
      pts.map(([x, y], i) => ({ transform: `translate(${x}px, ${y}px)`, offset: dist[i] / total })),
      { duration: slideMs, easing: SLIDE_EASING },
    );
  }, [slide, slideMs, animated, size]);

  const cellAt = (clientX, clientY) => {
    const rect = svgRef.current.getBoundingClientRect();
    const k = FULL / rect.width;
    const col = Math.floor(((clientX - rect.left) * k - PAD) / S);
    const row = Math.floor(((clientY - rect.top) * k - PAD) / S);
    return col >= 0 && col < size && row >= 0 && row < size ? row * size + col : -1;
  };

  const onPointerDown = (e) => {
    if (!interactive || e.button !== 0 || !e.isPrimary) return;
    const cell = cellAt(e.clientX, e.clientY);
    const robot = names.find(r => robotCells[r] === cell) || null;
    swipe.current = { x: e.clientX, y: e.clientY, robot, pointerId: e.pointerId };
  };
  // A tap on empty board slides the selected robot along the dominant axis from
  // its centre to the tap point; a tap on a robot (or its arrows) is handled by
  // their own click handlers, and the robot's own cell is a dead zone.
  const tap = (e) => {
    if (e.target && e.target.closest && e.target.closest('.ricochet-arrow, .ricochet-robot')) return;
    const cell = cellAt(e.clientX, e.clientY);
    if (cell < 0) return;
    const occupant = names.find(r => robotCells[r] === cell);
    if (occupant) { onSelect(occupant); return; }
    if (!selected) return;
    const rect = svgRef.current.getBoundingClientRect();
    const k = FULL / rect.width;
    const dx = (e.clientX - rect.left) * k - cx(robotCells[selected], size);
    const dy = (e.clientY - rect.top) * k - cy(robotCells[selected], size);
    const dir = Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'E' : 'W') : (dy > 0 ? 'S' : 'N');
    onMove(selected, dir);
  };
  const onPointerUp = (e) => {
    const s = swipe.current;
    if (!s || e.button !== 0 || e.pointerId !== s.pointerId) return;
    swipe.current = null;
    if (!interactive) return;
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
  // A press that started on the board but was released elsewhere must not linger and
  // pair with some later pointerup.
  useEffect(() => {
    const clear = (e) => { if (swipe.current && e.pointerId === swipe.current.pointerId) swipe.current = null; };
    window.addEventListener('pointerup', clear);
    window.addEventListener('pointercancel', clear);
    return () => {
      window.removeEventListener('pointerup', clear);
      window.removeEventListener('pointercancel', clear);
    };
  }, []);
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
      aria-label={`Ricochet board, ${size} by ${size} grid`}
      data-size={size}
      onPointerDown={onPointerDown}
      onPointerUp={onPointerUp}
      onPointerCancel={(e) => { if (swipe.current && e.pointerId === swipe.current.pointerId) swipe.current = null; }}
    >
      <rect x={PAD} y={PAD} width={size * S} height={size * S} fill="var(--rc-board)" />
      {Array.from({ length: size * size }, (_, cell) => (
        (rowOf(cell, size) + colOf(cell, size)) % 2 === 0
          ? <rect key={cell} x={PAD + colOf(cell, size) * S} y={PAD + rowOf(cell, size) * S} width={S} height={S} fill="var(--rc-cell-alt)" />
          : null
      ))}
      <rect
        x={PAD + centreStart * S} y={PAD + centreStart * S} width={2 * S} height={2 * S}
        fill="var(--rc-center)" data-center={centre.length}
      />

      <path d={wallPath} className="ricochet-walls" />

      {barriers.map(b => <Barrier key={b.cell} barrier={b} size={size} />)}

      {board.targets.map((t) => {
        const isCurrent = showCurrent && t.id === board.currentTargetId;
        const claimed = board.claimed.includes(t.id) && !isCurrent;
        return (
          <g
            key={t.id}
            transform={`translate(${cx(t.cell, size)} ${cy(t.cell, size)})`}
            className={`ricochet-target${isCurrent ? ' is-current' : ''}${claimed ? ' is-claimed' : ''}`}
            data-testid={isCurrent ? 'current-target' : undefined}
          >
            {isCurrent && <circle r="19" className="ricochet-target-ring" />}
            <TargetGlyph shape={t.shape} color={t.color} r={isCurrent ? 13 : 10.5} />
          </g>
        );
      })}

      {traces && traces.length > 0 && (
        <g className="ricochet-traces" data-testid="path-traces" pointerEvents="none">
          {traces.map((t, i) => <PathTrace key={`${t.optimal ? 'o' : 'y'}${t.n}`} trace={t} shift={shifts[i] * OVERLAP_STEP} size={size} />)}
        </g>
      )}

      {current && interactive && selected && arrows.map(({ dir, to }) => {
        const [vx, vy] = DIR_VEC[dir];
        const from = robotCells[selected];
        const ax = cx(from, size) + vx * S * 0.92;
        const ay = cy(from, size) + vy * S * 0.92;
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

      {names.map((name) => {
        const cell = robotCells[name];
        const isSel = selected === name;
        return (
          <g
            key={name}
            ref={(el) => { robotEls.current[name] = el; }}
            className={`ricochet-robot${isSel ? ' is-selected' : ''}`}
            data-testid={`robot-${name}`}
            data-cell={cell}
            style={{
              transform: `translate(${cx(cell, size)}px, ${cy(cell, size)}px)`,
              transitionDuration: `${animated && slide && slide.robot === name ? 0 : slideMs}ms`,
            }}
            onClick={guard(() => onSelect(name))}
          >
            <g
              key={bump && bump.robot === name ? bump.n : 0}
              className={bump && bump.robot === name ? `ricochet-bump ricochet-bump-${bump.dir}` : undefined}
              data-bump={bump && bump.robot === name ? bump.dir : undefined}
            >
              {isSel && <circle r="19.5" className="ricochet-select-ring" />}
              <ellipse cy="12" rx="11" ry="4" className="ricochet-robot-shadow" />
              <circle r="14" fill={`var(--rc-${name})`} className="ricochet-robot-body" data-robot={name} />
              <text y="5.5" textAnchor="middle" className="ricochet-robot-letter">{ROBOT_LETTER[name]}</text>
            </g>
          </g>
        );
      })}
    </svg>
  );
}
