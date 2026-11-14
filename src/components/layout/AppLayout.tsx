import React, { useState, useCallback, useRef, useEffect, useLayoutEffect, useMemo } from 'react';
import styles from './AppLayout.module.css';
import Sidebar from '../sidebar/Sidebar';
import Toolbar from '../toolbar/Toolbar';
import FileExplorer, { type ExplorerNavigator } from '../explorer/FileExplorer';
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
import ConfirmDeleteDialog from '../dialog/ConfirmDeleteDialog';
import WifiConnectDialog from '../dialog/WifiConnectDialog';
import ConnectHelpDialog from '../dialog/ConnectHelpDialog';
import AboutDialog from '../dialog/AboutDialog';
import type { ConnectGuideProps } from '../onboarding/ConnectGuide';
import { SEARCH_INPUT_ID } from '../toolbar/Toolbar';
import { AlertTriangle, X } from 'lucide-react';
import { getFileCategory } from '../../utils/fileKind';
import { plural, quoted } from '../../utils/format';
import { toast } from 'sonner';
import { isSelfHosted } from '../../services/network/selfHosted';
import QuitScreen from '../quit/QuitScreen';
import { errorMessage, errorName } from '../../utils/errors';

export type ViewMode = 'grid' | 'list' | 'columns' | 'gallery';
export type SortMode = 'none' | 'name' | 'date' | 'size' | 'kind';
export type SortDir = 'asc' | 'desc';
export type GroupMode = 'none' | 'kind';

/** Dirección inicial de cada criterio (como Finder: lo más nuevo/grande primero). */
const DEFAULT_SORT_DIR: Record<SortMode, SortDir> = {
  none: 'asc', name: 'asc', date: 'desc', size: 'desc', kind: 'asc',
};

/* ── Preferencias de vista (por navegador) ─────────────────────────────── */
const PREFS_KEY = 'wixplorer_view_prefs';
interface ViewPrefs { viewMode: ViewMode; sortMode: SortMode; sortDir: SortDir; groupMode: GroupMode }
const DEFAULT_PREFS: ViewPrefs = { viewMode: 'grid', sortMode: 'none', sortDir: 'asc', groupMode: 'none' };

function loadPrefs(): ViewPrefs {
  try {
    const raw = JSON.parse(localStorage.getItem(PREFS_KEY) ?? '{}') as Partial<ViewPrefs>;
    return {
      viewMode: (['grid', 'list', 'columns', 'gallery'] as const).includes(raw.viewMode as ViewMode) ? raw.viewMode! : DEFAULT_PREFS.viewMode,
      sortMode: (['none', 'name', 'date', 'size', 'kind'] as const).includes(raw.sortMode as SortMode) ? raw.sortMode! : DEFAULT_PREFS.sortMode,
      sortDir: raw.sortDir === 'desc' ? 'desc' : 'asc',
      groupMode: raw.groupMode === 'kind' ? 'kind' : 'none',
    };
  } catch {
    return DEFAULT_PREFS;
  }
}

/** El navegador puede usar WebUSB (Chrome/Edge en contexto seguro). */
const HAS_WEBUSB = typeof navigator !== 'undefined' && 'usb' in navigator && window.isSecureContext;

