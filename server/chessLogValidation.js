// Existing local gameHistory.js entry shape; no new ranking or counters.
export function validChessLog(raw) {
  if (typeof raw !== 'string' || Buffer.byteLength(raw, 'utf8') > 100000) return false;
  try {
    const entries = JSON.parse(raw);
    if (!Array.isArray(entries) || entries.length > 200) return false;
    const fields = ['playedAt','result','color','rated','opponentKey','accuracy','counts','opening','eco','leftBookAtPly','moves'];
    const count = v => Number.isSafeInteger(v) && v >= 0 && v <= 100000;
    const text = (v,max) => typeof v === 'string' && v.length <= max;
    return entries.every(e => e && typeof e === 'object' && !Array.isArray(e) &&
      Object.keys(e).every(k => fields.includes(k)) &&
      Number.isSafeInteger(e.playedAt) && e.playedAt >= 0 && e.playedAt <= 4102444800000 &&
      ['win','loss','draw'].includes(e.result) && ['w','b'].includes(e.color) && typeof e.rated === 'boolean' &&
      text(e.opponentKey,80) && (e.accuracy === null || (Number.isFinite(e.accuracy) && e.accuracy >= 0 && e.accuracy <= 100)) &&
      e.counts && Object.keys(e.counts).length === 3 && ['blunder','mistake','inaccuracy'].every(k => count(e.counts[k])) &&
      (e.opening === null || text(e.opening,256)) && (e.eco === null || text(e.eco,16)) &&
      (e.leftBookAtPly === null || count(e.leftBookAtPly)) && count(e.moves));
  } catch (_) { return false; }
}
