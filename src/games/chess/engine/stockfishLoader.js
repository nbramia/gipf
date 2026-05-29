// stockfishLoader.js — create a Stockfish engine instance in a Web Worker,
// loading the engine from a CDN.
//
// Browsers block `new Worker(crossOriginUrl)`, but a Worker CAN `importScripts`
// a cross-origin script. So we build a tiny same-origin worker from a Blob whose
// only job is to importScripts the CDN engine. stockfish.js@10 is a self-
// contained asm.js build (no separate .wasm, no SharedArrayBuffer / COOP-COEP
// requirement), which makes it the most portable choice for a static deploy.
//
// Returns an object: { post(cmd), onLine(cb), terminate() } or throws if Workers
// are unavailable.

export const STOCKFISH_CDN_URL =
  'https://cdn.jsdelivr.net/npm/stockfish.js@10.0.2/stockfish.js';

export function isEngineSupported() {
  return typeof Worker !== 'undefined' && typeof Blob !== 'undefined' && typeof URL !== 'undefined';
}

export function createEngine(cdnUrl = STOCKFISH_CDN_URL) {
  if (!isEngineSupported()) {
    throw new Error('Web Workers are not supported in this environment');
  }

  // The bootstrap worker imports the engine. stockfish.js@10 registers its own
  // onmessage/postMessage in the worker scope when loaded this way, so the main
  // thread can talk UCI to the worker directly. We guard with try/catch so a
  // failed CDN load surfaces as an 'error' message rather than a silent hang.
  const bootstrap = `
    try {
      importScripts(${JSON.stringify(cdnUrl)});
    } catch (e) {
      self.postMessage('engine-load-error: ' + (e && e.message ? e.message : e));
    }
  `;
  const blob = new Blob([bootstrap], { type: 'application/javascript' });
  const blobUrl = URL.createObjectURL(blob);
  const worker = new Worker(blobUrl);

  const listeners = new Set();
  worker.onmessage = (e) => {
    const line = typeof e.data === 'string' ? e.data : (e.data && e.data.data) || '';
    for (const cb of listeners) cb(line);
  };
  worker.onerror = (e) => {
    for (const cb of listeners) cb(`engine-error: ${e.message || 'worker error'}`);
  };

  return {
    post(cmd) {
      worker.postMessage(cmd);
    },
    onLine(cb) {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    terminate() {
      listeners.clear();
      worker.terminate();
      URL.revokeObjectURL(blobUrl);
    },
  };
}
