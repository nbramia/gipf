import { useEffect, useRef, useCallback } from 'react';
import { createAIWorker } from './createAIWorker.js';

// Owns the round-dealing worker. Each request gets an increasing requestId and
// only the newest request's reply is delivered: a reply for an abandoned
// request, or one that arrives after unmount, is dropped.
export default function useSolverWorker() {
  const workerRef = useRef(null);
  const pendingRef = useRef(null);
  const sequenceRef = useRef(0);
  const mountedRef = useRef(false);

  const startWorker = useCallback(() => {
    try {
      const worker = createAIWorker();
      workerRef.current = worker;
      worker.onmessage = ({ data: message }) => {
        const pending = pendingRef.current;
        if (workerRef.current !== worker || !pending || message.requestId !== pending.requestId) return;
        if (message.type !== 'result' && message.type !== 'error') return;
        pendingRef.current = null;
        if (message.type === 'result') pending.onSuccess(message.data.round);
        else pending.onError(message.error);
      };
      worker.onerror = (event) => {
        if (workerRef.current !== worker) return;
        const pending = pendingRef.current;
        pendingRef.current = null;
        worker.terminate();
        workerRef.current = null;
        if (pending) pending.onError(event.message || 'Worker error');
      };
      return worker;
    } catch {
      return null;
    }
  }, []);

  const cancel = useCallback(() => {
    if (!pendingRef.current) return;
    pendingRef.current = null;
    const worker = workerRef.current;
    workerRef.current = null;
    if (worker) worker.terminate();
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    startWorker();
    return () => {
      mountedRef.current = false;
      pendingRef.current = null;
      const worker = workerRef.current;
      workerRef.current = null;
      if (worker) worker.terminate();
    };
  }, [startWorker]);

  const requestRound = useCallback((boardState, desiredLength, onSuccess, onError) => {
    if (!mountedRef.current) return;
    cancel();
    const worker = workerRef.current || startWorker();
    if (!worker) { onError('Worker not available'); return; }
    const requestId = ++sequenceRef.current;
    pendingRef.current = { requestId, onSuccess, onError };
    try {
      worker.postMessage({ type: 'next', requestId, data: { boardState, desiredLength } });
    } catch (error) {
      pendingRef.current = null;
      onError(error.message);
    }
  }, [cancel, startWorker]);

  return { requestRound, cancel };
}
