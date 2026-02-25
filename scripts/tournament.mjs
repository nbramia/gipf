#!/usr/bin/env node
// tournament.mjs — Head-to-head comparison between MCTS engines.
// Supports: heuristic-vs-nn (default), nn-vs-nn mode, and SPRT early termination.
//
// Usage: node scripts/tournament.mjs --games 5 --sims 50 --model public/models/yinsh-value-v1.onnx
//        node scripts/tournament.mjs --games 5 --sims 50 --mode nn-vs-nn --model1 v2.onnx --model2 v1.onnx
//        node scripts/tournament.mjs --games 10 --sims 50 --mode nn-vs-nn --model1 v2.onnx --model2 v1.onnx --sprt

import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';

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
function hasFlag(name) {
  return args.includes(`--${name}`);
}

const GAMES_PER_SIDE = parseInt(getArg('games', '5'), 10);
const SIMS = parseInt(getArg('sims', '50'), 10);
const MODE = getArg('mode', 'heuristic-vs-nn'); // heuristic-vs-nn | nn-vs-nn
const MODEL_PATH = resolve(projectDir, getArg('model', 'public/models/yinsh-value-v1.onnx'));
const MODEL1_PATH = getArg('model1', null) ? resolve(projectDir, getArg('model1', '')) : null;
const MODEL2_PATH = getArg('model2', null) ? resolve(projectDir, getArg('model2', '')) : null;
const USE_SPRT = hasFlag('sprt');
const SPRT_MAX_GAMES = 40; // Safety cap for SPRT
const MAX_MOVES = 100;

/**
 * Sequential Probability Ratio Test (SPRT).
 * H0: p = p0 (no improvement), H1: p = p1 (improvement).
 * Returns 'accept' (model1 is better), 'reject' (no improvement), or 'continue'.
 */
function sprtDecision(wins, losses, p0 = 0.5, p1 = 0.55, alpha = 0.05, beta = 0.10) {
  if (wins + losses === 0) return 'continue';
  const llr = wins * Math.log(p1 / p0) + losses * Math.log((1 - p1) / (1 - p0));
  const upper = Math.log((1 - beta) / alpha);  // ~2.89
  const lower = Math.log(beta / (1 - alpha));   // ~-2.25
  if (llr >= upper) return 'accept';
  if (llr <= lower) return 'reject';
  return 'continue';
}

