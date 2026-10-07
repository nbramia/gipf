// Per-power Diplomacy personas. Each of the 7 Great Powers gets a fixed
// temperament and a set of opening dispositions that flavour how its AI envoy
// negotiates. These seed the system prompt (api/diplomacyAgent.js) and the
// per-power memory scratchpad; the live board state still drives actual choices.
//
// Pure data + a lookup. No React, no network, no cross-game imports.

// stance enum mirrors the scratchpad spec: ally | friendly | neutral | rival | enemy.
export const PERSONAS = {
  austria: {
    name: 'Austria-Hungary',
    temperament: { trust: 0.45, aggression: 0.4 },
    openingDisposition: { italy: 'rival', russia: 'rival', turkey: 'neutral', germany: 'friendly', england: 'neutral', france: 'neutral' },
    blurb:
      'Austria-Hungary is hemmed in by Italy, Russia, and Turkey and must build alliances early to survive. It negotiates defensively, prizing a stable Italian border and a Russo-Turkish quarrel it can exploit.',
  },
  england: {
    name: 'England',
    temperament: { trust: 0.4, aggression: 0.5 },
    openingDisposition: { france: 'rival', germany: 'neutral', russia: 'rival', italy: 'neutral', austria: 'neutral', turkey: 'neutral' },
    blurb:
      'England is an island power that thinks in fleets and tempo. It courts a continental partner to pin France or Germany, but trusts no one fully and is quick to switch sides when the Channel or the North Sea is at stake.',
  },
  france: {
    name: 'France',
    temperament: { trust: 0.55, aggression: 0.45 },
    openingDisposition: { england: 'rival', germany: 'rival', italy: 'neutral', russia: 'friendly', austria: 'neutral', turkey: 'neutral' },
    blurb:
      'France is a patient corner power with secure home centers. It prefers durable alliances (often against England or Germany), negotiates warmly, and aims to grow steadily toward Iberia and the Low Countries before any stab.',
  },
  germany: {
    name: 'Germany',
    temperament: { trust: 0.45, aggression: 0.6 },
    openingDisposition: { france: 'rival', russia: 'rival', england: 'neutral', austria: 'friendly', italy: 'neutral', turkey: 'neutral' },
    blurb:
      'Germany sits at the center with enemies on every side, so it plays tempo and leverage. It bargains hard, plays France and Russia against each other, and pushes aggressively for the Low Countries and Scandinavia.',
  },
  italy: {
    name: 'Italy',
    temperament: { trust: 0.5, aggression: 0.4 },
    openingDisposition: { austria: 'rival', france: 'rival', turkey: 'neutral', germany: 'neutral', england: 'neutral', russia: 'neutral' },
    blurb:
      'Italy is a slow starter that must pick a direction: the Lepanto against Turkey or a turn on Austria/France. It negotiates cautiously, hunts for a reliable partner, and avoids overcommitting until the map opens up.',
  },
  russia: {
    name: 'Russia',
    temperament: { trust: 0.4, aggression: 0.55 },
    openingDisposition: { turkey: 'rival', germany: 'rival', england: 'rival', austria: 'rival', france: 'friendly', italy: 'neutral' },
    blurb:
      'Russia is huge but stretched across four fronts. It must make friends fast, usually settling its south (Turkey) or north (England/Germany) first. It negotiates broadly and aggressively to keep too many enemies from ganging up.',
  },
  turkey: {
    name: 'Turkey',
    temperament: { trust: 0.4, aggression: 0.5 },
    openingDisposition: { russia: 'rival', austria: 'rival', italy: 'rival', germany: 'neutral', england: 'neutral', france: 'neutral' },
    blurb:
      'Turkey is a defensible corner power that grows from the Black Sea and the Balkans. It is patient and wary, looks to fight Russia or Austria one at a time, and trusts slowly while building an unbreakable home cluster.',
  },
};

// Resolve the persona for a power id. Returns null for an unknown power.
export function getPersona(power) {
  return PERSONAS[power] || null;
}

// ---- Persona spice ----------------------------------------------------------
// The setup's "Persona spice" slider in [0, 1] (0 = restrained, 1 = vivid and
// volatile). It does three things, all derived from this one number:
//   1. scales how far each temperament knob sits from neutral (extremity),
//   2. rides along on the persona so the agent prompt can carry a tone
//      instruction (api/diplomacyAgent.js turns `spice` into a TONE paragraph),
//   3. loosens or tightens the honor-vs-betray margin in betrayalModel.
// 0.5 reproduces the base personas exactly, so it is also the default for a save
// made before spice existed.
export const DEFAULT_SPICE = 0.5;

export function normalizeSpice(value) {
  const n = Number(value);
  if (value == null || !Number.isFinite(n)) return DEFAULT_SPICE;
  return Math.min(1, Math.max(0, n));
}

// Extremity multiplier: 0.2x at spice 0, 1x at 0.5, 1.8x at 1.
export function spiceScale(spice) {
  return 0.2 + 1.6 * normalizeSpice(spice);
}

function scaleKnob(value, spice) {
  return Math.min(1, Math.max(0, 0.5 + (value - 0.5) * spiceScale(spice)));
}

// Every power's persona with spice applied. Pure; never mutates PERSONAS.
export function buildPersonas(spice = DEFAULT_SPICE) {
  const s = normalizeSpice(spice);
  const out = {};
  for (const [power, persona] of Object.entries(PERSONAS)) {
    out[power] = {
      ...persona,
      temperament: {
        trust: scaleKnob(persona.temperament.trust, s),
        aggression: scaleKnob(persona.temperament.aggression, s),
      },
      spice: s,
    };
  }
  return out;
}

// Re-apply spice to a persona set restored from a save. A save made before spice
// existed has no `spice` on its personas; those take `fallbackSpice` (the saved
// setting, else the default), so older games keep resuming.
export function ensureSpice(personas, fallbackSpice = DEFAULT_SPICE) {
  if (!personas || typeof personas !== 'object') return buildPersonas(fallbackSpice);
  const hasSpice = Object.values(personas).every((p) => p && typeof p.spice === 'number');
  if (hasSpice) return personas;
  return buildPersonas(fallbackSpice);
}
