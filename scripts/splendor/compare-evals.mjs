#!/usr/bin/env node
// A/B compare two engine builds head-to-head: the challenger (engine/mcts.js)
// vs the frozen champion (engine/_mcts_champion.js). Same sims/children/rollout
// for both; seats split evenly and rotated so neither side gets a seat edge.
// This is how every heuristic/search change is PROVEN before it ships: the
// challenger must beat the champion, then copy mcts.js -> _mcts_champion.js.
//
//   node scripts/splendor/compare-evals.mjs --games 30 --sims 120 --rollout 24

import SplendorBoard from '../../src/games/splendor/SplendorBoard.js';
import { MCTS as Challenger, applyMove } from '../../src/games/splendor/engine/mcts.js';
import { MCTS as Champion } from '../../src/games/splendor/engine/_mcts_champion.js';

const args = process.argv.slice(2);
const getArg = (n, d) => { const i = args.indexOf(`--${n}`); return i >= 0 && args[i + 1] ? args[i + 1] : d; };
const getInt = (n, d) => parseInt(getArg(n, String(d)), 10);

const GAMES = getInt('games', 30);
const PLAYERS = getInt('players', 2);
const SIMS = getInt('sims', 120);
const ROLLOUT = getInt('rollout', 24);
const CHILDREN = getInt('children', 36);
const MAX_MOVES = getInt('max-moves', 800);
const SEED = getInt('seed', 4000);

function makeEngine(which) {
  const Cls = which === 'challenger' ? Challenger : Champion;
  return new Cls({ maxChildren: CHILDREN, rolloutSteps: ROLLOUT });
}

async function playGame(index) {
  const offset = index % 2;
  const assign = {};
  for (let seat = 1; seat <= PLAYERS; seat++) {
    assign[seat] = (seat - 1 + offset) % 2 === 0 ? 'challenger' : 'champion';
  }
  const board = new SplendorBoard({ seed: SEED + index, playerCount: PLAYERS, skipInitialHistory: true });
  board._skipHistory = true;
  const engines = {};
  for (let seat = 1; seat <= PLAYERS; seat++) engines[seat] = makeEngine(assign[seat]);

  let moves = 0;
  while (board.phase !== 'game-over' && moves < MAX_MOVES) {
    const seat = board.currentPlayer;
    const move = await engines[seat].getBestMove(board, SIMS);
    if (!move || !applyMove(board, move)) break;
    moves++;
  }
  return {
    winner: board.winner,
    side: board.winner ? assign[board.winner] : null,
    moves,
    scores: board.getPlayerIds().map(p => board.getVictoryPoints(p)),
    assign,
  };
}

async function main() {
  const wins = { challenger: 0, champion: 0, none: 0 };
  const start = Date.now();
  const moveCounts = [];
  let capped = 0;
  let winPrestigeSum = 0;
  let winPrestigeN = 0;
  console.log(`Splendor eval A/B: challenger (mcts.js) vs champion (_mcts_champion.js)`);
  console.log(`  ${GAMES} games, ${PLAYERS}p, sims=${SIMS}, rollout=${ROLLOUT}, children=${CHILDREN}`);
  for (let i = 0; i < GAMES; i++) {
    const r = await playGame(i);
    if (r.side) wins[r.side]++; else wins.none++;
    moveCounts.push(r.moves);
    if (r.moves >= MAX_MOVES) capped++;
    if (r.winner) { winPrestigeSum += Math.max(...r.scores); winPrestigeN++; }
    const seats = Array.from({ length: PLAYERS }, (_, s) => r.assign[s + 1][0].toUpperCase()).join('');
    console.log(`  Game ${i + 1}: winner=P${r.winner || '-'} (${r.side || 'none'}) moves=${r.moves} seats=[${seats}] scores=${r.scores.join('/')}`);
  }
  const decisive = wins.challenger + wins.champion;
  const p = decisive ? wins.challenger / decisive : 0;
  const rate = decisive ? (p * 100).toFixed(1) : 'n/a';
  const [lo, hi] = wilson95(wins.challenger, decisive);
  const verdict = lo > 0.5 ? 'PROMOTE (significantly better)'
    : hi < 0.5 ? 'REJECT (significantly worse)'
    : 'inconclusive (need more games or a bigger effect)';

  const avgMoves = (moveCounts.reduce((a, b) => a + b, 0) / (moveCounts.length || 1)).toFixed(0);
  console.log('---');
  console.log(`challenger=${wins.challenger}  champion=${wins.champion}  none=${wins.none}`);
  console.log(`challenger win rate (decisive): ${rate}%  95% CI [${(lo * 100).toFixed(1)}%, ${(hi * 100).toFixed(1)}%]  [${decisive} decisive]`);
  console.log(`verdict: ${verdict}`);
  console.log(`self-play health: avg ${avgMoves} plies/game, ${capped}/${GAMES} hit the move cap, avg winning prestige ${(winPrestigeSum / (winPrestigeN || 1)).toFixed(1)}`);
  console.log(`time=${((Date.now() - start) / 1000).toFixed(0)}s`);
  // Exit 0 only on a statistically significant improvement, so the flywheel gate
  // promotes on real gains, not noise.
  process.exitCode = lo > 0.5 ? 0 : 1;
}

// Wilson score interval for a binomial proportion (better than normal approx for
// small n and extreme rates).
function wilson95(wins, n) {
  if (n === 0) return [0, 1];
  const z = 1.96;
  const phat = wins / n;
  const denom = 1 + (z * z) / n;
  const center = (phat + (z * z) / (2 * n)) / denom;
  const margin = (z * Math.sqrt((phat * (1 - phat)) / n + (z * z) / (4 * n * n))) / denom;
  return [Math.max(0, center - margin), Math.min(1, center + margin)];
}

main();
