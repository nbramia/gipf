// Shared helpers for the model-proxy functions: classify upstream timeouts and
// budget the upstream call from a whole-request deadline.

const TIMEOUT_NAMES = new Set(['TimeoutError', 'AbortError']);
const UNDICI_TIMEOUT_CODES = new Set([
  'UND_ERR_CONNECT_TIMEOUT',
  'UND_ERR_HEADERS_TIMEOUT',
  'UND_ERR_BODY_TIMEOUT',
]);

// True for an aborted/timed-out upstream call: a direct TimeoutError/AbortError,
// or the TypeError('fetch failed') undici throws around one (cause is the
// DOMException or an error with an undici timeout code). Other errors, including
// unrelated TypeErrors, are not timeouts.
export function isUpstreamTimeout(err) {
  if (!err) return false;
  if (TIMEOUT_NAMES.has(err.name)) return true;
  if (err.name === 'TypeError') {
    const cause = err.cause;
    if (cause && (TIMEOUT_NAMES.has(cause.name) || UNDICI_TIMEOUT_CODES.has(cause.code))) return true;
  }
  return false;
}

// Time the upstream call may take: what is left of the function's maxDuration
// after the time already spent since `startedAt` (guard, key lookup) and a
// margin for emitting the response, never below `floorMs`.
export function upstreamBudgetMs({
  startedAt,
  now = Date.now(),
  maxDurationMs = 20000,
  marginMs = 1500,
  floorMs = 2000,
} = {}) {
  return Math.max(floorMs, maxDurationMs - marginMs - (now - startedAt));
}
