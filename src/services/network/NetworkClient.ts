export interface NetworkFileData {
  name: string;
  path: string;
  isFolder: boolean;
  size: number;
  dateModified: number; // epoch ms
  mimeType?: string;
}

export interface NetworkStorage {
  id: string;
  name: string;
  path: string;
}

/**
 * Cliente HTTP para el servidor WiXplorer en el teléfono.
 * Todas las peticiones (excepto /api/ping y /api/auth) llevan Bearer token.
 */
export class NetworkClient {
  private baseUrl: string;
  private token: string;

  constructor(ip: string, port: number, token: string) {
    this.baseUrl = `http://${ip}:${port}`;
    this.token = token;
  }

  private get authHeader(): Record<string, string> {
    return { Authorization: `Bearer ${this.token}` };
  }

  async getStorages(): Promise<NetworkStorage[]> {
    const res = await fetch(`${this.baseUrl}/api/storages`, {
      headers: this.authHeader,
    });
    if (!res.ok) throw new Error(`storages: HTTP ${res.status}`);
    return res.json();
  }

  /**
   * Lista archivos de una carpeta.
   *
   * Si el servidor soporta NDJSON streaming (Flutter ≥ esta versión), los items
   * llegan progresivamente y `onChunk` se invoca con la lista acumulada cada vez
   * que llega un batch. Esto permite renderizado incremental en la UI.
   *
   * Fallback automático a JSON array si el servidor no soporta NDJSON.
   */
  async listFiles(
    path: string,
    onChunk?: (accumulated: NetworkFileData[]) => void,
  ): Promise<NetworkFileData[]> {
    const res = await fetch(
      `${this.baseUrl}/api/files?path=${encodeURIComponent(path)}`,
      {
        headers: {
          ...this.authHeader,
          // Señalizar al servidor que soportamos NDJSON streaming
          Accept: 'application/x-ndjson, application/json',
        },
      }
    );

    if (res.status === 401) throw new Error('SESSION_EXPIRED');
    if (!res.ok) throw new Error(`files: HTTP ${res.status}`);

    const contentType = res.headers.get('content-type') ?? '';

    // ── Streaming NDJSON ──────────────────────────────────────────────────
    // Usar _readNdjson siempre que el servidor responda con NDJSON, con o sin
    // onChunk. Sin onChunk simplemente acumula todos los ítems sin notificar.
    if (contentType.includes('x-ndjson') && res.body) {
      return this._readNdjson(res.body, onChunk ?? (() => {}));
    }

    // ── JSON array (fallback / servidor antiguo) ──────────────────────────
    return res.json();
  }

  /** Lee un ReadableStream de NDJSON e invoca [onChunk] con la lista acumulada. */
  private async _readNdjson(
    body: ReadableStream<Uint8Array>,
    onChunk: (accumulated: NetworkFileData[]) => void,
  ): Promise<NetworkFileData[]> {
    const reader = body.getReader();
    const decoder = new TextDecoder();
    const all: NetworkFileData[] = [];
    let buffer = '';
    let pending: NetworkFileData[] = [];

    const flush = () => {
      if (pending.length === 0) return;
      all.push(...pending);
      pending = [];
      onChunk([...all]); // copia inmutable para React
    };

    while (true) {
      const { done, value } = await reader.read();
      if (done) { flush(); break; }

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop()!; // última línea incompleta

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        try {
          pending.push(JSON.parse(trimmed) as NetworkFileData);
        } catch { /* ignorar líneas malformadas */ }
      }

      // Notificar al cliente cada 50 ítems para no saturar React con re-renders
      if (pending.length >= 50) flush();
    }

