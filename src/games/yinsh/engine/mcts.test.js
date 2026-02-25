// mcts.test.js
// AI engine test — validates heuristic winning move detection

import MCTS from './mcts.js';
import { createBoardWithSetup, placeMarkers } from '../testHelpers.js';

// Suppress MCTS console noise during tests
beforeAll(() => {
  jest.spyOn(console, 'log').mockImplementation(() => {});
  jest.spyOn(console, 'error').mockImplementation(() => {});
});

afterAll(() => {
  console.log.mockRestore();
  console.error.mockRestore();
});

describe('MCTS — Tactical Positions', () => {
  test('finds winning move (5-in-a-row completion)', async () => {
    const mcts = new MCTS();
    // P1 has 4 markers in a row [0,0]-[3,0], ring at [4,0]
    // Moving ring away from [4,0] leaves a marker, completing the 5-in-a-row
    const board = createBoardWithSetup([
      { player: 1, positions: [[4,0], [-3,-2], [-2,-3], [-1,-4], [0,-4]] },
      { player: 2, positions: [[-4,1], [-3,2], [-2,3], [-1,4], [0,4]] }
    ]);
    placeMarkers(board, [[0,0], [1,0], [2,0], [3,0]], 1);
    board.currentPlayer = 1;

    const result = await mcts.getBestMove(board, 20);

    expect(result).not.toBeNull();
    expect(result.move).toEqual([4, 0]);
    expect(result.confidence).toBe(1.0);
  }, 30000);
});
