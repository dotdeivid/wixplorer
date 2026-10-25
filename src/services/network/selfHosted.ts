/**
 * Utilidades para detectar si la app está siendo servida directamente
 * por el servidor Flutter del teléfono (modo auto-hospedado) en lugar
 * de correr en localhost (Go launcher o Vite dev).
 *
 * Modo auto-hospedado:  http://192.168.x.x:7070  → isSelfHosted() = true
 * Modo local:           http://localhost:3000      → isSelfHosted() = false
 */

/** true cuando la página fue servida desde una IP de red (no localhost). */
export function isSelfHosted(): boolean {
  const h = window.location.hostname;
  return h !== 'localhost' && h !== '127.0.0.1' && h !== '';
}

/** IP y puerto del host que sirvió la página, o null si es localhost. */
export function getSelfOrigin(): { ip: string; port: number } | null {
  if (!isSelfHosted()) return null;
  return {
    ip: window.location.hostname,
    port: Number(window.location.port) || 7070,
  };
}
