#!/usr/bin/env node
// Catan AI tournament harness.
//
// Usage:
//   node scripts/catan/tournament.mjs --games 8 --sims-a 500 --sims-b 180

import CatanBoard from '../../src/games/catan/CatanBoard.js';
import { MCTS, applyMove } from '../../src/games/catan/engine/mcts.js';

const args = process.argv.slice(2);
function getArg(name, defaultValue) {
  const index = args.indexOf(`--${name}`);
  return index >= 0 && args[index + 1] ? args[index + 1] : defaultValue;
}

const NUM_GAMES = parseInt(getArg('games', '8'), 10);
const SIMS_A = parseInt(getArg('sims-a', '500'), 10);
const SIMS_B = parseInt(getArg('sims-b', '180'), 10);
const MAX_MOVES = parseInt(getArg('max-moves', '520'), 10);

async function playGame(index, strongSeat) {
  const board = new CatanBoard({ seed: 1000 + index });
  const strong = new MCTS({ maxChildren: 50 });
  const baseline = new MCTS({ maxChildren: 28 });
  let moves = 0;

  while (board.phase !== 'game-over' && moves < MAX_MOVES) {
    const isStrongTurn = board.currentPlayer === strongSeat;
    const mcts = isStrongTurn ? strong : baseline;
    const sims = isStrongTurn ? SIMS_A : SIMS_B;
    const move = await mcts.getBestMove(board, sims);
    if (!move) break;
    applyMove(board, move);
    moves++;
  }

  return {
    winner: board.winner,
    moves,
    scores: [1, 2, 3, 4].map(player => board.getVictoryPoints(player)),
  };
}

async function main() {
  const results = { strong: 0, baseline: 0, none: 0 };
  const start = Date.now();

  console.log(`Catan tournament: ${NUM_GAMES} games`);
  console.log(`Strong sims=${SIMS_A}, baseline sims=${SIMS_B}`);

  for (let i = 0; i < NUM_GAMES; i++) {
    const strongSeat = (i % 4) + 1;
    const result = await playGame(i, strongSeat);
    if (result.winner === strongSeat) results.strong++;
    else if (result.winner) results.baseline++;
    else results.none++;
    console.log(`  Game ${i + 1}: strong=P${strongSeat}, winner=${result.winner || 'none'}, moves=${result.moves}, scores=${result.scores.join('/')}`);
  }

  const elapsed = ((Date.now() - start) / 1000).toFixed(1);
  console.log(`Results: strong=${results.strong}, baseline=${results.baseline}, none=${results.none}`);
  console.log(`Time: ${elapsed}s`);

  process.exit(results.strong >= results.baseline ? 0 : 1);
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
