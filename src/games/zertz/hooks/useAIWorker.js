// React hook for Zertz AI Web Worker communication
import { useRef, useEffect, useCallback, useState } from 'react';

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

      worker.onmessage = (e) => {
        const { success, data, error, stats } = e.data;
        if (callbackRef.current) {
          if (success) {
            callbackRef.current.onSuccess(data.move, stats);
          } else {
            callbackRef.current.onError(error);
          }
          callbackRef.current = null;
        }
      };

      worker.onerror = (e) => {
        if (callbackRef.current) {
          callbackRef.current.onError(e.message);
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

  const computeMove = useCallback(
    (boardState, simulations, onSuccess, onError, evaluationMode = 'heuristic', modelPath = null) => {
      if (!workerRef.current) {
        onError('Worker not available');
        return;
      }

      callbackRef.current = { onSuccess, onError };

      workerRef.current.postMessage({
        type: 'compute',
        data: { boardState, simulations, evaluationMode, modelPath },
      });
    },
    []
  );

  return { computeMove, isSupported };
}
