"use client";

// A small hand-rolled IndexedDB wrapper. No dependency: the app needs three
// object stores and about six operations, which is less code than the wrapper
// libraries that would provide them.
//
// Three stores, one job each:
//
//   meta      the snapshot, plus small bookkeeping values (which trips the user
//             marked available offline, when the last sync ran)
//   queue     pending writes, in insertion order
//
// Every function resolves rather than throwing: a browser in private mode, a
// blocked upgrade, or a quota refusal all degrade to "no offline data", which
// is the same shape as a first visit. The one thing that must never happen is
// losing a queued write, so the queue's own writes report failure to the
// caller (see enqueue) instead of swallowing it.

const DB_NAME = "batchport-offline";
const DB_VERSION = 1;

export const STORE_META = "meta";
export const STORE_QUEUE = "queue";

/** Keys used in the meta store. */
export const META_SNAPSHOT = "snapshot";
export const META_OFFLINE_TRIPS = "offlineTrips";

let dbPromise: Promise<IDBDatabase | null> | null = null;

function openDb(): Promise<IDBDatabase | null> {
  if (typeof indexedDB === "undefined") return Promise.resolve(null);
  if (dbPromise) return dbPromise;

  dbPromise = new Promise((resolve) => {
    let request: IDBOpenDBRequest;
    try {
      request = indexedDB.open(DB_NAME, DB_VERSION);
    } catch {
      resolve(null);
      return;
    }
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_META)) {
        db.createObjectStore(STORE_META);
      }
      if (!db.objectStoreNames.contains(STORE_QUEUE)) {
        db.createObjectStore(STORE_QUEUE, { keyPath: "id" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => resolve(null);
    request.onblocked = () => resolve(null);
  });

  return dbPromise;
}

function runTransaction<T>(
  store: string,
  mode: IDBTransactionMode,
  work: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T | null> {
  return openDb().then(
    (db) =>
      new Promise<T | null>((resolve) => {
        if (!db) {
          resolve(null);
          return;
        }
        let request: IDBRequest<T>;
        try {
          const transaction = db.transaction(store, mode);
          request = work(transaction.objectStore(store));
        } catch {
          resolve(null);
          return;
        }
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => resolve(null);
      }),
  );
}

/** Read one value from the meta store. Null when absent or unavailable. */
export async function metaGet<T>(key: string): Promise<T | null> {
  const value = await runTransaction<T>(STORE_META, "readonly", (store) =>
    store.get(key),
  );
  return value ?? null;
}

/** Write one value to the meta store. Returns false when the write did not
 * land (quota, private mode), so callers that care can say so. */
export async function metaPut(key: string, value: unknown): Promise<boolean> {
  const result = await runTransaction<IDBValidKey>(
    STORE_META,
    "readwrite",
    (store) => store.put(value, key),
  );
  return result !== null;
}

export async function metaDelete(key: string): Promise<void> {
  await runTransaction<undefined>(STORE_META, "readwrite", (store) =>
    store.delete(key),
  );
}

/** Every queue row, oldest first (insertion order is the key order, since ids
 * are time-prefixed). */
export async function queueAll<T>(): Promise<T[]> {
  const rows = await runTransaction<T[]>(STORE_QUEUE, "readonly", (store) =>
    store.getAll(),
  );
  return rows ?? [];
}

/** Insert or replace one queue row. Returns false when the write failed, which
 * the caller MUST surface: a queued write the user believes is safe but which
 * never reached storage is exactly the silent data loss this whole feature is
 * built to avoid. */
export async function queuePut(row: { id: string }): Promise<boolean> {
  const result = await runTransaction<IDBValidKey>(
    STORE_QUEUE,
    "readwrite",
    (store) => store.put(row),
  );
  return result !== null;
}

export async function queueDelete(id: string): Promise<void> {
  await runTransaction<undefined>(STORE_QUEUE, "readwrite", (store) =>
    store.delete(id),
  );
}

/** Wipe every trace of offline state. Used on sign-out, so a shared device
 * does not keep one account's trips readable to the next one. */
export async function clearOfflineStorage(): Promise<void> {
  await Promise.all([
    runTransaction<undefined>(STORE_META, "readwrite", (store) =>
      store.clear(),
    ),
    runTransaction<undefined>(STORE_QUEUE, "readwrite", (store) =>
      store.clear(),
    ),
  ]);
}
