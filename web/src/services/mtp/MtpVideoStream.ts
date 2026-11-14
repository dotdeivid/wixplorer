import * as MP4Box from 'mp4box';
import type { MtpClient } from './MtpClient';

export interface MtpVideoStreamResult {
  /** mediasource: URL — usar directo como <video src> */
  url: string;
  /** Llamar cuando el elemento <video> ya no necesita esta URL. Aborta la transferencia USB. */
  cleanup: () => void;
}

interface TrackHandle {
  id: number;
  sb: SourceBuffer;
  queue: ArrayBuffer[];
  queuedBytes: number;
  appending: boolean;
  receivedLastSegment: boolean;
  /** El último append falló por cuota y no había nada reproducido para liberar. */
  quotaBlocked: boolean;
}

/** Bytes de segmentos esperando append antes de frenar la lectura USB. */
const MAX_QUEUED_BYTES = 16 * 1024 * 1024;
/** Segundos ya reproducidos que se conservan al liberar buffer. */
const BACK_BUFFER_SEC = 10;
/** Cada cuánto se reintenta un append bloqueado por cuota. */
const QUOTA_RETRY_MS = 1000;

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

function isQuotaError(e: unknown): boolean {
  return (e as { name?: string })?.name === 'QuotaExceededError';
}

/**
 * Agrega el próximo segmento de la cola. Si el SourceBuffer está lleno,
 * libera lo ya reproducido (más de BACK_BUFFER_SEC atrás) y reintenta en
 * `updateend`; si todavía no hay nada que liberar, queda bloqueado hasta que
 * avance la reproducción (lo reintenta el intervalo de createMtpVideoStream).
 */
function drainTrack(track: TrackHandle, getCurrentTime: () => number) {
  if (track.appending || track.sb.updating || track.queue.length === 0) return;
  const next = track.queue[0];
  try {
    track.sb.appendBuffer(next);
    track.queue.shift();
    track.queuedBytes -= next.byteLength;
    track.appending = true;
    track.quotaBlocked = false;
  } catch (e) {
    if (!isQuotaError(e)) {
      // Segmento inválido: descartarlo para no trabar la cola
      track.queue.shift();
      track.queuedBytes -= next.byteLength;
      console.warn('[MtpVideoStream] appendBuffer failed:', e);
      return;
    }
    const buffered = track.sb.buffered;
    const removeEnd = getCurrentTime() - BACK_BUFFER_SEC;
    if (buffered.length > 0 && removeEnd > buffered.start(0)) {
      track.appending = true;
      track.sb.remove(buffered.start(0), removeEnd); // updateend → drainTrack
    } else {
      track.quotaBlocked = true;
    }
  }
}

function tryEndStream(tracks: TrackHandle[], ms: MediaSource) {
  if (ms.readyState !== 'open') return;
  const allDone = tracks.every(
    t => t.receivedLastSegment && !t.appending && t.queue.length === 0,
  );
  if (allDone) {
    try { ms.endOfStream(); } catch { /* ignore */ }
  }
}

/**
 * Crea un stream de video MTP usando MediaSource Extensions + mp4box.js.
 *
 * Para videos con moov-at-start (la mayoría de grabaciones Android modernas)
 * la reproducción comienza en 1–3 segundos desde que arranca la transferencia USB.
 * Para videos con moov-at-end el comportamiento es igual que la descarga completa,
 * pero con menor uso de memoria (MSE gestiona su propio buffer interno).
 *
 * La lectura USB se frena cuando hay demasiados segmentos sin agregar al
 * SourceBuffer, así la memoria queda acotada aunque el video sea largo.
 * Mientras dura, la transferencia ocupa la cola MTP: hay que llamar a
 * `cleanup()` (o abortar `signal`) al dejar de mostrar el video.
 *
 * @param getCurrentTime posición de reproducción, para saber qué buffer liberar.
 */
