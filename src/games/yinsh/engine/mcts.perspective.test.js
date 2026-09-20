import YinshBoard from '../YinshBoard.js';
import MCTS, { MCTSNode } from './mcts.js';

function scoringBoard(player = 1) {
  const board = new YinshBoard({ initialPhase: 'remove-row', initialPlayer: player });
  for (let q = -2; q <= 2; q++) board.boardState[`${q},0`] = { type: 'marker', player };
  board.boardState['-3,1'] = { type: 'ring', player };
  board.boardState['3,-1'] = { type: 'ring', player: 3 - player };
  board.nextTurnPlayer = 3 - player;
  board._startNextRowResolution();
  return board;
}

test.each(['batch', 'incremental'])('%s low-budget final choice uses NN values before all legal moves are visited', async mode => {
  const board = new YinshBoard({ initialPhase: 'play', initialBoardState: {
    '-1,0': { type: 'ring', player: 1 }, '3,0': { type: 'ring', player: 2 }
  } });
  // Keep the real legal action set and search; disable only the heuristic shortcut.
  const probe = new MCTS();
  const legal = probe.getLegalMoves(board);
  expect(legal.length).toBeGreaterThan(2);
  const preferred = legal[1];
  const network = { evaluatePosition: jest.fn(async state =>
    state.boardState[preferred.end.join(',')]?.type === 'ring' ? -0.8 : 0.8) };
  const engine = new MCTS(100, { evaluationMode: 'nn', valueNetwork: network });
  jest.spyOn(engine, 'evaluatePosition').mockReturnValue({ myScoring: [] });
  jest.spyOn(engine, '_selectMoveByFastHeuristic').mockReturnValue({ score: 0 });
  let result;
  if (mode === 'batch') result = await engine.getBestMove(board, 2);
  else { await engine.runIteration(board); result = await engine.runIteration(board); }
  const root = result.rootNode || engine.root;
  expect(root.children.size).toBe(2);
  expect([...root.children.values()].map(child => child.visits)).toEqual([1, 1]);
  expect([...root.children.values()].every(child => child.board.currentPlayer === 2)).toBe(true);
  expect(result.destination).toEqual(preferred.end);
  expect(network.evaluatePosition).toHaveBeenCalledTimes(2);
});

test.each(['batch', 'incremental'])('%s low-budget final choice preserves same-player scoring values', async mode => {
  const board = scoringBoard();
  for (let q = -2; q <= 2; q++) board.boardState[`${q},2`] = { type: 'marker', player: 1 };
  board._startNextRowResolution();
  const engine = new MCTS(100, { evaluationMode: 'nn', valueNetwork: {
    evaluatePosition: async state => state.boardState['0,2'] ? -0.8 : 0.8
  } });
  jest.spyOn(engine, 'evaluatePosition').mockReturnValue({ myScoring: [] });
  jest.spyOn(engine, '_selectMoveByFastHeuristic').mockReturnValue({ score: 0 });
  let result;
  if (mode === 'batch') result = await engine.getBestMove(board, 2);
  else { await engine.runIteration(board); result = await engine.runIteration(board); }
  const children = [...(result.rootNode || engine.root).children.values()];
  expect(children).toHaveLength(2);
  expect(children.every(child => child.board.currentPlayer === 1 && child.visits === 1)).toBe(true);
  expect(result.row).toContainEqual([0, 2]);
});

test('final root comparator orders visits, value, prior and stable action key', () => {
  const engine = new MCTS();
  const root = new MCTSNode(scoringBoard());
  const a = new MCTSNode(scoringBoard(), null, root);
  const b = new MCTSNode(scoringBoard(), null, root);
  a.stats = { visits: 1, wins: 10 };
  b.stats = { visits: 2, wins: -100 };
  root.children.set('{"id":"b"}', b);
  root.children.set('{"id":"a"}', a);
  expect(engine._bestRootChild(root).node).toBe(b);
  b.stats = { visits: 1, wins: -100 };
  expect(engine._bestRootChild(root).node).toBe(a);
  b.stats.wins = 10;
  b.prior = 0.8;
  expect(engine._bestRootChild(root).node).toBe(b);
  a.prior = 0.8;
  expect(engine._bestRootChild(root).node).toBe(a);
  root.children = new Map([...root.children].reverse());
  expect(engine._bestRootChild(root).node).toBe(a);
});

test('invalid row expansion fails closed without a self-loop or shared child statistics', () => {
  const engine = new MCTS();
  const root = new MCTSNode(scoringBoard(), null, null, engine);
  root.untriedMoves = [{ type: 'remove-row', row: [[0, 0]] }];
  const hash = root.board.getStateHash();
  expect(() => engine.expand(root)).toThrow('Invalid remove-row action');
  expect(root.children.size).toBe(0);
  expect(engine.transpositionTable.size).toBe(1);
  expect(root.visits).toBe(0);
  expect(root.board.getStateHash()).toBe(hash);
});

