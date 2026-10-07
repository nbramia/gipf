import YinshBoard from './YinshBoard.js';
import { encodeBoard, decodeMatch } from './matchSnapshot.js';
import legacy51 from './fixtures/old-51-save.json';
import { getAIMove } from './engine/aiPlayer.js';

const envelope = board => ({ v: 1, game: 'yinsh', id: 'synthetic', updatedAt: 1, state: encodeBoard(board), ui: { humanPlayer: 1, twoPlayerMode: true, showModal: false } });

function place(board, q, r) {
  board.handleSetupRingClick(board.getCurrentPlayer(), 0);
  board.handleClick(q, r);
}
function move(board, from, to) {
  board.handleClick(from[0], from[1]);
  board.handleClick(to[0], to[1]);
}

describe('new game state', () => {
  test('startNewGame empties the notation history and numbering', () => {
    const board = new YinshBoard();
    place(board, 0, 0);
    place(board, 1, 1);
    board.startNewGame(false);
    expect(board.getMoveHistory()).toEqual([]);
    expect(board.getNotation().currentMoveNumber).toBe(0);
    place(board, 2, 2);
    expect(board.getNotation().getHistory()[0].moveNumber).toBe(1);
  });

  test('the first action after startNewGame can be undone to the empty board', () => {
    const board = new YinshBoard();
    place(board, 0, 0);
    board.startNewGame(false);
    expect(board.canUndo()).toBe(false);
    place(board, 2, 2);
    expect(board.canUndo()).toBe(true);
    board.undo();
    expect(board.getBoardState()).toEqual({});
    expect(board.getMoveHistory()).toEqual([]);
  });

  test('random setup is the undo floor of a new game', () => {
    const board = new YinshBoard();
    board.startNewGame(true);
    expect(Object.keys(board.getBoardState())).toHaveLength(10);
    const fromKey = Object.keys(board.getBoardState()).find(k => board.getBoardState()[k].player === 1);
    const from = fromKey.split(',').map(Number);
    move(board, from, board.calculateValidMoves(from[0], from[1])[0]);
    expect(board.canUndo()).toBe(true);
    board.undo();
    expect(Object.keys(board.getBoardState())).toHaveLength(10);
  });
});

describe('jump notation', () => {
  test('records the number of markers a jump flips', () => {
    const board = new YinshBoard();
    const white = [[0, 0], [-3, 2], [-3, 3], [-4, 3], [-2, 3]];
    const black = [[2, 0], [3, -2], [3, -3], [4, -3], [2, -3]];
    for (let i = 0; i < 5; i++) { place(board, ...white[i]); place(board, ...black[i]); }
    move(board, [0, 0], [0, 1]); // leaves a white marker at [0,0]
    move(board, [2, 0], [-1, 0]); // jumps it
    expect(board.getBoardState()['0,0']).toEqual({ type: 'marker', player: 2 });
    expect(board.getMoveHistory().pop()).toBe('R[2,0]->[-1,0]x1');
  });
});

describe('off-axis destinations', () => {
  test('getFlippedAlongPath returns [] instead of walking a path that cannot reach the target', () => {
    const board = new YinshBoard();
    expect(board.getFlippedAlongPath([0, 0], [2, -1])).toEqual([]);
    expect(board.getFlippedAlongPath([0, 0], [0, 0])).toEqual([]);
  });
  test('_flipMarkersAlongPath rejects an off-axis path instead of looping', () => {
    const board = new YinshBoard();
    expect(() => board._flipMarkersAlongPath(0, 0, 2, -1, {})).toThrow(/straight/);
  });
});

