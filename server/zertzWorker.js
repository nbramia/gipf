// Isolated CPU work: the API can terminate this thread at its deadline.
import { parentPort, workerData } from 'node:worker_threads';
import ZertzBoard from '../src/games/zertz/ZertzBoard.js';
import { MCTS } from '../src/games/zertz/engine/mcts.js';
const board = ZertzBoard.fromSerializedState(workerData.boardState);
const mcts = new MCTS({ evaluationMode: 'heuristic' });
parentPort.postMessage({ move: await mcts.getBestMove(board, workerData.simulations), phase: board.gamePhase });
