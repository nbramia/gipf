#!/usr/bin/env node
// generate-training-data.mjs — Self-play with feature extraction for policy-value network training.
// Outputs NDJSON with: board, meta, value, policy (visit distribution)
//
// Usage: node scripts/generate-training-data.mjs --games 50 --sims 200 --output data/train.ndjson
//        node scripts/generate-training-data.mjs --games 50 --sims 200 --mode nn --model public/models/yinsh-value-v1.onnx

import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';
import { createWriteStream } from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const srcDir = resolve(__dirname, '..', 'src', 'games', 'yinsh');
const projectDir = resolve(__dirname, '..');

// Parse CLI args
const args = process.argv.slice(2);
function getArg(name, defaultVal) {
  const idx = args.indexOf(`--${name}`);
  if (idx !== -1 && args[idx + 1]) return args[idx + 1];
  return defaultVal;
}

const NUM_GAMES = parseInt(getArg('games', '200'), 10);
const SIMS = parseInt(getArg('sims', '200'), 10);
const OUTPUT = getArg('output', 'data/train.ndjson');
const MODE = getArg('mode', 'heuristic'); // heuristic | nn | mixed
const MODEL = getArg('model', null);
const RAMP_MOVES = parseInt(getArg('ramp', '10'), 10);
const TEMP_MOVES = parseInt(getArg('temperature-moves', '15'), 10);
const MAX_MOVES = 100;

/**
 * Extract policy target (visit distribution) from MCTS root node.
 * Returns Float32Array(121) representing normalized visit counts over the 11x11 grid.
 */
function extractPolicyTarget(rootNode) {
  const policyTarget = new Float32Array(121);
  if (!rootNode || !rootNode.children || rootNode.children.size === 0) {
    return policyTarget;
  }

  for (const [moveKey, child] of rootNode.children.entries()) {
    const move = JSON.parse(moveKey);
    let destQ, destR;
    if (move.end) {
      [destQ, destR] = move.end;
    } else if (move.start) {
      [destQ, destR] = move.start;
    } else if (move.row && move.row.length > 0) {
      [destQ, destR] = move.row[0];
    } else {
      continue;
    }
    const idx = (destR + 5) * 11 + (destQ + 5);
    if (idx >= 0 && idx < 121) {
      policyTarget[idx] += child.visits;
    }
  }

  // Normalize
  const total = policyTarget.reduce((a, b) => a + b, 0);
  if (total > 0) {
    for (let i = 0; i < 121; i++) policyTarget[i] /= total;
  }

  return policyTarget;
}

/**
 * Temperature-based move selection from MCTS root node visit counts.
 * Move 1-TEMP_MOVES: temperature=1.0 (proportional to visits)
 * Move TEMP_MOVES+1+: temperature=0.1 (near-greedy)
 */
function selectWithTemperature(rootNode, moveNumber) {
  const entries = [...rootNode.children.entries()];
  if (entries.length === 0) return null;

  const temperature = moveNumber <= TEMP_MOVES ? 1.0 : 0.1;

  if (temperature < 0.05) {
    // Pure greedy
    return entries.reduce((best, e) => e[1].visits > best[1].visits ? e : best);
  }

  const scaled = entries.map(([k, c]) => [k, Math.pow(c.visits, 1.0 / temperature)]);
  const total = scaled.reduce((s, [, v]) => s + v, 0);
  if (total === 0) return entries[0];

  let r = Math.random() * total;
  let cum = 0;
  for (const [key, val] of scaled) {
    cum += val;
    if (r < cum) return [key, rootNode.children.get(key)];
  }
  return entries[entries.length - 1];
}