describe('marker pool exhaustion', () => {
  function nearlyFullBoard(markerCount, scores) {
    const points = YinshBoard.generateGridPoints();
    const state = {};
    // Colour by (q - r) mod 3 so no line of five same-coloured markers can form.
    points.slice(0, markerCount).forEach(([q, r]) => {
      state[`${q},${r}`] = { type: 'marker', player: (((q - r) % 3) + 3) % 3 === 0 ? 1 : 2 };
    });
    points.slice(-10).forEach(([q, r], i) => { state[`${q},${r}`] = { type: 'ring', player: i < 5 ? 1 : 2 }; });
    return new YinshBoard({
      initialBoardState: state, initialPhase: 'play', initialPlayer: 1,
      player1RingsPlaced: 5, player2RingsPlaced: 5,
      player1Score: scores[0], player2Score: scores[1],
    });
  }
  function quietMove(board) {
    for (const key of Object.keys(board.getBoardState())) {
      const piece = board.getBoardState()[key];
      if (piece.type !== 'ring' || piece.player !== 1) continue;
      const [q, r] = key.split(',').map(Number);
      const dest = board.calculateValidMoves(q, r).find(to => board.getFlippedAlongPath([q, r], to).length === 0);
      if (dest) return [[q, r], dest];
    }
    throw new Error('no quiet move');
  }

  test('the game keeps going while the pool still has markers', () => {
    const board = nearlyFullBoard(49, [1, 0]);
    move(board, ...quietMove(board));
    expect(board._countMarkers()).toBe(50);
    expect(board.getGamePhase()).toBe('play');
  });

  test('placing the 51st marker without a row ends the game for the player with more rings', () => {
    const board = nearlyFullBoard(50, [1, 0]);
    move(board, ...quietMove(board));
    expect(board._countMarkers()).toBe(51);
    expect(board.getGamePhase()).toBe('game-over');
    expect(board.getWinner()).toBe(1);
    expect(board.isDraw()).toBe(false);
  });

  test('equal rings removed is a draw', () => {
    const board = nearlyFullBoard(50, [1, 1]);
    move(board, ...quietMove(board));
    expect(board.getGamePhase()).toBe('game-over');
    expect(board.getWinner()).toBeNull();
    expect(board.isDraw()).toBe(true);
  });

  test('the AI treats a finished draw as terminal and a draw as value zero', async () => {
    const MCTS = (await import('./engine/mcts.js')).default;
    const board = nearlyFullBoard(50, [0, 0]);
    move(board, ...quietMove(board));
    const mcts = new MCTS(10, { evaluationMode: 'heuristic' });
    expect(await mcts.getBestMove(board, 5)).toBeNull();
    expect(mcts._evaluatePlayoutResult(board, 1)).toBe(0);
    expect(await getAIMove(mcts, board, 5)).toBeNull();
  });

  test('a pre-rule save holding a full pool is adjudicated on restore and never overdrawn', () => {
    const { board } = decodeMatch(JSON.parse(JSON.stringify(legacy51)));
    expect(board.getGamePhase()).toBe('game-over');
    expect(board._countMarkers()).toBe(51);
    const ring = Object.entries(board.getBoardState()).find(([, p]) => p.type === 'ring' && p.player === board.getCurrentPlayer());
    const [q, r] = ring[0].split(',').map(Number);
    board.handleClick(q, r);
    expect(board._countMarkers()).toBe(51);
    expect(() => decodeMatch(JSON.parse(JSON.stringify(envelope(board))))).not.toThrow();
  });

  test('the engine refuses to place a marker once the pool is full', () => {
    const board = nearlyFullBoard(51, [0, 0]);
    board.handleClick(...Object.keys(board.getBoardState()).find(k => board.getBoardState()[k].type === 'ring' && board.getBoardState()[k].player === 1).split(',').map(Number));
    expect(board._countMarkers()).toBe(51);
    expect(board.getGamePhase()).toBe('game-over');
  });

  test('snapshots round-trip a draw and reject an over-full pool or an unexplained drawn phase', () => {
    const board = nearlyFullBoard(50, [1, 1]);
    move(board, ...quietMove(board));
    const restored = decodeMatch(JSON.parse(JSON.stringify(envelope(board)))).board;
    expect(restored.isDraw()).toBe(true);

    const over = JSON.parse(JSON.stringify(envelope(board)));
    const extra = YinshBoard.generateGridPoints().find(([q, r]) => !over.state.boardState[`${q},${r}`]);
    over.state.boardState[`${extra[0]},${extra[1]}`] = { type: 'marker', player: 1 };
    expect(() => decodeMatch(over)).toThrow();

    const bogusDraw = envelope(new YinshBoard());
    bogusDraw.state.gamePhase = 'game-over';
    expect(() => decodeMatch(bogusDraw)).toThrow();
  });
});