test.each([false, true])('actual search favors the acting player across alternating moves (PUCT=%s)', policy => {
  const network = { evaluatePosition: jest.fn(async board => board.boardState['0,0'] ? 0.9 : -0.9) };
  if (policy) network.evaluatePositionWithPolicy = async () => ({ policy: new Array(121).fill(0) });
  const engine = new MCTS(100, { evaluationMode: 'nn', valueNetwork: network });
  // Restrict branching, not selection/backpropagation, to isolate the sign bug.
  const board = new YinshBoard({ initialPhase: 'play', initialBoardState: {
    '-1,0': { type: 'ring', player: 1 },
    '3,0': { type: 'ring', player: 2 }
  } });
  const moves = [
    { type: 'move-ring', start: [-1, 0], end: [0, 0] },
    { type: 'move-ring', start: [-1, 0], end: [1, 0] }
  ];
  jest.spyOn(engine, 'getLegalMoves').mockImplementation(state => state.currentPlayer === 2 ? [] : [...moves]);
  jest.spyOn(engine, 'evaluatePosition').mockReturnValue({ myScoring: [] });
  jest.spyOn(engine, '_selectMoveByFastHeuristic').mockReturnValue({ move: moves[0], score: 0 });
  jest.spyOn(engine, '_sampleDirichlet').mockReturnValue([0.5, 0.5]);
  return engine.getBestMove(board, 40).then(result => {
    expect(result.destination).toEqual([1, 0]);
    const children = [...result.rootNode.children.values()];
    expect(children.every(child => child.board.currentPlayer === 2)).toBe(true);
    expect(children[0].wins / children[0].visits).toBe(4500);
    expect(children[1].wins / children[1].visits).toBe(-4500);
    expect(result.rootNode.visits).toBe(40);
    expect(result.rootNode.wins).toBeGreaterThan(0);
  });
});

test.each([1, 2])('row/ring actions preserve player %i values; next turn inverts once', async player => {
  const engine = new MCTS(100, { evaluationMode: 'nn', valueNetwork: { evaluatePosition: async () => 0.9 } });
  const root = new MCTSNode(scoringBoard(player), null, null, engine);
  const ringPhase = engine.expand(root);
  expect(ringPhase.board.gamePhase).toBe('remove-ring');
  expect(ringPhase.board.currentPlayer).toBe(player);
  engine.backpropagate(ringPhase, await engine.simulate(ringPhase));
  expect(root.wins).toBe(4500);
  expect(ringPhase.wins).toBe(4500);
  const nextTurn = engine.expand(ringPhase);
  expect(nextTurn.board.currentPlayer).toBe(3 - player);
  engine.backpropagate(nextTurn, await engine.simulate(nextTurn));
  expect(nextTurn.wins).toBe(4500);
  expect(ringPhase.wins).toBe(0);
  expect(root.wins).toBe(0);
  expect(root.visits).toBe(2);
});

test.each([false, true])('same-player selection prefers own positive outcome (PUCT=%s)', puct => {
  const engine = new MCTS();
  engine.usePUCT = puct;
  const board = scoringBoard();
  board.boardState['-3,2'] = { type: 'ring', player: 1 };
  board.removeRow(board.rows[0].markers);
  // Both ring removals lead to another own row, preserving the acting player.
  for (let q = -2; q <= 2; q++) board.boardState[`${q},2`] = { type: 'marker', player: 1 };
  const root = new MCTSNode(board, null, null, engine);
  const bad = engine.expand(root);
  const good = engine.expand(root);
  expect(bad.board.currentPlayer).toBe(1);
  expect(good.board.currentPlayer).toBe(1);
  engine.backpropagate(bad, -1000);
  engine.backpropagate(good, 1000);
  expect(engine.select(root)).toBe(good);
});

