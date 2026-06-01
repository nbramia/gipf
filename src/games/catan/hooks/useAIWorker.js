// React hook for Catan AI Web Worker communication.

import { useCallback, useEffect, useRef, useState } from 'react';

export default function useAIWorker() {
  const workerRef = useRef(null);
  const callbackRef = useRef(null);
  const [isSupported, setIsSupported] = useState(false);

  useEffect(() => {
    try {
      const worker = new Worker(
        new URL('../engine/mcts.worker.js', import.meta.url),
        { type: 'module' }
      );

      worker.onmessage = (event) => {
        const { success, data, error, stats } = event.data;
        if (!callbackRef.current) return;

        if (success) {
          callbackRef.current.onSuccess(data.move, stats);
        } else {
          callbackRef.current.onError(error);
        }
        callbackRef.current = null;
      };

      worker.onerror = (event) => {
        if (callbackRef.current) {
          callbackRef.current.onError(event.message || 'Worker error');
          callbackRef.current = null;
        }
      };

      workerRef.current = worker;
      setIsSupported(true);

      return () => {
        worker.terminate();
        workerRef.current = null;
      };
    } catch {
      setIsSupported(false);
    }
  }, []);

  const computeMove = useCallback((boardState, simulations, onSuccess, onError, maxChildren = 42, rolloutSteps = 24) => {
    if (!workerRef.current) {
      onError('Worker not available');
      return;
    }

    callbackRef.current = { onSuccess, onError };
    workerRef.current.postMessage({
      type: 'compute',
      data: { boardState, simulations, maxChildren, rolloutSteps },
    });
  }, []);

  return { computeMove, isSupported };
}
