/**
 * Helpers para leer valores capturados en `catch` sin recurrir a `any`.
 * Un `catch` puede recibir cualquier cosa (Error, DOMException, string…),
 * así que se lee cada propiedad solo si existe y es string.
 */
function stringProp(e: unknown, key: 'name' | 'message'): string | undefined {
  if (typeof e !== 'object' || e === null || !(key in e)) return undefined;
  const value = (e as Record<string, unknown>)[key];
  return typeof value === 'string' ? value : undefined;
}

export const errorName = (e: unknown): string | undefined => stringProp(e, 'name');
export const errorMessage = (e: unknown): string | undefined => stringProp(e, 'message');
