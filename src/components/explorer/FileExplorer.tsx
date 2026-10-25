import React, { memo, useRef } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import styles from './FileExplorer.module.css';
import FileItemComponent, { FolderIcon, SmallFolderIcon, getFileEmoji } from './FileItem';
import FileListItem from './FileListItem';
import type { FileItem, PathNode } from '../../hooks/useMTPDevice';
import type { ViewMode, GroupMode } from '../layout/AppLayout';
import { useThumbnail, isImageFile } from '../../hooks/useThumbnail';

function getFileCategory(file: FileItem): string {
  if (file.isFolder) return 'Carpetas';
  const ext = file.name.split('.').pop()?.toLowerCase() || '';
  if (['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'svg', 'heic', 'heif'].includes(ext)) return 'Imágenes';
  if (['pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'txt', 'rtf', 'csv'].includes(ext)) return 'Documentos';
  if (['mp4', 'mov', 'avi', 'mkv', 'webm'].includes(ext)) return 'Películas';
  if (['mp3', 'wav', 'ogg', 'flac', 'm4a', 'aac'].includes(ext)) return 'Audio';
  if (['zip', 'rar', '7z', 'tar', 'gz'].includes(ext)) return 'Archivos comprimidos';
  if (['apk', 'exe', 'dmg', 'iso'].includes(ext)) return 'Instaladores';
  return 'Otros';
}

/* ── Column item with lazy thumbnail support ─────────────────────────────── */
const noopThumb = async (_h: number): Promise<Blob | null> => null;

const ColumnFileItem = memo<{
  file: FileItem;
  isActive: boolean;
  onClick: (e: React.MouseEvent) => void;
  onContextMenu: (e: React.MouseEvent) => void;
  onDragStart: (e: React.DragEvent) => void;
  onDragOver: (e: React.DragEvent) => void;
  onDrop: (e: React.DragEvent) => void;
  getThumb?: (handle: number) => Promise<Blob | null>;
  isNetworkMode?: boolean;
}>(({ file, isActive, onClick, onContextMenu, onDragStart, onDragOver, onDrop, getThumb, isNetworkMode }) => {
  const [isDropTarget, setIsDropTarget] = React.useState(false);
  const { thumbUrl, thumbRef } = useThumbnail({ file, getThumb: getThumb ?? noopThumb, isNetwork: isNetworkMode });
  const showThumb = !file.isFolder && isImageFile(file.name) && !!getThumb;

  return (
    <div
      ref={thumbRef}
      className={`${styles.columnItem} ${isActive ? styles.columnItemActive : ''} ${isDropTarget ? styles.columnItemDrop : ''}`}
      data-file-id={file.id}
      onClick={onClick}
      onContextMenu={onContextMenu}
      draggable
      onDragStart={onDragStart}
      onDragOver={(e) => {
        if (!file.isFolder) return;
        e.preventDefault();
        setIsDropTarget(true);
        onDragOver(e);
      }}
      onDragLeave={() => setIsDropTarget(false)}
      onDrop={(e) => { setIsDropTarget(false); onDrop(e); }}
    >
      <div className={styles.colItemLeft}>
        <span className={styles.colIcon}>
          {file.isFolder
            ? <SmallFolderIcon />
            : showThumb && thumbUrl
              ? <img src={thumbUrl} className={styles.colThumb} alt="" />
              : getFileEmoji(file.name)}
        </span>
        <span className={styles.colName}>{file.name}</span>
      </div>
      {file.isFolder && <span className={styles.colArrow}>›</span>}
    </div>
  );
});

/* ── Virtual file list (list view only) ─────────────────────────────────── */
// Uses @tanstack/react-virtual to render only the visible rows.
// The list creates its own internal scroll container so it doesn't
// interfere with the parent's overflow behaviour.
const LIST_ROW_H = 30; // matches .row height in FileListItem.module.css

const VirtualFileList = memo<{
  files: FileItem[];
  selectedIds: Set<number>;
  getThumb?: (handle: number) => Promise<Blob | null>;
  isNetworkMode?: boolean;
  renamingFileId?: number | null;
  onSelect: (file: FileItem, e: React.MouseEvent) => void;
  onActivate: (file: FileItem) => void;
  onContextMenu: (file: FileItem, e: React.MouseEvent) => void;
  makeDragStart: (file: FileItem) => (e: React.DragEvent) => void;
  makeDrop: (folder: FileItem) => (e: React.DragEvent) => void;
  onRenameConfirm?: (file: FileItem, newName: string) => void;
  onRenameCancel?: () => void;
}>(({
  files, selectedIds, getThumb, isNetworkMode, renamingFileId,
  onSelect, onActivate, onContextMenu,
  makeDragStart, makeDrop, onRenameConfirm, onRenameCancel,
}) => {
  const scrollRef = useRef<HTMLDivElement>(null);

  const virtualizer = useVirtualizer({
    count: files.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => LIST_ROW_H,
    overscan: 15,
  });

  return (
    <div className={styles.list}>
      <div className={styles.listHeader}>
        <div className={styles.listHeaderCell}>Nombre</div>
        <div className={styles.listHeaderCell}>Fecha de modificación</div>
        <div className={styles.listHeaderCell}>Tamaño</div>
        <div className={styles.listHeaderCell}>Tipo</div>
      </div>
      <div ref={scrollRef} className={styles.virtualScroll}>
        <div style={{ height: virtualizer.getTotalSize(), position: 'relative' }}>
          {virtualizer.getVirtualItems().map(vRow => {
            const file = files[vRow.index];
            return (
              <div
                key={vRow.key}
                data-index={vRow.index}
                style={{ position: 'absolute', top: vRow.start, left: 0, right: 0, height: vRow.size }}
              >
                <FileListItem
                  file={file}
                  isSelected={selectedIds.has(file.id)}
                  onSelect={(e) => onSelect(file, e)}
                  onActivate={() => onActivate(file)}
                  onContextMenu={(e) => onContextMenu(file, e)}
                  onDragStart={makeDragStart(file)}
                  onDragOver={file.isFolder ? (e) => e.preventDefault() : undefined}
                  onDrop={file.isFolder ? makeDrop(file) : undefined}
                  getThumb={getThumb}
                  isNetworkMode={isNetworkMode}
                  isRenaming={file.id === renamingFileId}
                  onRenameConfirm={(newName) => onRenameConfirm?.(file, newName)}
                  onRenameCancel={onRenameCancel}
                />
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
});

/* ── Gallery center preview with actual blob rendering ───────────────────── */
const GALLERY_MEDIA_EXTS = new Set([
  'jpg','jpeg','png','gif','webp','bmp','heic','heif','mp4','webm','mov',
]);

const GalleryPreview: React.FC<{
  file: FileItem;
  onFetchBlob: (file: FileItem) => Promise<Blob | null>;
  getDirectUrl?: (file: FileItem) => string | null;
  onStreamVideo?: (file: FileItem, signal: AbortSignal) => { url: string; cleanup: () => void } | null;
}> = ({ file, onFetchBlob, getDirectUrl, onStreamVideo }) => {
  const [mediaUrl, setMediaUrl] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState(false);
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
    if (blobUrlRef.current) { URL.revokeObjectURL(blobUrlRef.current); blobUrlRef.current = null; }
    if (streamCleanupRef.current) { streamCleanupRef.current(); streamCleanupRef.current = null; }
    setMediaUrl(null);
    setIsPlaying(false);
    setVideoTime(0);
    setVideoDuration(0);
    if (file.isFolder) return;
    const ext = file.name.split('.').pop()?.toLowerCase() ?? '';
    if (!GALLERY_MEDIA_EXTS.has(ext)) return;

    const abortCtrl = new AbortController();

    // URL directa disponible (modo red) — sin descarga previa
    if (getDirectUrl) {
      const url = getDirectUrl(file);
      if (url) { setMediaUrl(url); return () => { abortCtrl.abort(); }; }
    }

    // Streaming MSE para video MTP — inicia reproducción sin esperar descarga completa
    if (onStreamVideo && ['mp4','webm','mov','m4v','3gp'].includes(ext)) {
      const stream = onStreamVideo(file, abortCtrl.signal);
      if (stream) {
        streamCleanupRef.current = stream.cleanup;
        setMediaUrl(stream.url);
        return () => { abortCtrl.abort(); };
      }
    }

    // Fallback: descarga blob completo (modo USB/MTP para imágenes o sin MSE)
    let cancelled = false;
    setLoading(true);
    onFetchBlob(file).then(blob => {
      if (cancelled || !blob) { setLoading(false); return; }
      const url = URL.createObjectURL(blob);
      blobUrlRef.current = url;
      setMediaUrl(url);
      setLoading(false);
    }).catch(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; abortCtrl.abort(); };
  }, [file.id]); // eslint-disable-line react-hooks/exhaustive-deps

  React.useEffect(() => () => {
    if (blobUrlRef.current) URL.revokeObjectURL(blobUrlRef.current);
    if (streamCleanupRef.current) streamCleanupRef.current();
  }, []);

  if (loading) return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10 }}>
      <div className={styles.gallerySpinner} />
      <span style={{ color: 'var(--text-secondary)', fontSize: 13 }}>Cargando vista previa...</span>
    </div>
  );

  if (mediaUrl) {
    const ext = file.name.split('.').pop()?.toLowerCase() ?? '';
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
    return <img src={mediaUrl} alt={file.name} style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain', borderRadius: 6 }} />;
  }

  return (
    <div className={styles.galleryPreviewContent}>
      <div style={{ width: 120, height: 120, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 96 }}>
        {file.isFolder ? <FolderIcon /> : getFileEmoji(file.name)}
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
  folderCache?: Record<number, FileItem[]>;
  currentPath?: PathNode[];
  onNavigateIn?: (file: FileItem) => void;
  onNavigateToPathIndex?: (index: number) => Promise<void>;
  onNavigateColumnFolder?: (depth: number, folder: FileItem) => Promise<void>;
  onFetchBlob?: (file: FileItem) => Promise<Blob | null>;
  getDirectUrl?: (file: FileItem) => string | null;
  onStreamVideo?: (file: FileItem, signal: AbortSignal) => { url: string; cleanup: () => void } | null;
  onDownload?: (file: FileItem) => void;
  onDragStart?: (files: FileItem[]) => void;
  onDropOnFolder?: (folder: FileItem) => void;
  draggingFiles?: React.MutableRefObject<FileItem[]>;
  renamingFileId?: number | null;
  onRenameConfirm?: (file: FileItem, newName: string) => void;
  onRenameCancel?: () => void;
}

/* ── Drag ghost builder ──────────────────────────────────────────────────── */
function buildDragGhost(label: string): HTMLElement {
  const el = document.createElement('div');
  el.style.cssText = [
    'position:fixed', 'top:-200px', 'left:-200px',
    'background:rgba(0,122,255,0.92)', 'color:#fff',
    'padding:6px 14px', 'border-radius:10px',
    'font-size:13px', 'font-weight:500',
    'font-family:-apple-system,BlinkMacSystemFont,sans-serif',
    'white-space:nowrap', 'pointer-events:none',
    'box-shadow:0 4px 16px rgba(0,0,0,0.4)',
  ].join(';');
  el.textContent = label;
  document.body.appendChild(el);
  return el;
}

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
  folderCache,
  currentPath,
  onNavigateIn,
  onNavigateColumnFolder,
  onFetchBlob,
  getDirectUrl,
  onStreamVideo,
  onDragStart,
  onDropOnFolder,
  draggingFiles,
  renamingFileId,
  onRenameConfirm,
  onRenameCancel,
}) => {
  const selectedIds = new Set(selectedFiles.map(f => f.id));
  const primarySelected = selectedFiles[selectedFiles.length - 1] ?? null;

  /* ── Drag handlers shared across views ───────────────────────────────── */
  const makeDragStart = (file: FileItem) => (e: React.DragEvent) => {
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
  };

  const makeDrop = (folder: FileItem) => (e: React.DragEvent) => {
    e.preventDefault();
    onDropOnFolder?.(folder);
  };

  /* ── Early returns ───────────────────────────────────────────────────── */
  if (!isConnected) {
    return (
      <div className={styles.emptyWrapper}>
        <div className={styles.emptyState}>
          <div className={styles.emptyIcon}>📱</div>
          <div className={styles.emptyTitle}>Sin dispositivo conectado</div>
          <div className={styles.emptySubtitle}>
            Conecta tu Android via USB, selecciona "Transferencia de archivos" y toca el dispositivo en el panel izquierdo.
          </div>
        </div>
      </div>
    );
  }

  if (isLoading && files.length === 0 && viewMode !== 'columns') {
    return (
      <div className={styles.emptyWrapper}>
        <div className={styles.emptyState}>
          <div className={styles.emptyIcon}>🔄</div>
          <div className={styles.emptyTitle}>Explorando dispositivo...</div>
        </div>
      </div>
    );
  }

  /* ── Shared handler wrappers for virtual list ────────────────────────── */
  const handleVirtualSelect = (file: FileItem, e: React.MouseEvent) => onSelect(file, e, files);
  const handleVirtualActivate = (file: FileItem) => onActivate(file);
  const handleVirtualContextMenu = (file: FileItem, e: React.MouseEvent) => onContextMenu(file, e);

  /* ── Renderers ───────────────────────────────────────────────────────── */
  // Non-grouped list view uses VirtualFileList for performance.
  // Grouped list uses a plain render (each group is small).
  const renderList = (filesToRender: FileItem[]) => (
    <div className={styles.list}>
      <div className={styles.listHeader}>
        <div className={styles.listHeaderCell}>Nombre</div>
        <div className={styles.listHeaderCell}>Fecha de modificación</div>
        <div className={styles.listHeaderCell}>Tamaño</div>
        <div className={styles.listHeaderCell}>Tipo</div>
      </div>
      {filesToRender.map(file => (
        <FileListItem
          key={file.id}
          file={file}
          isSelected={selectedIds.has(file.id)}
          onSelect={(e) => onSelect(file, e, filesToRender)}
          onActivate={() => onActivate(file)}
          onContextMenu={(e) => onContextMenu(file, e)}
          onDragStart={makeDragStart(file)}
          onDragOver={file.isFolder ? (e) => e.preventDefault() : undefined}
          onDrop={file.isFolder ? makeDrop(file) : undefined}
          getThumb={getThumb}
          isNetworkMode={isNetworkMode}
          isRenaming={file.id === renamingFileId}
          onRenameConfirm={(newName) => onRenameConfirm?.(file, newName)}
          onRenameCancel={onRenameCancel}
        />
      ))}
    </div>
  );

  const renderGrid = (filesToRender: FileItem[]) => (
    <div className={styles.grid}>
      {filesToRender.map(file => (
        <FileItemComponent
          key={file.id}
          file={file}
          isSelected={selectedIds.has(file.id)}
          onSelect={(e) => onSelect(file, e, filesToRender)}
          onActivate={() => onActivate(file)}
          onContextMenu={(e) => onContextMenu(file, e)}
          getThumb={getThumb}
          isNetworkMode={isNetworkMode}
          onDragStart={makeDragStart(file)}
          onDrop={file.isFolder ? makeDrop(file) : undefined}
          isRenaming={file.id === renamingFileId}
          onRenameConfirm={(newName) => onRenameConfirm?.(file, newName)}
          onRenameCancel={onRenameCancel}
        />
      ))}
    </div>
  );

  /* ── Column view ─────────────────────────────────────────────────────── */
  if (viewMode === 'columns') {
    if (!currentPath || !folderCache) return renderList(files);
    const visibleNodes = currentPath.slice(-3);
    return (
      <div className={styles.columnsView}>
        {visibleNodes.map((node, idx) => {
          const isLast = idx === visibleNodes.length - 1;
          const colFiles = isLast ? files : (folderCache[node.id] || []);
          const isEmpty = colFiles.length === 0;

          let activeItemId: number | null = null;
          if (!isLast) activeItemId = visibleNodes[idx + 1].id;
          else if (primarySelected) activeItemId = primarySelected.id;

          return (
            <div key={node.id} className={styles.columnCol}>
              {isEmpty ? (
                <div style={{ padding: 16, color: 'var(--text-secondary)', fontSize: 13, textAlign: 'center' }}>
                  {isLoading && isLast ? '...' : 'Vacío'}
                </div>
              ) : (
                colFiles.map(f => (
                  <ColumnFileItem
                    key={f.id}
                    file={f}
                    isActive={f.id === activeItemId}
                    getThumb={getThumb}
                    isNetworkMode={isNetworkMode}
                    onContextMenu={(e) => { e.stopPropagation(); onContextMenu(f, e); }}
                    onDragStart={makeDragStart(f)}
                    onDragOver={(e) => e.preventDefault()}
                    onDrop={makeDrop(f)}
                    onClick={(e) => {
                      e.stopPropagation();
                      const actualIndex = currentPath.length - visibleNodes.length + idx;
                      if (isLast) {
                        onSelect(f, e, colFiles);
                        if (f.isFolder && onNavigateIn) onNavigateIn(f);
                      } else {
                        onSelect(f, e, colFiles);
                        if (f.isFolder && onNavigateColumnFolder) {
                          onNavigateColumnFolder(actualIndex, f);
                        }
                      }
                    }}
                  />
                ))
              )}
            </div>
          );
        })}
      </div>
    );
  }

  /* ── Gallery view ────────────────────────────────────────────────────── */
  if (viewMode === 'gallery') {
    return (
      <div className={styles.galleryView}>
        <div className={styles.galleryPreviewArea}>
          {primarySelected
            ? onFetchBlob || getDirectUrl
              ? <GalleryPreview file={primarySelected} onFetchBlob={onFetchBlob ?? (() => Promise.resolve(null))} getDirectUrl={getDirectUrl} onStreamVideo={onStreamVideo} />
              : (
                <div className={styles.galleryPreviewContent}>
                  <div style={{ fontSize: 96 }}>{primarySelected.isFolder ? <FolderIcon /> : getFileEmoji(primarySelected.name)}</div>
                  <div className={styles.galleryPreviewName}>{primarySelected.name}</div>
                </div>
              )
            : <div className={styles.emptyState}><div className={styles.emptyTitle}>Selecciona un elemento</div></div>
          }
        </div>
        <div className={styles.galleryStripWrapper}>
          <div className={styles.galleryStrip}>
            {files.map(file => (
              <FileItemComponent
                key={file.id}
                file={file}
                isSelected={selectedIds.has(file.id)}
                onSelect={(e) => onSelect(file, e, files)}
                onActivate={() => onActivate(file)}
                onContextMenu={(e) => onContextMenu(file, e)}
                getThumb={getThumb}
                isNetworkMode={isNetworkMode}
                onDragStart={makeDragStart(file)}
                onDrop={file.isFolder ? makeDrop(file) : undefined}
                isRenaming={file.id === renamingFileId}
                onRenameConfirm={(newName) => onRenameConfirm?.(file, newName)}
                onRenameCancel={onRenameCancel}
              />
            ))}
          </div>
        </div>
      </div>
    );
  }

  /* ── Empty folder ────────────────────────────────────────────────────── */
  if (files.length === 0) {
    return (
      <div className={styles.emptyWrapper}>
        <div className={styles.emptyState}>
          <div className={styles.emptyIcon}>📁</div>
          <div className={styles.emptyTitle}>Esta carpeta está vacía</div>
        </div>
      </div>
    );
  }

  /* ── Grouped view ────────────────────────────────────────────────────── */
  if (groupMode === 'kind') {
    const groups: Record<string, FileItem[]> = {};
    files.forEach(f => {
      const cat = getFileCategory(f);
      if (!groups[cat]) groups[cat] = [];
      groups[cat].push(f);
    });
    const sortedCategories = Object.keys(groups).sort((a, b) => {
      if (a === 'Carpetas') return -1;
      if (b === 'Carpetas') return 1;
      return a.localeCompare(b);
    });
    return (
      <div className={styles.groupedView}>
        {sortedCategories.map(cat => (
          <div key={cat} className={styles.groupSection}>
            <div className={styles.groupHeader}>
              <span className={styles.groupHeaderTitle}>{cat}</span>
            </div>
            {viewMode === 'list' ? renderList(groups[cat]) : renderGrid(groups[cat])}
          </div>
        ))}
      </div>
    );
  }

  /* ── Non-grouped list — virtual scroll ───────────────────────────────── */
  if (viewMode === 'list') {
    return (
      <VirtualFileList
        files={files}
        selectedIds={selectedIds}
        getThumb={getThumb}
        isNetworkMode={isNetworkMode}
        renamingFileId={renamingFileId}
        onSelect={handleVirtualSelect}
        onActivate={handleVirtualActivate}
        onContextMenu={handleVirtualContextMenu}
        makeDragStart={makeDragStart}
        makeDrop={makeDrop}
        onRenameConfirm={onRenameConfirm}
        onRenameCancel={onRenameCancel}
      />
    );
  }

  return renderGrid(files);
};

export default FileExplorer;
