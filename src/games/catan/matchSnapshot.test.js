import CatanBoard from './CatanBoard.js';
import { encodeBoard, decodeMatch, persistableMove } from './matchSnapshot.js';
import { validatePortableMatch } from '../../migrationMatchSchema.js';
import { MCTS } from './engine/mcts.js';
test.each(['setup-road','discard','robber','trade-response','action'])('restores Catan %s with deterministic hidden state', phase => {
  const b = new CatanBoard({ seed: 1234 });
  b.phase = phase; b.freeRoadsRemaining = 1;
  b.discardQueue = [{ player: 2, count: 4 }];
  const state = encodeBoard(b);
  const snapshot = { v: 1, game: 'catan', id: 'synthetic', updatedAt: 1, state, ui: { showModal: false, gameConfig: { rulesetId: b.rulesetId, playerCount: b.playerCount, scenarioId: b.scenarioId }, robberVictimPicker: null } };
  const restored = decodeMatch(JSON.parse(JSON.stringify(snapshot))).board;
  expect(encodeBoard(restored)).toEqual(JSON.parse(JSON.stringify(state)));
  expect(restored.rngState).toBe(b.rngState);
  expect(restored.devDeck).toEqual(b.devDeck);
});

describe('persisted AI moves stay portable', () => {
  test('an AI move with search metadata is rejected by the strict schema until it is stripped', async () => {
    const board = new CatanBoard({ seed: 1234 });
    const move = await new MCTS({ maxChildren: 8 }).getBestMove(board, 12);
    expect(move._rootVisits).toBeTruthy();
    expect(move._legalMoves).toBeTruthy();
    board.applyMove(move);
    const envelope = lastMove => JSON.parse(JSON.stringify({
      v: 1, game: 'catan', id: 'synthetic', updatedAt: 1, state: encodeBoard(board),
      ui: { showModal: false, gameConfig: { rulesetId: board.rulesetId, playerCount: board.playerCount, scenarioId: board.scenarioId }, lastMove },
    }));

    expect(() => validatePortableMatch(envelope(move), 'catan')).toThrow();
    const clean = persistableMove(move);
    expect(Object.keys(clean).some(key => key.startsWith('_'))).toBe(false);
    expect(clean.type).toBe(move.type);
    expect(() => validatePortableMatch(envelope(clean), 'catan')).not.toThrow();
  });
});