export function createMtpVideoStream(
  objectId: number,
  client: MtpClient,
  signal?: AbortSignal,
  fileSize?: number,
  getCurrentTime: () => number = () => 0,
): MtpVideoStreamResult {
  const ms = new MediaSource();
  const url = URL.createObjectURL(ms);

  // Abort propio: lo dispara cleanup() o el signal externo.
  const ctrl = new AbortController();
  const onExternalAbort = () => ctrl.abort();
  signal?.addEventListener('abort', onExternalAbort, { once: true });
  if (signal?.aborted) ctrl.abort();

  let retryTimer: ReturnType<typeof setInterval> | null = null;

  const cleanup = () => {
    ctrl.abort();
    signal?.removeEventListener('abort', onExternalAbort);
    if (retryTimer) clearInterval(retryTimer);
    URL.revokeObjectURL(url);
  };

  ms.addEventListener('sourceopen', () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const mp4box = (MP4Box as any).createFile();
    const tracks: TrackHandle[] = [];
    const drainAll = () => tracks.forEach(t => drainTrack(t, getCurrentTime));

    retryTimer = setInterval(() => {
      if (tracks.some(t => t.quotaBlocked)) drainAll();
    }, QUOTA_RETRY_MS);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    mp4box.onReady = (info: any) => {
      if (ctrl.signal.aborted || ms.readyState !== 'open') return;

      for (const track of info.tracks) {
        const mimeType = `video/mp4; codecs="${track.codec}"`;
        if (!MediaSource.isTypeSupported(mimeType)) continue;

        let sb: SourceBuffer;
        try { sb = ms.addSourceBuffer(mimeType); }
        catch (e) { console.warn('[MtpVideoStream] addSourceBuffer:', e); continue; }

        const handle: TrackHandle = {
          id: track.id, sb, queue: [], queuedBytes: 0,
          appending: false, receivedLastSegment: false, quotaBlocked: false,
        };
        tracks.push(handle);

        sb.addEventListener('updateend', () => {
          handle.appending = false;
          if (handle.queue.length > 0) drainTrack(handle, getCurrentTime);
          else tryEndStream(tracks, ms);
        });

        // nbSamples: cuántos frames por segmento antes de emitir onSegment.
        // 200 frames ≈ ~6s a 30fps — buena granularidad sin overhead excesivo.
        mp4box.setSegmentOptions(track.id, handle, { nbSamples: 200 });
      }

      if (tracks.length === 0) {
        try { ms.endOfStream('decode'); } catch { /* ignore */ }
        return;
      }

      // initializeSegmentation devuelve los segmentos de inicialización (moov)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const initSegs: any[] = mp4box.initializeSegmentation();
      for (const seg of initSegs) {
        const handle = tracks.find(t => t.id === seg.id);
        if (!handle) continue;
        handle.queue.push(seg.buffer);
        handle.queuedBytes += seg.buffer.byteLength;
        drainTrack(handle, getCurrentTime);
      }
      mp4box.start();
    };

    // onSegment se llama con cada segmento listo para MediaSource
    mp4box.onSegment = (
      id: number,
      handle: TrackHandle,
      buffer: ArrayBuffer,
      sampleNum: number,
      is_last: boolean,
    ) => {
      if (ctrl.signal.aborted) return;
      // Las muestras ya segmentadas no se vuelven a usar: liberarlas evita
      // que mp4box retenga el archivo entero en memoria.
      mp4box.releaseUsedSamples(id, sampleNum);
      if (is_last) handle.receivedLastSegment = true;
      handle.queue.push(buffer);
      handle.queuedBytes += buffer.byteLength;
      drainTrack(handle, getCurrentTime);
      if (is_last) tryEndStream(tracks, ms);
    };

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    mp4box.onError = (e: any) => {
      console.warn('[MtpVideoStream] mp4box error:', e);
      if (ms.readyState === 'open') {
        try { ms.endOfStream('decode'); } catch { /* ignore */ }
      }
    };

    // ── Transferencia USB → mp4box ───────────────────────────────────
    let fileOffset = 0;
    client.getObject(
      objectId,
      async (chunk: ArrayBuffer) => {
        if (ctrl.signal.aborted) return;
        // mp4box requiere que el ArrayBuffer tenga una propiedad fileStart
        // indicando el offset de este bloque dentro del archivo completo.
        const buf = chunk.slice(0) as ArrayBuffer & { fileStart: number };
        buf.fileStart = fileOffset;
        fileOffset += chunk.byteLength;
        mp4box.appendBuffer(buf);

        // Backpressure: no leer más del USB mientras el SourceBuffer no
        // absorba lo pendiente. Si el <video> ya no existe (MediaSource
        // cerrado), abortar para liberar la cola MTP.
        while (tracks.reduce((n, t) => n + t.queuedBytes, 0) > MAX_QUEUED_BYTES) {
          if (ms.readyState !== 'open') ctrl.abort();
          if (ctrl.signal.aborted) return;
          await sleep(200);
        }
      },
      ctrl.signal,
      fileSize,
    )
      .then(() => { mp4box.flush(); })
      .catch((err: unknown) => {
        if ((err as { name?: string })?.name === 'AbortError') return;
        if (ms.readyState === 'open') {
          try { ms.endOfStream('network'); } catch { /* ignore */ }
        }
      })
      .finally(() => {
        if (retryTimer && ctrl.signal.aborted) clearInterval(retryTimer);
      });
  }, { once: true });

  return { url, cleanup };
}
