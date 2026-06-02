import SplendorBoard from '../SplendorBoard.js';
import { MCTS } from './mcts.js';
import { CARDS, NOBLES, GEMS } from '../splendorCards.js';

// ---------------------------------------------------------------------------
// Tactical benchmark positions. Each sets up a position with an unambiguous
// best line and asserts the search finds it. These prove competence and guard
// against regressions as the engine/heuristic/NN evolve (see docs/splendor-ai-plan.md).
// ---------------------------------------------------------------------------

function freshPlayPosition(seed = 1) {
  const board = new SplendorBoard({ seed, playerCount: 2, skipInitialHistory: true });
  board._skipHistory = true;
  board.phase = 'play';
  return board;
}

// Stock a player with exactly enough tokens to afford a card (after bonuses).
function fundCard(board, playerId, card) {
  for (const gem of GEMS) {
    board.players[playerId].tokens[gem] = Math.max(0, (card.cost[gem] || 0) - board.players[playerId].bonuses[gem]);
  }
}

const findCard = pred => CARDS.find(pred);
const search = (board, sims = 350) => new MCTS({ maxChildren: 36, rolloutSteps: 24 }).getBestMove(board, sims);

describe('Splendor tactical positions', () => {
  test('takes the winning buy when one move reaches 15', async () => {
    const board = freshPlayPosition(11);
    const me = board.currentPlayer;
    const fourPt = findCard(c => c.points === 4);
    const twoPt = findCard(c => c.points === 2);
    board.players[me].cards = [fourPt.id, fourPt.id, fourPt.id, twoPt.id]; // 14 prestige

    // Put a cheap point card in the market and fund exactly it; make sure the
    // other market slots can't also be bought (empty them).
    const winCard = findCard(c => c.tier === 1 && c.points === 1);
    board.visible[1] = [winCard.id, null, null, null];
    board.visible[2] = [null, null, null, null];
    board.visible[3] = [null, null, null, null];
    fundCard(board, me, winCard);

    const move = await search(board);
    expect(board.applyMove(move)).toBe(true);
    expect(board.getVictoryPoints(me)).toBeGreaterThanOrEqual(15);
  }, 20000);

  test('buys the card that completes a noble for the win', async () => {
    const board = freshPlayPosition(12);
    const me = board.currentPlayer;
    const fivePt = findCard(c => c.points === 5);
    const twoPt = findCard(c => c.points === 2);
    board.players[me].cards = [fivePt.id, fivePt.id, twoPt.id]; // 12 prestige

    // A noble needing bonuses; give the player all but one of the needed colour.
    const noble = NOBLES.find(n => Object.keys(n.requirement).length >= 2);
    board.nobles = [noble.id];
    const needColor = Object.keys(noble.requirement)[0];
    for (const gem of GEMS) board.players[me].bonuses[gem] = noble.requirement[gem] || 0;
    board.players[me].bonuses[needColor] = (noble.requirement[needColor] || 0) - 1;

    // A 0-point card whose bonus is the missing colour, affordable now.
    const card = findCard(c => c.tier === 1 && c.points === 0 && c.bonus === needColor);
    board.visible[1] = [card.id, null, null, null];
    board.visible[2] = [null, null, null, null];
    board.visible[3] = [null, null, null, null];
    fundCard(board, me, card);

    const move = await search(board);
    expect(board.applyMove(move)).toBe(true);
    // Buying it grants the missing bonus -> the noble (+3) -> 12 + 3 = 15.
    expect(board.getVictoryPoints(me)).toBeGreaterThanOrEqual(15);
  }, 20000);

  test('prefers buying a high-prestige card over dawdling on tokens', async () => {
    const board = freshPlayPosition(13);
    const me = board.currentPlayer;
    const fivePt = findCard(c => c.points === 5);
    board.visible[3] = [fivePt.id, null, null, null];
    fundCard(board, me, fivePt);

    const move = await search(board, 400);
    expect(move.type).toBe('buy');
    expect(board.getCard(move.cardId).points).toBeGreaterThanOrEqual(4);
  }, 20000);

  test('does not discard a gold when a surplus colour is available', async () => {
    const board = freshPlayPosition(14);
    const me = board.currentPlayer;
    for (const gem of GEMS) board.players[me].tokens[gem] = 0;
    board.players[me].tokens.white = 6;
    board.players[me].tokens.blue = 4;
    board.players[me].tokens.gold = 1; // 11 total -> over the limit
    board.phase = 'discard';

    const move = await search(board, 200);
    expect(move.type).toBe('discard-token');
    expect(move.token).not.toBe('gold'); // gold (wild) is the most valuable to keep
  }, 20000);
});
