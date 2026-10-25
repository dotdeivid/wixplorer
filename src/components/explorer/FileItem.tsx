import React, { useState, useRef, useEffect, memo } from 'react';
import styles from './FileItem.module.css';
import type { FileItem as FileItemData } from '../../hooks/useMTPDevice';
import { useThumbnail, isImageFile } from '../../hooks/useThumbnail';

/* ─── macOS folder SVG ───────────────────────────────────────────────────── */
export const FolderIcon = () => (
  <svg className={styles.folderSvg} viewBox="0 0 88 76" fill="none">
    <defs>
      <linearGradient id="bodyGrad" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%"   stopColor="#72bcf7"/>
        <stop offset="100%" stopColor="#5ba8ea"/>
      </linearGradient>
      <linearGradient id="tabGrad" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%"   stopColor="#62aae8"/>
        <stop offset="100%" stopColor="#58a2e0"/>
      </linearGradient>
      <linearGradient id="sheenGrad" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%"   stopColor="white" stopOpacity="0.10"/>
        <stop offset="100%" stopColor="white" stopOpacity="0.00"/>
      </linearGradient>
    </defs>
    <path d="M4 20 Q4 14 10 14 L32 14 Q36 14 38 18 L42 24 L4 24 Z" fill="url(#tabGrad)"/>
    <rect x="4" y="22" width="80" height="50" rx="6" fill="url(#bodyGrad)"/>
    <rect x="4" y="22" width="80" height="20" rx="5" fill="url(#sheenGrad)"/>
    <rect x="4" y="68" width="80" height="4" rx="4" fill="#4a90d9" opacity="0.45"/>
  </svg>
);

export const SmallFolderIcon = () => (
  <svg width="20" height="17" viewBox="0 0 88 76" fill="none">
    <defs>
      <linearGradient id="sbodyGrad" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%"   stopColor="#72bcf7"/>
        <stop offset="100%" stopColor="#5ba8ea"/>
      </linearGradient>
    </defs>
    <path d="M4 20 Q4 14 10 14 L32 14 Q36 14 38 18 L42 24 L4 24 Z" fill="#62aae8"/>
    <rect x="4" y="22" width="80" height="50" rx="6" fill="url(#sbodyGrad)"/>
  </svg>
);

export function getFileEmoji(name: string): string {
  const ext = name.split('.').pop()?.toLowerCase() ?? '';
  if (['jpg','jpeg','png','gif','heic','webp','bmp','heif','tiff','raw','cr2','nef','arw'].includes(ext)) return '🖼️';
  if (['mp4','mkv','mov','avi','webm'].includes(ext)) return '🎬';
  if (['mp3','wav','aac','flac','m4a'].includes(ext)) return '🎵';
  if (['pdf'].includes(ext)) return '📄';
  if (['zip','rar','7z','tar','gz'].includes(ext)) return '🗜️';
  if (['apk'].includes(ext)) return '📦';
  if (['txt','md'].includes(ext)) return '📝';
  if (['doc','docx'].includes(ext)) return '📝';
  if (['xls','xlsx','csv'].includes(ext)) return '📊';
  return '📄';
}

/* ─── Image thumbnail subcomponent ──────────────────────────────────────── */
const ImageThumb = memo<{
  file: FileItemData;
  getThumb: (handle: number) => Promise<Blob | null>;
  isNetwork?: boolean;
}>(({ file, getThumb, isNetwork }) => {
  const { thumbUrl, loading, thumbRef } = useThumbnail({ file, getThumb, isNetwork });
  return (
    <div className={styles.thumbWrapper} ref={thumbRef}>
      {thumbUrl
        ? <img className={styles.thumbImg} src={thumbUrl} alt={file.name} draggable={false} />
        : loading
          ? <div className={styles.thumbLoading}><div className={styles.thumbSpinner} /></div>
          : <span className={styles.fileEmoji}>{getFileEmoji(file.name)}</span>
      }
    </div>
  );
});

