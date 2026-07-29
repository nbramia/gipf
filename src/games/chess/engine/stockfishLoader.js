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

// Prefixes createEngine's onLine/onerror callbacks use to report a failed
// load, so callers can tell "the CDN script never arrived" apart from other
// worker errors without string-sniffing the message body themselves.
export const ENGINE_LOAD_ERROR_PREFIX = 'engine-load-error';
export const ENGINE_RUNTIME_ERROR_PREFIX = 'engine-error';

export function isEngineSupported() {
  return typeof Worker !== 'undefined' && typeof Blob !== 'undefined' && typeof URL !== 'undefined';
}

// Best-effort classification of an engine failure line/message. `importScripts`
// failures on a blocked/unreachable CDN surface as generic-looking errors (a
// SecurityError, a network TypeError, or just "Failed to fetch") that are
// indistinguishable, from the message alone, from an ad-blocker or proxy
// silently killing the request — which is by far the most common real-world
// cause (issue 5.18). Anything from ENGINE_LOAD_ERROR_PREFIX (the CDN script
// itself never loaded) or that looks network-shaped is treated as CDN-blocked;
// anything else (e.g. a worker crash after the engine loaded fine) is 'other'.
export function classifyEngineError(message) {
  const msg = String(message || '');
  if (msg.startsWith(ENGINE_LOAD_ERROR_PREFIX)) return 'cdn-blocked';
  if (/networkerror|failed to fetch|net::|blocked|securityerror|CORS/i.test(msg)) return 'cdn-blocked';
  return 'other';
}

// Human-readable error text for the UI, distinguishing a likely CDN/network
// block (ad-blocker, corporate proxy, offline) from other failures, and
// pointing at the actual recovery (retry / check network) instead of
// "start a new game," which cannot work since a new game re-fails identically.
export function describeEngineError(message, cdnUrl = STOCKFISH_CDN_URL) {
  const host = safeHost(cdnUrl);
  if (classifyEngineError(message) === 'cdn-blocked') {
    return (
      `Couldn't load the chess engine from ${host}. This is usually an ad-blocker, ` +
      `privacy extension, or network/proxy blocking that domain. Try disabling ` +
      `blockers for this site or switching networks, then retry.`
    );
  }
  return `The chess engine failed to start${message ? `: ${message}` : ''}. Please retry.`;
}

function safeHost(url) {
  try {
    return new URL(url).host;
  } catch (_) {
    return 'the engine CDN';
  }
}

// Stateless factory — holds no module-level state, so a failed load can be
// retried by simply calling createEngine() again (e.g. after the user
// disables an ad-blocker), with no full page reload required.
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
