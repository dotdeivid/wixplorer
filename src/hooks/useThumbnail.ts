/**
 * useThumbnail
 *
 * Lazy-loads a thumbnail for a given image file using:
 *  1. IntersectionObserver — only fetches when the element enters the viewport
 *  2. In-memory LRU cache  — instant hit for recently viewed blobs (no async)
 *  3. IndexedDB (ThumbCache) — persistent cache across sessions
 *  4. Serial USB queue / parallel WiFi queue — prevents concurrent MTP requests
 *
 * Cancellation: each hook instance owns a generation counter.  When the file
 * changes or the component unmounts, the generation is incremented so any
 * pending queue task can detect it is stale and skip the work.
 *
 * Usage:
 *   const { thumbUrl, thumbRef } = useThumbnail({ file, getThumb });
 *   <div ref={thumbRef}><img src={thumbUrl ?? undefined} /></div>
 */

import { useEffect, useRef, useState, useCallback } from 'react';
import { ThumbCache } from '../services/cache/ThumbCache';
import type { FileItem } from './useMTPDevice';

/* ── In-memory LRU blob cache ────────────────────────────────────────────── */
// Stores raw Blob objects (not object URLs) — safe to keep across component
// lifecycles since Blobs are plain data and cannot become "revoked".
const LRU_MAX = 200;
const _lruCache = new Map<number, Blob>();

function lruGet(id: number): Blob | undefined {
  const blob = _lruCache.get(id);
  if (blob !== undefined) {
    // Promote to most-recently-used position
    _lruCache.delete(id);
    _lruCache.set(id, blob);
  }
  return blob;
}

function lruSet(id: number, blob: Blob): void {
  if (_lruCache.size >= LRU_MAX) {
    // Evict the oldest entry (first key in insertion-order Map)
    const oldest = _lruCache.keys().next().value!;
    _lruCache.delete(oldest);
  }
  _lruCache.set(id, blob);
}

/** Evict a single entry (e.g. after a failed or corrupt thumb). */
export function lruEvict(id: number): void {
  _lruCache.delete(id);
}

/** Clear the entire in-memory LRU (call when a new network session starts). */
export function clearLruCache(): void {
  _lruCache.clear();
}

/* ── Concurrent request queue ───────────────────────────────────────────── */
// USB bulk transfers are serial → maxConcurrent = 1.
// WiFi HTTP supports parallel requests → maxConcurrent = 4.
type QueueTask = () => Promise<void>;

function makeQueue(maxConcurrent: number) {
  const pending: QueueTask[] = [];
  let active = 0;

  function drain() {
    while (active < maxConcurrent && pending.length > 0) {
      const task = pending.shift()!;
      active++;
      task().finally(() => { active--; drain(); });
    }
  }

  return {
    enqueue(task: QueueTask) { pending.push(task); drain(); },
    clear() { pending.length = 0; },
  };
}

const usbQueue     = makeQueue(1); // MTP es serial
const networkQueue = makeQueue(4); // WiFi soporta paralelo

function enqueue(task: QueueTask, isNetwork = false) {
  (isNetwork ? networkQueue : usbQueue).enqueue(task);
}

/** Clear both queues (e.g. when navigating away from a folder) */
export function clearThumbQueue() {
  usbQueue.clear();
  networkQueue.clear();
}

/* ── File extensions that support thumbnails ────────────────────────────── */
const IMAGE_EXTS = new Set([
  'jpg','jpeg','png','gif','heic','heif','webp','bmp','tiff','tif','raw',
  'cr2','nef','arw','dng',
  'mp4','mov','avi','mkv','3gp',
]);

export function isImageFile(name: string): boolean {
  const ext = name.split('.').pop()?.toLowerCase() ?? '';
  return IMAGE_EXTS.has(ext);
}

/* ── Hook ───────────────────────────────────────────────────────────────── */
interface UseThumbnailOptions {
  file: FileItem;
  getThumb: (handle: number) => Promise<Blob | null>;
  /** Root margin for IntersectionObserver — how far outside viewport to start loading */
  rootMargin?: string;
  /** true when source is WiFi — uses parallel queue instead of serial */
  isNetwork?: boolean;
}

export function useThumbnail({ file, getThumb, rootMargin = '80px', isNetwork = false }: UseThumbnailOptions) {
  const [thumbUrl, setThumbUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const thumbRef = useRef<HTMLDivElement>(null);
  const fetchedRef = useRef(false);
  const blobUrlRef = useRef<string | null>(null);
  /**
   * Generation counter — incremented on each file.id change or unmount.
   * A queue task captures its generation at enqueue time; if the counter
   * has advanced by the time the task executes, the task is stale and
   * should be skipped (out-of-viewport cancellation).
   */
  const generationRef = useRef(0);

  // Reset state for new file; cancel any pending task from previous file
  useEffect(() => {
    fetchedRef.current = false;
    setThumbUrl(null);
    setLoading(false);

    return () => {
      generationRef.current++; // invalidate pending tasks
      if (blobUrlRef.current) {
        URL.revokeObjectURL(blobUrlRef.current);
        blobUrlRef.current = null;
      }
    };
  }, [file.id]);

  const doFetch = useCallback(async () => {
    if (fetchedRef.current) return;
    if (!isImageFile(file.name)) return;
    fetchedRef.current = true;
    setLoading(true);

    // 0. In-memory LRU — instant, no I/O
    const memBlob = lruGet(file.id);
    if (memBlob) {
      const url = URL.createObjectURL(memBlob);
      blobUrlRef.current = url;
      setThumbUrl(url);
      setLoading(false);
      return;
    }

    // 1. IndexedDB cache — async but no USB/network.
    // Skipped in network mode: file.id is an ephemeral counter that restarts
    // from 1 on each page load, so cross-session IDs collide with unrelated files.
    if (!isNetwork) {
      const cached = await ThumbCache.get(file.id);
      if (cached) {
        lruSet(file.id, cached);
        const url = URL.createObjectURL(cached);
        blobUrlRef.current = url;
        setThumbUrl(url);
        setLoading(false);
        return;
      }
    }

    // 2. Enqueue USB/network fetch — capture generation for cancellation
    const gen = generationRef.current;
    enqueue(async () => {
      // Skip if component unmounted or file changed while waiting in queue
      if (generationRef.current !== gen) return;
      try {
        const blob = await getThumb(file.id);
        if (generationRef.current !== gen) return; // stale after async call
        if (blob && blob.size > 0) {
          if (!isNetwork) await ThumbCache.set(file.id, blob);
          lruSet(file.id, blob);
          if (generationRef.current === gen) {
            const url = URL.createObjectURL(blob);
            blobUrlRef.current = url;
            setThumbUrl(url);
          }
        }
      } finally {
        if (generationRef.current === gen) setLoading(false);
      }
    }, isNetwork);
  }, [file.id, file.name, getThumb, isNetwork]);

  useEffect(() => {
    if (!isImageFile(file.name)) return;

    const el = thumbRef.current;
    if (!el) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) {
          observer.disconnect();
          doFetch();
        }
      },
      { rootMargin, threshold: 0 }
    );

    observer.observe(el);
    return () => observer.disconnect();
  }, [file.id, file.name, doFetch, rootMargin]);

  return { thumbUrl, loading, thumbRef };
}
