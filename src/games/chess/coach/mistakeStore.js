// mistakeStore.js — the persistent mistake library (#23).
//
// Every mistake/blunder the human plays in a normal game is captured as a
// replayable drill: the position it was played from, the move, the engine's
// best line, and a light spaced-repetition schedule so solved positions come
// back for review. Pure list-transforming functions (unit-tested directly)
// plus thin localStorage wrappers, mirroring the coach modules' style.
//
// Entry shape:
//   { id, fenBefore, movePlayed, bestSan, bestPv, cpLoss, classification,
//     opening, moveNo, createdAt, attempts, streak, nextDueAt }

export const MISTAKE_STORAGE_KEY = 'chessMistakes';
export const MISTAKE_CAP = 200;

const DAY_MS = 24 * 60 * 60 * 1000;
// Successful review #1 -> due in 1 day, #2 -> 3 days, #3+ -> 7 days.
export const REVIEW_INTERVALS_MS = [DAY_MS, 3 * DAY_MS, 7 * DAY_MS];

// A retried move that isn't the stored best still counts as solved when it
// concedes less than this (centipawns, mover's POV) — same honesty principle
// as the puzzle checker: alternate good moves are accepted.
export const DRILL_CP_TOLERANCE = 50;

// Worse errors survive eviction and get drilled first when tied on due time —
// an inaccuracy is the least costly, a blunder the most. Unknown/missing
// classifications rank alongside inaccuracies (least severe) rather than
// risk starving a real blunder of cap space.
const SEVERITY_RANK = { inaccuracy: 0, mistake: 1, blunder: 2 };
const severityOf = (e) => SEVERITY_RANK[e.classification] ?? 0;

export function loadMistakes() {
  try {
    const raw = localStorage.getItem(MISTAKE_STORAGE_KEY);
    const list = raw ? JSON.parse(raw) : [];
    return Array.isArray(list) ? list : [];
  } catch (_) {
    return [];
  }
}

export function saveMistakes(list) {
  try {
    localStorage.setItem(MISTAKE_STORAGE_KEY, JSON.stringify(list));
  } catch (_) {
    /* ignore storage failures */
  }
}

// Evict down to the cap: the least severe classification goes first (an
// inaccuracy before a mistake before a blunder — a blunder should never be
// dropped in favour of a lesser error just because it's newer). Within a
// severity tier, oldest solved entries (streak > 0) go first — they've been
// learned — then oldest overall. Exported for reuse by profileSync's
// cross-device mistake merge, which must enforce the same cap.
export function evictToCap(list) {
  let next = list;
  while (next.length > MISTAKE_CAP) {
    const minSeverity = Math.min(...next.map(severityOf));
    const tier = next.filter((e) => severityOf(e) === minSeverity);
    const byAge = (a, b) => a.createdAt - b.createdAt;
    const solved = tier.filter((e) => e.streak > 0).sort(byAge);
    const victim = solved[0] || tier.slice().sort(byAge)[0];
    next = next.filter((e) => e !== victim);
  }
  return next;
}

// Capture a freshly played mistake. Dedupes by position: repeating a mistake
// from the same FEN updates the stored move data and makes the entry due again
// (streak reset — the lesson clearly hasn't stuck), keeping its attempt count.
// Returns { list, entry }.
export function captureMistake(list, data, now = Date.now()) {
  const existing = list.find((e) => e.fenBefore === data.fenBefore);
  if (existing) {
    const entry = { ...existing, ...data, streak: 0, nextDueAt: now };
    return { list: list.map((e) => (e === existing ? entry : e)), entry };
  }
  const entry = {
    id: `m${now.toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`,
    ...data,
    createdAt: now,
    attempts: 0,
    streak: 0,
    nextDueAt: now,
  };
  return { list: evictToCap([...list, entry]), entry };
}

