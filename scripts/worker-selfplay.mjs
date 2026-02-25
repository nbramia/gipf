#!/usr/bin/env node
// worker-selfplay.mjs — Worker process for parallel self-play data generation.
// Spawned by parallel-selfplay.mjs via child_process.fork().
// Reads config from env vars, writes output to a dedicated file, reports progress to parent.

import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';
import { createWriteStream } from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const srcDir = resolve(__dirname, '..', 'src', 'games', 'yinsh');
const projectDir = resolve(__dirname, '..');

const WORKER_ID = parseInt(process.env.WORKER_ID || '0', 10);
const NUM_GAMES = parseInt(process.env.GAMES || '10', 10);
const SIMS = parseInt(process.env.SIMS || '200', 10);
const MODE = process.env.MODE || 'nn';
const MODEL_PATH = process.env.MODEL ? resolve(projectDir, process.env.MODEL) : null;
const OUTPUT = process.env.OUTPUT || `data/w${WORKER_ID}.ndjson`;
const RAMP_MOVES = parseInt(process.env.RAMP || '10', 10);
const TEMP_MOVES = parseInt(process.env.TEMP_MOVES || '15', 10);
const MAX_MOVES = 100;

function send(msg) {
  if (process.send) process.send(msg);
}

function extractPolicyTarget(rootNode) {
  const policyTarget = new Float32Array(121);
  if (!rootNode || !rootNode.children || rootNode.children.size === 0) return policyTarget;

  for (const [moveKey, child] of rootNode.children.entries()) {
    const move = JSON.parse(moveKey);
    let destQ, destR;
    if (move.end) [destQ, destR] = move.end;
    else if (move.start) [destQ, destR] = move.start;
    else if (move.row && move.row.length > 0) [destQ, destR] = move.row[0];
    else continue;
    const idx = (destR + 5) * 11 + (destQ + 5);
    if (idx >= 0 && idx < 121) policyTarget[idx] += child.visits;
  }

  const total = policyTarget.reduce((a, b) => a + b, 0);
  if (total > 0) for (let i = 0; i < 121; i++) policyTarget[i] /= total;
  return policyTarget;
}

function selectWithTemperature(rootNode, moveNumber) {
  const entries = [...rootNode.children.entries()];
  if (entries.length === 0) return null;

  const temperature = moveNumber <= TEMP_MOVES ? 1.0 : 0.1;
  if (temperature < 0.05) {
    return entries.reduce((best, e) => e[1].visits > best[1].visits ? e : best);
  }

  const scaled = entries.map(([k, c]) => [k, Math.pow(c.visits, 1.0 / temperature)]);
  const total = scaled.reduce((s, [, v]) => s + v, 0);
  if (total === 0) return entries[0];

  let r = Math.random() * total, cum = 0;
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

  let valueNetwork = null;
  if ((MODE === 'nn' || MODE === 'mixed') && MODEL_PATH) {
    const vnModule = await import(resolve(srcDir, 'engine', 'valueNetworkNode.js'));
    const { ValueNetwork } = vnModule;
    valueNetwork = new ValueNetwork();
    const loaded = await valueNetwork.load(MODEL_PATH);
    if (!loaded) {
      send({ type: 'error', workerId: WORKER_ID, error: `Failed to load model: ${MODEL_PATH}` });
      process.exit(1);
    }
  }

  const STANDARD_RINGS = {
    1: [[0, -2], [-2, 0], [2, -2], [-1, -1], [1, -1]],
    2: [[0, 2], [2, 0], [-2, 2], [1, 1], [-1, 1]]
  };

  const VALID_POSITIONS = [];
  for (let q = -5; q <= 5; q++) {
    for (let r = -5; r <= 5; r++) {
      if (Math.abs(q + r) <= 5) VALID_POSITIONS.push([q, r]);
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

  const outputPath = resolve(projectDir, OUTPUT);
  const stream = createWriteStream(outputPath);
  let totalPositions = 0;

  send({ type: 'started', workerId: WORKER_ID, games: NUM_GAMES });

  for (let g = 0; g < NUM_GAMES; g++) {
    const useRandom = g % 2 === 1;
    const board = setupBoard(useRandom);

    const evalMode = MODE === 'nn' ? 'nn' : (MODE === 'mixed' ? (g % 2 === 0 ? 'heuristic' : 'nn') : 'heuristic');
    const mctsOpts = evalMode === 'nn'
      ? { evaluationMode: 'nn', valueNetwork }
      : { evaluationMode: 'heuristic' };
    const mcts = new MCTS(100000, mctsOpts);

    let moveCount = 0;
    const positionBuffer = [];

    while (moveCount < MAX_MOVES) {
      const winner = board.isGameOver();
      if (winner) break;
      if (board.getGamePhase() === 'game-over') break;

      const phase = board.getGamePhase();
      const sims = moveCount < RAMP_MOVES ? Math.max(5, Math.floor(SIMS / 4)) : SIMS;
      const result = await mcts.getBestMove(board, sims);
      if (!result) break;

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

      let selectedMove;
      if (phase === 'play' && result.rootNode && result.rootNode.children.size > 0) {
        const selected = selectWithTemperature(result.rootNode, moveCount);
        if (selected) {
          const move = JSON.parse(selected[0]);
          selectedMove = { from: move.start || null, to: move.end || null, type: move.type || 'move', row: move.row || null };
        } else {
          selectedMove = { from: result.move || null, to: result.destination || null, type: result.type || 'move', row: result.row || null };
        }
      } else {
        selectedMove = { from: result.move || null, to: result.destination || null, type: result.type || 'move', row: result.row || null };
      }

      applyAIMove(board, selectedMove);
      moveCount++;
    }

    const winner = board.isGameOver();
    if (winner) {
      for (const pos of positionBuffer) {
        const value = pos.currentPlayer === winner ? 1.0 : -1.0;
        stream.write(JSON.stringify({ board: pos.board, meta: pos.meta, value, policy: pos.policy }) + '\n');
      }
      totalPositions += positionBuffer.length;
    }

    send({ type: 'game_complete', workerId: WORKER_ID, game: g + 1, total: NUM_GAMES, positions: positionBuffer.length, winner });
  }

  await new Promise((resolve, reject) => {
    stream.end(() => resolve());
    stream.on('error', reject);
  });
  send({ type: 'done', workerId: WORKER_ID, positions: totalPositions });
}

main().catch(err => {
  send({ type: 'error', workerId: WORKER_ID, error: err.message });
  console.error(`[Worker ${WORKER_ID}] Fatal:`, err);
  process.exit(1);
});
