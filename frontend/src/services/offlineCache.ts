/**
 * Offline snapshot of server data (rooms, categories, users, recent messages)
 * plus the text message outbox, in IndexedDB.
 *
 * The app shows this data while the server is unreachable (mobile data drops)
 * and replaces it as soon as fresh data arrives. Every entry is keyed by the
 * signed-in user, so another account never sees it; logout clears it all.
 * All calls swallow IndexedDB errors: without the cache the app behaves as if
 * nothing was ever cached.
 */

const DB_NAME = "orbital-cache"
const DB_VERSION = 1

export type CacheStore = "kv" | "channels" | "outbox"
const STORES: CacheStore[] = ["kv", "channels", "outbox"]

// How long a burst of writes to one key is coalesced.
const WRITE_DEBOUNCE_MS = 500

let dbPromise: Promise<IDBDatabase | null> | null = null
let currentUser = ""

function openDb(): Promise<IDBDatabase | null> {
  if (dbPromise) return dbPromise
  dbPromise = new Promise((resolve) => {
    try {
      if (typeof indexedDB === "undefined") {
        resolve(null)
        return
      }
      const request = indexedDB.open(DB_NAME, DB_VERSION)
      request.onupgradeneeded = () => {
        const db = request.result
        for (const name of STORES) {
          if (!db.objectStoreNames.contains(name)) db.createObjectStore(name)
        }
      }
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => {
        console.warn("[OfflineCache] Failed to open IndexedDB:", request.error)
        resolve(null)
      }
      request.onblocked = () => resolve(null)
    } catch (error) {
      console.warn("[OfflineCache] IndexedDB unavailable:", error)
      resolve(null)
    }
  })
  return dbPromise
}

function promisify<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error ?? new Error("IndexedDB request failed"))
  })
}

async function withStore<T>(
  store: CacheStore,
  mode: IDBTransactionMode,
  run: (s: IDBObjectStore) => IDBRequest<T>,
): Promise<T | undefined> {
  try {
    const db = await openDb()
    if (!db) return undefined
    return await promisify(run(db.transaction(store, mode).objectStore(store)))
  } catch (error) {
    console.warn(`[OfflineCache] ${mode} ${store} failed:`, error)
    return undefined
  }
}

/** Scopes every key to the signed-in user ("" disables the cache). */
export function setOfflineCacheUser(userId: string | null | undefined) {
  if ((userId || "") !== currentUser) cancelPendingWrites()
  currentUser = userId || ""
}

export function offlineCacheUser(): string {
  return currentUser
}

function scoped(key: string): string {
  return `${currentUser}|${key}`
}

/** Plain JSON copy: reactive proxies can't be structured-cloned. */
function plain<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

export async function cacheGet<T>(store: CacheStore, key: string): Promise<T | undefined> {
  if (!currentUser) return undefined
  return (await withStore<T>(store, "readonly", (s) => s.get(scoped(key)) as IDBRequest<T>)) as
    T | undefined
}

export async function cachePut(store: CacheStore, key: string, value: unknown): Promise<void> {
  if (!currentUser) return
  let copy: unknown
  try {
    copy = plain(value)
  } catch (error) {
    console.warn("[OfflineCache] Value is not serializable:", key, error)
    return
  }
  const fullKey = scoped(key)
  await withStore(store, "readwrite", (s) => s.put(copy, fullKey))
}

export async function cacheDelete(store: CacheStore, key: string): Promise<void> {
  if (!currentUser) return
  pendingWrites.delete(`${store}:${scoped(key)}`)
  const fullKey = scoped(key)
  await withStore(store, "readwrite", (s) => s.delete(fullKey))
}

/** All values of a store that belong to the current user. */
export async function cacheGetAll<T>(store: CacheStore): Promise<T[]> {
  if (!currentUser) return []
  const prefix = `${currentUser}|`
  const range = IDBKeyRange.bound(prefix, `${prefix}￿`)
  return (
    ((await withStore(store, "readonly", (s) => s.getAll(range) as IDBRequest<T[]>)) as
      T[] | undefined) ?? []
  )
}

// --- Debounced writes ------------------------------------------------------

const pendingWrites = new Map<string, ReturnType<typeof setTimeout>>()

function cancelPendingWrites() {
  for (const timer of pendingWrites.values()) clearTimeout(timer)
  pendingWrites.clear()
}

/**
 * Writes `read()` after a short quiet period, so WebSocket bursts don't hammer
 * IndexedDB. `read` is evaluated at write time and gets the latest state.
 */
export function cachePutDebounced(store: CacheStore, key: string, read: () => unknown) {
  if (!currentUser) return
  const id = `${store}:${scoped(key)}`
  const existing = pendingWrites.get(id)
  if (existing) clearTimeout(existing)
  const user = currentUser
  pendingWrites.set(
    id,
    setTimeout(() => {
      pendingWrites.delete(id)
      if (user !== currentUser) return
      const value = read()
      if (value !== undefined) void cachePut(store, key, value)
    }, WRITE_DEBOUNCE_MS),
  )
}

/** Drops everything (logout). */
export async function clearOfflineCache(): Promise<void> {
  cancelPendingWrites()
  try {
    const db = await openDb()
    if (!db) return
    const tx = db.transaction(STORES, "readwrite")
    for (const name of STORES) tx.objectStore(name).clear()
    await new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error ?? new Error("IndexedDB clear failed"))
    })
  } catch (error) {
    console.warn("[OfflineCache] Failed to clear:", error)
  }
}
