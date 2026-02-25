#!/usr/bin/env node
// generate-training-data.mjs — Self-play with feature extraction for policy-value network training.
// Outputs NDJSON with: board, meta, value, policy (visit distribution)
//
// Usage: node scripts/zertz/generate-training-data.mjs --games 50 --sims 200
//        node scripts/zertz/generate-training-data.mjs --games 50 --sims 200 --mode nn --model public/models/zertz-value-v1.onnx

import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';
import { createWriteStream } from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const srcDir = resolve(__dirname, '..', '..', 'src', 'games', 'zertz');
const projectDir = resolve(__dirname, '..', '..');

// Parse CLI args
const args = process.argv.slice(2);
function getArg(name, defaultVal) {
  const idx = args.indexOf(`--${name}`);
  if (idx !== -1 && args[idx + 1]) return args[idx + 1];
  return defaultVal;
}

const NUM_GAMES = parseInt(getArg('games', '100'), 10);
const SIMS = parseInt(getArg('sims', '200'), 10);
const OUTPUT = getArg('output', null);
const OUTPUT_DIR = getArg('output-dir', 'data/zertz');
const MODE = getArg('mode', 'heuristic'); // heuristic | nn | mixed
const MODEL = getArg('model', null);
const RAMP_MOVES = parseInt(getArg('ramp', '10'), 10);
const TEMP_MOVES = parseInt(getArg('temperature-moves', '15'), 10);
const MAX_MOVES = 200;

const GRID_SIZE = 7;
const GRID_OFFSET = 3;
const POLICY_SIZE = 49; // 7 * 7

/**
 * Extract policy target (visit distribution) from MCTS root visit counts.
 * Returns Float32Array(49) representing normalized visit counts over the 7x7 grid.
 */
function extractPolicyTarget(move) {
  const policyTarget = new Float32Array(POLICY_SIZE);
  const rootVisits = move._rootVisits;
  const legalMoves = move._legalMoves;

  if (!rootVisits || !legalMoves) return policyTarget;

  // Map each legal move's visit count to its destination grid index
  for (const m of legalMoves) {
    const key = moveToKey(m);
    const visits = rootVisits[key] || 0;
    if (visits === 0) continue;

    const idx = getMoveDestIndex(m);
    if (idx >= 0 && idx < POLICY_SIZE) {
      policyTarget[idx] += visits;
    }
  }

  // Normalize
  const total = policyTarget.reduce((a, b) => a + b, 0);
  if (total > 0) {
    for (let i = 0; i < POLICY_SIZE; i++) policyTarget[i] /= total;
  }

  return policyTarget;
}

/**
 * Get the destination grid index for a move (matching mcts.js getMoveDestIndex).
 */
function getMoveDestIndex(move) {
  let q, r;
  switch (move.type) {
    case 'place-marble':
      q = move.q;
      r = move.r;
      break;
    case 'remove-ring':
      q = move.q;
      r = move.r;
      break;
    case 'capture': {
      const parts = move.toKey.split(',').map(Number);
      q = parts[0];
      r = parts[1];
      break;
    }
    default:
      return -1;
  }
  return (r + GRID_OFFSET) * GRID_SIZE + (q + GRID_OFFSET);
}

function moveToKey(move) {
  switch (move.type) {
    case 'place-marble':
      return `p:${move.color}:${move.q},${move.r}`;
    case 'remove-ring':
      return `r:${move.q},${move.r}`;
    case 'capture':
      return `c:${move.fromKey}>${move.toKey}`;
    default:
      return JSON.stringify(move);
  }
}

/**
 * Temperature-based move selection from MCTS root visit counts.
 * Move 1-TEMP_MOVES: temperature=1.0 (proportional to visits)
 * Move TEMP_MOVES+1+: temperature=0.1 (near-greedy)
 */
function selectWithTemperature(move, moveNumber) {
  const rootVisits = move._rootVisits;
  const legalMoves = move._legalMoves;

  if (!rootVisits || !legalMoves || legalMoves.length === 0) return move;

  const temperature = moveNumber <= TEMP_MOVES ? 1.0 : 0.1;

  // Build entries: [move, visits]
  const entries = legalMoves.map(m => {
    const key = moveToKey(m);
    return [m, rootVisits[key] || 0];
  }).filter(([, v]) => v > 0);

  if (entries.length === 0) return move;

  if (temperature < 0.05) {
    // Pure greedy
    return entries.reduce((best, e) => e[1] > best[1] ? e : best)[0];
  }

  const scaled = entries.map(([m, v]) => [m, Math.pow(v, 1.0 / temperature)]);
  const total = scaled.reduce((s, [, v]) => s + v, 0);
  if (total === 0) return entries[0][0];

  let r = Math.random() * total;
  let cum = 0;
  for (const [m, val] of scaled) {
    cum += val;
    if (r < cum) return m;
  }
  return entries[entries.length - 1][0];
}

