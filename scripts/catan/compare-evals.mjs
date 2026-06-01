#!/usr/bin/env node
// A/B compare two engine builds head-to-head: the challenger (engine/mcts.js)
// vs the frozen champion (engine/_mcts_champion.js). Same sims/children/rollout
// for both, seats split evenly and rotated so neither gets a seat advantage.
// This is how every heuristic/search improvement is PROVEN before it ships:
// the challenger must beat the champion, then copy mcts.js -> _mcts_champion.js.
//
//   node scripts/catan/compare-evals.mjs --games 20 --sims 120 --rollout 30

import CatanBoard from '../../src/games/catan/CatanBoard.js';
import { MCTS as Challenger, applyMove } from '../../src/games/catan/engine/mcts.js';
import { MCTS as Champion } from '../../src/games/catan/engine/_mcts_champion.js';

const args = process.argv.slice(2);
const getArg = (n, d) => { const i = args.indexOf(`--${n}`); return i >= 0 && args[i + 1] ? args[i + 1] : d; };
const getInt = (n, d) => parseInt(getArg(n, String(d)), 10);

const GAMES = getInt('games', 20);
const PLAYERS = getInt('players', 4);
const SIMS = getInt('sims', 120);
const ROLLOUT = getInt('rollout', 30);
const CHILDREN = getInt('children', 30);
const MAX_MOVES = getInt('max-moves', 1200);
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
  const board = new CatanBoard({ seed: SEED + index, playerCount: PLAYERS });
  const engines = {};
  for (let seat = 1; seat <= PLAYERS; seat++) engines[seat] = makeEngine(assign[seat]);

  let moves = 0;
  while (board.phase !== 'game-over' && moves < MAX_MOVES) {
    const seat = board.currentPlayer;
    const move = await engines[seat].getBestMove(board, SIMS);
    if (!move || !applyMove(board, move)) break;
    moves++;
  }
  return { winner: board.winner, side: board.winner ? assign[board.winner] : null, moves,
    scores: board.getPlayerIds().map(p => board.getVictoryPoints(p)), assign };
}

async function main() {
  const wins = { challenger: 0, champion: 0, none: 0 };
  const start = Date.now();
  console.log(`Catan eval A/B: challenger (mcts.js) vs champion (_mcts_champion.js)`);
  console.log(`  ${GAMES} games, ${PLAYERS}p, sims=${SIMS}, rollout=${ROLLOUT}, children=${CHILDREN}`);
  for (let i = 0; i < GAMES; i++) {
    const r = await playGame(i);
    if (r.side) wins[r.side]++; else wins.none++;
    const seats = [1, 2, 3, 4].slice(0, PLAYERS).map(s => r.assign[s][0].toUpperCase()).join('');
    console.log(`  Game ${i + 1}: winner=P${r.winner || '-'} (${r.side || 'none'}) moves=${r.moves} seats=[${seats}] scores=${r.scores.join('/')}`);
  }
  const decisive = wins.challenger + wins.champion;
  const rate = decisive ? (wins.challenger / decisive * 100).toFixed(1) : 'n/a';
  console.log('---');
  console.log(`challenger=${wins.challenger}  champion=${wins.champion}  none=${wins.none}`);
  console.log(`challenger win rate (decisive): ${rate}%  [${decisive} decisive]  time=${((Date.now() - start) / 1000).toFixed(0)}s`);
  process.exitCode = wins.challenger > wins.champion ? 0 : 1;
}

main();
