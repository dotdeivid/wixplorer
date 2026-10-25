import React, { useState, useCallback, useRef, useEffect } from 'react';
import styles from './AppLayout.module.css';
import Sidebar from '../sidebar/Sidebar';
import Toolbar from '../toolbar/Toolbar';
import FileExplorer from '../explorer/FileExplorer';
import StatusBar from '../statusbar/StatusBar';
import PreviewPanel from '../preview/PreviewPanel';
import { useMTPDevice } from '../../hooks/useMTPDevice';
import type { FileItem } from '../../hooks/useMTPDevice';
import { useNetworkDevice } from '../../hooks/useNetworkDevice';
import type { NetworkDevice } from '../../hooks/useNetworkDevice'; // used in pinDialogDevice state
import PinDialog from '../network/PinDialog';
import RecentsView from '../recents/RecentsView';
import { RecentsStorage } from '../../services/recents/RecentsStorage';
import ContextMenu from '../contextmenu/ContextMenu';
import NewFolderDialog from '../contextmenu/NewFolderDialog';
import { toast } from 'sonner';
import { isSelfHosted } from '../../services/network/selfHosted';
import QuitScreen from '../quit/QuitScreen';
import { errorMessage, errorName } from '../../utils/errors';

export type ViewMode = 'grid' | 'list' | 'columns' | 'gallery';
export type SortMode = 'none' | 'name' | 'date' | 'size' | 'kind';
export type GroupMode = 'none' | 'kind' | 'date';

const MIN_PANEL_WIDTH = 180;
const MAX_PANEL_WIDTH = 500;
const DEFAULT_PANEL_WIDTH = 240;