/* ─── Inline rename input ────────────────────────────────────────────────── */
const InlineRenameInput: React.FC<{
  file: FileItemData;
  onConfirm: (newName: string) => void;
  onCancel: () => void;
}> = ({ file, onConfirm, onCancel }) => {
  const inputRef = useRef<HTMLInputElement>(null);
  const confirmedRef = useRef(false);

  useEffect(() => {
    const input = inputRef.current;
    if (!input) return;
    input.focus();
    const dotIdx = file.isFolder ? -1 : file.name.lastIndexOf('.');
    input.setSelectionRange(0, dotIdx > 0 ? dotIdx : file.name.length);
  }, [file]);

  const commit = () => {
    if (confirmedRef.current) return;
    confirmedRef.current = true;
    const val = inputRef.current?.value.trim() ?? '';
    if (val && val !== file.name) onConfirm(val);
    else onCancel();
  };

  return (
    <input
      ref={inputRef}
      className={styles.renameInput}
      defaultValue={file.name}
      spellCheck={false}
      onClick={e => e.stopPropagation()}
      onDoubleClick={e => e.stopPropagation()}
      onContextMenu={e => e.stopPropagation()}
      onKeyDown={e => {
        e.stopPropagation();
        if (e.key === 'Enter') { e.preventDefault(); commit(); }
        if (e.key === 'Escape') { e.preventDefault(); confirmedRef.current = true; onCancel(); }
      }}
      onBlur={commit}
    />
  );
};

/* ─── Props ──────────────────────────────────────────────────────────────── */
interface FileItemProps {
  file: FileItemData;
  isSelected: boolean;
  onSelect: (e: React.MouseEvent) => void;
  onActivate: () => void;
  onContextMenu: (e: React.MouseEvent) => void;
  getThumb?: (handle: number) => Promise<Blob | null>;
  isNetworkMode?: boolean;
  onDragStart?: (e: React.DragEvent) => void;
  onDrop?: (e: React.DragEvent) => void;
  isRenaming?: boolean;
  onRenameConfirm?: (newName: string) => void;
  onRenameCancel?: () => void;
}

const FileItem = memo<FileItemProps>(({
  file, isSelected, onSelect, onActivate, onContextMenu, getThumb, isNetworkMode,
  onDragStart, onDrop, isRenaming, onRenameConfirm, onRenameCancel,
}) => {
  const [isDropTarget, setIsDropTarget] = useState(false);
  const showThumb = !file.isFolder && isImageFile(file.name) && !!getThumb;

  return (
    <div
      className={`${styles.item} ${isSelected ? styles.selected : ''} ${isDropTarget ? styles.dropTarget : ''}`}
      data-file-id={file.id}
      onClick={e => { if (isRenaming) return; e.stopPropagation(); onSelect(e); }}
      onDoubleClick={e => { if (isRenaming) return; e.preventDefault(); onActivate(); }}
      onContextMenu={e => { if (isRenaming) return; e.stopPropagation(); onContextMenu(e); }}
      draggable={!isRenaming}
      onDragStart={isRenaming ? undefined : onDragStart}
      onDragOver={file.isFolder ? (e) => { e.preventDefault(); setIsDropTarget(true); } : undefined}
      onDragLeave={file.isFolder ? () => setIsDropTarget(false) : undefined}
      onDrop={file.isFolder && onDrop ? (e) => { e.preventDefault(); setIsDropTarget(false); onDrop(e); } : undefined}
    >
      <div className={styles.iconWrapper}>
        {file.isFolder
          ? <FolderIcon />
          : showThumb
            ? <ImageThumb file={file} getThumb={getThumb!} isNetwork={isNetworkMode} />
            : <span className={styles.fileEmoji}>{getFileEmoji(file.name)}</span>
        }
      </div>
      {isRenaming && onRenameConfirm && onRenameCancel
        ? <InlineRenameInput file={file} onConfirm={onRenameConfirm} onCancel={onRenameCancel} />
        : <span className={styles.name} title={file.name}>{file.name}</span>
      }
    </div>
  );
});

export default FileItem;
