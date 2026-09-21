// A durable generation survives a transition starting and finishing between awaits.
export const epochKey = 'gipf:account-epoch';
export const transitionKey = 'gipf:account-transition';
export function captureFence({ allowTransition = false } = {}) {
  const owner = localStorage.getItem('gipfAccount');
  const epoch = localStorage.getItem(epochKey);
  const marker = localStorage.getItem(transitionKey);
  const active = raw => {
    if (!raw) return false;
    try { return !(JSON.parse(raw).until <= Date.now()); } catch (_) { return true; }
  };
  if (!allowTransition && active(marker)) throw new Error('account_changed');
  return () => {
    if (localStorage.getItem('gipfAccount') !== owner || localStorage.getItem(epochKey) !== epoch ||
        localStorage.getItem(transitionKey) !== marker || (allowTransition ? marker && !active(marker) : active(marker))) throw new Error('account_changed');
  };
}
export async function withAccountTransition(operation, migration = false) {
  const entryCheck = captureFence();
  const run = async () => {
    entryCheck();
    const marker = JSON.stringify({ id: globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random()}`, until: Date.now() + 60000 });
    localStorage.setItem(epochKey, marker);
    localStorage.setItem(transitionKey, marker);
    window.dispatchEvent(new CustomEvent('gipf-account-transition', { detail: { migration } }));
    const check = captureFence({ allowTransition: true });
    try { return await operation(check); }
    finally { if (localStorage.getItem(transitionKey) === marker) localStorage.removeItem(transitionKey); }
  };
  if (navigator.locks?.request) return navigator.locks.request('gipf-account-writer-v1', run);
  if (migration) throw new Error('web_locks_required');
  return run();
}
