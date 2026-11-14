import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NetworkClient } from './NetworkClient';

/** Response con body en streaming, partido en los trozos dados. */
function streamResponse(parts: string[], headers: Record<string, string>, status = 200): Response {
  const encoder = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    start(ctrl) {
      for (const part of parts) ctrl.enqueue(encoder.encode(part));
      ctrl.close();
    },
  });
  return new Response(body, { status, headers });
}

const item = (name: string) => ({ name, path: `/s/${name}`, isFolder: false, size: 1, dateModified: 0 });
const ndjson = { 'content-type': 'application/x-ndjson; charset=utf-8' };

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('NetworkClient.listFiles (NDJSON)', () => {
  it('une líneas partidas entre chunks y la última sin salto de línea', async () => {
    const a = JSON.stringify(item('a.jpg'));
    const b = JSON.stringify(item('b.jpg'));
    const c = JSON.stringify(item('c.jpg'));
    vi.stubGlobal('fetch', vi.fn(async () =>
      streamResponse([a.slice(0, 5), a.slice(5) + '\n' + b + '\n', c], ndjson)));

    const onChunk = vi.fn();
    const files = await new NetworkClient('10.0.0.2', 7070, 't').listFiles('/s', onChunk);

    expect(files.map(f => f.name)).toEqual(['a.jpg', 'b.jpg', 'c.jpg']);
    expect(onChunk).toHaveBeenLastCalledWith(files);
  });

  it('lanza si el servidor manda una línea de error a mitad del listado', async () => {
    vi.stubGlobal('fetch', vi.fn(async () =>
      streamResponse([JSON.stringify(item('a.jpg')) + '\n', '{"error":"Error al leer"}\n'], ndjson)));

    await expect(new NetworkClient('10.0.0.2', 7070, 't').listFiles('/s')).rejects.toThrow('Error al leer');
  });

  it('un 401 se informa como SESSION_EXPIRED', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('', { status: 401 })));
    await expect(new NetworkClient('10.0.0.2', 7070, 't').listFiles('/s')).rejects.toThrow('SESSION_EXPIRED');
  });
});

describe('NetworkClient.downloadFileChunked (sin File System Access API)', () => {
  const source = Uint8Array.from({ length: 1000 }, (_, i) => i % 251);
  let saved: Blob | null;

  /** Servidor falso con soporte de Range sobre `source`. */
  function rangeServer(opts: { ignoreRangeOnChunks?: boolean } = {}) {
    return vi.fn(async (_url: string, init?: RequestInit) => {
      if (init?.signal?.aborted) throw new DOMException('aborted', 'AbortError');
      const range = new Headers(init?.headers).get('range');
      const m = range?.match(/bytes=(\d+)-(\d+)/);
      const isProbe = range === 'bytes=0-0';
      if (!m || (opts.ignoreRangeOnChunks && !isProbe)) {
        return new Response(source.slice(), { status: 200 });
      }
      const start = Number(m[1]);
      const end = Math.min(Number(m[2]), source.length - 1);
      return new Response(source.slice(start, end + 1), {
        status: 206,
        headers: { 'content-range': `bytes ${start}-${end}/${source.length}` },
      });
    });
  }

  beforeEach(() => {
    saved = null;
    // Entorno mínimo de navegador: sin showSaveFilePicker → camino Blob + <a download>
    vi.stubGlobal('window', {});
    vi.stubGlobal('document', {
      createElement: () => ({ click: vi.fn() }),
      body: { appendChild: vi.fn(), removeChild: vi.fn() },
    });
    vi.spyOn(URL, 'createObjectURL').mockImplementation((b) => { saved = b as Blob; return 'blob:x'; });
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
  });

  it('arma el archivo completo y en orden a partir de los chunks', async () => {
    vi.stubGlobal('fetch', rangeServer());
    const onProgress = vi.fn();

    await new NetworkClient('10.0.0.2', 7070, 't').downloadFileChunked('/s/f.bin', 'f.bin', onProgress);

    expect(new Uint8Array(await saved!.arrayBuffer())).toEqual(source);
    expect(onProgress).toHaveBeenLastCalledWith(100, 0, 0);
  });

  it('rechaza chunks que no vienen como 206 en lugar de corromper el archivo', async () => {
    vi.stubGlobal('fetch', rangeServer({ ignoreRangeOnChunks: true }));
    await expect(
      new NetworkClient('10.0.0.2', 7070, 't').downloadFileChunked('/s/f.bin', 'f.bin'),
    ).rejects.toThrow(/HTTP 200/);
    expect(saved).toBeNull();
  });

  it('propaga la cancelación como AbortError', async () => {
    vi.stubGlobal('fetch', rangeServer());
    const ctrl = new AbortController();
    ctrl.abort();
    await expect(
      new NetworkClient('10.0.0.2', 7070, 't').downloadFileChunked('/s/f.bin', 'f.bin', undefined, ctrl.signal),
    ).rejects.toMatchObject({ name: 'AbortError' });
    expect(saved).toBeNull();
  });
});