test('transposition statistics share perspective but preserve the selected parent path', () => {
  const engine = new MCTS();
  const parentA = new MCTSNode(new YinshBoard({ initialPlayer: 1 }), null, null, engine);
  const parentB = new MCTSNode(new YinshBoard({ initialPlayer: 2 }), null, null, engine);
  const board = scoringBoard(2);
  const viaA = new MCTSNode(board, { id: 'a' }, parentA, engine);
  const viaB = new MCTSNode(board, { id: 'b' }, parentB, engine);
  engine.backpropagate(viaA, 900);
  expect(viaB.visits).toBe(1);
  expect(viaB.wins).toBe(900);
  expect(parentA.wins).toBe(-900);
  expect(parentB.visits).toBe(0);
  engine.backpropagate(viaB, 300);
  expect(viaA.wins).toBe(1200);
  expect(viaA.visits).toBe(2);
  expect(parentA.visits).toBe(1);
  expect(parentB.wins).toBe(300);
  expect(viaA.ucb1(2, 0)).toBe(-600);
  expect(viaB.ucb1(2, 0)).toBe(600);
  const neutralBoard = board.clone();
  neutralBoard.boardState['0,3'] = { type: 'marker', player: 2 };
  for (const [parent, shared] of [[parentA, viaA], [parentB, viaB]]) {
    const neutral = new MCTSNode(neutralBoard, null, parent, engine);
    neutral.updateStats(0);
    parent.untriedMoves = [];
    parent.children.set('shared', shared);
    parent.children.set('neutral', neutral);
    expect(engine.select(parent)).toBe(parent === parentA ? neutral : shared);
  }
  const expanded = engine.expand(viaB);
  expect(expanded.parent).toBe(viaB);
  expect(viaA.children.size).toBe(0);
  expect(viaA.getLegalMoves()).toHaveLength(1);
  const isolated = new MCTSNode(board, null, null, new MCTS());
  expect(isolated.visits).toBe(0);
});

test.each(['heuristic', 'nn'])('%s terminal evaluation and final scoring backup use node player', async evaluationMode => {
  const network = { evaluatePosition: jest.fn(async () => -0.9) };
  const engine = new MCTS(100, { evaluationMode, valueNetwork: network });
  const board = scoringBoard();
  board.scores[1] = 2;
  const root = new MCTSNode(board, null, null, engine);
  const ringPhase = engine.expand(root);
  const terminal = engine.expand(ringPhase);
  expect(terminal.board.winner).toBe(1);
  engine.backpropagate(terminal, await engine.simulate(terminal));
  expect(root.wins).toBe(10000);
  expect(ringPhase.wins).toBe(10000);
  expect(terminal.wins).toBe(10000);
  expect(engine._evaluatePlayoutResult(terminal.board, 1)).toBe(10000);
  expect(engine._evaluatePlayoutResult(terminal.board, 2)).toBe(-10000);
  const loser = terminal.board.clone();
  loser.currentPlayer = 2;
  expect(await engine.simulate(new MCTSNode(loser, null, null, engine))).toBe(-10000);
  expect(network.evaluatePosition).not.toHaveBeenCalled();
});

test.each(['play', 'remove-row', 'remove-ring'])('heuristic values reverse with evaluation player in %s', phase => {
  const engine = new MCTS();
  const board = scoringBoard();
  board.gamePhase = phase;
  board.scores[1] = 1;
  expect(engine._evaluatePlayoutResult(board, 1)).toBeGreaterThan(0);
  expect(engine._evaluatePlayoutResult(board, 1)).toBe(-engine._evaluatePlayoutResult(board, 2));
});

test('heuristic rollout preserves its starting player through scoring actions', () => {
  const engine = new MCTS();
  const root = new MCTSNode(scoringBoard(), null, null, engine);
  const legalMoves = engine.getLegalMoves.bind(engine);
  jest.spyOn(engine, '_getLegalMovesForSimulation').mockImplementation(board =>
    board.gamePhase === 'play' ? [] : legalMoves(board));
  const evaluate = jest.spyOn(engine, '_evaluatePlayoutResult');
  expect(engine.simulate(root)).toBeGreaterThan(0);
  expect(evaluate.mock.calls[0][0].currentPlayer).toBe(2);
  expect(evaluate.mock.calls[0][1]).toBe(1);
});

test('search repeatedly backs up terminal leaves after the final ring', async () => {
  const board = scoringBoard();
  board.scores[1] = 2;
  board.removeRow(board.rows[0].markers);
  const engine = new MCTS(100, { evaluationMode: 'nn', valueNetwork: { evaluatePosition: jest.fn() } });
  jest.spyOn(engine, '_selectMoveByFastHeuristic').mockReturnValue({ score: 0 });
  const result = await engine.getBestMove(board, 8);
  expect(result.type).toBe('remove-ring');
  expect(result.rootNode.visits).toBe(8);
  expect(result.rootNode.wins).toBe(80000);
});

test('incremental NN search awaits values and preserves explicit row actions', async () => {
  const engine = new MCTS(100, { evaluationMode: 'nn', valueNetwork: { evaluatePosition: async () => 0.9 } });
  const board = scoringBoard();
  const result = await engine.runIteration(board);
  expect(result.type).toBe('remove-row');
  expect(result.row).toHaveLength(5);
  expect(engine.root.wins).toBe(4500);
  const root = engine.root;
  await engine.runIteration(board);
  expect(engine.root).toBe(root);
  expect(root.visits).toBe(2);
  expect(root.wins).toBe(0);
});
