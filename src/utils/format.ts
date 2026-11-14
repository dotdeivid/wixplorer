/** "1 elemento" / "3 elementos". */
export function plural(count: number, singular: string, pluralForm: string): string {
  return `${count} ${count === 1 ? singular : pluralForm}`;
}

/** Tamaño legible: 512 B, 1.5 KB, 23.4 MB, 1.25 GB. Vacío para 0. */
export function formatBytes(bytes: number): string {
  if (!bytes) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

/** Nombre con comillas angulares para mensajes: «foto.jpg». */
export const quoted = (name: string) => `«${name}»`;
