import { validateMatch } from './matchSchema.js';
export function requireSnapshot(snapshot, game, uiKeys, stateKeys) {
  if (!validateMatch(snapshot, game) || Object.keys(snapshot.ui).some(k => !uiKeys.includes(k)) ||
      Object.keys(snapshot.state).some(k => !stateKeys.includes(k)) || stateKeys.some(k => !(k in snapshot.state))) throw new Error('invalid_snapshot');
  requireUI(snapshot.ui);
}
export const record = v => v && typeof v === 'object' && !Array.isArray(v);
export const player = v => v === 1 || v === 2;
export const count = (v, max) => Number.isInteger(v) && v >= 0 && v <= max;

// UI contains gameplay state only, never arbitrary component props or credentials.
export function requireUI(ui) {
  const booleans = ['twoPlayerMode','showModal','scoreApplied','rated','ratedApplied','historyApplied','gameLogged','showTradeBuilder','showMonopolyPicker','showYopPicker'];
  const arrays = ['lastMoveKeys','tradeTargets','yopPick','gameLog','dialogue','moveStats','gameMistakes'];
  for (const k of booleans) if (k in ui && typeof ui[k] !== 'boolean') throw new Error('invalid_snapshot');
  for (const k of arrays) if (k in ui && (!Array.isArray(ui[k]) || ui[k].length > 2000)) throw new Error('invalid_snapshot');
  for (const k of ['difficulty','timeControl','orientation','humanColor']) if (k in ui && (typeof ui[k] !== 'string' || ui[k].length > 80)) throw new Error('invalid_snapshot');
  for (const k of ['resigned','flagged']) if (k in ui && ui[k] !== null && !['w','b'].includes(ui[k])) throw new Error('invalid_snapshot');
  for (const k of ['tradeGive','tradeReceive']) if (k in ui && (!record(ui[k]) || Object.values(ui[k]).some(v => !count(v,100)))) throw new Error('invalid_snapshot');
  for (const k of ['lastMoveKeys','yopPick','gameLog']) if (ui[k]?.some(v => typeof v !== 'string' || v.length > 2000)) throw new Error('invalid_snapshot');
  if (ui.gameConfig !== undefined && (!record(ui.gameConfig) || typeof ui.gameConfig.rulesetId !== 'string' || !count(ui.gameConfig.playerCount,6) || ui.gameConfig.playerCount < 3)) throw new Error('invalid_snapshot');
  if (ui.robberVictimPicker && (!record(ui.robberVictimPicker) || typeof ui.robberVictimPicker.tileId !== 'string' || !Array.isArray(ui.robberVictimPicker.victims) || ui.robberVictimPicker.victims.some(p => !count(p,6) || p === 0))) throw new Error('invalid_snapshot');
  if (ui.selectedAction !== undefined && ui.selectedAction !== null && typeof ui.selectedAction !== 'string') throw new Error('invalid_snapshot');
  for (const k of ['dialogue','moveStats','gameMistakes']) if (ui[k]?.some(v => !record(v))) throw new Error('invalid_snapshot');
}
