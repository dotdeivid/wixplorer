import type { FileItem } from '../hooks/useMTPDevice';

/** Categoría de un archivo, usada para ordenar y agrupar por tipo. */
export function getFileCategory(file: Pick<FileItem, 'name' | 'isFolder'>): string {
  if (file.isFolder) return 'Carpetas';
  const ext = file.name.split('.').pop()?.toLowerCase() || '';
  if (['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'svg', 'heic', 'heif', 'dng', 'raw'].includes(ext)) return 'Imágenes';
  if (['pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'txt', 'rtf', 'csv', 'md'].includes(ext)) return 'Documentos';
  if (['mp4', 'mov', 'avi', 'mkv', 'webm', '3gp', 'm4v'].includes(ext)) return 'Videos';
  if (['mp3', 'wav', 'ogg', 'flac', 'm4a', 'aac', 'opus'].includes(ext)) return 'Audio';
  if (['zip', 'rar', '7z', 'tar', 'gz'].includes(ext)) return 'Archivos comprimidos';
  if (['apk', 'exe', 'dmg', 'iso'].includes(ext)) return 'Instaladores';
  return 'Otros';
}
