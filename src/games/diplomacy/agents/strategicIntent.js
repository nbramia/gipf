// Strategic-intent schema for the Diplomacy agents (PR3 of [AI Negotiation]).
//
// This is the EXACT contract the [Intent Binding] / [Tactical AI] issues consume:
// the betrayal/decision model (betrayalModel.js) emits one of these per AI power
// each turn, and the tactical layer binds it to actual orders. Keeping the schema
// + validator here lets downstream code assert against it without importing the
// decision model.
//
// Pure: no React, no network, no LLM, no cross-game imports.
//
//   {
//     power: 'france',                                   // the deciding power
//     allies:  ['germany'],                              // powers to cooperate with
//     targets: ['italy'],                                // powers to press / attack
//     supportDeals: [ { from: 'france', to: 'germany' } ], // support deals being honored
//     dmz: ['pie', 'tyr'],                               // provinces left demilitarized
//     betrayals: [ { type: 'non-aggression', partner: 'germany' } ] // deals being broken
//   }

const INTENT_KEYS = ['power', 'allies', 'targets', 'supportDeals', 'dmz', 'betrayals'];

// Exported schema description (shape-level; the validator below enforces it).
export const STRATEGIC_INTENT_SCHEMA = {
  power: 'string (power id)',
  allies: 'string[] (power ids)',
  targets: 'string[] (power ids)',
  supportDeals: '{ from: string, to: string }[]',
  dmz: 'string[] (province ids)',
  betrayals: '{ type: string, partner: string }[]',
};

function isStringArray(v) {
  return Array.isArray(v) && v.every((x) => typeof x === 'string');
}

// True iff `obj` is a well-formed strategic-intent object. Never throws.
export function validateStrategicIntent(obj) {
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return false;

  // No stray keys: keeps the contract tight so [Intent Binding] can rely on it.
  for (const key of Object.keys(obj)) {
    if (!INTENT_KEYS.includes(key)) return false;
  }

  if (typeof obj.power !== 'string' || !obj.power) return false;
  if (!isStringArray(obj.allies)) return false;
  if (!isStringArray(obj.targets)) return false;
  if (!isStringArray(obj.dmz)) return false;

  if (!Array.isArray(obj.supportDeals)) return false;
  for (const d of obj.supportDeals) {
    if (!d || typeof d !== 'object' || Array.isArray(d)) return false;
    if (typeof d.from !== 'string' || typeof d.to !== 'string') return false;
  }

  if (!Array.isArray(obj.betrayals)) return false;
  for (const b of obj.betrayals) {
    if (!b || typeof b !== 'object' || Array.isArray(b)) return false;
    if (typeof b.type !== 'string' || typeof b.partner !== 'string') return false;
  }

  return true;
}