const AppLayout: React.FC = () => {
  const mtpState = useMTPDevice();
  const networkState = useNetworkDevice();
  const [pinDialogDevice, setPinDialogDevice] = useState<NetworkDevice | null>(null);
  const [zipProgress, setZipProgress] = useState<number | null>(null);

  // Constante de sesión — no cambia mientras la página esté abierta
  const selfHosted = isSelfHosted();
  const [quitting, setQuitting] = useState(false);

  // Modo activo: 'network' cuando hay un dispositivo de red autenticado, 'usb' en otro caso
  const isNetworkMode = networkState.connectedDevice !== null;

  // Estado unificado — el resto de la UI consume estas variables sin saber el modo
  const activeFiles       = isNetworkMode ? networkState.files       : mtpState.files;
  const activeCurrentPath = isNetworkMode ? networkState.currentPath : mtpState.currentPath;
  const activeIsConnected = isNetworkMode ? true                     : mtpState.isConnected;
  const activeIsLoading   = isNetworkMode ? networkState.isLoading   : mtpState.isLoading;
  const activeError       = isNetworkMode ? networkState.error       : mtpState.error;
  const activeFolderCache = isNetworkMode ? networkState.folderCache  : mtpState.folderCache;
  const activeCanGoFwd    = isNetworkMode ? networkState.canGoForward : mtpState.canGoForward;

  const activeNavigateIn  = isNetworkMode ? networkState.navigateIn  : mtpState.navigateIn;
  const activeNavigateOut = isNetworkMode ? networkState.navigateOut : mtpState.navigateOut;
  const activeNavigateFwd = isNetworkMode
    ? async () => { /* forward not implemented for network yet */ }
    : mtpState.navigateForward;
  const activeNavigateToPathIndex = isNetworkMode
    ? networkState.navigateToPathIndex
    : mtpState.navigateToPathIndex;
  const activeNavigateColumnFolder = isNetworkMode
    ? networkState.navigateColumnFolder
    : mtpState.navigateColumnFolder;
  const activeDownloadFile = useCallback((file: FileItem) => {
    return isNetworkMode ? networkState.downloadFile(file) : mtpState.downloadFile(file);
  }, [isNetworkMode, networkState, mtpState]);
  const activeCancelDownload = isNetworkMode ? networkState.cancelDownload : mtpState.cancelDownload;
  const activePreviewFile  = isNetworkMode ? networkState.previewFile  : mtpState.previewFile;
  const activeGetThumb     = isNetworkMode ? networkState.getThumb     : (mtpState.isConnected ? mtpState.getThumb : undefined);
  // URL directa solo disponible en modo red — permite preview sin descarga previa
  const activeGetDirectUrl = isNetworkMode
    ? (file: FileItem) => networkState.getDirectUrl(file.id)
    : undefined;
  const [viewMode, setViewMode] = useState<ViewMode>('grid');
  const [sortMode, setSortMode] = useState<SortMode>('none');
  const [groupMode, setGroupMode] = useState<GroupMode>('none');
  const [searchQuery, setSearchQuery] = useState('');
  const [errorDismissed, setErrorDismissed] = useState(false);
  const [activeSection, setActiveSection] = useState<string | null>('home');

  // Multi-select
  const [selectedFiles, setSelectedFiles] = useState<FileItem[]>([]);
  const primarySelected = selectedFiles[selectedFiles.length - 1] ?? null;
  const selectionAnchorRef = useRef<FileItem | null>(null);

  // Context menu
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; isBackground: boolean } | null>(null);

  // New folder dialog
  const [newFolderDialogOpen, setNewFolderDialogOpen] = useState(false);

  // Inline rename
  const [renamingFileId, setRenamingFileId] = useState<number | null>(null);

  // Clipboard (cut only; copy requires MTP SendObject which is out of scope)
  const [clipboard, setClipboard] = useState<{ files: FileItem[]; op: 'cut' } | null>(null);

  // Drag ref (avoids stale closure in drag handlers)
  const draggingRef = useRef<FileItem[]>([]);

  // Rubber-band selection
  const [rubberBand, setRubberBand] = useState<{ x1: number; y1: number; x2: number; y2: number } | null>(null);
  const rbStartRef = useRef<{ x: number; y: number } | null>(null);
  const rbMovedRef = useRef(false);         // true once the drag moved > threshold
  const rbDidSelectRef = useRef(false);     // true if rubber-band actually ran
  const visibleFilesRef = useRef<FileItem[]>([]); // always up-to-date without closure issues
  const contentRef = useRef<HTMLDivElement>(null);

  // Preview panel resizing
  const [panelWidth, setPanelWidth] = useState(DEFAULT_PANEL_WIDTH);
  const isDragging = useRef(false);
  const dragStartX = useRef(0);
  const dragStartWidth = useRef(DEFAULT_PANEL_WIDTH);

  React.useEffect(() => {
    if (mtpState.error) setErrorDismissed(false);
  }, [mtpState.error]);

  /* ── Re-autenticar cuando la sesión expira ──────────────────────────── */
  useEffect(() => {
    if (networkState.lastExpiredDevice) {
      toast.error('Sesión expirada — volvé a ingresar el PIN');
      setPinDialogDevice(networkState.lastExpiredDevice);
      networkState.clearExpiredDevice();
    }
  }, [networkState.lastExpiredDevice]); // eslint-disable-line react-hooks/exhaustive-deps

  /* ── Auto-hospedado: abrir PinDialog en cuanto el dispositivo se pre-carga ── */
  useEffect(() => {
    if (
      selfHosted &&
      networkState.devices.length > 0 &&
      !networkState.connectedDevice &&
      !pinDialogDevice
    ) {
      setPinDialogDevice(networkState.devices[0]);
    }
  }, [networkState.devices]); // eslint-disable-line react-hooks/exhaustive-deps

  /* ── Network device auth ────────────────────────────────────────────── */
  const handlePinConfirm = useCallback(async (pin: string) => {
    if (!pinDialogDevice) return;
    const ok = await networkState.authenticate(pinDialogDevice, pin);
    if (ok) {
      setPinDialogDevice(null);
      toast.success(`Conectado a ${pinDialogDevice.deviceName}`);
    }
  }, [pinDialogDevice, networkState]);

  const handlePinCancel = useCallback(() => {
    setPinDialogDevice(null);
  }, []);

  // Clear selection when navigating
  React.useEffect(() => {
    setSelectedFiles([]);
    selectionAnchorRef.current = null;
  }, [mtpState.currentPath]);

  /* ── Selection ──────────────────────────────────────────────────────── */
  const handleSelectFile = useCallback((file: FileItem, event: React.MouseEvent, allVisibleFiles: FileItem[]) => {
    if (event.metaKey || event.ctrlKey) {
      selectionAnchorRef.current = file;
      setSelectedFiles(prev =>
        prev.find(f => f.id === file.id)
          ? prev.filter(f => f.id !== file.id)
          : [...prev, file]
      );
    } else if (event.shiftKey && selectionAnchorRef.current) {
      const anchor = selectionAnchorRef.current;
      const anchorIdx = allVisibleFiles.findIndex(f => f.id === anchor.id);
      const thisIdx = allVisibleFiles.findIndex(f => f.id === file.id);
      if (anchorIdx >= 0 && thisIdx >= 0) {
        const start = Math.min(anchorIdx, thisIdx);
        const end = Math.max(anchorIdx, thisIdx);
        setSelectedFiles(allVisibleFiles.slice(start, end + 1));
      } else {
        selectionAnchorRef.current = file;
        setSelectedFiles([file]);
      }
    } else {
      selectionAnchorRef.current = file;
      setSelectedFiles([file]);
    }
    if (!file.isFolder) RecentsStorage.touch(file);
  }, []);

  /* ── Activate (double-click) ────────────────────────────────────────── */
  const handleActivate = useCallback((file: FileItem) => {
    if (file.isFolder) {
      activeNavigateIn(file);
      setSelectedFiles([]);
    } else {
      if (!isNetworkMode) RecentsStorage.touch(file);
      activeDownloadFile(file);
    }
  }, [activeNavigateIn, activeDownloadFile, isNetworkMode]);

  /* ── Context menu ───────────────────────────────────────────────────── */
  const handleContextMenu = useCallback((file: FileItem, event: React.MouseEvent) => {
    event.preventDefault();
    event.stopPropagation();
    // If the right-clicked file is not already in selection, select only it
    setSelectedFiles(prev => prev.find(f => f.id === file.id) ? prev : [file]);
    setContextMenu({ x: event.clientX, y: event.clientY, isBackground: false });
  }, []);

  const handleBackgroundContextMenu = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    setContextMenu({ x: e.clientX, y: e.clientY, isBackground: true });
  }, []);

  /* ── Download ZIP ───────────────────────────────────────────────────── */
  const handleDownloadZip = useCallback(async (filesToZip: FileItem[]) => {
    if (filesToZip.length === 0) { toast.error('No hay archivos para descargar'); return; }

    // Phase split: 0–75% fetching files, 75–100% compressing
    const FETCH_PHASE = 75;
    setZipProgress(0);
    try {
      const JSZip = (await import('jszip')).default;
      const zip = new JSZip();

      for (let i = 0; i < filesToZip.length; i++) {
        const blob = await activePreviewFile(filesToZip[i]);
        if (blob) zip.file(filesToZip[i].name, blob);
        setZipProgress(Math.round(((i + 1) / filesToZip.length) * FETCH_PHASE));
      }

      const zipBlob = await zip.generateAsync(
        { type: 'blob', compression: 'DEFLATE', compressionOptions: { level: 6 } },
        (meta) => setZipProgress(FETCH_PHASE + Math.round((meta.percent / 100) * (100 - FETCH_PHASE)))
      );
      const url = URL.createObjectURL(zipBlob);
      const a = document.createElement('a');
      a.href = url; a.download = 'pt_files.zip';
      document.body.appendChild(a); a.click(); document.body.removeChild(a);
      URL.revokeObjectURL(url);
      setZipProgress(100);
      setTimeout(() => setZipProgress(null), 1200);
      toast.success('ZIP descargado');
    } catch (e) {
      if (errorName(e) !== 'AbortError') {
        const msg = (e instanceof RangeError || (errorMessage(e) ?? '').toLowerCase().includes('allocation'))
          ? 'Los archivos seleccionados son demasiado grandes para comprimir en memoria. Intentá con menos archivos o descargalos de a uno.'
          : 'Error al crear ZIP: ' + (errorMessage(e) ?? '');
        toast.error(msg);
      }
      setZipProgress(null);
    }
  }, [activePreviewFile]);

  /* ── Download — single uses <a> link, multiple auto-ZIPs ──────────── */
  const handleDownloadSelected = useCallback(async () => {
    const files = selectedFiles.filter(f => !f.isFolder);
    if (files.length === 0) return;
    if (files.length === 1) {
      activeDownloadFile(files[0]);
    } else {
      handleDownloadZip(files);
    }
  }, [selectedFiles, activeDownloadFile, handleDownloadZip]);

  /* ── Delete ─────────────────────────────────────────────────────────── */
  const handleDeleteSelected = useCallback(async () => {
    if (selectedFiles.length === 0) return;
    const names = selectedFiles.length === 1
      ? `"${selectedFiles[0].name}"`
      : `${selectedFiles.length} elementos`;
    if (!window.confirm(`¿Eliminar ${names}? Esta acción no se puede deshacer.`)) return;
    const activeDeleteFiles = isNetworkMode ? networkState.deleteFiles : mtpState.deleteFiles;
    try {
      await activeDeleteFiles(selectedFiles);
      setSelectedFiles([]);
      toast.success(`${names} eliminado`);
    } catch (e) {
      toast.error('Error al eliminar: ' + (errorMessage(e) ?? ''));
    }
  }, [selectedFiles, isNetworkMode, networkState.deleteFiles, mtpState.deleteFiles]);

  /* ── Inline Rename ──────────────────────────────────────────────────── */
  const handleInlineRenameConfirm = useCallback(async (file: FileItem, newName: string) => {
    setRenamingFileId(null);
    try {
      await mtpState.renameFile(file, newName);
      toast.success('Renombrado correctamente');
    } catch (e) {
      toast.error('Error al renombrar: ' + (errorMessage(e) ?? ''));
    }
  }, [mtpState]);

  const handleInlineRenameCancel = useCallback(() => {
    setRenamingFileId(null);
  }, []);

  /* ── Cut / Paste ────────────────────────────────────────────────────── */
  const handleCut = useCallback(() => {
    if (selectedFiles.length === 0) return;
    setClipboard({ files: [...selectedFiles], op: 'cut' });
    toast.info(`${selectedFiles.length} elemento${selectedFiles.length !== 1 ? 's' : ''} listo para mover`);
  }, [selectedFiles]);

  const handlePaste = useCallback(async () => {
    if (!clipboard || clipboard.files.length === 0) return;
    const targetFolder = primarySelected?.isFolder ? primarySelected : null;
    if (!targetFolder) { toast.error('Selecciona una carpeta destino primero'); return; }
    try {
      await mtpState.moveFiles(clipboard.files, targetFolder);
      setClipboard(null);
      setSelectedFiles([]);
      toast.success('Archivos movidos');
    } catch (e) {
      toast.error('Error al mover: ' + (errorMessage(e) ?? ''));
    }
  }, [clipboard, primarySelected, mtpState]);

  /* ── New Folder ────────────────────────────────────────────────────── */
  const handleNewFolderConfirm = useCallback(async (name: string) => {
    setNewFolderDialogOpen(false);
    try {
      await mtpState.createFolder(name);
      toast.success(`Carpeta "${name}" creada`);
    } catch (e) {
      toast.error('Error al crear carpeta: ' + (errorMessage(e) ?? ''));
    }
  }, [mtpState]);

  /* ── Drag ───────────────────────────────────────────────────────────── */
  const handleDragStart = useCallback((files: FileItem[]) => {
    draggingRef.current = files;
  }, []);

  const handleDropOnFolder = useCallback(async (targetFolder: FileItem) => {
    const filesToMove = draggingRef.current.filter(f => f.id !== targetFolder.id);
    draggingRef.current = [];
    if (filesToMove.length === 0) return;
    try {
      await mtpState.moveFiles(filesToMove, targetFolder);
      setSelectedFiles([]);
      toast.success(`${filesToMove.length > 1 ? filesToMove.length + ' archivos' : `"${filesToMove[0].name}"`} movido${filesToMove.length > 1 ? 's' : ''}`);
    } catch (e) {
      toast.error('Error al mover: ' + (errorMessage(e) ?? ''));
    }
  }, [mtpState]);

  /* ── Panel resize ───────────────────────────────────────────────────── */
  const onResizeMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    isDragging.current = true;
    dragStartX.current = e.clientX;
    dragStartWidth.current = panelWidth;
    document.body.style.cursor = 'ew-resize';
    document.body.style.userSelect = 'none';
  }, [panelWidth]);

  useEffect(() => {
    const onMouseMove = (e: MouseEvent) => {
      if (!isDragging.current) return;
      const delta = dragStartX.current - e.clientX;
      const newWidth = Math.min(MAX_PANEL_WIDTH, Math.max(MIN_PANEL_WIDTH, dragStartWidth.current + delta));
      setPanelWidth(newWidth);
    };
    const onMouseUp = () => {
      if (!isDragging.current) return;
      isDragging.current = false;
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
    return () => { window.removeEventListener('mousemove', onMouseMove); window.removeEventListener('mouseup', onMouseUp); };
  }, []);

  /* ── Rubber-band selection ──────────────────────────────────────────── */
  const handleContentMouseDown = useCallback((e: React.MouseEvent) => {
    if (e.button !== 0) return;
    if ((e.target as Element).closest('[data-file-id]')) return;
    rbStartRef.current = { x: e.clientX, y: e.clientY };
    rbMovedRef.current = false;
    rbDidSelectRef.current = false;
    document.body.style.userSelect = 'none';
  }, []);

  useEffect(() => {
    const onMouseMove = (e: MouseEvent) => {
      if (!rbStartRef.current) return;
      const dx = e.clientX - rbStartRef.current.x;
      const dy = e.clientY - rbStartRef.current.y;
      if (!rbMovedRef.current && Math.abs(dx) < 5 && Math.abs(dy) < 5) return;
      rbMovedRef.current = true;

      const x1 = rbStartRef.current.x;
      const y1 = rbStartRef.current.y;
      const x2 = e.clientX;
      const y2 = e.clientY;
      setRubberBand({ x1, y1, x2, y2 });

      const left = Math.min(x1, x2);
      const top = Math.min(y1, y2);
      const right = Math.max(x1, x2);
      const bottom = Math.max(y1, y2);

      const elements = document.querySelectorAll('[data-file-id]');
      const selectedIds = new Set<number>();
      elements.forEach(el => {
        const rect = el.getBoundingClientRect();
        if (rect.left < right && rect.right > left && rect.top < bottom && rect.bottom > top) {
          const id = Number((el as HTMLElement).dataset.fileId);
          if (!isNaN(id)) selectedIds.add(id);
        }
      });

      const newSelection = visibleFilesRef.current.filter(f => selectedIds.has(f.id));
      if (newSelection.length > 0) {
        rbDidSelectRef.current = true;
        setSelectedFiles(newSelection);
      } else if (rbMovedRef.current) {
        setSelectedFiles([]);
      }
    };

    const onMouseUp = () => {
      if (!rbStartRef.current) return;
      rbStartRef.current = null;
      setRubberBand(null);
      document.body.style.userSelect = '';
    };

    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
    return () => {
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
    };
  }, []);

  /* ── File list with sort ────────────────────────────────────────────── */
  const visibleFiles = searchQuery
    ? activeFiles.filter(f => f.name.toLowerCase().includes(searchQuery.toLowerCase()))
    : [...activeFiles];

  if (sortMode !== 'none') {
    visibleFiles.sort((a, b) => {
      if (a.isFolder !== b.isFolder) return a.isFolder ? -1 : 1;
      switch (sortMode) {
        case 'name': return a.name.localeCompare(b.name);
        case 'size': return (b.size || 0) - (a.size || 0);
        case 'date': return (b.dateModified || '').localeCompare(a.dateModified || '');
        case 'kind': {
          const ea = a.name.split('.').pop()?.toLowerCase() || '';
          const eb = b.name.split('.').pop()?.toLowerCase() || '';
          return ea === eb ? a.name.localeCompare(b.name) : ea.localeCompare(eb);
        }
        default: return 0;
      }
    });
  }

  visibleFilesRef.current = visibleFiles;

  const handleQuit = useCallback(() => {
    setQuitting(true);
    fetch('/quit', { method: 'POST' }).catch(() => {});
  }, []);

  const showError = activeError && !errorDismissed;
  const showPreviewPanel =
    selectedFiles.length > 1 ||
    (primarySelected !== null && !primarySelected.isFolder);

  if (quitting) return <QuitScreen />;

  return (
    <div className={styles.layout}>
      <div className={styles.sidebarWrapper}>
        <Sidebar
          isConnected={activeIsConnected}
          deviceName={mtpState.deviceName}
          isLoading={mtpState.isLoading}
          availableDevices={mtpState.availableDevices}
          onConnectDevice={mtpState.connectToDevice}
          onRequestNewDevice={mtpState.requestNewDevice}
          onDisconnect={mtpState.disconnect}
          currentPath={mtpState.currentPath}
          onSectionChange={(section: string | null) => {
            setActiveSection(section);
            if (section === 'home') activeNavigateToPathIndex(0);
          }}
          onNavigateToFavorite={isNetworkMode ? networkState.navigateToFavoriteFolder : mtpState.navigateToFavoriteFolder}
          selfHosted={selfHosted}
          onQuit={handleQuit}
        />
      </div>

      <div className={styles.mainArea}>
        <Toolbar
          isConnected={activeIsConnected}
          currentPath={activeCurrentPath}
          onNavigateOut={activeNavigateOut}
          onNavigateForward={activeNavigateFwd}
          canGoForward={activeCanGoFwd}
          isLoading={activeIsLoading}
          viewMode={viewMode}
          onViewModeChange={setViewMode}
          sortMode={sortMode}
          onSortModeChange={setSortMode}
          groupMode={groupMode}
          onGroupModeChange={setGroupMode}
          searchQuery={searchQuery}
          onSearchChange={setSearchQuery}
        />

        {showError && (
          <div className={styles.errorBanner}>
            <span>⚠️</span>
            <span>{activeError}</span>
            <button onClick={() => setErrorDismissed(true)}>✕</button>
          </div>
        )}

        <div className={styles.contentRow}>
          <div
            ref={contentRef}
            className={styles.content}
            onMouseDown={handleContentMouseDown}
            onClick={() => { if (rbDidSelectRef.current) { rbDidSelectRef.current = false; return; } setSelectedFiles([]); }}
            onContextMenu={handleBackgroundContextMenu}
          >
            {activeSection === 'recents' ? (
              <RecentsView
                isConnected={activeIsConnected}
                onVerify={mtpState.verifyFile}
                onActivate={(file) => setSelectedFiles([file])}
              />
            ) : (
              <FileExplorer
                files={visibleFiles}
                selectedFiles={selectedFiles}
                onSelect={handleSelectFile}
                onActivate={handleActivate}
                onContextMenu={handleContextMenu}
                isConnected={activeIsConnected}
                isLoading={activeIsLoading}
                viewMode={viewMode}
                groupMode={groupMode}
                getThumb={activeGetThumb}
                isNetworkMode={isNetworkMode}
                folderCache={activeFolderCache}
                currentPath={activeCurrentPath}
                onNavigateIn={activeNavigateIn}
                onNavigateToPathIndex={activeNavigateToPathIndex}
                onNavigateColumnFolder={activeNavigateColumnFolder}
                onFetchBlob={activePreviewFile}
                getDirectUrl={activeGetDirectUrl}
                onStreamVideo={!isNetworkMode ? mtpState.streamVideo : undefined}
                onDownload={activeDownloadFile}
                onDragStart={handleDragStart}
                onDropOnFolder={handleDropOnFolder}
                draggingFiles={draggingRef}
                renamingFileId={renamingFileId}
                onRenameConfirm={handleInlineRenameConfirm}
                onRenameCancel={handleInlineRenameCancel}
              />
            )}
          </div>

          {showPreviewPanel && (
            <>
              <div className={styles.resizeHandle} onMouseDown={onResizeMouseDown} />
              <div style={{ width: panelWidth, minWidth: panelWidth, flexShrink: 0 }}>
                <PreviewPanel
                  file={primarySelected}
                  selectedFiles={selectedFiles}
                  onDownload={activeDownloadFile}
                  isDownloading={activeIsLoading}
                  onFetchBlob={activePreviewFile}
                  getDirectUrl={activeGetDirectUrl}
                  onStreamVideo={!isNetworkMode ? mtpState.streamVideo : undefined}
                  metadataOnly={viewMode === 'gallery'}
                />
              </div>
            </>
          )}
        </div>

        <StatusBar
          isConnected={activeIsConnected}
          fileCount={activeFiles.length}
          isLoading={activeIsLoading}
          selectedFiles={selectedFiles}
          downloadProgress={zipProgress ?? (isNetworkMode ? networkState.downloadProgress : mtpState.downloadProgress)}
          downloadSpeed={zipProgress != null ? null : (isNetworkMode ? networkState.downloadSpeed : null)}
          downloadEta={zipProgress != null ? null : (isNetworkMode ? networkState.downloadEta : null)}
          isZip={zipProgress != null}
          onCancelDownload={zipProgress == null ? activeCancelDownload : undefined}
        />
      </div>

      {/* Context menu */}
      {contextMenu && (
        <ContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          selectedFiles={contextMenu.isBackground ? [] : selectedFiles}
          onClose={() => setContextMenu(null)}
          onDownload={handleDownloadSelected}
          onDelete={handleDeleteSelected}
          onRename={() => {
            if (selectedFiles.length === 1) setRenamingFileId(selectedFiles[0].id);
          }}
          onCut={handleCut}
          onPaste={handlePaste}
          canPaste={!!clipboard && !!primarySelected?.isFolder}
          onNewFolder={contextMenu?.isBackground && mtpState.isConnected
            ? () => setNewFolderDialogOpen(true)
            : undefined
          }
        />
      )}

      {/* New folder dialog */}
      {newFolderDialogOpen && (
        <NewFolderDialog
          onConfirm={handleNewFolderConfirm}
          onCancel={() => setNewFolderDialogOpen(false)}
        />
      )}

      {/* PIN dialog — aparece al hacer clic en un dispositivo de red */}
      {pinDialogDevice && (
        <PinDialog
          device={pinDialogDevice}
          authError={networkState.authError}
          isAuthenticating={networkState.authStatus === 'authenticating'}
          onConfirm={handlePinConfirm}
          onCancel={handlePinCancel}
          selfHosted={selfHosted}
        />
      )}

      {/* Rubber-band selection rect */}
      {rubberBand && (
        <div
          style={{
            position: 'fixed',
            left: Math.min(rubberBand.x1, rubberBand.x2),
            top: Math.min(rubberBand.y1, rubberBand.y2),
            width: Math.abs(rubberBand.x2 - rubberBand.x1),
            height: Math.abs(rubberBand.y2 - rubberBand.y1),
            border: '1px solid rgba(0, 122, 255, 0.8)',
            backgroundColor: 'rgba(0, 122, 255, 0.12)',
            pointerEvents: 'none',
            zIndex: 9999,
            borderRadius: 2,
          }}
        />
      )}
    </div>
  );
};

export default AppLayout;