/** Nombre del ZIP: WiXplorer_<carpeta>_<AAAA-MM-DD>.zip */
function zipFileName(folder: string): string {
  const safe = folder.replace(/[\\/:*?"<>|]+/g, '_').trim() || 'archivos';
  const date = new Date().toISOString().slice(0, 10);
  return `WiXplorer_${safe}_${date}.zip`;
}

/** Handle MTP de la raíz del almacenamiento (en currentPath) y su valor para MoveObject. */
const MTP_ROOT_HANDLE = 0xFFFFFFFF;

const MIN_PANEL_WIDTH = 180;
const MAX_PANEL_WIDTH = 500;
const DEFAULT_PANEL_WIDTH = 240;

const AppLayout: React.FC = () => {
  const mtpState = useMTPDevice();
  const [pinDialogDevice, setPinDialogDevice] = useState<NetworkDevice | null>(null);
  /* ── Re-autenticar cuando la sesión expira ──────────────────────────── */
  const handleSessionExpired = useCallback((device: NetworkDevice) => {
    toast.error('Sesión expirada — volvé a ingresar el PIN');
    setPinDialogDevice(device);
  }, []);
  const networkState = useNetworkDevice({ onSessionExpired: handleSessionExpired });
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
  const activeNavigateFwd = isNetworkMode ? networkState.navigateForward : mtpState.navigateForward;
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
  const activeCapabilities = isNetworkMode ? networkState.capabilities : mtpState.capabilities;
  const [prefs, setPrefs] = useState<ViewPrefs>(loadPrefs);
  const { viewMode, sortMode, sortDir, groupMode } = prefs;
  const updatePrefs = useCallback((patch: Partial<ViewPrefs>) => {
    setPrefs(prev => {
      const next = { ...prev, ...patch };
      try { localStorage.setItem(PREFS_KEY, JSON.stringify(next)); } catch { /* sin almacenamiento */ }
      return next;
    });
  }, []);
  const setViewMode = useCallback((v: ViewMode) => updatePrefs({ viewMode: v }), [updatePrefs]);
  const setGroupMode = useCallback((g: GroupMode) => updatePrefs({ groupMode: g }), [updatePrefs]);
  /** Elegir el criterio activo invierte la dirección; uno nuevo arranca con su dirección por defecto. */
  const handleSortChange = useCallback((mode: SortMode) => {
    setPrefs(prev => {
      const next: ViewPrefs = mode === prev.sortMode && mode !== 'none'
        ? { ...prev, sortDir: prev.sortDir === 'asc' ? 'desc' : 'asc' }
        : { ...prev, sortMode: mode, sortDir: DEFAULT_SORT_DIR[mode] };
      try { localStorage.setItem(PREFS_KEY, JSON.stringify(next)); } catch { /* sin almacenamiento */ }
      return next;
    });
  }, []);
  const [searchQuery, setSearchQuery] = useState('');
  const [errorDismissed, setErrorDismissed] = useState(false);
  const [activeSection, setActiveSection] = useState<string | null>('home');

  // Multi-select
  const [selectedFiles, setSelectedFiles] = useState<FileItem[]>([]);
  const primarySelected = selectedFiles[selectedFiles.length - 1] ?? null;
  const selectionAnchorRef = useRef<FileItem | null>(null);

  // Context menu
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; isBackground: boolean } | null>(null);

  // Dialogs
  const [newFolderDialogOpen, setNewFolderDialogOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<FileItem[] | null>(null);
  const [wifiDialogOpen, setWifiDialogOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [aboutOpen, setAboutOpen] = useState(false);

  // Navegación con teclado: orden visible, columnas y scroll del explorador
  const navigatorRef = useRef<ExplorerNavigator | null>(null);

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

  // Ajustes de estado ante cambios de props/estado externo: se hacen durante
  // el render comparando con el valor anterior (patrón recomendado por React
  // en lugar de un efecto que vuelve a renderizar).

  // Un error nuevo vuelve a mostrar el banner aunque se haya cerrado el anterior
  const [prevError, setPrevError] = useState(activeError);
  if (activeError !== prevError) {
    setPrevError(activeError);
    if (activeError) setErrorDismissed(false);
  }

  /* ── Auto-hospedado: abrir PinDialog en cuanto el dispositivo se pre-carga ── */
  const [prevDevices, setPrevDevices] = useState(networkState.devices);
  if (networkState.devices !== prevDevices) {
    setPrevDevices(networkState.devices);
    if (
      selfHosted &&
      networkState.devices.length > 0 &&
      !networkState.connectedDevice &&
      !pinDialogDevice
    ) {
      setPinDialogDevice(networkState.devices[0]);
    }
  }

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

  // Limpiar la selección al navegar (USB o WiFi). El ancla del shift-click
  // no hace falta resetearla: si ya no está en la lista, se ignora.
  const [prevPath, setPrevPath] = useState(activeCurrentPath);
  if (activeCurrentPath !== prevPath) {
    setPrevPath(activeCurrentPath);
    setSelectedFiles([]);
  }

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
    // Recientes es solo para USB: en modo WiFi los ids son efímeros y
    // después se verificarían como handles MTP de otro archivo.
    if (!file.isFolder && !isNetworkMode) RecentsStorage.touch(file);
  }, [isNetworkMode]);

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
      a.href = url; a.download = zipFileName(activeCurrentPath[activeCurrentPath.length - 1]?.name ?? '');
      document.body.appendChild(a); a.click(); document.body.removeChild(a);
      URL.revokeObjectURL(url);
      setZipProgress(100);
      setTimeout(() => setZipProgress(null), 1200);
      toast.success('ZIP descargado');
    } catch (e) {
      if (errorName(e) !== 'AbortError') {
        const msg = (e instanceof RangeError || (errorMessage(e) ?? '').toLowerCase().includes('allocation'))
          ? 'Los archivos seleccionados son demasiado grandes para comprimir en memoria. Intentá con menos archivos o descargalos de a uno.'
          : 'No se pudo crear el ZIP. Revisá la conexión con el teléfono e intentá de nuevo.';
        console.error('[WiXplorer] ZIP:', e);
        toast.error(msg);
      }
      setZipProgress(null);
    }
  }, [activePreviewFile, activeCurrentPath]);

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
  // Abre la confirmación; el borrado real lo hace confirmDelete.
  const handleDeleteSelected = useCallback(() => {
    if (selectedFiles.length === 0 || !activeCapabilities.delete) return;
    setDeleteTarget([...selectedFiles]);
  }, [selectedFiles, activeCapabilities.delete]);

  const confirmDelete = useCallback(async () => {
    const files = deleteTarget;
    setDeleteTarget(null);
    if (!files || files.length === 0) return;
    const activeDeleteFiles = isNetworkMode ? networkState.deleteFiles : mtpState.deleteFiles;
    try {
      await activeDeleteFiles(files);
      setSelectedFiles([]);
      toast.success(files.length === 1
        ? `${quoted(files[0].name)} eliminado`
        : `${plural(files.length, 'elemento eliminado', 'elementos eliminados')}`);
    } catch (e) {
      console.error('[WiXplorer] Eliminar:', e);
      toast.error(files.length === 1
        ? `No se pudo eliminar ${quoted(files[0].name)}.`
        : 'No se pudieron eliminar todos los elementos.', {
        description: 'Puede estar protegido o ya no existir en el teléfono.',
      });
    }
  }, [deleteTarget, isNetworkMode, networkState.deleteFiles, mtpState.deleteFiles]);

  /* ── Inline Rename ──────────────────────────────────────────────────── */
  const handleInlineRenameConfirm = useCallback(async (file: FileItem, newName: string) => {
    setRenamingFileId(null);
    if (!activeCapabilities.rename) return;
    try {
      await mtpState.renameFile(file, newName);
      toast.success(`Renombrado a ${quoted(newName)}`);
    } catch (e) {
      // renameObject ya traduce los códigos MTP a mensajes legibles
      toast.error(`No se pudo renombrar ${quoted(file.name)}`, { description: errorMessage(e) });
    }
  }, [mtpState, activeCapabilities.rename]);

  const handleInlineRenameCancel = useCallback(() => {
    setRenamingFileId(null);
  }, []);

  /* ── Cut / Paste ────────────────────────────────────────────────────── */
  const handleCut = useCallback(() => {
    if (selectedFiles.length === 0 || !activeCapabilities.move) return;
    setClipboard({ files: [...selectedFiles], op: 'cut' });
    toast.info(`${plural(selectedFiles.length, 'elemento listo', 'elementos listos')} para mover`, {
      description: 'Abrí la carpeta destino y pegá con el menú o el teclado.',
    });
  }, [selectedFiles, activeCapabilities.move]);

  /**
   * Destino del pegado: la carpeta seleccionada si hay una, si no la carpeta
   * actual. En la raíz del almacenamiento MTP el "padre" se expresa como 0.
   */
  const currentNode = activeCurrentPath[activeCurrentPath.length - 1] ?? null;
  const pasteTarget = useMemo<FileItem | null>(() => {
    if (primarySelected?.isFolder && !clipboard?.files.some(f => f.id === primarySelected.id)) return primarySelected;
    if (!currentNode) return null;
    return { id: currentNode.id === MTP_ROOT_HANDLE ? 0 : currentNode.id, name: currentNode.name, isFolder: true, size: 0, dateModified: '' };
  }, [primarySelected, clipboard, currentNode]);

  const handlePaste = useCallback(async () => {
    if (!clipboard || clipboard.files.length === 0 || !activeCapabilities.move || !pasteTarget) return;
    const filesToMove = clipboard.files.filter(f => f.id !== pasteTarget.id);
    try {
      await mtpState.moveFiles(filesToMove, pasteTarget);
      setClipboard(null);
      setSelectedFiles([]);
      toast.success(`${plural(filesToMove.length, 'elemento movido', 'elementos movidos')} a ${quoted(pasteTarget.name)}`);
    } catch (e) {
      console.error('[WiXplorer] Mover:', e);
      toast.error('No se pudieron mover los archivos', { description: 'El teléfono rechazó la operación. Revisá que la carpeta destino exista.' });
    }
  }, [clipboard, pasteTarget, mtpState, activeCapabilities.move]);

  /* ── New Folder ────────────────────────────────────────────────────── */
  const handleNewFolderConfirm = useCallback(async (name: string) => {
    setNewFolderDialogOpen(false);
    if (!activeCapabilities.createFolder) return;
    try {
      await mtpState.createFolder(name);
      toast.success(`Carpeta ${quoted(name)} creada`);
    } catch (e) {
      console.error('[WiXplorer] Crear carpeta:', e);
      toast.error(`No se pudo crear la carpeta ${quoted(name)}`, { description: errorMessage(e)?.startsWith('El nombre') ? errorMessage(e) : 'El teléfono rechazó la operación.' });
    }
  }, [mtpState, activeCapabilities.createFolder]);

  /* ── Drag ───────────────────────────────────────────────────────────── */
  const handleDragStart = useCallback((files: FileItem[]) => {
    draggingRef.current = files;
  }, []);

  const handleDropOnFolder = useCallback(async (targetFolder: FileItem) => {
    const filesToMove = draggingRef.current.filter(f => f.id !== targetFolder.id);
    draggingRef.current = [];
    if (filesToMove.length === 0 || !activeCapabilities.move) return;
    try {
      await mtpState.moveFiles(filesToMove, targetFolder);
      setSelectedFiles([]);
      toast.success(filesToMove.length === 1
        ? `${quoted(filesToMove[0].name)} movido a ${quoted(targetFolder.name)}`
        : `${plural(filesToMove.length, 'elemento movido', 'elementos movidos')} a ${quoted(targetFolder.name)}`);
    } catch (e) {
      console.error('[WiXplorer] Mover:', e);
      toast.error('No se pudieron mover los archivos', { description: 'El teléfono rechazó la operación.' });
    }
  }, [mtpState, activeCapabilities.move]);

  /* ── Conexión ──────────────────────────────────────────────────────── */
  const handleConnectUsb = useCallback(() => { void mtpState.connect(); }, [mtpState]);
  const handleConnectWifi = useCallback(() => {
    // En modo auto-hospedado el teléfono ya es conocido: solo falta el PIN
    if (selfHosted && networkState.devices[0]) setPinDialogDevice(networkState.devices[0]);
    else setWifiDialogOpen(true);
  }, [selfHosted, networkState.devices]);
  const handleWifiFound = useCallback((device: NetworkDevice) => {
    setWifiDialogOpen(false);
    setPinDialogDevice(device);
  }, []);
  const connectGuide: ConnectGuideProps = {
    hasWebUsb: HAS_WEBUSB,
    selfHosted,
    onConnectUsb: HAS_WEBUSB ? handleConnectUsb : undefined,
    onConnectWifi: handleConnectWifi,
    isBusy: mtpState.isLoading || networkState.authStatus === 'authenticating',
  };

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
    const dir = sortDir === 'asc' ? 1 : -1;
    const byName = (a: FileItem, b: FileItem) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' });
    visibleFiles.sort((a, b) => {
      if (a.isFolder !== b.isFolder) return a.isFolder ? -1 : 1;
      let cmp = 0;
      switch (sortMode) {
        case 'name': cmp = byName(a, b); break;
        case 'size': cmp = (a.size || 0) - (b.size || 0); break;
        case 'date': cmp = (a.dateModified || '').localeCompare(b.dateModified || ''); break;
        // Misma categoría que "Agrupar por tipo"
        case 'kind': cmp = getFileCategory(a).localeCompare(getFileCategory(b)) || byName(a, b); break;
      }
      return cmp * dir;
    });
  }

  // Los handlers leen la lista visible vía ref; se sincroniza después del
  // render (escribir refs durante el render rompe las reglas de React).
  useLayoutEffect(() => {
    visibleFilesRef.current = visibleFiles;
  });

  /* ── Teclado ───────────────────────────────────────────────────────────
     Atajos de explorador de archivos (⌘ en macOS, Ctrl en el resto):
       Flechas (+Shift para extender) · Home/End · Enter/⌘↓ abrir
       ⌘↑ / Backspace subir · ⌘[ / ⌘] atrás/adelante · Supr / ⌘⌫ eliminar
       F2 renombrar · ⌘A todo · ⌘X / ⌘V mover · ⌘F buscar · Esc deseleccionar
       Shift+F10 / tecla Menú: menú contextual
     No actúan mientras se escribe ni con un diálogo o menú abierto. */
  const focusFile = useCallback((id: number) => {
    navigatorRef.current?.scrollTo(id);
    // Dos frames: uno para que el virtualizador renderice la fila, otro para enfocar
    requestAnimationFrame(() => requestAnimationFrame(() => {
      document.querySelector<HTMLElement>(`[data-file-id="${id}"]`)?.focus({ preventScroll: true });
    }));
  }, []);

  const keyHandlerRef = useRef<(e: KeyboardEvent) => void>(() => {});
  useLayoutEffect(() => {
    keyHandlerRef.current = (e: KeyboardEvent) => {
      if (e.defaultPrevented || quitting) return;
      const blocked = pinDialogDevice || deleteTarget || wifiDialogOpen || helpOpen || aboutOpen
        || newFolderDialogOpen || contextMenu || renamingFileId != null;
      if (blocked) return;

      const target = e.target as HTMLElement;
      const typing = !!target.closest?.('input, textarea, select, [contenteditable="true"]');
      const mod = e.metaKey || e.ctrlKey;
      const key = e.key;

      if (mod && key.toLowerCase() === 'f') {
        e.preventDefault();
        document.getElementById(SEARCH_INPUT_ID)?.focus();
        return;
      }
      if (typing || !activeIsConnected || activeSection === 'recents') return;

      // Navegación de carpetas: funciona con el foco en cualquier lado
      if ((mod && key === 'ArrowUp') || (!mod && key === 'Backspace' && !e.shiftKey)) {
        e.preventDefault(); activeNavigateOut(); return;
      }
      if (mod && key === '[') { e.preventDefault(); activeNavigateOut(); return; }
      if (mod && key === ']') { e.preventDefault(); if (activeCanGoFwd) activeNavigateFwd(); return; }

      // El resto solo con el foco en el área de archivos (o sin foco)
      const inContent = target === document.body || !!contentRef.current?.contains(target);
      if (!inContent) return;

      const order = navigatorRef.current?.order() ?? visibleFiles;
      if (order.length === 0) return;
      const cols = navigatorRef.current?.columns() ?? 1;
      const currentIdx = primarySelected ? order.findIndex(f => f.id === primarySelected.id) : -1;

      const moveTo = (idx: number) => {
        const clamped = Math.max(0, Math.min(order.length - 1, idx));
        const file = order[clamped];
        if (e.shiftKey && selectionAnchorRef.current) {
          const anchorIdx = order.findIndex(f => f.id === selectionAnchorRef.current!.id);
          if (anchorIdx >= 0) {
            const [a, b] = anchorIdx < clamped ? [anchorIdx, clamped] : [clamped, anchorIdx];
            // El último de la selección es el "activo" (el que tiene el foco)
            const range = order.slice(a, b + 1).filter(f => f.id !== file.id);
            setSelectedFiles([...range, file]);
            focusFile(file.id);
            return;
          }
        }
        selectionAnchorRef.current = file;
        setSelectedFiles([file]);
        focusFile(file.id);
      };

      const step = (delta: number) => moveTo(currentIdx < 0 ? 0 : currentIdx + delta);

      switch (true) {
        case key === 'ArrowRight' && !mod: e.preventDefault(); step(1); return;
        case key === 'ArrowLeft' && !mod: e.preventDefault(); step(-1); return;
        case key === 'ArrowDown' && !mod: e.preventDefault(); step(cols); return;
        case key === 'ArrowUp' && !mod: e.preventDefault(); step(-cols); return;
        case key === 'Home': e.preventDefault(); moveTo(0); return;
        case key === 'End': e.preventDefault(); moveTo(order.length - 1); return;
        case (key === 'Enter' && !mod) || (mod && key === 'ArrowDown'):
          if (primarySelected && selectedFiles.length === 1) { e.preventDefault(); handleActivate(primarySelected); }
          return;
        case key === 'Delete' || (mod && key === 'Backspace'):
          e.preventDefault(); handleDeleteSelected(); return;
        case key === 'F2':
          if (selectedFiles.length === 1 && activeCapabilities.rename) { e.preventDefault(); setRenamingFileId(selectedFiles[0].id); }
          return;
        case mod && key.toLowerCase() === 'a':
          e.preventDefault(); setSelectedFiles([...order]); return;
        case mod && key.toLowerCase() === 'x':
          e.preventDefault(); handleCut(); return;
        case mod && key.toLowerCase() === 'v':
          e.preventDefault(); void handlePaste(); return;
        case key === 'Escape':
          if (selectedFiles.length > 0) { e.preventDefault(); setSelectedFiles([]); }
          return;
        case key === 'ContextMenu' || (e.shiftKey && key === 'F10'): {
          e.preventDefault();
          const el = primarySelected
            ? document.querySelector<HTMLElement>(`[data-file-id="${primarySelected.id}"]`)
            : null;
          const rect = (el ?? contentRef.current)?.getBoundingClientRect();
          if (rect) setContextMenu({ x: rect.left + 16, y: rect.top + 16, isBackground: !primarySelected });
          return;
        }
      }
    };
  });
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => keyHandlerRef.current(e);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const handleQuit = useCallback(() => {
    setQuitting(true);
    fetch('/quit', { method: 'POST' }).catch(() => {});
  }, []);

  const showError = activeError && !errorDismissed;
  const activeDownloadProgress = zipProgress ?? (isNetworkMode ? networkState.downloadProgress : mtpState.downloadProgress);
  const cutIds = new Set(clipboard?.files.map(f => f.id) ?? []);
  const showPreviewPanel =
    selectedFiles.length > 1 ||
    (primarySelected !== null && !primarySelected.isFolder);

  if (quitting) return <QuitScreen />;

  return (
    <div className={styles.layout}>
      <div className={styles.sidebarWrapper}>
        <Sidebar
          isConnected={activeIsConnected}
          usbDeviceName={mtpState.deviceName}
          usbConnected={mtpState.isConnected}
          networkDevice={networkState.connectedDevice}
          isLoading={mtpState.isLoading}
          availableDevices={mtpState.availableDevices}
          hasWebUsb={HAS_WEBUSB}
          onConnectDevice={mtpState.connectToDevice}
          onRequestNewDevice={mtpState.requestNewDevice}
          onDisconnectUsb={mtpState.disconnect}
          onDisconnectNetwork={networkState.disconnect}
          onConnectWifi={handleConnectWifi}
          onShowHelp={() => setHelpOpen(true)}
          onShowAbout={() => setAboutOpen(true)}
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
          sortDir={sortDir}
          onSortChange={handleSortChange}
          onNavigateToPathIndex={activeNavigateToPathIndex}
          groupMode={groupMode}
          onGroupModeChange={setGroupMode}
          searchQuery={searchQuery}
          onSearchChange={setSearchQuery}
        />

        {showError && (
          <div className={styles.errorBanner} role="alert">
            <AlertTriangle size={15} strokeWidth={1.8} aria-hidden="true" className={styles.errorIcon} />
            <span className={`${styles.errorText} selectable`}>{activeError}</span>
            <button type="button" className={styles.errorClose} onClick={() => setErrorDismissed(true)} aria-label="Cerrar aviso">
              <X size={14} strokeWidth={2} aria-hidden="true" />
            </button>
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
                isConnected={mtpState.isConnected}
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
                sortMode={sortMode}
                sortDir={sortDir}
                onSortChange={handleSortChange}
                searchQuery={searchQuery}
                onClearSearch={() => setSearchQuery('')}
                connectGuide={connectGuide}
                getThumb={activeGetThumb}
                isNetworkMode={isNetworkMode}
                folderCache={activeFolderCache}
                currentPath={activeCurrentPath}
                onNavigateIn={activeNavigateIn}
                onNavigateColumnFolder={activeNavigateColumnFolder}
                onFetchBlob={activePreviewFile}
                getDirectUrl={activeGetDirectUrl}
                onStreamVideo={!isNetworkMode ? mtpState.streamVideo : undefined}
                canMove={activeCapabilities.move}
                cutIds={cutIds}
                navigatorRef={navigatorRef}
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
                  key={primarySelected?.id ?? 'none'}
                  file={primarySelected}
                  selectedFiles={selectedFiles}
                  onDownload={activeDownloadFile}
                  onDownloadSelected={handleDownloadSelected}
                  isDownloading={activeDownloadProgress != null}
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
          fileCount={visibleFiles.length}
          totalCount={activeFiles.length}
          isLoading={activeIsLoading}
          selectedFiles={selectedFiles}
          downloadProgress={activeDownloadProgress}
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
          capabilities={activeCapabilities}
          unavailableReason="No disponible por WiFi"
          onClose={() => setContextMenu(null)}
          onDownload={handleDownloadSelected}
          onDelete={handleDeleteSelected}
          onRename={() => {
            if (selectedFiles.length === 1 && activeCapabilities.rename) setRenamingFileId(selectedFiles[0].id);
          }}
          onCut={handleCut}
          onPaste={handlePaste}
          canPaste={!!clipboard && !!pasteTarget}
          pasteTargetName={clipboard ? pasteTarget?.name : undefined}
          onNewFolder={contextMenu?.isBackground && activeIsConnected
            ? () => setNewFolderDialogOpen(true)
            : undefined
          }
        />
      )}

      {/* Dialogs */}
      {newFolderDialogOpen && (
        <NewFolderDialog
          onConfirm={handleNewFolderConfirm}
          onCancel={() => setNewFolderDialogOpen(false)}
        />
      )}
      {deleteTarget && (
        <ConfirmDeleteDialog files={deleteTarget} onConfirm={confirmDelete} onCancel={() => setDeleteTarget(null)} />
      )}
      {wifiDialogOpen && (
        <WifiConnectDialog onFound={handleWifiFound} onCancel={() => setWifiDialogOpen(false)} />
      )}
      {helpOpen && (
        <ConnectHelpDialog
          {...connectGuide}
          onConnectUsb={connectGuide.onConnectUsb && (() => { setHelpOpen(false); handleConnectUsb(); })}
          onConnectWifi={() => { setHelpOpen(false); handleConnectWifi(); }}
          onClose={() => setHelpOpen(false)}
        />
      )}
      {aboutOpen && <AboutDialog onClose={() => setAboutOpen(false)} />}

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
          className={styles.rubberBand}
          style={{
            left: Math.min(rubberBand.x1, rubberBand.x2),
            top: Math.min(rubberBand.y1, rubberBand.y2),
            width: Math.abs(rubberBand.x2 - rubberBand.x1),
            height: Math.abs(rubberBand.y2 - rubberBand.y1),
          }}
        />
      )}
    </div>
  );
};

export default AppLayout;
