/**
 * ThumbCache — IndexedDB-backed thumbnail cache.
 *
 * Key   : objectHandle (number) — unique per MTP object
 * Value : { blob: Blob, ts: number }
 *
 * TTL: 7 days. Stale entries are evicted lazily on read.
 */

const DB_NAME = 'wixplorer_thumbs';
const STORE   = 'thumbnails';
const VERSION = 1;
const TTL_MS  = 7 * 24 * 60 * 60 * 1000; // 7 days

interface CacheEntry {
  handle: number;
  blob: Blob;
  ts: number;
}

class ThumbCacheService {
  private db: IDBDatabase | null = null;
  private opening: Promise<IDBDatabase> | null = null;

  private open(): Promise<IDBDatabase> {
    if (this.db) return Promise.resolve(this.db);
    if (this.opening) return this.opening;

    this.opening = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, VERSION);
      req.onupgradeneeded = () => {
        req.result.createObjectStore(STORE, { keyPath: 'handle' });
      };
      req.onsuccess = () => {
        this.db = req.result;
        resolve(req.result);
      };
      req.onerror = () => reject(req.error);
    });

    return this.opening;
  }

  async get(handle: number): Promise<Blob | null> {
    try {
      const db = await this.open();
      return new Promise((resolve) => {
        const tx = db.transaction(STORE, 'readonly');
        const req = tx.objectStore(STORE).get(handle);
        req.onsuccess = () => {
          const entry: CacheEntry | undefined = req.result;
          if (!entry) { resolve(null); return; }
          // Evict stale entries
          if (Date.now() - entry.ts > TTL_MS) {
            this.delete(handle);
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

  async set(handle: number, blob: Blob): Promise<void> {
    try {
      const db = await this.open();
      return new Promise((resolve) => {
        const tx = db.transaction(STORE, 'readwrite');
        tx.objectStore(STORE).put({ handle, blob, ts: Date.now() });
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

  private async delete(handle: number): Promise<void> {
    try {
      const db = await this.open();
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).delete(handle);
    } catch { /* ignore */ }
  }
}

export const ThumbCache = new ThumbCacheService();
