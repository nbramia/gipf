#!/usr/bin/env node
// Micro-benchmark for MCTS throughput (sims/sec). Plays a fixed number of moves
// at a fixed sim budget and reports search speed — used to verify engine
// speedups translate into more search per move-time.
//
//   node scripts/splendor/bench.mjs --moves 12 --sims 800

import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectDir = resolve(__dirname, '..', '..');
const args = process.argv.slice(2);
const getInt = (n, d) => { const i = args.indexOf(`--${n}`); return i >= 0 ? parseInt(args[i + 1], 10) : d; };

const MOVES = getInt('moves', 12);
const SIMS = getInt('sims', 800);
const ROLLOUT = getInt('rollout', 28);
const PLAYERS = getInt('players', 2);
const SEED = getInt('seed', 12345);

const { default: SplendorBoard } = await import(resolve(projectDir, 'src/games/splendor/SplendorBoard.js'));
const { MCTS, applyMove } = await import(resolve(projectDir, 'src/games/splendor/engine/mcts.js'));

const board = new SplendorBoard({ seed: SEED, playerCount: PLAYERS, skipInitialHistory: true });
board._skipHistory = true;
const mcts = new MCTS({ maxChildren: 36, rolloutSteps: ROLLOUT });

// warm up
await mcts.getBestMove(board, 50);

let totalSims = 0;
const start = Date.now();
let moves = 0;
while (board.phase !== 'game-over' && moves < MOVES) {
  const move = await mcts.getBestMove(board, SIMS);
  if (!move) break;
  totalSims += SIMS;
  applyMove(board, move);
  moves++;
}
const secs = (Date.now() - start) / 1000;
console.log(`moves=${moves} sims/move=${SIMS} rollout=${ROLLOUT} players=${PLAYERS}`);
console.log(`total ${totalSims} sims in ${secs.toFixed(2)}s -> ${Math.round(totalSims / secs)} sims/sec, ${(secs / moves * 1000).toFixed(0)} ms/move`);
