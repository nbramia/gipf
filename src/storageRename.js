// One-time move of this app's browser storage from its legacy `gipf` names to `play`
// names, so a device that used the app under its old name keeps its session, keys
// and progress. Every step is idempotent: a name already present under `play` wins,
// and the legacy copy is removed either way.
//
//   localStorage / sessionStorage   gipfAccount → playAccount, gipfApiKey → playApiKey,
//                                    gipfAccountKeys → playAccountKeys, gipf:* → play:*
//   IndexedDB                        database `gipf-account` → `play-account`

const LEGACY_KEY = /^gipf(?=[:A-Z])/;
export const LEGACY_KEY_DB = 'gipf-account';

// The current name for a legacy storage key, or null when the key is not legacy.
export function renamedKey(key) {
  return typeof key === 'string' && LEGACY_KEY.test(key) ? key.replace(LEGACY_KEY, 'play') : null;
}

// Move every legacy key in one Storage area. Returns the number of keys moved or dropped.
export function renameStorageArea(storage) {
  if (!storage) return 0;
  const legacy = [];
  for (let i = 0; i < storage.length; i++) {
    const key = storage.key(i);
    if (renamedKey(key)) legacy.push(key);
  }
  for (const key of legacy) {
    const value = storage.getItem(key);
    const next = renamedKey(key);
    if (value !== null && storage.getItem(next) === null) storage.setItem(next, value);
    storage.removeItem(key);
  }
  return legacy.length;
}

// Synchronous, so it runs before anything at startup reads a session or a key.
export function renameLegacyStorage() {
  for (const area of ['localStorage', 'sessionStorage']) {
    try { renameStorageArea(globalThis[area]); } catch (_) { /* storage unavailable or full: try again next load */ }
  }
}

const request = r => new Promise((resolve, reject) => { r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); });
const done = tx => new Promise((resolve, reject) => { tx.oncomplete = () => resolve(); tx.onerror = tx.onabort = () => reject(tx.error); });

// Copy the legacy key database into `target` (keeping any entry already there), then
// delete the legacy database. Detection uses indexedDB.databases(), so a browser
// without it is left as it is rather than having an empty legacy database created.
export async function renameKeyDatabase(target, store, idb = globalThis.indexedDB) {
  if (!idb || typeof idb.databases !== 'function') return false;
  const names = (await idb.databases()).map(d => d.name);
  if (!names.includes(LEGACY_KEY_DB)) return false;
  const legacy = await request(idb.open(LEGACY_KEY_DB));
  let entries = [];
  try {
    if (legacy.objectStoreNames.contains(store)) {
      const tx = legacy.transaction(store, 'readonly');
      const keys = request(tx.objectStore(store).getAllKeys());
      const values = request(tx.objectStore(store).getAll());
      const [k, v] = await Promise.all([keys, values]);
      await done(tx);
      entries = k.map((key, i) => [key, v[i]]);
    }
  } finally { legacy.close(); }
  if (entries.length) {
    const open = idb.open(target, 1);
    open.onupgradeneeded = () => open.result.createObjectStore(store);
    const db = await request(open);
    try {
      const tx = db.transaction(store, 'readwrite');
      const os = tx.objectStore(store);
      for (const [key, value] of entries) {
        const existing = os.get(key);
        existing.onsuccess = () => { if (existing.result === undefined) os.put(value, key); };
      }
      await done(tx);
    } finally { db.close(); }
  }
  // Not awaited: a tab still running the old code may hold the legacy database open,
  // which blocks deletion until it closes; the copy above is already complete.
  try { idb.deleteDatabase(LEGACY_KEY_DB); } catch (_) { /* retried next load */ }
  return true;
}
