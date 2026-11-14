import { afterEach, describe, expect, it, vi } from 'vitest';
import { getSelfOrigin, isSelfHosted, isWebHosted } from './selfHosted';

function at(url: string) {
  const u = new URL(url);
  vi.stubGlobal('window', { location: { protocol: u.protocol, hostname: u.hostname, port: u.port } });
}

afterEach(() => vi.unstubAllGlobals());

describe('detección del modo', () => {
  it('la página del teléfono (http + IP de red) es auto-hospedada', () => {
    at('http://192.168.0.10:7070/');
    expect(isSelfHosted()).toBe(true);
    expect(isWebHosted()).toBe(false);
    expect(getSelfOrigin()).toEqual({ ip: '192.168.0.10', port: 7070 });
  });

  it('Vite en desarrollo (localhost) no lo es', () => {
    for (const url of ['http://localhost:5173/', 'http://127.0.0.1:5173/', 'http://[::1]:5173/']) {
      at(url);
      expect(isSelfHosted()).toBe(false);
      expect(isWebHosted()).toBe(false);
    }
  });

  it('la versión publicada (https) no se confunde con el teléfono', () => {
    at('https://dotdeivid.github.io/wixplorer/');
    expect(isSelfHosted()).toBe(false);
    expect(isWebHosted()).toBe(true);
    expect(getSelfOrigin()).toBeNull();
  });
});