async function main() {
  const { default: YinshBoard } = await import(resolve(srcDir, 'YinshBoard.js'));
  const { default: MCTS } = await import(resolve(srcDir, 'engine', 'mcts.js'));
  const { getAIMove, applyAIMove } = await import(resolve(srcDir, 'engine', 'aiPlayer.js'));
  const vnModule = await import(resolve(srcDir, 'engine', 'valueNetworkNode.js'));
  const { ValueNetwork } = vnModule;

  let player1Label, player2Label;
  let mcts1Factory, mcts2Factory;

  if (MODE === 'nn-vs-nn') {
    if (!MODEL1_PATH || !MODEL2_PATH) {
      console.error('Error: --model1 and --model2 required for nn-vs-nn mode');
      process.exit(1);
    }

    const vn1 = new ValueNetwork();
    const vn2 = new ValueNetwork();
    if (!(await vn1.load(MODEL1_PATH))) { console.error(`Failed to load model1: ${MODEL1_PATH}`); process.exit(1); }
    if (!(await vn2.load(MODEL2_PATH))) { console.error(`Failed to load model2: ${MODEL2_PATH}`); process.exit(1); }
    console.log(`Model 1: ${MODEL1_PATH}`);
    console.log(`Model 2: ${MODEL2_PATH}`);

    player1Label = 'Model1';
    player2Label = 'Model2';
    mcts1Factory = () => new MCTS(100000, { evaluationMode: 'nn', valueNetwork: vn1 });
    mcts2Factory = () => new MCTS(100000, { evaluationMode: 'nn', valueNetwork: vn2 });
  } else {
    // heuristic-vs-nn
    const vn = new ValueNetwork();
    if (!(await vn.load(MODEL_PATH))) { console.error(`Failed to load model: ${MODEL_PATH}`); process.exit(1); }
    console.log(`Loaded model: ${MODEL_PATH}`);

    player1Label = 'Heuristic';
    player2Label = 'NN';
    mcts1Factory = () => new MCTS(100000, { evaluationMode: 'heuristic' });
    mcts2Factory = () => new MCTS(100000, { evaluationMode: 'nn', valueNetwork: vn });
  }

  // Standard ring setup
  const STANDARD_RINGS = {
    1: [[0, -2], [-2, 0], [2, -2], [-1, -1], [1, -1]],
    2: [[0, 2], [2, 0], [-2, 2], [1, 1], [-1, 1]]
  };

  function setupBoard() {
    const board = new YinshBoard({ skipInitialHistory: true });
    for (const player of [1, 2]) {
      for (const [q, r] of STANDARD_RINGS[player]) {
        board.boardState[`${q},${r}`] = { type: 'ring', player };
        board.ringsPlaced[player]++;
      }
    }
    board.gamePhase = 'play';
    board.currentPlayer = 1;
    board._captureState();
    return board;
  }

  async function playGame(p1Mcts, p2Mcts) {
    const board = setupBoard();
    const engines = { 1: p1Mcts, 2: p2Mcts };

    let moveCount = 0;
    const start = performance.now();

    while (moveCount < MAX_MOVES) {
      const winner = board.isGameOver();
      if (winner) return { winner, moves: moveCount, elapsed: performance.now() - start };
      if (board.getGamePhase() === 'game-over') break;

      const currentPlayer = board.getCurrentPlayer();
      const mcts = engines[currentPlayer];
      const move = await getAIMove(mcts, board, SIMS);
      if (!move) break;

      applyAIMove(board, move);
      moveCount++;
    }

    const winner = board.isGameOver();
    return { winner: winner || null, moves: moveCount, elapsed: performance.now() - start };
  }

  const totalGamesMax = USE_SPRT ? SPRT_MAX_GAMES : GAMES_PER_SIDE * 2;
  console.log(`\nTournament: ${player1Label} vs ${player2Label}`);
  console.log(`Games per side: ${GAMES_PER_SIDE} | Sims: ${SIMS} | Max moves: ${MAX_MOVES}${USE_SPRT ? ' | SPRT enabled (max ' + SPRT_MAX_GAMES + ')' : ''}`);
  console.log('═'.repeat(60));

  const results = { p1: 0, p2: 0, draw: 0 };
  let totalGamesPlayed = 0;
  let sprtResult = null;

  if (USE_SPRT) {
    // SPRT mode: interleave sides, check after each game
    console.log(`\nSPRT Tournament (interleaved, early termination)`);
    console.log('─'.repeat(60));

    for (let g = 0; g < SPRT_MAX_GAMES; g++) {
      // Alternate sides: even games = P1 white, odd = P2 white
      const p1AsWhite = g % 2 === 0;
      const { winner, moves, elapsed } = p1AsWhite
        ? await playGame(mcts1Factory(), mcts2Factory())
        : await playGame(mcts2Factory(), mcts1Factory());
      const sec = (elapsed / 1000).toFixed(1);
      totalGamesPlayed++;

      let resultStr;
      if (p1AsWhite) {
        if (winner === 1) { results.p1++; resultStr = `${player1Label} wins`; }
        else if (winner === 2) { results.p2++; resultStr = `${player2Label} wins`; }
        else { results.draw++; resultStr = 'Draw'; }
      } else {
        if (winner === 1) { results.p2++; resultStr = `${player2Label} wins`; }
        else if (winner === 2) { results.p1++; resultStr = `${player1Label} wins`; }
        else { results.draw++; resultStr = 'Draw'; }
      }

      // Draws count as 0.5 win for each
      const p1Wins = results.p1 + results.draw * 0.5;
      const p2Wins = results.p2 + results.draw * 0.5;
      const decision = sprtDecision(p1Wins, p2Wins);

      console.log(`  Game ${g + 1}: ${resultStr} in ${moves} moves (${sec}s) [${p1AsWhite ? 'P1 white' : 'P2 white'}] — Score: ${results.p1}-${results.p2} (${results.draw} draws) SPRT: ${decision}`);

      if (decision !== 'continue') {
        sprtResult = decision;
        console.log(`\nSPRT terminated: ${decision}`);
        break;
      }
    }
  } else {
    // Original fixed-game mode
    // Round 1: P1 as white, P2 as black
    console.log(`\nRound 1: ${player1Label} (white) vs ${player2Label} (black)`);
    console.log('─'.repeat(60));

    for (let g = 0; g < GAMES_PER_SIDE; g++) {
      const { winner, moves, elapsed } = await playGame(mcts1Factory(), mcts2Factory());
      const sec = (elapsed / 1000).toFixed(1);
      totalGamesPlayed++;

      let result;
      if (winner === 1) { results.p1++; result = `${player1Label} wins`; }
      else if (winner === 2) { results.p2++; result = `${player2Label} wins`; }
      else { results.draw++; result = 'Draw'; }

      console.log(`  Game ${g + 1}: ${result} in ${moves} moves (${sec}s)`);
    }

    // Round 2: P2 as white, P1 as black
    console.log(`\nRound 2: ${player2Label} (white) vs ${player1Label} (black)`);
    console.log('─'.repeat(60));

    for (let g = 0; g < GAMES_PER_SIDE; g++) {
      const { winner, moves, elapsed } = await playGame(mcts2Factory(), mcts1Factory());
      const sec = (elapsed / 1000).toFixed(1);
      totalGamesPlayed++;

      let result;
      if (winner === 1) { results.p2++; result = `${player2Label} wins`; }
      else if (winner === 2) { results.p1++; result = `${player1Label} wins`; }
      else { results.draw++; result = 'Draw'; }

      console.log(`  Game ${g + 1}: ${result} in ${moves} moves (${sec}s)`);
    }
  }

  // Summary
  console.log('\n' + '═'.repeat(60));
  console.log(`Results (${totalGamesPlayed} games):`);
  console.log(`  ${player1Label}: ${results.p1} wins (${(results.p1 / totalGamesPlayed * 100).toFixed(0)}%)`);
  console.log(`  ${player2Label}: ${results.p2} wins (${(results.p2 / totalGamesPlayed * 100).toFixed(0)}%)`);
  console.log(`  Draws:     ${results.draw}`);
  if (sprtResult) {
    console.log(`  SPRT:      ${sprtResult} (after ${totalGamesPlayed} games)`);
  }
  console.log('═'.repeat(60));

  if (results.p1 > results.p2) {
    console.log(`\n${player1Label} wins the tournament.`);
  } else if (results.p2 > results.p1) {
    console.log(`\n${player2Label} wins the tournament!`);
  } else {
    console.log(`\nTournament tied.`);
  }

  // Exit code: 0 if p1 wins, 1 if p2 wins, 2 if tie
  // For SPRT: accept=0, reject=1
  if (USE_SPRT && sprtResult) {
    process.exit(sprtResult === 'accept' ? 0 : 1);
  }
  process.exit(results.p1 > results.p2 ? 0 : results.p1 === results.p2 ? 2 : 1);
}

main().catch(err => {
  console.error('Tournament error:', err);
  process.exit(1);
});
