// IndexedDB is stored in the Android WebView's private app data, per server origin.
let database;
function openDatabase() {
  if (!database) database = new Promise((resolve, reject) => {
    const request = indexedDB.open('codex-conversations', 1);
    request.onupgradeneeded = () => {
      const store = request.result.createObjectStore('entries', {keyPath:'key'});
      store.createIndex('savedAt', 'savedAt');
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error('Cache unavailable'));
  }).catch(() => null);
  return database;
}

export async function readCache(key) {
  try {
    const db = await openDatabase();
    if (!db) return null;
    return await new Promise(resolve => {
      const request = db.transaction('entries').objectStore('entries').get(key);
      request.onsuccess = () => resolve(request.result?.value ?? null);
      request.onerror = () => resolve(null);
    });
  } catch { return null; }
}

export async function writeCache(key, value) {
  try {
    const db = await openDatabase();
    if (!db) return;
    await new Promise(resolve => {
      const transaction = db.transaction('entries', 'readwrite'), store = transaction.objectStore('entries');
      transaction.oncomplete = transaction.onerror = transaction.onabort = () => resolve();
      store.put({key, value, savedAt:Date.now()});
      const count = store.count();
      count.onsuccess = () => {
        // Keep whole conversations; evict oldest entries instead of cutting messages.
        let excess = count.result - 32;
        if (excess <= 0) return;
        const cursor = store.index('savedAt').openCursor();
        cursor.onsuccess = () => {
          if (!cursor.result || excess-- <= 0) return;
          cursor.result.delete(); cursor.result.continue();
        };
      };
    });
  } catch { /* Storage quota/privacy restrictions must not break live conversations. */ }
}

export async function clearCache() {
  try {
    const db = await openDatabase();
    if (db) await new Promise(resolve => {
      const transaction = db.transaction('entries', 'readwrite');
      transaction.objectStore('entries').clear();
      transaction.oncomplete = transaction.onerror = transaction.onabort = () => resolve();
    });
  } catch {}
}

export function cacheableThread(thread) {
  const {id, name, preview, cwd, projectId, projectName, projectPath, projectless, pinned, source, turns, olderTurnsCursor} = thread;
  return {id, name, preview, cwd, projectId, projectName, projectPath, projectless, pinned, source, turns, olderTurnsCursor};
}

export function mergeCachedHistory(previous, fresh) {
  if (previous?.id !== fresh.id || !fresh.olderTurnsCursor || !fresh.turns?.length) return fresh;
  const boundary = previous.turns?.findIndex(turn => turn.id === fresh.turns[0].id) ?? -1;
  if (boundary <= 0) return fresh;
  return {...fresh, turns:[...previous.turns.slice(0,boundary), ...fresh.turns], olderTurnsCursor:previous.olderTurnsCursor ?? null};
}
