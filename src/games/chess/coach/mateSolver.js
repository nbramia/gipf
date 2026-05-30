// mateSolver.js — exhaustive forced-mate search over chess.js.
//
// Used at authoring time (a generation script) and in tests to GUARANTEE every
// bundled puzzle is a sound forced mate with a unique key move. Not imported by
// the app at runtime (the search is exponential; fine for mate-in-≤3 offline,
// too slow for the browser), so it stays out of the shipped bundle.
//
// All distances are in plies (half-moves). "Forced mate for the side to move in
// d plies" means: there is a move such that, against EVERY opponent reply, the
// side can still force mate, with the longest such line being d plies.

import { Chess } from 'chess.js';

// Search for the shortest forced mate for the side to move, within maxPlies.
// Returns { dist, key } (key is a verbose move) or null if none exists.
export function searchMate(game, maxPlies) {
  if (maxPlies <= 0) return null;
  let best = null;
  for (const m of game.moves({ verbose: true })) {
    game.move(m);
    let dist;
    if (game.isCheckmate()) {
      dist = 1;
    } else if (maxPlies - 2 < 0) {
      dist = null; // no plies left for the opponent + our follow-up
    } else {
      const replies = game.moves({ verbose: true });
      if (replies.length === 0) {
        dist = null; // stalemate (or no legal move but not mate) — not a win
      } else {
        let worst = 0;
        let allMatable = true;
        for (const om of replies) {
          game.move(om);
          const sub = searchMate(game, maxPlies - 2);
          game.undo();
          if (!sub) {
            allMatable = false;
            break;
          }
          if (sub.dist > worst) worst = sub.dist;
        }
        dist = allMatable ? worst + 2 : null;
      }
    }
    game.undo();
    if (dist != null && (best == null || dist < best.dist)) {
      best = { dist, key: m };
    }
  }
  return best;
}

// How many distinct root moves achieve a forced mate in exactly `dist` plies?
// A clean puzzle wants this to be 1 (the key is unique).
export function countKeysAtDist(fen, dist) {
  const game = new Chess(fen);
  let count = 0;
  const keys = [];
  for (const m of game.moves({ verbose: true })) {
    game.move(m);
    let d;
    if (game.isCheckmate()) {
      d = 1;
    } else {
      const replies = game.moves({ verbose: true });
      if (replies.length === 0) {
        d = null;
      } else {
        let worst = 0;
        let all = true;
        for (const om of replies) {
          game.move(om);
          const sub = searchMate(game, dist - 2);
          game.undo();
          if (!sub) {
            all = false;
            break;
          }
          if (sub.dist > worst) worst = sub.dist;
        }
        d = all ? worst + 2 : null;
      }
    }
    game.undo();
    if (d === dist) {
      count += 1;
      keys.push(`${m.from}${m.to}${m.promotion || ''}`);
    }
  }
  return { count, keys };
}

// Build the canonical solution line (UCI strings) for a forced mate: at each
// solver turn play the unique/best key; at each opponent turn play the defense
// that resists longest (maximises mate distance). Returns the line or null if
// the position is not a forced mate within maxPlies.
export function solutionLine(fen, maxPlies) {
  const game = new Chess(fen);
  const line = [];
  let guard = 0;
  while (!game.isCheckmate() && guard < maxPlies + 2) {
    guard += 1;
    const me = searchMate(game, maxPlies);
    if (!me) return null; // solver side has no forced mate — unsound
    line.push(`${me.key.from}${me.key.to}${me.key.promotion || ''}`);
    game.move(me.key);
    if (game.isCheckmate()) break;
    // Opponent: pick the reply that maximises remaining mate distance.
    let bestReply = null;
    let bestDist = -1;
    for (const om of game.moves({ verbose: true })) {
      game.move(om);
      const sub = game.isCheckmate() ? { dist: 0 } : searchMate(game, maxPlies);
      game.undo();
      const d = sub ? sub.dist : Infinity; // a reply with no forced mate => unsound
      if (d === Infinity) return null;
      if (d > bestDist) {
        bestDist = d;
        bestReply = om;
      }
    }
    if (!bestReply) break;
    line.push(`${bestReply.from}${bestReply.to}${bestReply.promotion || ''}`);
    game.move(bestReply);
  }
  return game.isCheckmate() ? line : null;
}
