/**
 * Utilidades para detectar si la app está siendo servida directamente
 * por el servidor Flutter del teléfono (modo auto-hospedado) en lugar
 * de correr en localhost (Go launcher o Vite dev).
 *
 * Modo auto-hospedado:  http://192.168.x.x:7070           → isSelfHosted() = true
 * Modo local:           http://localhost:3000               → isSelfHosted() = false
 * Publicada:            https://dotdeivid.github.io/wixplorer/ → isSelfHosted() = false
 */

const LOOPBACK = new Set(['localhost', '127.0.0.1', '[::1]', '::1', '']);

/**
 * true cuando la página la sirvió el servidor del teléfono.
 *
 * El teléfono sirve por http:// en una dirección de la red local. Las otras
 * formas de abrir la app no cumplen eso: el launcher y Vite usan localhost,
 * y la versión publicada (GitHub Pages) siempre es https://.
 */
export function isSelfHosted(): boolean {
  const { protocol, hostname } = window.location;
  return protocol === 'http:' && !LOOPBACK.has(hostname);
}

/** La app está publicada en la web (GitHub Pages), no en el launcher ni el teléfono. */
export function isWebHosted(): boolean {
  return window.location.protocol === 'https:';
}

/** IP y puerto del host que sirvió la página, o null si es localhost. */
export function getSelfOrigin(): { ip: string; port: number } | null {
  if (!isSelfHosted()) return null;
  return {
    ip: window.location.hostname,
    port: Number(window.location.port) || 7070,
  };
}
