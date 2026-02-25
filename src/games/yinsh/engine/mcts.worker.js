// mcts.worker.js - Web Worker for MCTS AI computation
// Runs MCTS in a separate thread to prevent UI blocking

import MCTS from './mcts.js';
import YinshBoard from '../YinshBoard.js';

let valueNetworkModule = null;
const loadedModels = new Map(); // Cache: modelPath → ValueNetwork instance

// Worker message handler
self.onmessage = async function(e) {
  const { type, data } = e.data;

  if (type === 'compute') {
    try {
      // Reconstruct board state from serialized data
      const board = YinshBoard.fromSerializedState(data.boardState);

      const evaluationMode = data.evaluationMode || 'heuristic';
      const modelPath = data.modelPath || '/models/yinsh-value-v1.onnx';
      let valueNetwork = null;

      // Load value network on first NN-mode request (cached per model path)
      if (evaluationMode === 'nn') {
        if (!valueNetworkModule) {
          valueNetworkModule = await import('./valueNetwork.js');
        }
        if (!loadedModels.has(modelPath)) {
          const vn = new valueNetworkModule.ValueNetwork();
          const loaded = await vn.load(modelPath);
          if (loaded) {
            loadedModels.set(modelPath, vn);
          }
        }
        valueNetwork = loadedModels.get(modelPath) || null;
      }

      // Run MCTS with specified number of simulations
      const mcts = new MCTS(100000, { evaluationMode, valueNetwork });
      const simulations = data.simulations || 200;
      const result = await mcts.getBestMove(board, simulations);

      // Strip rootNode before posting — it contains class instances and
      // arrow-function properties that can't be cloned by postMessage
      const { rootNode, ...serializableResult } = result;

      // Send result back to main thread
      self.postMessage({
        type: 'result',
        data: serializableResult,
        success: true,
        stats: {
          simulations: simulations,
          phase: data.boardState.gamePhase,
          evaluationMode
        }
      });
    } catch (error) {
      // Send error back to main thread
      console.error('Worker error:', error);
      self.postMessage({
        type: 'error',
        error: error.message,
        stack: error.stack,
        success: false
      });
    }
  }
};

// Handle errors
self.onerror = function(error) {
  console.error('Worker global error:', error);
  self.postMessage({
    type: 'error',
    error: error.message,
    success: false
  });
};
