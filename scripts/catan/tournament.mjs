#!/usr/bin/env node
// Catan AI tournament harness — A/B engine-variant comparison.
//
// Pits two engine variants (A and B) head-to-head so any change to the engine,
// heuristics, or evaluation can be PROVEN by win rate rather than eyeballed.
// Seats are split evenly between the two variants and the assignment is rotated
// each game so neither variant gets a fixed seat/turn-order advantage.
//
// Usage:
//   node scripts/catan/tournament.mjs --games 12 --a-sims 500 --b-sims 500
//   node scripts/catan/tournament.mjs --games 20 --a-children 50 --b-children 28 --a-label wide --b-label narrow
//   node scripts/catan/tournament.mjs --players 4 --games 16 --a-sims 600 --b-sims 200

import { resolve } from 'node:path';
import CatanBoard from '../../src/games/catan/CatanBoard.js';
import { MCTS, NNEvaluator, applyMove } from '../../src/games/catan/engine/mcts.js';

// Build an NN evaluator from a model path (e.g. --a-model public/models/catan-value-v1.onnx).
// onnxruntime-node is imported lazily so a heuristic-only run never loads it.
async function loadEvaluator(modelPath) {
  if (!modelPath) return null;
  const { default: CatanValueNetworkNode } = await import('../../src/games/catan/engine/valueNetworkNode.js');
  const net = await CatanValueNetworkNode.load(resolve(modelPath));
  return new NNEvaluator(net);
}

const args = process.argv.slice(2);
function getArg(name, defaultValue) {
  const index = args.indexOf(`--${name}`);
  return index >= 0 && args[index + 1] ? args[index + 1] : defaultValue;
}
function getInt(name, defaultValue) {
  return parseInt(getArg(name, String(defaultValue)), 10);
}

const NUM_GAMES = getInt('games', 12);
const PLAYERS = getInt('players', 4);
// Games now need ~700 moves to reach 10 VP (the expanded action space inflates
// moves-per-turn), so the cap must clear that or games get truncated as draws.
const MAX_MOVES = getInt('max-moves', 1200);
const SEED = getInt('seed', 1000);

// A variant is everything the harness needs to build an engine and pick a sim
// budget for it. Today both variants use the heuristic-rollout MCTS and differ
// only by config; when the NN engine lands, add a branch in makeEngine().
const variantA = {
  label: getArg('a-label', 'A'),
  sims: getInt('a-sims', 500),
  maxChildren: getInt('a-children', 50),
  mode: getArg('a-mode', 'tree'),
  rolloutSteps: getInt('a-rollout', 0),
  model: getArg('a-model', null),
};
const variantB = {
  label: getArg('b-label', 'B'),
  sims: getInt('b-sims', 500),
  maxChildren: getInt('b-children', 28),
  mode: getArg('b-mode', 'tree'),
  rolloutSteps: getInt('b-rollout', 0),
  model: getArg('b-model', null),
};

function makeEngine(variant) {
  if (variant.evaluator) {
    return new MCTS({ maxChildren: variant.maxChildren, evaluator: variant.evaluator });
  }
  return new MCTS({ maxChildren: variant.maxChildren, mode: variant.mode, rolloutSteps: variant.rolloutSteps });
}

// Assign each seat (1..PLAYERS) to variant A or B, alternating, with the
// starting variant rotated by `offset` so seat advantage balances over a run.
function seatAssignment(offset) {
  const assignment = {};
  for (let seat = 1; seat <= PLAYERS; seat++) {
    assignment[seat] = (seat - 1 + offset) % 2 === 0 ? variantA : variantB;
  }
  return assignment;
}

async function playGame(index) {
  const assignment = seatAssignment(index % 2);
  const board = new CatanBoard({ seed: SEED + index, playerCount: PLAYERS });
  const engines = {};
  for (let seat = 1; seat <= PLAYERS; seat++) engines[seat] = makeEngine(assignment[seat]);

  let moves = 0;
  while (board.phase !== 'game-over' && moves < MAX_MOVES) {
    const seat = board.currentPlayer;
    const move = await engines[seat].getBestMove(board, assignment[seat].sims);
    if (!move) break;
    applyMove(board, move);
    moves++;
  }

  const winnerVariant = board.winner ? assignment[board.winner] : null;
  return {
    winner: board.winner,
    winnerVariant: winnerVariant ? winnerVariant.label : null,
    moves,
    scores: board.getPlayerIds().map(player => board.getVictoryPoints(player)),
    assignment: board.getPlayerIds().map(seat => assignment[seat].label),
  };
}

async function main() {
  const wins = { [variantA.label]: 0, [variantB.label]: 0, none: 0 };
  const start = Date.now();

  variantA.evaluator = await loadEvaluator(variantA.model);
  variantB.evaluator = await loadEvaluator(variantB.model);
  const describe = v => `mode=${v.evaluator ? `nn(${v.model})` : v.mode}, sims=${v.sims}, children=${v.maxChildren}${v.rolloutSteps ? `, rollout=${v.rolloutSteps}` : ''}`;

  console.log(`Catan A/B tournament: ${NUM_GAMES} games, ${PLAYERS} players`);
  console.log(`  A "${variantA.label}": ${describe(variantA)}`);
  console.log(`  B "${variantB.label}": ${describe(variantB)}`);

  for (let i = 0; i < NUM_GAMES; i++) {
    const result = await playGame(i);
    if (result.winnerVariant) wins[result.winnerVariant]++;
    else wins.none++;
    console.log(
      `  Game ${i + 1}: winner=P${result.winner || '-'} (${result.winnerVariant || 'none'}), ` +
      `moves=${result.moves}, seats=[${result.assignment.join(',')}], scores=${result.scores.join('/')}`
    );
  }

  const decisive = wins[variantA.label] + wins[variantB.label];
  const aRate = decisive > 0 ? ((wins[variantA.label] / decisive) * 100).toFixed(1) : 'n/a';
  const elapsed = ((Date.now() - start) / 1000).toFixed(1);

  console.log('---');
  console.log(`A "${variantA.label}": ${wins[variantA.label]}   B "${variantB.label}": ${wins[variantB.label]}   none: ${wins.none}`);
  console.log(`A win rate (of decisive games): ${aRate}%   [${decisive} decisive]`);
  console.log(`Time: ${elapsed}s`);

  // Exit 0 if A is at least as strong as B, so this can gate promotion in scripts.
  // Use exitCode (not process.exit) so buffered stdout flushes to a file/pipe first.
  process.exitCode = wins[variantA.label] >= wins[variantB.label] ? 0 : 1;
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
