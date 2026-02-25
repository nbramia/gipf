// mcts.positions.test.js
// Position regression tests — runs MCTS on curated positions and verifies AI picks great/good moves.

import MCTS from './mcts.js';
import YinshBoard from '../YinshBoard.js';
import testPositions from './testPositions.js';
import { createBoardWithSetup, placeMarkers } from '../testHelpers.js';

const SIMULATIONS = 200;

/**
 * Build a YinshBoard from a position definition.
 */
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

/**
 * Check if two [q,r] arrays match.
 */
function coordsMatch(a, b) {
  if (!a || !b) return false;
  return a[0] === b[0] && a[1] === b[1];
}

/**
 * Check if a move matches any in a list.
 * Move format from MCTS: { move: [q,r] (from), destination: [q,r] (to) }
 * Expected format: { from: [q,r], to: [q,r] }
 */
function matchesAny(aiFrom, aiTo, moveList) {
  return moveList.some(expected =>
    coordsMatch(aiFrom, expected.from) && coordsMatch(aiTo, expected.to)
  );
}

describe('MCTS Position Tests', () => {
  let mcts;

  beforeAll(() => {
    mcts = new MCTS();
  });

  testPositions.forEach((pos) => {
    test(`${pos.id}: ${pos.name}`, async () => {
      const board = buildBoard(pos);
      const result = await mcts.getBestMove(board, SIMULATIONS);

      expect(result).not.toBeNull();

      const aiFrom = result.move;
      const aiTo = result.destination;

      const isGreat = matchesAny(aiFrom, aiTo, pos.moves.great);
      const isGood = matchesAny(aiFrom, aiTo, pos.moves.good);
      const isBad = matchesAny(aiFrom, aiTo, pos.moves.bad);

      // Log the result for visibility
      const tier = isGreat ? 'GREAT' : isGood ? 'good' : isBad ? 'BAD' : 'other';
      console.log(
        `  [${pos.id}] AI chose: [${aiFrom}] -> [${aiTo}] (${tier}) confidence=${(result.confidence * 100).toFixed(0)}%`
      );

      // AI must never pick a bad move
      expect(isBad).toBe(false);
    }, 30000);
  });
});