async function main() {
  const { default: ZertzBoard } = await import(resolve(srcDir, 'ZertzBoard.js'));
  const { MCTS, applyMove } = await import(resolve(srcDir, 'engine', 'mcts.js'));
  const { extractFeatures } = await import(resolve(srcDir, 'engine', 'features.js'));

  // Load NN model if needed
  let valueNetwork = null;
  if (MODE === 'nn' || MODE === 'mixed') {
    if (!MODEL) {
      console.error('Error: --model required for nn/mixed mode');
      process.exit(1);
    }
    const { ValueNetwork } = await import(resolve(srcDir, 'engine', 'valueNetworkNode.js'));
    valueNetwork = new ValueNetwork();
    const modelPath = resolve(projectDir, MODEL);
    const loaded = await valueNetwork.load(modelPath);
    if (!loaded) {
      console.error(`Failed to load model: ${modelPath}`);
      process.exit(1);
    }
    console.log(`Loaded NN model: ${modelPath} (policy: ${valueNetwork.hasPolicy})`);
  }

  // Compute output path
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const outputPath = OUTPUT
    ? resolve(projectDir, OUTPUT)
    : resolve(projectDir, OUTPUT_DIR, `selfplay-${timestamp}.ndjson`);

  const { mkdirSync } = await import('fs');
  const { dirname: pathDirname } = await import('path');
  mkdirSync(pathDirname(outputPath), { recursive: true });

  const stream = createWriteStream(outputPath);

  console.log(`\nZertz Training Data Generation`);
  console.log(`Games: ${NUM_GAMES} | Sims: ${SIMS} (ramp: ${Math.max(5, Math.floor(SIMS/4))} for first ${RAMP_MOVES} moves) | Mode: ${MODE}`);
  console.log(`Temperature: t=1.0 for moves 1-${TEMP_MOVES}, t=0.1 after | Output: ${outputPath}`);
  console.log('─'.repeat(50));

  let totalPositions = 0;
  const totalStart = performance.now();

  for (let g = 0; g < NUM_GAMES; g++) {
    const board = new ZertzBoard({ skipInitialHistory: true });

    let evalMode = 'heuristic';
    if (MODE === 'nn') {
      evalMode = 'nn';
    } else if (MODE === 'mixed') {
      evalMode = g % 2 === 0 ? 'heuristic' : 'nn';
    }

    const mctsOpts = evalMode === 'nn'
      ? { evaluationMode: 'nn', valueNetwork }
      : { evaluationMode: 'heuristic' };
    const mcts = new MCTS(mctsOpts);

    let moveCount = 0;
    const gameStart = performance.now();

    // Buffer positions: { board, meta, policy, currentPlayer }
    const positionBuffer = [];

    while (board.gamePhase !== 'game-over' && moveCount < MAX_MOVES) {
      const sims = moveCount < RAMP_MOVES ? Math.max(5, Math.floor(SIMS / 4)) : SIMS;

      // Extract features before move
      const { board: boardFeatures, meta: metaFeatures } = extractFeatures(board);

      // Run MCTS
      const bestMove = await mcts.getBestMove(board, sims);
      if (!bestMove) break;

      // Extract policy target from visit counts
      const policyTarget = extractPolicyTarget(bestMove);

      positionBuffer.push({
        board: Array.from(boardFeatures),
        meta: Array.from(metaFeatures),
        policy: Array.from(policyTarget),
        player: board.currentPlayer,
      });

      // Temperature-based move selection for exploration
      const selectedMove = selectWithTemperature(bestMove, moveCount);
      applyMove(board, selectedMove);
      moveCount++;
    }

    // Determine outcome
    const winner = board.winner;
    if (!winner) {
      const elapsed = ((performance.now() - gameStart) / 1000).toFixed(1);
      console.log(`  Game ${g + 1}: draw in ${moveCount} moves (${elapsed}s) — skipped`);
      continue;
    }

    // Label positions with value and write
    for (const pos of positionBuffer) {
      const value = pos.player === winner ? 1.0 : -1.0;
      const line = JSON.stringify({
        board: pos.board,
        meta: pos.meta,
        value,
        policy: pos.policy,
      });
      stream.write(line + '\n');
    }

    totalPositions += positionBuffer.length;
    const elapsed = ((performance.now() - gameStart) / 1000).toFixed(1);
    console.log(
      `  Game ${g + 1}: P${winner} wins in ${moveCount} moves (${elapsed}s, ${positionBuffer.length} pos) [${evalMode}]`
    );
  }

  stream.end();
  const totalElapsed = ((performance.now() - totalStart) / 1000).toFixed(1);

  console.log('─'.repeat(50));
  console.log(`Total positions: ${totalPositions}`);
  console.log(`Total time: ${totalElapsed}s`);
  console.log(`Output: ${outputPath}`);
}

main().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
