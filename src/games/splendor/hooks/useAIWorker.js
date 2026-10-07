// React hook for Splendor AI Web Worker communication.

import { useCallback, useEffect, useRef, useState } from 'react';

function createWorker() {
  return new Worker(
    new URL('../engine/mcts.worker.js', import.meta.url),
    { type: 'module' }
  );
}

export default function useAIWorker() {
  const workerRef = useRef(null);
  const callbackRef = useRef(null);
  const requestIdRef = useRef(0);
  const [isSupported, setIsSupported] = useState(false);

  const attach = useCallback((worker) => {
    worker.onmessage = (event) => {
      const { success, data, error, stats, requestId } = event.data;
      const pending = callbackRef.current;
      // Ignore replies to a request that was cancelled or superseded.
      if (!pending || requestId !== pending.requestId) return;
      callbackRef.current = null;
      if (success) {
        pending.onSuccess(data.move, stats);
      } else {
        pending.onError(error);
      }
    };

    worker.onerror = (event) => {
      if (callbackRef.current) {
        const { onError } = callbackRef.current;
        callbackRef.current = null;
        onError(event.message || 'Worker error');
      }
    };
    workerRef.current = worker;
  }, []);

  useEffect(() => {
    try {
      attach(createWorker());
      setIsSupported(true);

      return () => {
        if (workerRef.current) workerRef.current.terminate();
        workerRef.current = null;
        callbackRef.current = null;
      };
    } catch {
      setIsSupported(false);
    }
  }, [attach]);

  // Drop the outstanding request and stop its search: the worker is
  // single-threaded, so a fresh worker keeps the next request from queueing
  // behind a computation nobody wants.
  const cancel = useCallback(() => {
    callbackRef.current = null;
    if (!workerRef.current) return;
    workerRef.current.terminate();
    try {
      attach(createWorker());
    } catch {
      workerRef.current = null;
    }
  }, [attach]);

  const computeMove = useCallback((boardState, simulations, onSuccess, onError, maxChildren = 36, rolloutSteps = 28) => {
    if (!workerRef.current) {
      onError('Worker not available');
      return;
    }

    const requestId = ++requestIdRef.current;
    callbackRef.current = { onSuccess, onError, requestId };
    workerRef.current.postMessage({
      type: 'compute',
      data: { boardState, simulations, maxChildren, rolloutSteps, requestId },
    });
  }, []);

  return { computeMove, cancel, isSupported };
}