    return all;
  }

  /**
   * Descarga un archivo usando chunks paralelos (Range requests) para maximizar
   * el throughput WiFi. Estrategia:
   *
   * 1. Si el browser soporta File System Access API (Chrome/Edge): muestra el
   *    diálogo de guardar PRIMERO (mientras aún hay gesto del usuario), luego
   *    descarga 6 chunks en paralelo y los escribe directo al disco → sin RAM.
   *
   * 2. Si no hay FSAA: descarga 6 chunks en paralelo, ensambla un Blob y
   *    dispara `<a download>` → usa RAM pero 2-4× más rápido que conexión única.
   *
   * 3. Si no se puede determinar el tamaño (el servidor no devuelve
   *    Content-Range): descarga directa vía URL con token (single connection).
   */
  async downloadFileChunked(
    path: string,
    fileName: string,
    onProgress?: (pct: number, bytesPerSec: number, etaSec: number | null) => void,
    signal?: AbortSignal,
  ): Promise<void> {
    const url = this.getFileUrl(path);

    // ── 1. Capturar gesto del usuario ANTES de cualquier await ──────────────
    // showSaveFilePicker() pierde el contexto de gesto del usuario si se llama
    // después de un await (como el probe fetch de abajo). Debe ser lo primero.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let fsWritable: any = null;
    if ('showSaveFilePicker' in window) {
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const handle = await (window as any).showSaveFilePicker({
          suggestedName: fileName,
          startIn: 'downloads',
        });
        fsWritable = await handle.createWritable();
      } catch (e: any) {
        if (e?.name === 'AbortError') return; // usuario canceló el diálogo
        // Otro error (permisos, etc.) → continuar sin FSAA
      }
    }

    // ── 2. Obtener tamaño total con un Range probe mínimo ───────────────────
    let totalSize = 0;
    try {
      const probe = await fetch(url, {
        headers: { ...this.authHeader, Range: 'bytes=0-0' },
        signal,
      });
      if (probe.status === 206) {
        const m = probe.headers.get('content-range')?.match(/\/(\d+)$/);
        if (m) totalSize = parseInt(m[1]);
      } else if (probe.status === 200) {
        totalSize = parseInt(probe.headers.get('content-length') || '0');
      }
    } catch { /* tamaño desconocido */ }

    // ── 3. Sin tamaño conocido → descarga directa (sin chunks) ─────────────
    if (totalSize === 0) {
      if (fsWritable) {
        const res = await fetch(url, { headers: this.authHeader, signal });
        const reader = res.body!.getReader();
        let offset = 0;
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          await fsWritable.write({ type: 'write', position: offset, data: value });
          offset += value.byteLength;
        }
        await fsWritable.close();
      } else {
        const a = document.createElement('a');
        a.href = url; a.download = fileName;
        document.body.appendChild(a); a.click();
        document.body.removeChild(a);
      }
      return;
    }

    // ── 4. Descarga adaptativa: slow-start + worker pool ───────────────────
    //
    // Arranca con 2 conexiones paralelas y sube de a 1 cada PROBE_INTERVAL ms
    // mientras el throughput siga mejorando, hasta MAX_CONCURRENCY.
    // En servidor cargado (descarga + navegación simultánea) se estabiliza
    // en 2–3 conexiones; en servidor libre llega a MAX_CONCURRENCY.
    // 12 chunks pequeños dan más granularidad al scheduler que 6 grandes.
    const NUM_CHUNKS     = 12;
    const MAX_CONCURRENCY = 6;
    const PROBE_INTERVAL  = 1500; // ms entre intentos de subir concurrencia

    const chunkSize = Math.ceil(totalSize / NUM_CHUNKS);
    let received = 0;
    const t0 = Date.now();
    let smoothedSpeed = 0;

    // Estado del slow-start
    let concurrency     = 2;
    let lastProbeAt     = t0;
    let lastProbeBytes  = 0;

    /** Intenta subir concurrencia si el throughput de la última ventana es bueno. */
    const maybeScale = () => {
      if (concurrency >= MAX_CONCURRENCY) return;
      const now = Date.now();
      const elapsed = (now - lastProbeAt) / 1000;
      if (elapsed < PROBE_INTERVAL / 1000) return;
      const windowSpeed = (received - lastProbeBytes) / elapsed;
      // Si la ventana alcanzó al menos el 65% de la velocidad suavizada → añadir conexión
      if (smoothedSpeed > 0 && windowSpeed >= smoothedSpeed * 0.65) {
        concurrency++;
      }
      lastProbeAt    = now;
      lastProbeBytes = received;
    };

    /**
     * Descarga el chunk i streamando bytes para progreso incremental.
     * Si se provee onWrite, escribe cada pieza en posición exacta (FSAA).
     */
    const fetchChunkStreamed = async (
      i: number,
      onWrite?: (position: number, data: Uint8Array) => Promise<void>,
    ): Promise<{ offset: number; data: ArrayBuffer }> => {
      const start = i * chunkSize;
      const end   = Math.min(start + chunkSize - 1, totalSize - 1);
      const res = await fetch(url, {
        headers: { ...this.authHeader, Range: `bytes=${start}-${end}` },
        signal,
      });
      if (!res.ok) throw new Error(`chunk ${i}: HTTP ${res.status}`);

      const reader = res.body!.getReader();
      const parts: Uint8Array[] = [];
      let position = start;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        received += value.byteLength;
        const elapsed = Math.max((Date.now() - t0) / 1000, 0.001);
        const instantSpeed = received / elapsed;
        smoothedSpeed = smoothedSpeed === 0
          ? instantSpeed
          : 0.15 * instantSpeed + 0.85 * smoothedSpeed;
        const pct    = Math.min(99, Math.round((received / totalSize) * 100));
        const etaSec = smoothedSpeed > 0
          ? Math.round((totalSize - received) / smoothedSpeed)
          : null;
        onProgress?.(pct, smoothedSpeed, etaSec);

        if (onWrite) await onWrite(position, value);
        else parts.push(value);
        position += value.byteLength;
      }

      if (onWrite) return { offset: start, data: new ArrayBuffer(0) };

      const total = parts.reduce((s, p) => s + p.byteLength, 0);
      const buf = new Uint8Array(total);
      let off = 0;
      for (const p of parts) { buf.set(p, off); off += p.byteLength; }
      return { offset: start, data: buf.buffer };
    };

    /**
     * Worker pool con concurrencia dinámica.
     * Despacha hasta `concurrency` chunks en paralelo; al completar cada uno
     * llama a maybeScale() y despacha el siguiente de la cola.
     */
    const runPool = (
      onWrite?: (position: number, data: Uint8Array) => Promise<void>,
    ): Promise<Array<{ offset: number; data: ArrayBuffer }>> =>
      new Promise((resolve, reject) => {
        const queue   = Array.from({ length: NUM_CHUNKS }, (_, i) => i);
        const results = new Array<{ offset: number; data: ArrayBuffer }>(NUM_CHUNKS);
        let active    = 0;
        let done      = 0;

        const dispatch = () => {
          while (active < concurrency && queue.length > 0) {
            const i = queue.shift()!;
            active++;
            fetchChunkStreamed(i, onWrite)
              .then(chunk => {
                results[i] = chunk;
                active--;
                done++;
                maybeScale();           // ¿subir concurrencia?
                if (done === NUM_CHUNKS) resolve(results);
                else dispatch();        // despachar siguiente
              })
              .catch(reject);
          }
        };

        dispatch();
      });

    // ── 4a. FSAA: escribir directo al disco ────────────────────────────────
    if (fsWritable) {
      try {
        await runPool((pos, data) => fsWritable.write({ type: 'write', position: pos, data }));
        await fsWritable.close();
        onProgress?.(100, 0, 0);
        return;
      } catch {
        await fsWritable.close().catch(() => {});
        received = 0;
        smoothedSpeed = 0;
        concurrency = 2;
      }
    }

    // ── 4b. Fallback: ensamblar Blob → <a> click ────────────────────────────
    received     = 0;
    smoothedSpeed = 0;
    concurrency  = 2;
    const chunkResults = await runPool();
    onProgress?.(100, 0, 0);
    const blob = new Blob(chunkResults.map(r => r.data));
    const blobUrl = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = blobUrl; a.download = fileName;
    document.body.appendChild(a); a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(blobUrl), 1000);
  }

  /**
   * Descarga un archivo completo con seguimiento de progreso opcional.
   * @param onProgress Callback con porcentaje (0–100) y velocidad en bytes/s
   */
  async getFileBlob(
    path: string,
    onProgress?: (pct: number, bytesPerSec: number) => void
  ): Promise<Blob> {
    const res = await fetch(
      `${this.baseUrl}/api/file?path=${encodeURIComponent(path)}`,
      { headers: this.authHeader }
    );
    if (res.status === 401) throw new Error('SESSION_EXPIRED');
    if (!res.ok) throw new Error(`file: HTTP ${res.status}`);

    if (!onProgress || !res.body) return res.blob();

    const contentLength = Number(res.headers.get('content-length') || 0);
    const reader = res.body.getReader();
    const chunks: Uint8Array[] = [];
    let received = 0;
    let lastBytes = 0;
    let lastTime = Date.now();

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) {
        chunks.push(value);
        received += value.length;

        const now = Date.now();
        const elapsed = (now - lastTime) / 1000;
        if (elapsed >= 0.3) {
          const speed = (received - lastBytes) / elapsed;
          const pct = contentLength > 0 ? Math.round((received / contentLength) * 100) : 0;
          onProgress(pct, speed);
          lastBytes = received;
          lastTime = now;
        }
      }
    }

    onProgress(100, 0);
    return new Blob(chunks as BlobPart[]);
  }

  /**
   * Devuelve una URL directa al archivo con el token embebido como query param.
   * Permite usar la URL en <img src> y <video src> sin headers personalizados,
   * habilitando carga progresiva nativa del navegador y Range requests para video.
   */
  async deleteFiles(paths: string[]): Promise<void> {
    const res = await fetch(`${this.baseUrl}/api/file`, {
      method: 'DELETE',
      headers: { ...this.authHeader, 'Content-Type': 'application/json' },
      body: JSON.stringify({ paths }),
    });
    if (res.status === 401) throw new Error('SESSION_EXPIRED');
    if (!res.ok) {
      const json = await res.json().catch(() => ({}));
      throw new Error(json.error || `HTTP ${res.status}`);
    }
  }

  getFileUrl(path: string): string {
    return `${this.baseUrl}/api/file?path=${encodeURIComponent(path)}&token=${encodeURIComponent(this.token)}`;
  }

  async getThumbBlob(path: string): Promise<Blob | null> {
    try {
      const res = await fetch(
        `${this.baseUrl}/api/thumb?path=${encodeURIComponent(path)}`,
        { headers: { ...this.authHeader, Accept: 'image/webp,image/jpeg,image/*' } }
      );
      if (res.status === 204 || !res.ok) return null;
      return res.blob();
    } catch {
      return null;
    }
  }
}
