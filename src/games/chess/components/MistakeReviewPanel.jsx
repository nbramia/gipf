// MistakeReviewPanel.jsx — post-game review of the mistakes captured this game
// (#23). Each row is a replayable drill: Retry loads the position the mistake
// was played from. Solved entries return later on the store's spaced schedule.

import React from 'react';
import { CATEGORIES } from '../coach/classify.js';

const TONE_CLASS = { great: 'tone-great', good: 'tone-good', warn: 'tone-warn', bad: 'tone-bad' };

export default function MistakeReviewPanel({ mistakes, onRetry }) {
  if (!mistakes || mistakes.length === 0) return null;
  return (
    <div className="panel rounded-xl p-4">
      <h2 className="font-heading text-sm font-semibold mb-1" style={{ color: 'var(--color-text-primary)' }}>
        Review your mistakes
      </h2>
      <p className="font-body text-xs mb-3" style={{ color: 'var(--color-text-muted)' }}>
        Retry each position now — solved ones come back for review over the next days.
      </p>
      <ul className="space-y-2">
        {mistakes.map((e) => {
          const cat = CATEGORIES[e.classification] || CATEGORIES.mistake;
          return (
            <li key={e.id} className="flex items-center justify-between gap-3">
              <span className="font-body text-sm min-w-0" style={{ color: 'var(--color-text-secondary)' }}>
                <span style={{ color: 'var(--color-text-muted)' }}>{e.moveNo}.</span> {e.movePlayed}{' '}
                <span className={`text-xs font-semibold ${TONE_CLASS[cat.tone] || ''}`}>{cat.label}</span>
                {e.opening && (
                  <span className="text-xs ml-1" style={{ color: 'var(--color-text-muted)' }}>
                    {e.opening}
                  </span>
                )}
              </span>
              <button onClick={() => onRetry(e)} className="px-3 py-1 rounded-lg font-body text-xs panel shrink-0">
                Retry
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
