import { renderHook, waitFor } from '@testing-library/react';
import DiplomacyBoard from '../DiplomacyBoard.js';
import { createDiplomaticState } from '../agents/diplomaticState.js';
import useDiplomacyTurn from './useDiplomacyTurn.js';

const CONTROLLERS = { austria: 'AI', england: 'human', france: 'AI', germany: 'AI', italy: 'AI', russia: 'AI', turkey: 'AI' };

function aiOnlyRetreatBoard() {
  const board = new DiplomacyBoard({ maxYears: 1905 });
  delete board.units.BUD;
  board.season = 'fall';
  board.phase = 'fall-retreats';
  board.pendingRetreats = [{ unitLoc: 'BUD', unit: { power: 'austria', type: 'army' }, options: ['GAL'] }];
  return board;
}

describe('useDiplomacyTurn — automatic AI-only retreats', () => {
  test('a second game that reaches the same retreat phase resolves automatically too', async () => {
    const setBoard = jest.fn();
    const first = aiOnlyRetreatBoard();
    const state = createDiplomaticState({ board: first, humanPower: 'england' });
    const props = (board) => ({
      board,
      setBoard,
      controllers: CONTROLLERS,
      humanPower: 'england',
      difficultyBudget: { difficulty: 'easy' },
      diplomaticState: state,
      setDiplomaticState: jest.fn(),
      personas: null,
      conversations: null,
      setConversations: jest.fn(),
      workerSupported: false,
      computeOrders: null,
      onPhaseSettled: jest.fn(),
      initialUiPhase: 'retreats',
    });
    const { rerender } = renderHook((p) => useDiplomacyTurn(p), { initialProps: props(first) });
    await waitFor(() => expect(setBoard).toHaveBeenCalledTimes(1));
    expect(setBoard.mock.calls[0][0].units.GAL).toEqual({ power: 'austria', type: 'army' });

    // New Game: a fresh board, then the same AI-only retreat phase again.
    rerender(props(new DiplomacyBoard({ maxYears: 1905 })));
    rerender(props(aiOnlyRetreatBoard()));
    await waitFor(() => expect(setBoard).toHaveBeenCalledTimes(2));
  });
});
