#!/usr/bin/env node
// Explicit candidate-versus-incumbent gate; heuristic is a separate benchmark.
import ZertzBoard from '../../src/games/zertz/ZertzBoard.js';
import { MCTS, applyMove } from '../../src/games/zertz/engine/mcts.js';
import { ValueNetwork } from '../../src/games/zertz/engine/valueNetworkNode.js';

const args = process.argv.slice(2);
function getArg(name, fallback) {
  const index = args.indexOf(`--${name}`);
  return index >= 0 ? args[index + 1] : fallback;
}
const games = Number(getArg('games', '10'));
const sims = Number(getArg('sims', '100'));
const mode = getArg('mode', 'nn-vs-nn');

async function loadModel(path, label) {
  if (!path) throw new Error(`${label} model path required`);
  const network = new ValueNetwork();
  if (!(await network.load(path)) || !network.isLoaded()) throw new Error(`Failed to load ${label}: ${path}`);
  // A parseable ONNX file with incompatible inputs/outputs must also fail closed.
  const result = await network.evaluatePositionWithPolicy(new ZertzBoard({ skipInitialHistory: true }));
  if (!Number.isFinite(result.value) || (result.policy && !result.policy.every(Number.isFinite))) {
    throw new Error(`Invalid ${label} inference`);
  }
  return network;
}

async function main() {
  if (!['nn-vs-nn', 'heuristic-vs-nn'].includes(mode)) throw new Error('Invalid tournament mode');
  if (!Number.isInteger(games) || games < 2 || games % 2 || !Number.isInteger(sims) || sims < 1) {
    throw new Error('Use a positive even game count and positive simulations');
  }
  const candidate = await loadModel(getArg('model1', getArg('model', null)), 'candidate');
  const incumbent = mode === 'nn-vs-nn' ? await loadModel(getArg('model2', null), 'incumbent') : null;
  const results = { candidate: 0, opponent: 0, draws: 0 };
  for (let game = 0; game < games; game++) {
    const candidateSide = game % 2 + 1;
    const board = new ZertzBoard({ skipInitialHistory: true });
    const candidateMcts = new MCTS({ evaluationMode: 'nn', valueNetwork: candidate });
    const opponentMcts = new MCTS(incumbent
      ? { evaluationMode: 'nn', valueNetwork: incumbent }
      : { evaluationMode: 'heuristic' });
    let moves = 0;
    while (board.gamePhase !== 'game-over' && moves < 200) {
      const mcts = board.currentPlayer === candidateSide ? candidateMcts : opponentMcts;
      const move = await mcts.getBestMove(board, sims);
      if (!move) throw new Error('No move before terminal state');
      applyMove(board, move);
      moves++;
    }
    if (board.winner == null) results.draws++;
    else if (board.winner === candidateSide) results.candidate++;
    else results.opponent++;
    console.log(`Game ${game + 1}: candidate=P${candidateSide}, winner=${board.winner}, moves=${moves}`);
  }
  console.log(`Results (${mode}): ${JSON.stringify(results)}`);
  // A strict majority of all games is required, including draws in the denominator.
  process.exitCode = results.candidate > games / 2 ? 0 : 1;
}
main().catch(error => { console.error(error); process.exitCode = 1; });
