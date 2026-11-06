import * as MP4Box from 'mp4box';
import type { MtpClient } from './MtpClient';

export interface MtpVideoStreamResult {
  /** mediasource: URL — usar directo como <video src> */
  url: string;
  /** Llamar cuando el elemento <video> ya no necesita esta URL */
  cleanup: () => void;
}

interface TrackHandle {
  id: number;
  sb: SourceBuffer;
  queue: ArrayBuffer[];
  appending: boolean;
  receivedLastSegment: boolean;
}

function drainTrack(track: TrackHandle) {
  if (track.appending || track.queue.length === 0) return;
  track.appending = true;
  try {
    track.sb.appendBuffer(track.queue.shift()!);
  } catch (e) {
    track.appending = false;
    console.warn('[MtpVideoStream] appendBuffer failed:', e);
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
 */
export function createMtpVideoStream(
  objectId: number,
  client: MtpClient,
  signal?: AbortSignal,
  fileSize?: number,
): MtpVideoStreamResult {
  const ms = new MediaSource();
  const url = URL.createObjectURL(ms);

  const cleanup = () => {
    URL.revokeObjectURL(url);
  };

  ms.addEventListener('sourceopen', () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const mp4box = (MP4Box as any).createFile();
    const tracks: TrackHandle[] = [];

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    mp4box.onReady = (info: any) => {
      if (signal?.aborted || ms.readyState !== 'open') return;

      for (const track of info.tracks) {
        const mimeType = `video/mp4; codecs="${track.codec}"`;
        if (!MediaSource.isTypeSupported(mimeType)) continue;

        let sb: SourceBuffer;
        try { sb = ms.addSourceBuffer(mimeType); }
        catch (e) { console.warn('[MtpVideoStream] addSourceBuffer:', e); continue; }

        const handle: TrackHandle = {
          id: track.id, sb, queue: [], appending: false, receivedLastSegment: false,
        };
        tracks.push(handle);

        sb.addEventListener('updateend', () => {
          handle.appending = false;
          if (handle.queue.length > 0) drainTrack(handle);
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
        drainTrack(handle);
      }
    };

    // onSegment se llama con cada segmento listo para MediaSource
    mp4box.onSegment = (
      _id: number,
      handle: TrackHandle,
      buffer: ArrayBuffer,
      _sampleNum: number,
      is_last: boolean,
    ) => {
      if (signal?.aborted) return;
      if (is_last) handle.receivedLastSegment = true;
      handle.queue.push(buffer);
      drainTrack(handle);
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
        if (signal?.aborted) return;
        // mp4box requiere que el ArrayBuffer tenga una propiedad fileStart
        // indicando el offset de este bloque dentro del archivo completo.
        const buf = chunk.slice(0) as ArrayBuffer & { fileStart: number };
        buf.fileStart = fileOffset;
        fileOffset += chunk.byteLength;
        mp4box.appendBuffer(buf);
      },
      signal,
      fileSize,
    )
      .then(() => { mp4box.flush(); })
      .catch((err: unknown) => {
        if ((err as { name?: string })?.name === 'AbortError') return;
        if (ms.readyState === 'open') {
          try { ms.endOfStream('network'); } catch { /* ignore */ }
        }
      });
  }, { once: true });

  return { url, cleanup };
}
