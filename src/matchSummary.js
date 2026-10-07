import { games } from './games-registry.js';

export const gameLabel = id => games.find(g => g.path === `/${id}`)?.name || String(id).toUpperCase();

const phaseOf = s => s.phase || s.gamePhase;

const PHASES = { 'setup-settlement': 'setup', 'setup-road': 'setup', 'remove-row': 'remove a row', 'remove-ring': 'remove a ring', 'place-marble': 'place a marble', 'game-over': 'game over', 'trade-response': 'trade response', 'paired-action': 'paired action' };

// Plain-language one-liner for a saved snapshot, from fields the portable envelope already
// carries. Presentation only: never decodes or validates, so a damaged value degrades to
// less detail rather than throwing.
export function describeSnapshot(snapshot) {
  if (!snapshot) return 'No match saved';
  if (snapshot.unreadable !== undefined) return 'Unreadable copy (cannot be restored)';
  const parts = [];
  const at = Number.isFinite(snapshot.updatedAt) && snapshot.updatedAt > 0 ? new Date(snapshot.updatedAt) : null;
  parts.push(at ? `Saved ${at.toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}` : 'Saved time unknown');
  const s = snapshot.state;
  if (s && typeof s === 'object') {
    if (typeof s.pgn === 'string') {
      const plies = s.pgn.replace(/^\s*\[[^\]]*\]\s*$/gm, '').replace(/\{[^}]*\}|\([^)]*\)|\$\d+/g, '').split(/\s+/)
        .filter(t => t && !/^\d+\.+$/.test(t) && !/^(1-0|0-1|1\/2-1\/2|\*)$/.test(t)).length;
      parts.push(plies ? `${Math.ceil(plies / 2)} move${plies > 2 ? 's' : ''}` : 'no moves yet');
    }
    const move = s.notation?.currentMoveNumber;
    if (Number.isInteger(move) && move > 0) parts.push(`move ${move}`);
    if (s.ringsPlaced && typeof s.ringsPlaced === 'object' && (phaseOf(s) === 'setup')) {
      const placed = Object.values(s.ringsPlaced).reduce((a, n) => a + (Number.isInteger(n) ? n : 0), 0);
      parts.push(`${placed} rings placed`);
    }
    if (Number.isInteger(s.turnNumber) && s.turnNumber > 0) parts.push(`turn ${s.turnNumber}`);
    if (Array.isArray(s.rings) && s.rings.length) parts.push(`${s.rings.length} rings left`);
    if (Number.isInteger(s.currentPlayer)) parts.push(`Player ${s.currentPlayer} to move`);
    const phase = s.phase || s.gamePhase;
    if (typeof phase === 'string') parts.push(PHASES[phase] || phase);
  }
  return parts.join(' · ');
}
