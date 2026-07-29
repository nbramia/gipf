// ProgressPanel.jsx — the cross-game view the app never had.
//
// The coach already computes rich per-game data (accuracy, blunder counts, the
// opening played, how deep the player stayed in book) and used to discard all
// of it at game end, so a learner had no way to tell whether they were
// improving. This renders the aggregation from coach/gameHistory.js: an
// accuracy trend and an opening report card.
//
// Everything degrades honestly on sparse data — with two games played the panel
// says so rather than drawing a confident trend line through noise.

import React from 'react';

// A tiny inline sparkline. No chart library: a handful of accuracy points
// doesn't justify the bundle, and this stays legible at panel width.
function Sparkline({ points }) {
  if (!points || points.length < 2) return null;
  const w = 150;
  const h = 30;
  const min = Math.min(...points);
  const max = Math.max(...points);
  const span = max - min || 1;
  const d = points
    .map((p, i) => {
      const x = (i / (points.length - 1)) * w;
      const y = h - ((p - min) / span) * h;
      return `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' ');
  return (
    <svg
      width={w}
      height={h}
      viewBox={`0 0 ${w} ${h}`}
      role="img"
      aria-label={`Accuracy across your last ${points.length} analysed games`}
    >
      <path
        d={d}
        fill="none"
        stroke="var(--color-accent)"
        strokeWidth="2"
        strokeLinejoin="round"
        strokeLinecap="round"
      />
    </svg>
  );
}

const DIRECTION_COPY = {
  improving: { label: 'Improving', tone: 'tone-great' },
  declining: { label: 'Slipping', tone: 'tone-warn' },
  steady: { label: 'Steady', tone: '' },
};

const formatRecord = (r) => `${r.w}W · ${r.l}L · ${r.d}D`;

export default function ProgressPanel({ trend, report, stats, onDrillOpening, drillableOpenings }) {
  if (!stats || stats.games === 0) {
    return (
      <div className="panel rounded-xl p-4">
        <h2 className="font-heading text-sm font-semibold mb-1" style={{ color: 'var(--color-text-primary)' }}>
          Your progress
        </h2>
        <p className="font-body text-xs" style={{ color: 'var(--color-text-muted)' }}>
          Finish a game and your accuracy, your openings and your recurring mistakes start showing up here.
        </p>
      </div>
    );
  }

  const dir = trend && trend.direction ? DIRECTION_COPY[trend.direction] : null;
  const points = (trend && trend.games) || [];

  return (
    <div className="panel rounded-xl p-4">
      <h2 className="font-heading text-sm font-semibold mb-3" style={{ color: 'var(--color-text-primary)' }}>
        Your progress
      </h2>

      <div className="flex items-end justify-between gap-3 mb-1">
        <div>
          <div className="font-body text-xs" style={{ color: 'var(--color-text-muted)' }}>
            Average accuracy
          </div>
          <div className="font-display text-2xl font-bold" style={{ color: 'var(--color-text-primary)' }}>
            {stats.avgAccuracy != null ? `${stats.avgAccuracy}%` : '—'}
          </div>
        </div>
        {points.length >= 2 && <Sparkline points={points} />}
      </div>

      <p className="font-body text-xs mb-1" style={{ color: 'var(--color-text-secondary)' }}>
        {stats.games} game{stats.games === 1 ? '' : 's'} · {formatRecord(stats.record)}
        {stats.blundersPerGame != null && ` · ${stats.blundersPerGame} blunders per game`}
        {dir && (
          <>
            {' · '}
            <span className={`font-semibold ${dir.tone}`}>{dir.label}</span>
          </>
        )}
      </p>

      {dir && trend.recentMean != null && (
        <p className="font-body text-xs mb-3" style={{ color: 'var(--color-text-muted)' }}>
          Recent games average {trend.recentMean}%, against {trend.earlierMean}% before that.
        </p>
      )}
      {!dir && (
        <p className="font-body text-xs mb-3" style={{ color: 'var(--color-text-muted)' }}>
          A few more analysed games and there'll be enough to call a trend.
        </p>
      )}

      {report && report.length > 0 && (
        <>
          <h3 className="font-body text-xs font-semibold mb-1" style={{ color: 'var(--color-text-secondary)' }}>
            Your openings
          </h3>
          <ul className="space-y-1.5">
            {report.slice(0, 6).map((o) => {
              const label = o.name || 'Out of book early';
              const canDrill = onDrillOpening && drillableOpenings && drillableOpenings.has(o.name);
              return (
                <li key={label} className="flex items-baseline justify-between gap-2">
                  <span className="font-body text-xs min-w-0" style={{ color: 'var(--color-text-secondary)' }}>
                    <span className="font-semibold">{label}</span>{' '}
                    <span style={{ color: 'var(--color-text-muted)' }}>
                      {o.games} game{o.games === 1 ? '' : 's'} · {formatRecord(o)}
                      {o.byColor.w.games > 0 && o.byColor.b.games > 0
                        ? ` (${o.byColor.w.games} as White, ${o.byColor.b.games} as Black)`
                        : o.byColor.b.games > 0
                          ? ' as Black'
                          : ' as White'}
                      {o.avgAccuracy != null && ` · ${o.avgAccuracy}% accuracy`}
                      {o.avgLeftBookAtPly != null &&
                        ` · out of book by move ${Math.ceil(o.avgLeftBookAtPly / 2)}`}
                    </span>
                  </span>
                  {canDrill && (
                    <button
                      onClick={() => onDrillOpening(o.name)}
                      className="px-2 py-1 rounded font-body text-xs panel shrink-0 tap-target"
                      title={`Drill the mistakes you've made in the ${o.name}`}
                    >
                      Drill
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
        </>
      )}
    </div>
  );
}
