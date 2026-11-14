/**
 * RecentsStorage — localStorage-backed list of recently accessed MTP files.
 * Max 20 entries, ordered by most recent access first.
 */

const STORAGE_KEY = 'wixplorer_recents';
const MAX_ENTRIES = 20;

export interface RecentEntry {
  /** MTP objectHandle — used to verify the file still exists */
  id: number;
  name: string;
  size: number;
  dateModified: string;
  /** ISO timestamp of last access via this app */
  accessedAt: string;
  /** Extension detected at access time */
  ext: string;
}

function load(): RecentEntry[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as RecentEntry[]) : [];
  } catch {
    return [];
  }
}

function save(entries: RecentEntry[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(entries));
  } catch { /* quota exceeded — ignore */ }
}

export const RecentsStorage = {
  getAll(): RecentEntry[] {
    return load();
  },

  /** Add or update a file; bumps it to the top and trims to MAX_ENTRIES */
  touch(file: { id: number; name: string; size: number; dateModified: string }): void {
    const entries = load().filter(e => e.id !== file.id);
    const ext = file.name.split('.').pop()?.toLowerCase() ?? '';
    entries.unshift({
      id: file.id,
      name: file.name,
      size: file.size,
      dateModified: file.dateModified,
      accessedAt: new Date().toISOString(),
      ext,
    });
    save(entries.slice(0, MAX_ENTRIES));
  },

  /** Remove a specific entry (e.g. file no longer exists) */
  remove(id: number): void {
    save(load().filter(e => e.id !== id));
  },

  /** Clear all */
  clear(): void {
    localStorage.removeItem(STORAGE_KEY);
  },
};
