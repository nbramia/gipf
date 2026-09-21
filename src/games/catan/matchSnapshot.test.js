import CatanBoard from './CatanBoard.js';
import { encodeBoard, decodeMatch } from './matchSnapshot.js';
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
