// React hook for Diplomacy AI Web Worker communication.
//
// Mirrors the Catan hook lifecycle: a module worker, a single in-flight
// callback, and graceful fallback when Worker construction throws. The
// difference is the compute call takes a LIST of powers and resolves all of
// them in one request (the worker loops internally), returning a per-power map.

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
          callbackRef.current.onSuccess(data, stats);
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

  // Resolve orders/retreats/adjustments for one or more AI powers in a single
  // request. `onSuccess(data, stats)` receives { phase, byPower } where byPower
  // maps each requested power to its per-power order fragment.
  const computeOrders = useCallback((boardState, powers, options, onSuccess, onError) => {
    if (!workerRef.current) {
      onError('Worker not available');
      return;
    }

    callbackRef.current = { onSuccess, onError };
    workerRef.current.postMessage({
      type: 'compute',
      data: { boardState, powers, options },
    });
  }, []);

  return { computeOrders, isSupported };
}
