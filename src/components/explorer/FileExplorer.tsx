import React, { memo, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { FolderOpen, SearchX } from 'lucide-react';
import styles from './FileExplorer.module.css';
import FileItemComponent, { FolderIcon, SmallFolderIcon } from './FileItem';
import FileTypeIcon from './FileTypeIcon';
import FileListItem from './FileListItem';
import ConnectGuide, { type ConnectGuideProps } from '../onboarding/ConnectGuide';
import type { FetchBlobFn, FileItem, PathNode, StreamVideoFn } from '../../hooks/useMTPDevice';
import type { ViewMode, GroupMode, SortMode, SortDir } from '../layout/AppLayout';
import { useThumbnail, isImageFile } from '../../hooks/useThumbnail';
import { getFileCategory } from '../../utils/fileKind';

/**
 * Lo que AppLayout necesita del explorador para la navegación con teclado:
 * el orden visible de los archivos, cuántas columnas tiene la grilla y cómo
 * llevar un archivo a la vista (en las listas virtualizadas puede no estar
 * renderizado).
 */
export interface ExplorerNavigator {
  order: () => FileItem[];
  columns: () => number;
  scrollTo: (fileId: number) => void;
}

interface Section {
  title?: string;
  files: FileItem[];
}

/** Carpetas primero y luego categorías alfabéticas. */
function groupByKind(files: FileItem[]): Section[] {
  const groups = new Map<string, FileItem[]>();
  for (const f of files) {
    const cat = getFileCategory(f);
    if (!groups.has(cat)) groups.set(cat, []);
    groups.get(cat)!.push(f);
  }
  return [...groups.keys()]
    .sort((a, b) => (a === 'Carpetas' ? -1 : b === 'Carpetas' ? 1 : a.localeCompare(b)))
    .map(title => ({ title, files: groups.get(title)! }));
}

/* ── Column item with lazy thumbnail support ─────────────────────────────── */
const noopThumb = async (): Promise<Blob | null> => null;

const ColumnFileItem = memo<{
  file: FileItem;
  isActive: boolean;
  isCut: boolean;
  tabIndex: number;
  onClick: (e: React.MouseEvent) => void;
  onContextMenu: (e: React.MouseEvent) => void;
  onDragStart?: (e: React.DragEvent) => void;
  onDrop?: (e: React.DragEvent) => void;
  getThumb?: (handle: number) => Promise<Blob | null>;
  isNetworkMode?: boolean;
}>(({ file, isActive, isCut, tabIndex, onClick, onContextMenu, onDragStart, onDrop, getThumb, isNetworkMode }) => {
  const [isDropTarget, setIsDropTarget] = React.useState(false);
  const { thumbUrl, thumbRef } = useThumbnail({ file, getThumb: getThumb ?? noopThumb, isNetwork: isNetworkMode });
  const showThumb = !file.isFolder && isImageFile(file.name) && !!getThumb;

  return (
    <div
      ref={thumbRef}
      className={`${styles.columnItem} ${isActive ? styles.columnItemActive : ''} ${isDropTarget ? styles.columnItemDrop : ''} ${isCut ? styles.cut : ''}`}
      data-file-id={file.id}
      role="option"
      aria-selected={isActive}
      aria-label={file.isFolder ? `${file.name}, carpeta` : file.name}
      tabIndex={tabIndex}
      onClick={onClick}
      onContextMenu={onContextMenu}
      draggable={!!onDragStart}
      onDragStart={onDragStart}
      onDragOver={file.isFolder && onDrop ? (e) => { e.preventDefault(); setIsDropTarget(true); } : undefined}
      onDragLeave={() => setIsDropTarget(false)}
      onDrop={onDrop ? (e) => { setIsDropTarget(false); onDrop(e); } : undefined}
    >
      <div className={styles.colItemLeft}>
        <span className={styles.colIcon}>
          {file.isFolder
            ? <SmallFolderIcon />
            : showThumb && thumbUrl
              ? <img src={thumbUrl} className={styles.colThumb} alt="" />
              : <FileTypeIcon name={file.name} size={16} />}
        </span>
        <span className={styles.colName} title={file.name}>{file.name}</span>
      </div>
      {file.isFolder && <span className={styles.colArrow} aria-hidden="true">›</span>}
    </div>
  );
});

/* ── Props compartidas por las vistas virtualizadas ──────────────────────── */
interface ItemHandlers {
  selectedIds: Set<number>;
  cutIds: Set<number>;
  focusId: number | null;
  getThumb?: (handle: number) => Promise<Blob | null>;
  isNetworkMode?: boolean;
  renamingFileId?: number | null;
  onSelect: (file: FileItem, e: React.MouseEvent) => void;
  onActivate: (file: FileItem) => void;
  onContextMenu: (file: FileItem, e: React.MouseEvent) => void;
  makeDragStart?: (file: FileItem) => (e: React.DragEvent) => void;
  makeDrop?: (folder: FileItem) => (e: React.DragEvent) => void;
  onRenameConfirm?: (file: FileItem, newName: string) => void;
  onRenameCancel?: () => void;
}

/** Publica el navegador para AppLayout sin re-crear el objeto en cada render. */
function usePublishNavigator(
  navigatorRef: React.MutableRefObject<ExplorerNavigator | null> | undefined,
  nav: ExplorerNavigator,
) {
  useLayoutEffect(() => {
    if (navigatorRef) navigatorRef.current = nav;
  });
}

/* ── Virtual file list (list view) ──────────────────────────────────────── */
// Uses @tanstack/react-virtual to render only the visible rows. Sections
// (grouping by kind) become header rows inside the same virtual list.
const LIST_ROW_H = 30; // matches .row height in FileListItem.module.css
const LIST_HEADER_ROW_H = 34;

type ListRow = { kind: 'header'; title: string } | { kind: 'file'; file: FileItem };

const LIST_COLUMNS: { mode: SortMode; label: string }[] = [
  { mode: 'name', label: 'Nombre' },
  { mode: 'date', label: 'Fecha de modificación' },
  { mode: 'size', label: 'Tamaño' },
  { mode: 'kind', label: 'Tipo' },
];

const VirtualFileList = memo<ItemHandlers & {
  sections: Section[];
  sortMode: SortMode;
  sortDir: SortDir;
  onSortChange?: (mode: SortMode) => void;
  label: string;
  navigatorRef?: React.MutableRefObject<ExplorerNavigator | null>;
}>(({
  sections, sortMode, sortDir, onSortChange, label, navigatorRef,
  selectedIds, cutIds, focusId, getThumb, isNetworkMode, renamingFileId,
  onSelect, onActivate, onContextMenu, makeDragStart, makeDrop, onRenameConfirm, onRenameCancel,
}) => {
  const scrollRef = useRef<HTMLDivElement>(null);

  const rows: ListRow[] = [];
  const order: FileItem[] = [];
  for (const section of sections) {
    if (section.title) rows.push({ kind: 'header', title: section.title });
    for (const file of section.files) { rows.push({ kind: 'file', file }); order.push(file); }
  }

  // useVirtualizer devuelve funciones que React Compiler no puede memoizar,
  // así que el compilador se saltea este componente. Es esperado y está
  // documentado por TanStack; no afecta el comportamiento.
  // eslint-disable-next-line react-hooks/incompatible-library
  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: i => (rows[i].kind === 'header' ? LIST_HEADER_ROW_H : LIST_ROW_H),
    overscan: 15,
  });

  usePublishNavigator(navigatorRef, {
    order: () => order,
    columns: () => 1,
    scrollTo: id => {
      const idx = rows.findIndex(r => r.kind === 'file' && r.file.id === id);
      if (idx >= 0) virtualizer.scrollToIndex(idx, { align: 'auto' });
    },
  });

  return (
    <div className={styles.list}>
      <div className={styles.listHeader}>
        {LIST_COLUMNS.map(col => {
          const active = sortMode === col.mode;
          return (
            <button
              key={col.mode}
              type="button"
              className={`${styles.listHeaderCell} ${active ? styles.listHeaderActive : ''}`}
              onClick={() => onSortChange?.(col.mode)}
              aria-label={`Ordenar por ${col.label}${active ? (sortDir === 'asc' ? ', ascendente' : ', descendente') : ''}`}
            >
              {col.label}
              {active && <span aria-hidden="true">{sortDir === 'asc' ? '↑' : '↓'}</span>}
            </button>
          );
        })}
      </div>
      <div ref={scrollRef} className={styles.virtualScroll} role="listbox" aria-multiselectable="true" aria-label={label}>
        <div className={styles.virtualSizer} style={{ height: virtualizer.getTotalSize() }}>
          {virtualizer.getVirtualItems().map(vRow => {
            const row = rows[vRow.index];
            return (
              <div
                key={vRow.key}
                data-index={vRow.index}
                className={styles.virtualRow}
                style={{ transform: `translateY(${vRow.start}px)`, height: vRow.size }}
                role="presentation"
              >
                {row.kind === 'header' ? (
                  <div className={styles.listGroupHeader} role="presentation">{row.title}</div>
                ) : (
                  <FileListItem
                    file={row.file}
                    isSelected={selectedIds.has(row.file.id)}
                    isCut={cutIds.has(row.file.id)}
                    tabIndex={row.file.id === focusId ? 0 : -1}
                    onSelect={(e) => onSelect(row.file, e)}
                    onActivate={() => onActivate(row.file)}
                    onContextMenu={(e) => onContextMenu(row.file, e)}
                    onDragStart={makeDragStart?.(row.file)}
                    onDragOver={row.file.isFolder && makeDrop ? (e) => e.preventDefault() : undefined}
                    onDrop={row.file.isFolder ? makeDrop?.(row.file) : undefined}
                    getThumb={getThumb}
                    isNetworkMode={isNetworkMode}
                    isRenaming={row.file.id === renamingFileId}
                    onRenameConfirm={(newName) => onRenameConfirm?.(row.file, newName)}
                    onRenameCancel={onRenameCancel}
                  />
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
});

/* ── Virtual grid (icon view, also grouped) ─────────────────────────────── */
// Las filas se arman según el ancho disponible: cada fila de la grilla es una
// fila virtual, y los títulos de grupo son filas propias. Así DCIM con miles
// de fotos solo renderiza lo visible.
const GRID_ITEM_MIN_W = 96;
const GRID_GAP = 4;
const GRID_PAD = 16;
const GRID_ROW_H = 116;
const GRID_HEADER_ROW_H = 40;

type GridRow = { kind: 'header'; title: string } | { kind: 'files'; files: FileItem[] };

const VirtualGrid = memo<ItemHandlers & {
  sections: Section[];
  label: string;
  navigatorRef?: React.MutableRefObject<ExplorerNavigator | null>;
}>(({
  sections, label, navigatorRef,
  selectedIds, cutIds, focusId, getThumb, isNetworkMode, renamingFileId,
  onSelect, onActivate, onContextMenu, makeDragStart, makeDrop, onRenameConfirm, onRenameCancel,
}) => {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const ro = new ResizeObserver(entries => setWidth(entries[0].contentRect.width));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const columns = Math.max(1, Math.floor((width - GRID_PAD * 2 + GRID_GAP) / (GRID_ITEM_MIN_W + GRID_GAP)));
  const rows: GridRow[] = [];
  const order: FileItem[] = [];
  for (const section of sections) {
    if (section.title) rows.push({ kind: 'header', title: section.title });
    for (let i = 0; i < section.files.length; i += columns) {
      rows.push({ kind: 'files', files: section.files.slice(i, i + columns) });
    }
    order.push(...section.files);
  }

  // Ver el comentario de VirtualFileList sobre React Compiler.
  // eslint-disable-next-line react-hooks/incompatible-library
  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: i => (rows[i].kind === 'header' ? GRID_HEADER_ROW_H : GRID_ROW_H),
    overscan: 4,
    paddingStart: GRID_PAD,
    paddingEnd: GRID_PAD,
  });

  usePublishNavigator(navigatorRef, {
    order: () => order,
    columns: () => columns,
    scrollTo: id => {
      const idx = rows.findIndex(r => r.kind === 'files' && r.files.some(f => f.id === id));
      if (idx >= 0) virtualizer.scrollToIndex(idx, { align: 'auto' });
    },
  });

  return (
    <div ref={scrollRef} className={styles.gridScroll} role="listbox" aria-multiselectable="true" aria-label={label}>
      <div className={styles.virtualSizer} style={{ height: virtualizer.getTotalSize() }}>
        {virtualizer.getVirtualItems().map(vRow => {
          const row = rows[vRow.index];
          return (
            <div
              key={vRow.key}
              data-index={vRow.index}
              ref={virtualizer.measureElement}
              className={styles.virtualRow}
              style={{ transform: `translateY(${vRow.start}px)` }}
              role="presentation"
            >
              {row.kind === 'header' ? (
                <div className={styles.groupHeader} role="presentation">
                  <span className={styles.groupHeaderTitle}>{row.title}</span>
                </div>
              ) : (
                <div className={styles.gridRow} style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }} role="presentation">
                  {row.files.map(file => (
                    <FileItemComponent
                      key={file.id}
                      file={file}
                      isSelected={selectedIds.has(file.id)}
                      isCut={cutIds.has(file.id)}
                      tabIndex={file.id === focusId ? 0 : -1}
                      onSelect={(e) => onSelect(file, e)}
                      onActivate={() => onActivate(file)}
                      onContextMenu={(e) => onContextMenu(file, e)}
                      getThumb={getThumb}
                      isNetworkMode={isNetworkMode}
                      onDragStart={makeDragStart?.(file)}
                      onDrop={file.isFolder ? makeDrop?.(file) : undefined}
                      isRenaming={file.id === renamingFileId}
                      onRenameConfirm={(newName) => onRenameConfirm?.(file, newName)}
                      onRenameCancel={onRenameCancel}
                    />
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
});

/* ── Virtual gallery strip (horizontal) ─────────────────────────────────── */
const STRIP_ITEM_W = 100;
const STRIP_GAP = 16;

const VirtualStrip = memo<ItemHandlers & {
  files: FileItem[];
  navigatorRef?: React.MutableRefObject<ExplorerNavigator | null>;
}>(({
  files, navigatorRef,
  selectedIds, cutIds, focusId, getThumb, isNetworkMode, renamingFileId,
  onSelect, onActivate, onContextMenu, makeDragStart, makeDrop, onRenameConfirm, onRenameCancel,
}) => {
  const scrollRef = useRef<HTMLDivElement>(null);

  // Ver el comentario de VirtualFileList sobre React Compiler.
  // eslint-disable-next-line react-hooks/incompatible-library
  const virtualizer = useVirtualizer({
    horizontal: true,
    count: files.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => STRIP_ITEM_W + STRIP_GAP,
    overscan: 6,
    paddingStart: GRID_PAD,
    paddingEnd: GRID_PAD,
  });

  usePublishNavigator(navigatorRef, {
    order: () => files,
    columns: () => 1,
    scrollTo: id => {
      const idx = files.findIndex(f => f.id === id);
      if (idx >= 0) virtualizer.scrollToIndex(idx, { align: 'auto' });
    },
  });

  return (
    <div ref={scrollRef} className={styles.galleryStripWrapper} role="listbox" aria-multiselectable="true"
      aria-orientation="horizontal" aria-label="Archivos">
      <div className={styles.stripSizer} style={{ width: virtualizer.getTotalSize() }}>
        {virtualizer.getVirtualItems().map(vItem => {
          const file = files[vItem.index];
          return (
            <div
              key={vItem.key}
              className={styles.stripItem}
              style={{ transform: `translateX(${vItem.start}px)`, width: STRIP_ITEM_W }}
              role="presentation"
            >
              <FileItemComponent
                file={file}
                isSelected={selectedIds.has(file.id)}
                isCut={cutIds.has(file.id)}
                tabIndex={file.id === focusId ? 0 : -1}
                onSelect={(e) => onSelect(file, e)}
                onActivate={() => onActivate(file)}
                onContextMenu={(e) => onContextMenu(file, e)}
                getThumb={getThumb}
                isNetworkMode={isNetworkMode}
                onDragStart={makeDragStart?.(file)}
                onDrop={file.isFolder ? makeDrop?.(file) : undefined}
                isRenaming={file.id === renamingFileId}
                onRenameConfirm={(newName) => onRenameConfirm?.(file, newName)}
                onRenameCancel={onRenameCancel}
              />
            </div>
          );
        })}
      </div>
    </div>
  );
});

/* ── Gallery preview (big preview in gallery mode) ───────────────────────── */
const GALLERY_MEDIA_EXTS = new Set([
  'jpg','jpeg','png','gif','webp','bmp','heic','heif','mp4','webm','mov',
]);

const GalleryPreview: React.FC<{
  file: FileItem;
  onFetchBlob: FetchBlobFn;
  getDirectUrl?: (file: FileItem) => string | null;
  onStreamVideo?: StreamVideoFn;
}> = ({ file, onFetchBlob, getDirectUrl, onStreamVideo }) => {
  // Se monta uno nuevo por archivo (key = file.id): el estado arranca limpio.
  const ext = file.name.split('.').pop()?.toLowerCase() ?? '';
  const isMedia = !file.isFolder && GALLERY_MEDIA_EXTS.has(ext);
  // URL directa disponible (modo red) — sin descarga previa
  const directUrl = isMedia && getDirectUrl ? getDirectUrl(file) : null;
  const canStream = isMedia && !directUrl && !!onStreamVideo && ['mp4','webm','mov','m4v','3gp'].includes(ext);
  const [fetchedUrl, setFetchedUrl] = React.useState<string | null>(null);
  const mediaUrl = directUrl ?? fetchedUrl;
  const [loading, setLoading] = React.useState(() => isMedia && !directUrl && !canStream);
  const [isPlaying, setIsPlaying] = React.useState(false);
  const [videoTime, setVideoTime] = React.useState(0);
  const [videoDuration, setVideoDuration] = React.useState(0);
  const blobUrlRef = React.useRef<string | null>(null);
  const streamCleanupRef = React.useRef<(() => void) | null>(null);
  const videoRef = React.useRef<HTMLVideoElement>(null);

  const togglePlay = () => {
    const v = videoRef.current;
    if (!v) return;
    if (v.paused) { v.play(); setIsPlaying(true); }
    else { v.pause(); setIsPlaying(false); }
  };

  const seekTimeline = (e: React.PointerEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const pct = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    if (videoRef.current && videoDuration > 0) {
      videoRef.current.currentTime = pct * videoDuration;
      setVideoTime(pct * videoDuration);
    }
  };

  const formatVideoTime = (s: number) => {
    const m = Math.floor(s / 60);
    const ss = Math.floor(s % 60);
    return `${m}:${ss.toString().padStart(2, '0')}`;
  };

  React.useEffect(() => {
    if (!isMedia || directUrl) return;
    const abortCtrl = new AbortController();

    // Streaming MSE para video MTP — inicia reproducción sin esperar descarga completa
    if (canStream) {
      const stream = onStreamVideo!(file, abortCtrl.signal, () => videoRef.current?.currentTime ?? 0);
      if (stream) {
        streamCleanupRef.current = stream.cleanup;
        setFetchedUrl(stream.url);
        return () => { abortCtrl.abort(); };
      }
    }

    // Fallback: descarga blob completo (modo USB/MTP para imágenes o sin MSE)
    onFetchBlob(file, { signal: abortCtrl.signal }).then(blob => {
      if (abortCtrl.signal.aborted) return;
      if (blob) {
        const url = URL.createObjectURL(blob);
        blobUrlRef.current = url;
        setFetchedUrl(url);
      }
      setLoading(false);
    }).catch(() => { if (!abortCtrl.signal.aborted) setLoading(false); });
    return () => { abortCtrl.abort(); };
    // Solo al montar: un archivo distinto monta otro GalleryPreview (key).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  React.useEffect(() => () => {
    if (blobUrlRef.current) URL.revokeObjectURL(blobUrlRef.current);
    if (streamCleanupRef.current) streamCleanupRef.current();
  }, []);

  if (loading) return (
    <div className={styles.galleryLoading} role="status">
      <div className={styles.gallerySpinner} />
      <span>Cargando vista previa…</span>
    </div>
  );

  if (mediaUrl) {
    if (['mp4','webm','mov'].includes(ext)) {
      const progress = videoDuration > 0 ? (videoTime / videoDuration) * 100 : 0;
      return (
        <div className={styles.galleryVideoWrapper} onClick={togglePlay}>
          <video
            ref={videoRef}
            className={styles.galleryPreviewVideo}
            src={mediaUrl}
            playsInline
            preload="auto"
            onEnded={() => setIsPlaying(false)}
            onTimeUpdate={() => setVideoTime(videoRef.current?.currentTime ?? 0)}
            onLoadedMetadata={() => setVideoDuration(videoRef.current?.duration ?? 0)}
          />
          <button
            className={`${styles.galleryPlayBtn} ${isPlaying ? styles.galleryPlaying : ''}`}
            onClick={e => { e.stopPropagation(); togglePlay(); }}
            aria-label={isPlaying ? 'Pausar' : 'Reproducir'}
          >
            {isPlaying
              ? <svg width="18" height="18" viewBox="0 0 18 18" fill="currentColor">
                  <rect x="3" y="2" width="4" height="14" rx="1.5"/>
                  <rect x="11" y="2" width="4" height="14" rx="1.5"/>
                </svg>
              : <svg width="18" height="18" viewBox="0 0 18 18" fill="currentColor">
                  <path d="M4 2.5l12 6.5-12 6.5V2.5Z"/>
                </svg>
            }
          </button>
          {/* Timeline scrubber */}
          <div
            className={styles.galleryVideoTimeline}
            onPointerDown={e => { e.stopPropagation(); e.currentTarget.setPointerCapture(e.pointerId); seekTimeline(e); }}
            onPointerMove={e => { if (e.buttons > 0) seekTimeline(e); }}
            onClick={e => e.stopPropagation()}
          >
            {videoDuration > 0 && (
              <span className={styles.galleryVideoTimeLabel}>
                {formatVideoTime(videoTime)} / {formatVideoTime(videoDuration)}
              </span>
            )}
            <div className={styles.galleryVideoTimelineTrack}>
              <div className={styles.galleryVideoTimelineProgress} style={{ width: `${progress}%` }} />
              <div className={styles.galleryVideoTimelineKnob} style={{ left: `${progress}%` }} />
            </div>
          </div>
        </div>
      );
    }
    return <img src={mediaUrl} alt={file.name} className={styles.galleryImage} />;
  }

  return (
    <div className={styles.galleryPreviewContent}>
      <div className={styles.galleryFallbackIcon}>
        {file.isFolder ? <FolderIcon /> : <FileTypeIcon name={file.name} size={96} />}
      </div>
      <div className={styles.galleryPreviewName}>{file.name}</div>
    </div>
  );
};


/* ── Props ───────────────────────────────────────────────────────────────── */
interface FileExplorerProps {
  files: FileItem[];
  selectedFiles: FileItem[];
  onSelect: (file: FileItem, event: React.MouseEvent, allFiles: FileItem[]) => void;
  onActivate: (file: FileItem) => void;
  onContextMenu: (file: FileItem, event: React.MouseEvent) => void;
  isConnected: boolean;
  isLoading: boolean;
  viewMode: ViewMode;
  getThumb?: (handle: number) => Promise<Blob | null>;
  isNetworkMode?: boolean;
  groupMode?: GroupMode;
  sortMode: SortMode;
  sortDir: SortDir;
  onSortChange?: (mode: SortMode) => void;
  searchQuery?: string;
  onClearSearch?: () => void;
  /** Datos para la guía de conexión cuando no hay dispositivo. */
  connectGuide: ConnectGuideProps;
  folderCache?: Record<number, FileItem[]>;
  currentPath?: PathNode[];
  onNavigateIn?: (file: FileItem) => void;
  onNavigateColumnFolder?: (depth: number, folder: FileItem) => Promise<void>;
  onFetchBlob?: FetchBlobFn;
  getDirectUrl?: (file: FileItem) => string | null;
  onStreamVideo?: StreamVideoFn;
  /** Mover archivos arrastrando: solo si el modo de conexión lo soporta. */
  canMove?: boolean;
  onDragStart?: (files: FileItem[]) => void;
  onDropOnFolder?: (folder: FileItem) => void;
  draggingFiles?: React.MutableRefObject<FileItem[]>;
  renamingFileId?: number | null;
  onRenameConfirm?: (file: FileItem, newName: string) => void;
  onRenameCancel?: () => void;
  cutIds?: Set<number>;
  navigatorRef?: React.MutableRefObject<ExplorerNavigator | null>;
}

/* ── Drag ghost builder ──────────────────────────────────────────────────── */
function buildDragGhost(label: string): HTMLElement {
  const el = document.createElement('div');
  el.className = styles.dragGhost;
  el.textContent = label;
  document.body.appendChild(el);
  return el;
}

const EMPTY_IDS = new Set<number>();

/* ── Main component ──────────────────────────────────────────────────────── */
const FileExplorer: React.FC<FileExplorerProps> = ({
  files,
  selectedFiles,
  onSelect,
  onActivate,
  onContextMenu,
  isConnected,
  isLoading,
  viewMode,
  getThumb,
  isNetworkMode = false,
  groupMode,
  sortMode,
  sortDir,
  onSortChange,
  searchQuery = '',
  onClearSearch,
  connectGuide,
  folderCache,
  currentPath,
  onNavigateIn,
  onNavigateColumnFolder,
  onFetchBlob,
  getDirectUrl,
  onStreamVideo,
  canMove = false,
  onDragStart,
  onDropOnFolder,
  draggingFiles,
  renamingFileId,
  onRenameConfirm,
  onRenameCancel,
  cutIds = EMPTY_IDS,
  navigatorRef,
}) => {
  const selectedIds = new Set(selectedFiles.map(f => f.id));
  const primarySelected = selectedFiles[selectedFiles.length - 1] ?? null;
  const folderName = currentPath?.[currentPath.length - 1]?.name ?? '';
  const listLabel = folderName ? `Archivos de ${folderName}` : 'Archivos';

  /* ── Drag handlers shared across views ───────────────────────────────── */
  const makeDragStart = canMove ? (file: FileItem) => (e: React.DragEvent) => {
    const filesToDrag = selectedIds.has(file.id) && selectedFiles.length > 0
      ? selectedFiles
      : [file];
    if (draggingFiles) draggingFiles.current = filesToDrag;
    onDragStart?.(filesToDrag);

    const label = filesToDrag.length === 1 ? filesToDrag[0].name : `${filesToDrag.length} elementos`;
    const ghost = buildDragGhost(label);
    e.dataTransfer.setDragImage(ghost, 20, 20);
    e.dataTransfer.effectAllowed = 'move';
    requestAnimationFrame(() => ghost.remove());
  } : undefined;

  const makeDrop = canMove ? (folder: FileItem) => (e: React.DragEvent) => {
    e.preventDefault();
    onDropOnFolder?.(folder);
  } : undefined;

  /* ── Early returns ───────────────────────────────────────────────────── */
  if (!isConnected) {
    return (
      <div className={styles.emptyWrapper}>
        <div className={styles.connectState}>
          <h2 className={styles.connectTitle}>Conectá tu teléfono</h2>
          <p className={styles.connectSubtitle}>Elegí cómo querés acceder a sus archivos.</p>
          <ConnectGuide {...connectGuide} />
        </div>
      </div>
    );
  }

  if (isLoading && files.length === 0 && viewMode !== 'columns') {
    return (
      <div className={styles.emptyWrapper}>
        <div className={styles.emptyState} role="status">
          <div className={styles.spinner} aria-hidden="true" />
          <div className={styles.emptyTitle}>Cargando archivos…</div>
        </div>
      </div>
    );
  }

  const sections: Section[] = groupMode === 'kind' ? groupByKind(files) : [{ files }];
  const orderedFiles = sections.flatMap(s => s.files);
  const focusId = primarySelected && orderedFiles.some(f => f.id === primarySelected.id)
    ? primarySelected.id
    : orderedFiles[0]?.id ?? null;

  const handlers: ItemHandlers = {
    selectedIds,
    cutIds,
    focusId,
    getThumb,
    isNetworkMode,
    renamingFileId,
    onSelect: (file, e) => onSelect(file, e, orderedFiles),
    onActivate,
    onContextMenu,
    makeDragStart,
    makeDrop,
    onRenameConfirm,
    onRenameCancel,
  };

  /* ── Column view ─────────────────────────────────────────────────────── */
  if (viewMode === 'columns') {
    if (!currentPath || !folderCache) return <VirtualFileList {...handlers} sections={sections} sortMode={sortMode} sortDir={sortDir} onSortChange={onSortChange} label={listLabel} navigatorRef={navigatorRef} />;
    const visibleNodes = currentPath.slice(-3);
    return (
      <ColumnsView
        visibleNodes={visibleNodes}
        currentPath={currentPath}
        files={files}
        folderCache={folderCache}
        isLoading={isLoading}
        primarySelected={primarySelected}
        handlers={handlers}
        onSelect={onSelect}
        onNavigateIn={onNavigateIn}
        onNavigateColumnFolder={onNavigateColumnFolder}
        navigatorRef={navigatorRef}
      />
    );
  }

  /* ── Gallery view ────────────────────────────────────────────────────── */
  if (viewMode === 'gallery') {
    return (
      <div className={styles.galleryView}>
        <div className={styles.galleryPreviewArea}>
          {primarySelected
            ? onFetchBlob || getDirectUrl
              ? <GalleryPreview key={primarySelected.id} file={primarySelected} onFetchBlob={onFetchBlob ?? (() => Promise.resolve(null))} getDirectUrl={getDirectUrl} onStreamVideo={onStreamVideo} />
              : (
                <div className={styles.galleryPreviewContent}>
                  <div className={styles.galleryFallbackIcon}>{primarySelected.isFolder ? <FolderIcon /> : <FileTypeIcon name={primarySelected.name} size={96} />}</div>
                  <div className={styles.galleryPreviewName}>{primarySelected.name}</div>
                </div>
              )
            : <div className={styles.emptyState}><div className={styles.emptyTitle}>Seleccioná un elemento</div></div>
          }
        </div>
        <VirtualStrip {...handlers} files={orderedFiles} navigatorRef={navigatorRef} />
      </div>
    );
  }

  /* ── Empty folder / no search results ────────────────────────────────── */
  if (files.length === 0) {
    return (
      <div className={styles.emptyWrapper}>
        <div className={styles.emptyState}>
          {searchQuery ? (
            <>
              <SearchX className={styles.emptyIcon} size={44} strokeWidth={1.2} aria-hidden="true" />
              <div className={styles.emptyTitle}>Ningún archivo coincide con «{searchQuery}»</div>
              {onClearSearch && (
                <button type="button" className={styles.emptyAction} onClick={onClearSearch}>Limpiar búsqueda</button>
              )}
            </>
          ) : (
            <>
              <FolderOpen className={styles.emptyIcon} size={44} strokeWidth={1.2} aria-hidden="true" />
              <div className={styles.emptyTitle}>Esta carpeta está vacía</div>
            </>
          )}
        </div>
      </div>
    );
  }

  /* ── List view ───────────────────────────────────────────────────────── */
  if (viewMode === 'list') {
    return (
      <VirtualFileList
        {...handlers}
        sections={sections}
        sortMode={sortMode}
        sortDir={sortDir}
        onSortChange={onSortChange}
        label={listLabel}
        navigatorRef={navigatorRef}
      />
    );
  }

  /* ── Grid view (also grouped) ────────────────────────────────────────── */
  return <VirtualGrid {...handlers} sections={sections} label={listLabel} navigatorRef={navigatorRef} />;
};

/* ── Column view ─────────────────────────────────────────────────────────── */
const ColumnsView: React.FC<{
  visibleNodes: PathNode[];
  currentPath: PathNode[];
  files: FileItem[];
  folderCache: Record<number, FileItem[]>;
  isLoading: boolean;
  primarySelected: FileItem | null;
  handlers: ItemHandlers;
  onSelect: FileExplorerProps['onSelect'];
  onNavigateIn?: (file: FileItem) => void;
  onNavigateColumnFolder?: (depth: number, folder: FileItem) => Promise<void>;
  navigatorRef?: React.MutableRefObject<ExplorerNavigator | null>;
}> = ({
  visibleNodes, currentPath, files, folderCache, isLoading, primarySelected, handlers,
  onSelect, onNavigateIn, onNavigateColumnFolder, navigatorRef,
}) => {
  // El teclado recorre la última columna (la carpeta actual)
  usePublishNavigator(navigatorRef, {
    order: () => files,
    columns: () => 1,
    scrollTo: id => {
      document.querySelector(`[data-file-id="${id}"]`)?.scrollIntoView({ block: 'nearest' });
    },
  });

  return (
    <div className={styles.columnsView}>
      {visibleNodes.map((node, idx) => {
        const isLast = idx === visibleNodes.length - 1;
        const colFiles = isLast ? files : (folderCache[node.id] || []);

        let activeItemId: number | null = null;
        if (!isLast) activeItemId = visibleNodes[idx + 1].id;
        else if (primarySelected) activeItemId = primarySelected.id;

        return (
          <div key={node.id} className={styles.columnCol} role="listbox" aria-label={`Archivos de ${node.name}`}>
            {colFiles.length === 0 ? (
              <div className={styles.columnEmpty} role={isLoading && isLast ? 'status' : undefined}>
                {isLoading && isLast
                  ? <><div className={styles.spinnerSmall} aria-hidden="true" /><span className="sr-only">Cargando…</span></>
                  : 'Vacía'}
              </div>
            ) : (
              colFiles.map(f => (
                <ColumnFileItem
                  key={f.id}
                  file={f}
                  isActive={f.id === activeItemId}
                  isCut={handlers.cutIds.has(f.id)}
                  tabIndex={isLast && f.id === handlers.focusId ? 0 : -1}
                  getThumb={handlers.getThumb}
                  isNetworkMode={handlers.isNetworkMode}
                  onContextMenu={(e) => { e.stopPropagation(); handlers.onContextMenu(f, e); }}
                  onDragStart={handlers.makeDragStart?.(f)}
                  onDrop={f.isFolder ? handlers.makeDrop?.(f) : undefined}
                  onClick={(e) => {
                    e.stopPropagation();
                    const actualIndex = currentPath.length - visibleNodes.length + idx;
                    onSelect(f, e, colFiles);
                    if (!f.isFolder) return;
                    if (isLast) onNavigateIn?.(f);
                    else onNavigateColumnFolder?.(actualIndex, f);
                  }}
                />
              ))
            )}
          </div>
        );
      })}
    </div>
  );
};

export default FileExplorer;