async function main() {
  const { default: YinshBoard } = await import(resolve(srcDir, 'YinshBoard.js'));
  const { default: MCTS } = await import(resolve(srcDir, 'engine', 'mcts.js'));
  const { applyAIMove } = await import(resolve(srcDir, 'engine', 'aiPlayer.js'));
  const { extractFeatures } = await import(resolve(srcDir, 'engine', 'features.js'));

  // Load NN model if needed
  let valueNetwork = null;
  if (MODE === 'nn' || MODE === 'mixed') {
    if (!MODEL) {
      console.error('Error: --model required for nn/mixed mode');
      process.exit(1);
    }
    const vnModule = await import(resolve(srcDir, 'engine', 'valueNetworkNode.js'));
    const { ValueNetwork } = vnModule;
    valueNetwork = new ValueNetwork();
    const modelPath = resolve(projectDir, MODEL);
    const loaded = await valueNetwork.load(modelPath);
    if (!loaded) {
      console.error(`Failed to load model: ${modelPath}`);
      process.exit(1);
    }
    console.log(`Loaded NN model: ${modelPath} (policy: ${valueNetwork.hasPolicy})`);
  }

  // Standard ring setup
  const STANDARD_RINGS = {
    1: [[0, -2], [-2, 0], [2, -2], [-1, -1], [1, -1]],
    2: [[0, 2], [2, 0], [-2, 2], [1, 1], [-1, 1]]
  };

  // Random ring positions for diversity
  const VALID_POSITIONS = [];
  for (let q = -5; q <= 5; q++) {
    for (let r = -5; r <= 5; r++) {
      if (Math.abs(q + r) <= 5) {
        VALID_POSITIONS.push([q, r]);
      }
    }
  }

  function setupBoard(useRandom) {
    const board = new YinshBoard({ skipInitialHistory: true });

    if (useRandom) {
      const available = [...VALID_POSITIONS];
      for (const player of [1, 2]) {
        for (let i = 0; i < 5; i++) {
          const idx = Math.floor(Math.random() * available.length);
          const [q, r] = available.splice(idx, 1)[0];
          board.boardState[`${q},${r}`] = { type: 'ring', player };
          board.ringsPlaced[player]++;
        }
      }
    } else {
      for (const player of [1, 2]) {
        for (const [q, r] of STANDARD_RINGS[player]) {
          board.boardState[`${q},${r}`] = { type: 'ring', player };
          board.ringsPlaced[player]++;
        }
      }
    }

    board.gamePhase = 'play';
    board.currentPlayer = 1;
    board._captureState();
    return board;
  }

  const outputPath = resolve(__dirname, '..', OUTPUT);
  const stream = createWriteStream(outputPath);

  console.log(`\nTraining Data Generation`);
  console.log(`Games: ${NUM_GAMES} | Sims: ${SIMS} (ramp: ${Math.max(5, Math.floor(SIMS/4))} for first ${RAMP_MOVES} moves) | Mode: ${MODE}`);
  console.log(`Temperature: t=1.0 for moves 1-${TEMP_MOVES}, t=0.1 after | Output: ${OUTPUT}`);
  console.log('─'.repeat(50));

  let totalPositions = 0;
  const totalStart = performance.now();

  for (let g = 0; g < NUM_GAMES; g++) {
    const useRandom = g % 2 === 1;
    const board = setupBoard(useRandom);

    let evalMode = 'heuristic';
    if (MODE === 'nn') {
      evalMode = 'nn';
    } else if (MODE === 'mixed') {
      evalMode = g % 2 === 0 ? 'heuristic' : 'nn';
    }

    const mctsOpts = evalMode === 'nn'
      ? { evaluationMode: 'nn', valueNetwork }
      : { evaluationMode: 'heuristic' };
    const mcts = new MCTS(100000, mctsOpts);

    let moveCount = 0;
    const gameStart = performance.now();

    // Buffer positions: { board, meta, policy, currentPlayer }
    const positionBuffer = [];

    while (moveCount < MAX_MOVES) {
      const winner = board.isGameOver();
      if (winner) break;
      if (board.getGamePhase() === 'game-over') break;

      const phase = board.getGamePhase();
      const sims = moveCount < RAMP_MOVES ? Math.max(5, Math.floor(SIMS / 4)) : SIMS;

      // Run MCTS to get rootNode with visit counts
      const result = await mcts.getBestMove(board, sims);
      if (!result) break;

      // Record position + policy target during play phase
      if (phase === 'play' && result.rootNode) {
        const features = extractFeatures(board);
        const policyTarget = extractPolicyTarget(result.rootNode);

        positionBuffer.push({
          board: Array.from(features.board),
          meta: Array.from(features.meta),
          policy: Array.from(policyTarget),
          currentPlayer: board.getCurrentPlayer()
        });
      }

      // Temperature-based move selection for self-play (only during play phase)
      let selectedMove;
      if (phase === 'play' && result.rootNode && result.rootNode.children.size > 0) {
        const selected = selectWithTemperature(result.rootNode, moveCount);
        if (selected) {
          const move = JSON.parse(selected[0]);
          selectedMove = {
            from: move.start || null,
            to: move.end || null,
            type: move.type || 'move',
            row: move.row || null
          };
        } else {
          selectedMove = {
            from: result.move || null,
            to: result.destination || null,
            type: result.type || 'move',
            row: result.row || null
          };
        }
      } else {
        // Non-play phases: use best move directly
        selectedMove = {
          from: result.move || null,
          to: result.destination || null,
          type: result.type || 'move',
          row: result.row || null
        };
      }

      applyAIMove(board, selectedMove);
      moveCount++;
    }

    // Determine game outcome
    const winner = board.isGameOver();
    if (!winner) {
      const elapsed = ((performance.now() - gameStart) / 1000).toFixed(1);
      console.log(`  Game ${g + 1}: draw in ${moveCount} moves (${elapsed}s) — skipped`);
      continue;
    }

    // Label positions with value and write
    for (const pos of positionBuffer) {
      const value = pos.currentPlayer === winner ? 1.0 : -1.0;
      const line = JSON.stringify({
        board: pos.board,
        meta: pos.meta,
        value,
        policy: pos.policy
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
