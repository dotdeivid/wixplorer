import React from 'react';
import {
  File, FileArchive, FileAudio, FileImage, FileSpreadsheet, FileText, FileVideo, Package,
  type LucideIcon,
} from 'lucide-react';
import styles from './FileTypeIcon.module.css';

type FileKind = 'image' | 'video' | 'audio' | 'pdf' | 'archive' | 'apk' | 'doc' | 'sheet' | 'other';

const KIND_BY_EXT: Record<string, FileKind> = {};
const register = (kind: FileKind, exts: string[]) => exts.forEach(e => { KIND_BY_EXT[e] = kind; });
register('image', ['jpg', 'jpeg', 'png', 'gif', 'heic', 'webp', 'bmp', 'heif', 'tiff', 'tif', 'raw', 'cr2', 'nef', 'arw', 'dng', 'svg']);
register('video', ['mp4', 'mkv', 'mov', 'avi', 'webm', '3gp', 'm4v']);
register('audio', ['mp3', 'wav', 'aac', 'flac', 'm4a', 'ogg', 'opus']);
register('pdf', ['pdf']);
register('archive', ['zip', 'rar', '7z', 'tar', 'gz']);
register('apk', ['apk']);
register('doc', ['txt', 'md', 'doc', 'docx', 'rtf', 'odt', 'log', 'json', 'xml', 'html']);
register('sheet', ['xls', 'xlsx', 'csv', 'ods']);

const ICONS: Record<FileKind, LucideIcon> = {
  image: FileImage,
  video: FileVideo,
  audio: FileAudio,
  pdf: FileText,
  archive: FileArchive,
  apk: Package,
  doc: FileText,
  sheet: FileSpreadsheet,
  other: File,
};

function kindOf(name: string): FileKind {
  const ext = name.includes('.') ? name.split('.').pop()!.toLowerCase() : '';
  return KIND_BY_EXT[ext] ?? 'other';
}

interface FileTypeIconProps {
  name: string;
  size: number;
  className?: string;
}

/** Ícono vectorial según la extensión, con el color de su categoría (como Finder). */
const FileTypeIcon: React.FC<FileTypeIconProps> = ({ name, size, className }) => {
  const kind = kindOf(name);
  const Icon = ICONS[kind];
  return (
    <Icon
      size={size}
      strokeWidth={size >= 40 ? 1.2 : 1.6}
      className={`${styles.icon} ${styles[kind]} ${className ?? ''}`}
      aria-hidden="true"
    />
  );
};

export default FileTypeIcon;
