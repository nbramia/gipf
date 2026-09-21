import { useEffect, useRef, useCallback, useState } from 'react';
import { createAIWorker } from './createAIWorker.js';

export function useAIWorker() {
  const workerRef = useRef(null);
  const pendingRef = useRef(null);
  const sequenceRef = useRef(0);
  const mountedRef = useRef(false);
  const [isSupported, setIsSupported] = useState(false);

  const startWorker = useCallback(() => {
    try {
      const worker = createAIWorker();
      workerRef.current = worker;
      worker.onmessage = ({ data: message }) => {
        const pending = pendingRef.current;
        if (workerRef.current !== worker || !pending || message.requestId !== pending.requestId) return;
        if (message.type !== 'result' && message.type !== 'error') return;
        pendingRef.current = null;
        if (message.type === 'result') pending.onSuccess(message.data, message.stats);
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
      setIsSupported(true);
      return worker;
    } catch {
      setIsSupported(false);
      return null;
    }
  }, []);

  const cancelPending = useCallback(() => {
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

  const computeMove = useCallback((boardState, simulations, onSuccess, onError,
    evaluationMode = 'heuristic', modelPath = `${process.env.PUBLIC_URL || ''}/models/yinsh-value-v1.onnx`) => {
    if (!mountedRef.current) return;
    cancelPending();
    const worker = workerRef.current || startWorker();
    if (!worker) { onError('Worker not available'); return; }
    const requestId = ++sequenceRef.current;
    pendingRef.current = { requestId, onSuccess, onError };
    try {
      worker.postMessage({ type: 'compute', requestId,
        data: { boardState, simulations, evaluationMode, modelPath } });
    } catch (error) {
      pendingRef.current = null;
      onError(error.message);
    }
  }, [cancelPending, startWorker]);

  return { computeMove, cancelPending, isSupported };
}
