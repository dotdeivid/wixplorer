/**
 * Log de depuración: solo escribe en desarrollo (`vite dev`). En producción
 * es un no-op, así el protocolo MTP no llena la consola del usuario.
 * Para advertencias y errores reales seguir usando console.warn/error.
 */
export const debug: (...args: unknown[]) => void = import.meta.env.DEV
  ? (...args) => console.log(...args)
  : () => {};
