#!/usr/bin/env node
// Splendor self-play data generation for future policy/value training.
//
// Usage:
//   node scripts/splendor/generate-training-data.mjs --games 20 --sims 200
//
// Output is NDJSON under data/splendor/ (gitignored). Each position carries the
// perspective-relative feature planes, the MCTS root-visit policy target, the
// heuristic value estimate, and (after the game) the eventual winner's seat.

import { createWriteStream, mkdirSync } from 'fs';
import { dirname, resolve } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const projectDir = resolve(__dirname, '..', '..');

const args = process.argv.slice(2);
function getArg(name, defaultValue) {
  const index = args.indexOf(`--${name}`);
  return index >= 0 && args[index + 1] ? args[index + 1] : defaultValue;
}

const NUM_GAMES = parseInt(getArg('games', '20'), 10);
const PLAYERS = parseInt(getArg('players', '4'), 10);
const SIMS = parseInt(getArg('sims', '200'), 10);
const ROLLOUT = parseInt(getArg('rollout', '24'), 10);
const MODEL = getArg('model', null);
const SEED_BASE = parseInt(getArg('seed', '0'), 10) || Date.now();
const MAX_MOVES = parseInt(getArg('max-moves', '800'), 10);
const OUTPUT_DIR = getArg('output-dir', 'data/splendor');
const OUTPUT = getArg('output', null);

function valueFor(winner, player) {
  if (!winner) return 0;
  return winner === player ? 1 : -1;
}

// Perspective-relative seat of the winner (0 = the position's own player), else
// its index in [self, ...others]. -1 if undecided.
function winnerSeatFor(board, player) {
  if (!board.winner) return -1;
  const order = [player, ...board.getPlayerIds().filter(p => p !== player)];
  return order.indexOf(board.winner);
}

async function main() {
  const { default: SplendorBoard } = await import(resolve(projectDir, 'src/games/splendor/SplendorBoard.js'));
  const { MCTS, NNEvaluator, applyMove, evaluatePosition } = await import(resolve(projectDir, 'src/games/splendor/engine/mcts.js'));
  const { extractFeatures, extractPolicyTarget } = await import(resolve(projectDir, 'src/games/splendor/engine/features.js'));

  let evaluator = null;
  if (MODEL) {
    const { default: SplendorValueNetworkNode } = await import(resolve(projectDir, 'src/games/splendor/engine/valueNetworkNode.js'));
    evaluator = new NNEvaluator(await SplendorValueNetworkNode.load(resolve(projectDir, MODEL)));
  }

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const outputPath = OUTPUT
    ? resolve(projectDir, OUTPUT)
    : resolve(projectDir, OUTPUT_DIR, `selfplay-${timestamp}.ndjson`);
  mkdirSync(dirname(outputPath), { recursive: true });
  const stream = createWriteStream(outputPath);

  console.log(`Splendor training data`);
  console.log(`Games: ${NUM_GAMES} | Players: ${PLAYERS} | Sims: ${SIMS} | Output: ${outputPath}`);

  let totalPositions = 0;
  const start = Date.now();

  for (let game = 0; game < NUM_GAMES; game++) {
    const board = new SplendorBoard({ seed: SEED_BASE + game, playerCount: PLAYERS, skipInitialHistory: true });
    board._skipHistory = true;
    const mcts = evaluator
      ? new MCTS({ maxChildren: 44, evaluator })
      : new MCTS({ maxChildren: 44, rolloutSteps: ROLLOUT });
    const buffer = [];
    let moves = 0;

    while (board.phase !== 'game-over' && moves < MAX_MOVES) {
      const player = board.currentPlayer;
      const features = extractFeatures(board, player);
      const move = await mcts.getBestMove(board, SIMS);
      if (!move) break;

      buffer.push({
        players: Array.from(features.players),
        market: Array.from(features.market),
        meta: Array.from(features.meta),
        policy: Array.from(extractPolicyTarget(move)),
        player,
        heuristic: evaluatePosition(board, player),
      });

      applyMove(board, move);
      moves++;
    }

    for (const position of buffer) {
      stream.write(JSON.stringify({
        ...position,
        value: valueFor(board.winner, position.player),
        winnerSeat: winnerSeatFor(board, position.player),
        numPlayers: board.playerCount,
        gameId: SEED_BASE + game,
      }) + '\n');
      totalPositions++;
    }

    console.log(`  Game ${game + 1}: winner=${board.winner || 'none'} moves=${moves} positions=${buffer.length}`);
  }

  stream.end();
  const elapsed = ((Date.now() - start) / 1000).toFixed(1);
  console.log(`Done: ${totalPositions} positions in ${elapsed}s`);
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
