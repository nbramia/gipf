#!/usr/bin/env node
// Catan self-play data generation for future policy/value training.
//
// Usage:
//   node scripts/catan/generate-training-data.mjs --games 20 --sims 200

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
const SIMS = parseInt(getArg('sims', '200'), 10);
const MAX_MOVES = parseInt(getArg('max-moves', '520'), 10);
const OUTPUT_DIR = getArg('output-dir', 'data/catan');
const OUTPUT = getArg('output', null);

function valueFor(winner, player) {
  if (!winner) return 0;
  return winner === player ? 1 : -1;
}

async function main() {
  const { default: CatanBoard } = await import(resolve(projectDir, 'src/games/catan/CatanBoard.js'));
  const { MCTS, applyMove, evaluatePosition } = await import(resolve(projectDir, 'src/games/catan/engine/mcts.js'));
  const { extractFeatures, extractPolicyTarget } = await import(resolve(projectDir, 'src/games/catan/engine/features.js'));

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const outputPath = OUTPUT
    ? resolve(projectDir, OUTPUT)
    : resolve(projectDir, OUTPUT_DIR, `selfplay-${timestamp}.ndjson`);
  mkdirSync(dirname(outputPath), { recursive: true });
  const stream = createWriteStream(outputPath);

  console.log(`Catan training data`);
  console.log(`Games: ${NUM_GAMES} | Sims: ${SIMS} | Output: ${outputPath}`);

  let totalPositions = 0;
  const start = Date.now();

  for (let game = 0; game < NUM_GAMES; game++) {
    const board = new CatanBoard({ seed: Date.now() + game });
    const mcts = new MCTS({ maxChildren: 44 });
    const buffer = [];
    let moves = 0;

    while (board.phase !== 'game-over' && moves < MAX_MOVES) {
      const player = board.currentPlayer;
      const features = extractFeatures(board, player);
      const sims = board.phase.startsWith('setup') ? Math.max(60, Math.floor(SIMS / 2)) : SIMS;
      const move = await mcts.getBestMove(board, sims);
      if (!move) break;

      buffer.push({
        tiles: Array.from(features.tiles),
        players: Array.from(features.players),
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
