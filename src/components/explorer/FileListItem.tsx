import React, { useState, useRef, useEffect, memo } from 'react';
import styles from './FileListItem.module.css';
import type { FileItem } from '../../hooks/useMTPDevice';
import { SmallFolderIcon, getFileEmoji } from './FileItem';
import { useThumbnail, isImageFile } from '../../hooks/useThumbnail';

interface FileListItemProps {
  file: FileItem;
  isSelected: boolean;
  onSelect: (e: React.MouseEvent) => void;
  onActivate: () => void;
  onContextMenu: (e: React.MouseEvent) => void;
  onDragStart?: (e: React.DragEvent) => void;
  onDragOver?: (e: React.DragEvent) => void;
  onDrop?: (e: React.DragEvent) => void;
  getThumb?: (handle: number) => Promise<Blob | null>;
  isNetworkMode?: boolean;
  isRenaming?: boolean;
  onRenameConfirm?: (newName: string) => void;
  onRenameCancel?: () => void;
}

function formatSize(bytes: number): string {
  if (bytes === 0) return '--';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

// MTP date format: "YYYYMMDDTHHmmSS[.sss]"
function formatDate(dateStr: string): string {
  if (!dateStr) return '--';
  const m = dateStr.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})/);
  if (!m) return dateStr;
  return `${m[3]}/${m[2]}/${m[1]} ${m[4]}:${m[5]}`;
}

function getKind(file: FileItem): string {
  if (file.isFolder) return 'Carpeta';
  const ext = file.name.split('.').pop()?.toLowerCase() ?? '';
  const kinds: Record<string, string> = {
    jpg: 'Imagen', jpeg: 'Imagen', png: 'Imagen', heic: 'Imagen', webp: 'Imagen',
    mp4: 'Video', mkv: 'Video', mov: 'Video', avi: 'Video',
    mp3: 'Audio', wav: 'Audio', aac: 'Audio', flac: 'Audio',
    pdf: 'PDF', zip: 'ZIP', rar: 'ZIP', apk: 'App Android',
  };
  return kinds[ext] ?? (ext ? ext.toUpperCase() : 'Documento');
}

const noopThumb = async (_h: number): Promise<Blob | null> => null;

/* ─── Inline rename input ────────────────────────────────────────────────── */
const InlineRenameInput: React.FC<{
  file: FileItem;
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

const FileListItem = memo<FileListItemProps>(({
  file, isSelected, onSelect, onActivate, onContextMenu,
  onDragStart, onDragOver, onDrop, getThumb, isNetworkMode,
  isRenaming, onRenameConfirm, onRenameCancel,
}) => {
  const [isDropTarget, setIsDropTarget] = useState(false);
  const showThumb = !file.isFolder && isImageFile(file.name) && !!getThumb;
  const { thumbUrl, thumbRef } = useThumbnail({ file, getThumb: getThumb ?? noopThumb, isNetwork: isNetworkMode });

  return (
    <div
      className={`${styles.row} ${isSelected ? styles.selected : ''} ${isDropTarget ? styles.dropTarget : ''}`}
      data-file-id={file.id}
      onClick={e => { if (isRenaming) return; e.stopPropagation(); onSelect(e); }}
      onDoubleClick={() => { if (isRenaming) return; onActivate(); }}
      onContextMenu={e => { if (isRenaming) return; e.stopPropagation(); onContextMenu(e); }}
      draggable={!isRenaming}
      onDragStart={isRenaming ? undefined : onDragStart}
      onDragOver={file.isFolder ? (e) => { e.preventDefault(); setIsDropTarget(true); onDragOver?.(e); } : undefined}
      onDragLeave={file.isFolder ? () => setIsDropTarget(false) : undefined}
      onDrop={file.isFolder && onDrop ? (e) => { e.preventDefault(); setIsDropTarget(false); onDrop(e); } : undefined}
    >
      <div className={styles.nameCell} ref={showThumb ? thumbRef : undefined}>
        {file.isFolder
          ? <div className={styles.folderIconSmall}><SmallFolderIcon /></div>
          : showThumb && thumbUrl
            ? <img src={thumbUrl} className={styles.iconThumb} alt="" />
            : <span className={styles.iconSmall}>{getFileEmoji(file.name)}</span>
        }
        {isRenaming && onRenameConfirm && onRenameCancel
          ? <InlineRenameInput file={file} onConfirm={onRenameConfirm} onCancel={onRenameCancel} />
          : <span className={styles.nameText}>{file.name}</span>
        }
      </div>
      <div className={styles.cell}>{formatDate(file.dateModified)}</div>
      <div className={styles.cell}>{file.isFolder ? '--' : formatSize(file.size)}</div>
      <div className={styles.cell}>{getKind(file)}</div>
    </div>
  );
});

export default FileListItem;
