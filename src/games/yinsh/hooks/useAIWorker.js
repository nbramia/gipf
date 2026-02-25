// useAIWorker.js - React hook to manage MCTS Web Worker lifecycle

import { useEffect, useRef, useCallback } from 'react';

/**
 * Custom hook to manage AI computation in a Web Worker
 * Prevents UI blocking during MCTS computation
 *
 * @returns {Object} - { computeMove, isSupported }
 */
export function useAIWorker() {
  const workerRef = useRef(null);
  const callbacksRef = useRef({});

  // Check if Web Workers are supported
  const isSupported = typeof Worker !== 'undefined';

  // Initialize worker on mount
  useEffect(() => {
    if (!isSupported) {
      console.warn('Web Workers not supported in this browser');
      return;
    }

    try {
      // Create worker with module type for ES6 imports
      workerRef.current = new Worker(
        new URL('../engine/mcts.worker.js', import.meta.url),
        { type: 'module' }
      );

      // Handle messages from worker
      workerRef.current.onmessage = (e) => {
        const { type, data, error, success, stats } = e.data;

        if (type === 'result' && callbacksRef.current.onSuccess) {
          callbacksRef.current.onSuccess(data, stats);
        } else if (type === 'error' && callbacksRef.current.onError) {
          callbacksRef.current.onError(error);
        }
      };

      // Handle worker errors
      workerRef.current.onerror = (error) => {
        console.error('Worker error:', error);
        if (callbacksRef.current.onError) {
          callbacksRef.current.onError(error.message || 'Worker error');
        }
      };
    } catch (error) {
      console.error('Failed to initialize worker:', error);
    }

    // Cleanup: terminate worker on unmount
    return () => {
      if (workerRef.current) {
        workerRef.current.terminate();
        workerRef.current = null;
      }
    };
  }, [isSupported]);

  /**
   * Request AI move computation from worker
   *
   * @param {Object} boardState - Serialized board state
   * @param {number} simulations - Number of MCTS simulations to run
   * @param {Function} onSuccess - Callback for successful computation (data, stats)
   * @param {Function} onError - Callback for errors (errorMessage)
   */
  const computeMove = useCallback((boardState, simulations, onSuccess, onError, evaluationMode, modelPath) => {
    if (!workerRef.current) {
      const errorMsg = 'Worker not initialized';
      console.error(errorMsg);
      onError(errorMsg);
      return;
    }

    // Store callbacks for when worker responds
    callbacksRef.current = { onSuccess, onError };

    // Send computation request to worker
    try {
      workerRef.current.postMessage({
        type: 'compute',
        data: {
          boardState,
          simulations,
          evaluationMode: evaluationMode || 'heuristic',
          modelPath: modelPath || '/models/yinsh-value-v1.onnx'
        }
      });
    } catch (error) {
      console.error('Failed to post message to worker:', error);
      onError(error.message);
    }
  }, []);

  return { computeMove, isSupported };
}