// Record a drill attempt. Success advances the streak and pushes the next
// review out (1d / 3d / 7d); a miss resets the streak and keeps it due now.
export function recordAttempt(list, id, success, now = Date.now()) {
  return list.map((e) => {
    if (e.id !== id) return e;
    const attempts = (e.attempts || 0) + 1;
    if (!success) return { ...e, attempts, streak: 0, nextDueAt: now };
    const streak = (e.streak || 0) + 1;
    const interval = REVIEW_INTERVALS_MS[Math.min(streak - 1, REVIEW_INTERVALS_MS.length - 1)];
    return { ...e, attempts, streak, nextDueAt: now + interval };
  });
}

// Entries due for review, longest-overdue first; entries tied on due time
// break toward the worse classification (a blunder drills before an
// inaccuracy that came due at the same moment).
//
// options.opening — optional exact opening name (as returned by
// listMistakeOpenings) restricting the result to mistakes captured in that
// opening, so the UI can offer e.g. "drill only my Sicilian mistakes".
// Omitted leaves behavior unchanged; an opening that matches nothing returns
// an empty list rather than falling back to all due mistakes.
export function dueMistakes(list, now = Date.now(), options = {}) {
  const { opening } = options;
  return (list || [])
    .filter((e) => (e.nextDueAt || 0) <= now)
    .filter((e) => !opening || e.opening === opening)
    .sort((a, b) => (a.nextDueAt || 0) - (b.nextDueAt || 0) || severityOf(b) - severityOf(a));
}

// Distinct openings present among stored mistakes, with counts, most
// frequent first — populates the "drill this opening" filter UI.
export function listMistakeOpenings(store) {
  const counts = {};
  for (const e of store || []) {
    if (!e.opening) continue;
    counts[e.opening] = (counts[e.opening] || 0) + 1;
  }
  return Object.keys(counts)
    .map((opening) => ({ opening, count: counts[opening] }))
    .sort((a, b) => b.count - a.count || a.opening.localeCompare(b.opening));
}

// Is a drill attempt correct? The stored best move always counts; any other
// move counts when the live-analysis centipawn loss is inside the tolerance.
export function drillMoveCorrect({ bestSan, playedSan, cpLoss }) {
  if (playedSan && playedSan === bestSan) return true;
  return typeof cpLoss === 'number' && cpLoss < DRILL_CP_TOLERANCE;
}

// Game phase from the full-move number, for the weakness profile.
export function phaseOf(moveNo) {
  if (moveNo <= 10) return 'opening';
  if (moveNo <= 30) return 'middlegame';
  return 'endgame';
}

// One-line summary of the player's recurring weaknesses, fed to the coach
// prompt alongside the learning goal. Empty until there's a real pattern.
export function weaknessProfile(list) {
  const entries = list || [];
  if (entries.length < 3) return '';

  const counts = { blunder: 0, mistake: 0, inaccuracy: 0 };
  const phases = {};
  const openings = {};
  for (const e of entries) {
    if (counts[e.classification] !== undefined) counts[e.classification] += 1;
    const phase = phaseOf(e.moveNo || 0);
    phases[phase] = (phases[phase] || 0) + 1;
    if (e.opening) openings[e.opening] = (openings[e.opening] || 0) + 1;
  }

  const topOf = (obj) => Object.keys(obj).sort((a, b) => obj[b] - obj[a])[0];
  const topPhase = topOf(phases);
  const topOpening = topOf(openings);
  const openingPart =
    topOpening && openings[topOpening] >= 2 ? `; often in the ${topOpening}` : '';

  const countParts = [];
  if (counts.blunder) countParts.push(`${counts.blunder} blunder${counts.blunder === 1 ? '' : 's'}`);
  if (counts.mistake) countParts.push(`${counts.mistake} mistake${counts.mistake === 1 ? '' : 's'}`);
  if (counts.inaccuracy) {
    countParts.push(`${counts.inaccuracy} inaccurac${counts.inaccuracy === 1 ? 'y' : 'ies'}`);
  }
  const countsText =
    countParts.length <= 1
      ? countParts.join('')
      : `${countParts.slice(0, -1).join(', ')} and ${countParts[countParts.length - 1]}`;

  return (
    `${countsText} captured from recent games, ` +
    `mostly in the ${topPhase}${openingPart}.`
  );
}
