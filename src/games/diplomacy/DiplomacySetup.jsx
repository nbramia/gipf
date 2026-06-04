// New-game setup for Diplomacy ([Negotiation Loop] PR2).
//
// Pick your power, difficulty, persona spice, and the maximum game year, then
// start. The chosen power becomes the only 'human' controller; the other six are
// 'AI'. Scoped under .game-diplomacy. Pure presentational + local draft state;
// the parent owns board creation and persistence.

import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { POWER_NAMES, POWER_COLORS } from './DiplomacyBoard.js';
import {
  POWER_OPTIONS,
  DIFFICULTY_OPTIONS,
  DEFAULT_SETTINGS,
} from './diplomacySettings.js';

const DIFFICULTY_LABELS = { easy: 'Easy', normal: 'Normal', hard: 'Hard' };
const MAX_YEAR_OPTIONS = [1905, 1910, 1912, 1920];

export default function DiplomacySetup({ initial, onStart }) {
  const base = { ...DEFAULT_SETTINGS, ...(initial || {}) };
  const [power, setPower] = useState(base.power);
  const [difficulty, setDifficulty] = useState(base.difficulty);
  const [personaSpice, setPersonaSpice] = useState(base.personaSpice);
  const [maxYears, setMaxYears] = useState(base.maxYears);

  function start() {
    onStart({ power, difficulty, personaSpice, maxYears });
  }

  return (
    <div className="dip-setup">
      <div className="dip-setup-card">
        <Link to="/" className="dip-panel-label hover:opacity-80">GIPF Project</Link>
        <h1 className="mt-1 font-display text-4xl font-bold" style={{ color: 'var(--dip-text)' }}>DIPLOMACY</h1>
        <p className="dip-setup-subtitle">
          Negotiate, ally, and betray your way to 18 supply centers against six AI powers.
        </p>

        <div className="dip-setup-section">
          <div className="dip-panel-label mb-2">Choose your power</div>
          <div className="dip-setup-powers">
            {POWER_OPTIONS.map((p) => (
              <button
                key={p}
                type="button"
                className={`dip-setup-power${power === p ? ' is-active' : ''}`}
                style={{ '--power-color': POWER_COLORS[p] }}
                onClick={() => setPower(p)}
                aria-pressed={power === p}
              >
                <span className="dip-setup-power-swatch" style={{ backgroundColor: POWER_COLORS[p] }} aria-hidden="true" />
                {POWER_NAMES[p]}
              </button>
            ))}
          </div>
        </div>

        <div className="dip-setup-section">
          <div className="dip-panel-label mb-2">Difficulty</div>
          <div className="dip-setup-row">
            {DIFFICULTY_OPTIONS.map((d) => (
              <button
                key={d}
                type="button"
                className={`dip-setup-pill${difficulty === d ? ' is-active' : ''}`}
                onClick={() => setDifficulty(d)}
                aria-pressed={difficulty === d}
              >
                {DIFFICULTY_LABELS[d]}
              </button>
            ))}
          </div>
        </div>

        <div className="dip-setup-section">
          <div className="dip-panel-label mb-2">
            Persona spice <span className="dip-setup-spice-value">{Math.round(personaSpice * 100)}%</span>
          </div>
          <input
            type="range"
            min="0"
            max="1"
            step="0.05"
            value={personaSpice}
            onChange={(e) => setPersonaSpice(Number(e.target.value))}
            className="dip-setup-slider"
            aria-label="Persona spice"
          />
          <p className="dip-setup-hint">How dramatically the AI powers play their personalities.</p>
        </div>

        <div className="dip-setup-section">
          <div className="dip-panel-label mb-2">Game ends by year</div>
          <div className="dip-setup-row">
            {MAX_YEAR_OPTIONS.map((y) => (
              <button
                key={y}
                type="button"
                className={`dip-setup-pill${maxYears === y ? ' is-active' : ''}`}
                onClick={() => setMaxYears(y)}
                aria-pressed={maxYears === y}
              >
                {y}
              </button>
            ))}
          </div>
        </div>

        <button type="button" className="dip-primary-btn mt-6 w-full" onClick={start}>
          Start Game
        </button>
      </div>
    </div>
  );
}
