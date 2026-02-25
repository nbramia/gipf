// mcts.benchmark.test.js
// Speed benchmark tests for MCTS engine. Catches catastrophic regressions.

import MCTS from './mcts.js';
import YinshBoard from '../YinshBoard.js';
import testPositions from './testPositions.js';
import { createBoardWithSetup, placeMarkers } from '../testHelpers.js';

// Use the flip-opponent-markers position — has ~25 legal moves, good complexity
const BENCHMARK_POS = testPositions.find(p => p.id === 'flip-opponent-markers');

function buildBoard(pos) {
  const board = createBoardWithSetup([
    { player: 1, positions: pos.rings[1] },
    { player: 2, positions: pos.rings[2] }
  ]);

  for (const player of [1, 2]) {
    if (pos.markers[player] && pos.markers[player].length > 0) {
      placeMarkers(board, pos.markers[player], player);
    }
  }

  board.currentPlayer = pos.player;
  board.gamePhase = 'play';
  return board;
}

describe('MCTS Speed Benchmark', () => {
  let mcts;

  beforeAll(() => {
    mcts = new MCTS();
  });

  test('getBestMove at 50 sims completes under 5s', async () => {
    const board = buildBoard(BENCHMARK_POS);

    const start = performance.now();
    const result = await mcts.getBestMove(board, 50);
    const elapsed = performance.now() - start;

    console.log(`  50 sims: ${elapsed.toFixed(0)}ms`);

    expect(result).not.toBeNull();
    expect(elapsed).toBeLessThan(5000);
  }, 10000);

  test('getBestMove at 200 sims completes under 15s', async () => {
    const board = buildBoard(BENCHMARK_POS);

    const start = performance.now();
    const result = await mcts.getBestMove(board, 200);
    const elapsed = performance.now() - start;

    console.log(`  200 sims: ${elapsed.toFixed(0)}ms`);

    expect(result).not.toBeNull();
    expect(elapsed).toBeLessThan(15000);
  }, 20000);
});
