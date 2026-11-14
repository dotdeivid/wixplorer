/**
 * ThumbCache — IndexedDB-backed thumbnail cache.
 *
 * Key   : `${scope}|${name}|${size}|${dateModified}` — see keyFor().
 *         The MTP object handle is NOT used: Android reassigns handles on
 *         every session, so a handle-keyed cache would show another file's
 *         thumbnail after reconnecting.
 * Value : { key, blob, ts }
 *
 * TTL: 7 days. Stale entries are evicted on read and when the DB opens.
 */

const DB_NAME = 'wixplorer_thumbs';
const STORE   = 'thumbnails';
const VERSION = 2;
const TTL_MS  = 7 * 24 * 60 * 60 * 1000; // 7 days

interface CacheEntry {
  key: string;
  blob: Blob;
  ts: number;
}

class ThumbCacheService {
  private db: IDBDatabase | null = null;
  private opening: Promise<IDBDatabase> | null = null;
  /** Identifica al dispositivo conectado; null = sin dispositivo → sin caché persistente. */
  private scope: string | null = null;

  /** Fija el dispositivo actual (p.ej. su número de serie USB). */
  setScope(scope: string | null): void {
    this.scope = scope;
  }

  /** Clave persistente de un archivo del dispositivo actual, o null si no hay scope. */
  keyFor(file: { name: string; size: number; dateModified: string }): string | null {
    if (!this.scope) return null;
    return `${this.scope}|${file.name}|${file.size}|${file.dateModified}`;
  }

  private open(): Promise<IDBDatabase> {
    if (this.db) return Promise.resolve(this.db);
    if (this.opening) return this.opening;

    this.opening = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, VERSION);
      req.onupgradeneeded = () => {
        // v1 usaba el handle MTP como clave — descartar esas entradas.
        if (req.result.objectStoreNames.contains(STORE)) {
          req.result.deleteObjectStore(STORE);
        }
        req.result.createObjectStore(STORE, { keyPath: 'key' });
      };
      req.onsuccess = () => {
        this.db = req.result;
        this.pruneExpired(req.result);
        resolve(req.result);
      };
      req.onerror = () => reject(req.error);
    });

    return this.opening;
  }

  async get(key: string): Promise<Blob | null> {
    try {
      const db = await this.open();
      return new Promise((resolve) => {
        const tx = db.transaction(STORE, 'readonly');
        const req = tx.objectStore(STORE).get(key);
        req.onsuccess = () => {
          const entry: CacheEntry | undefined = req.result;
          if (!entry) { resolve(null); return; }
          // Evict stale entries
          if (Date.now() - entry.ts > TTL_MS) {
            this.delete(key);
            resolve(null);
            return;
          }
          resolve(entry.blob);
        };
        req.onerror = () => resolve(null);
      });
    } catch {
      return null;
    }
  }

  async set(key: string, blob: Blob): Promise<void> {
    try {
      const db = await this.open();
      return new Promise((resolve) => {
        const tx = db.transaction(STORE, 'readwrite');
        tx.objectStore(STORE).put({ key, blob, ts: Date.now() } satisfies CacheEntry);
        tx.oncomplete = () => resolve();
        tx.onerror = () => resolve(); // non-fatal
      });
    } catch {
      // Non-fatal — app still works without cache
    }
  }

  async clear(): Promise<void> {
    try {
      const db = await this.open();
      return new Promise((resolve) => {
        const tx = db.transaction(STORE, 'readwrite');
        tx.objectStore(STORE).clear();
        tx.oncomplete = () => resolve();
        tx.onerror = () => resolve();
      });
    } catch { /* ignore */ }
  }

  private async delete(key: string): Promise<void> {
    try {
      const db = await this.open();
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).delete(key);
    } catch { /* ignore */ }
  }

  /** Borra las entradas vencidas para que la base no crezca sin límite. */
  private pruneExpired(db: IDBDatabase): void {
    try {
      const tx = db.transaction(STORE, 'readwrite');
      const req = tx.objectStore(STORE).openCursor();
      const cutoff = Date.now() - TTL_MS;
      req.onsuccess = () => {
        const cursor = req.result;
        if (!cursor) return;
        if ((cursor.value as CacheEntry).ts < cutoff) cursor.delete();
        cursor.continue();
      };
    } catch { /* ignore */ }
  }
}

export const ThumbCache = new ThumbCacheService();
