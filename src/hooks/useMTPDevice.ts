import { useState, useCallback, useRef, useEffect } from 'react';
import { MtpClient } from '../services/mtp/MtpClient';
import { createMtpVideoStream, type MtpVideoStreamResult } from '../services/mtp/MtpVideoStream';
import { USBManager } from '../services/usb/USBManager';
import { ThumbCache } from '../services/cache/ThumbCache';

export interface FileItem {
  id: number;
  name: string;
  isFolder: boolean;
  size: number;
  dateModified: string;
}

export interface PathNode {
  id: number;
  name: string;
}

export interface AvailableDevice {
  usbDevice: USBDevice;
  name: string;
}

const client = new MtpClient();

/**
 * Convierte errores técnicos de descarga en mensajes comprensibles para el usuario.
 * @param hasFsaa - true si se usó File System Access API (escritura directa al disco)
 */
function friendlyDownloadError(err: any): string {
  const name: string = err?.name ?? '';
  const msg: string  = (err?.message ?? '').toLowerCase();

  // Memoria insuficiente — solo ocurre en el path de fallback (sin FSAA)
  if (err instanceof RangeError || msg.includes('array buffer') || msg.includes('allocation failed') || msg.includes('out of memory')) {
    return 'El archivo es demasiado grande para cargarlo en memoria. Intentá reintentar — si el problema persiste, el dispositivo o navegador no tiene suficientes recursos disponibles.';
  }

  // Disco lleno
  if (name === 'QuotaExceededError' || msg.includes('quota') || msg.includes('no space') || msg.includes('disk full')) {
    return 'No hay suficiente espacio en el disco para guardar el archivo.';
  }

  // El navegador bloqueó el acceso al sistema de archivos
  if (name === 'NotAllowedError') {
    return 'El navegador no tiene permiso para guardar archivos en esa ubicación. '
      + 'Intentá elegir otra carpeta o revisá los permisos del sitio.';
  }

  // Modo privado u otras restricciones de seguridad
  if (name === 'SecurityError') {
    return 'El navegador bloqueó el acceso al disco (puede ocurrir en modo privado). '
      + 'Intentá en una ventana normal.';
  }

  return err?.message || 'Error al descargar';
}

export function useMTPDevice() {
  const [isConnected, setIsConnected]       = useState(false);
  const [deviceName, setDeviceName]         = useState('');
  const [files, setFiles]                   = useState<FileItem[]>([]);
  const [folderCache, setFolderCache]       = useState<Record<number, FileItem[]>>({});
  const [currentPath, setCurrentPath]       = useState<PathNode[]>([]);
  const [isLoading, setIsLoading]           = useState(false);
  const [error, setError]                   = useState<string | null>(null);
  const [availableDevices, setAvailableDevices] = useState<AvailableDevice[]>([]);
  const [downloadProgress, setDownloadProgress] = useState<number | null>(null);
  // Forward navigation history: each entry is the full path we came FROM when going back
  const [forwardStack, setForwardStack]     = useState<PathNode[][]>([]);

  const currentStorageId = useRef<number>(0);
  const isConnectedRef = useRef(false);
  const downloadAbortRef = useRef<AbortController | null>(null);

  // Sync ref with React state so event handlers can read current value without stale closure
  useEffect(() => {
    isConnectedRef.current = isConnected;
  }, [isConnected]);

  /* ── Scan for already-paired USB devices ─────────────────────────── */
  const scanDevices = useCallback(async () => {
    const devices = await USBManager.listGrantedDevices();
    setAvailableDevices(devices);
  }, []);

  useEffect(() => {
    scanDevices();

    // Listen for new USB devices being plugged in.
    // Retry after delays: switching from charging→MTP causes a USB re-enumeration
    // and the device may not be fully ready when the connect event fires.
    const connectTimers: ReturnType<typeof setTimeout>[] = [];
    const handleConnect = () => {
      scanDevices();
      connectTimers.push(setTimeout(() => scanDevices(), 1200));
      connectTimers.push(setTimeout(() => scanDevices(), 3000));
    };
    const handleDisconnect = () => {
      scanDevices();
      // After physical disconnect, device.opened becomes false so client.isConnected
      // returns false — check our React state ref instead to always reset correctly.
      if (isConnectedRef.current) {
        ThumbCache.clear();
        setIsConnected(false);
        setDeviceName('');
        setFiles([]);
        setFolderCache({});
        setCurrentPath([]);
        setForwardStack([]);
      }
    };

    navigator.usb?.addEventListener('connect', handleConnect);
    navigator.usb?.addEventListener('disconnect', handleDisconnect);

    return () => {
      connectTimers.forEach(clearTimeout);
      navigator.usb?.removeEventListener('connect', handleConnect);
      navigator.usb?.removeEventListener('disconnect', handleDisconnect);
    };
  }, [scanDevices]);

  /* ── File listing helper ─────────────────────────────────────────── */
  const refreshFiles = useCallback(async (storageId: number, parentId = 0xFFFFFFFF) => {
    setIsLoading(true);
    setError(null);
    try {
      const handles = await client.getObjectHandles(storageId, 0, parentId);

      const filePromises = handles.map(async (handle) => {
        try {
          const info = await client.getObjectInfo(handle);
          if (!info) return null;
          const isFolder = info.objectFormat === 0x3001;
          let size = info.objectCompressedSize;
          let dateModified = info.dateModified;
          // GetObjectInfo uses a 32-bit size field — can be 0 or 0xFFFFFFFF for large files.
          // Fall back to GetObjectPropValue (0x9803) for 64-bit size and missing date.
          if (!isFolder && (size === 0 || size === 0xFFFFFFFF || !dateModified)) {
            const fallback = await client.getObjectSizeAndDate(handle, size, dateModified);
            size = fallback.size;
            dateModified = fallback.dateModified;
          }
          return {
            id: handle,
            name: info.filename || 'Unknown',
            isFolder,
            size,
            dateModified,
          } as FileItem;
        } catch (e) {
          console.warn(`Failed to get info for ${handle}`, e);
          return null;
        }
      });

      const results = await Promise.all(filePromises);
      const validFiles = results.filter((f): f is FileItem => f !== null);

      validFiles.sort((a, b) => {
        if (a.isFolder === b.isFolder) return a.name.localeCompare(b.name);
        return a.isFolder ? -1 : 1;
      });

      setFiles(validFiles);
      setFolderCache(prev => ({ ...prev, [parentId]: validFiles }));
    } catch (err: any) {
      console.error(err);
      setError(err.message || 'Failed to refresh files');
    } finally {
      setIsLoading(false);
    }
  }, []);

  /* ── After connecting: get storages with retry ───────────────────── */
  const afterConnect = useCallback(async () => {
    setIsConnected(client.isConnected);
    setDeviceName(client.deviceName);

    let storages = await client.getStorageIDs();
    let retries = 5;
    while (storages.length === 0 && retries > 0) {
      console.log(`[useMTPDevice] Storages empty, retrying... (${retries} left)`);
      await new Promise(r => setTimeout(r, 1000));
      storages = await client.getStorageIDs();
      retries--;
    }

    console.log('[useMTPDevice] Final storages:', storages);

    if (storages.length > 0) {
      currentStorageId.current = storages[0];
      setCurrentPath([{ id: 0xFFFFFFFF, name: 'Inicio' }]);
      await refreshFiles(storages[0], 0xFFFFFFFF);
    } else {
      const msg = 'No se encontró almacenamiento. Asegúrate de que la pantalla esté desbloqueada y el modo sea "Transferencia de archivos".';
      setError(msg);
      throw new Error(msg);
    }
  }, [refreshFiles]);

  /* ── Connect via picker dialog ───────────────────────────────────── */
  const connect = useCallback(async () => {
    setError(null);
    setIsLoading(true);
    try {
      await client.connect();
      await afterConnect();
      scanDevices();
    } catch (err: any) {
      setError(err.message || 'Connection failed');
      try { await client.disconnect(); } catch { /* ignore */ }
      setIsConnected(false); setDeviceName(''); setFiles([]); setCurrentPath([]); setForwardStack([]);
    } finally {
      setIsLoading(false);
    }
  }, [afterConnect, scanDevices]);

  /* ── Connect directly to a known device (no dialog) ─────────────── */
  const connectToDevice = useCallback(async (device: AvailableDevice) => {
    setError(null);
    setIsLoading(true);
    try {
      await client.connectTo(device.usbDevice);
      await afterConnect();
    } catch (err: any) {
      setError(err.message || 'Connection failed');
      try { await client.disconnect(); } catch { /* ignore */ }
      setIsConnected(false); setDeviceName(''); setFiles([]); setCurrentPath([]); setForwardStack([]);
    } finally {
      setIsLoading(false);
    }
  }, [afterConnect]);

  /* ── Disconnect ──────────────────────────────────────────────────── */
  const disconnect = useCallback(async () => {
    setIsLoading(true);
    ThumbCache.clear();

    const usbDevice = client.currentUsbDevice;
    const name = client.deviceName;

    await client.disconnect();

    setIsConnected(false);
    setDeviceName('');
    setFiles([]);
    setFolderCache({});
    setForwardStack([]);
    setCurrentPath([]);
    setIsLoading(false);

    if (usbDevice) {
      setAvailableDevices([{ usbDevice, name: name || 'USB Device' }]);
    }
  }, []);

  /* ── Navigation ──────────────────────────────────────────────────── */
  const navigateIn = useCallback(async (folder: FileItem) => {
    if (!folder.isFolder) return;
    setForwardStack([]);   // new branch clears forward history
    setCurrentPath(prev => [...prev, { id: folder.id, name: folder.name }]);
    setFiles([]);          // clear immediately so column view doesn't flash stale content
    await refreshFiles(currentStorageId.current, folder.id);
  }, [refreshFiles]);

  const navigateOut = useCallback(async () => {
    if (currentPath.length <= 1) return;
    setForwardStack(prev => [...prev, currentPath]); // save for forward
    const newPath = currentPath.slice(0, -1);
    setCurrentPath(newPath);
    const target = newPath[newPath.length - 1];
    await refreshFiles(currentStorageId.current, target.id);
  }, [currentPath, refreshFiles]);

  const navigateToPathIndex = useCallback(async (index: number) => {
    if (index < 0 || index >= currentPath.length) return;
    if (index === currentPath.length - 1) return; // already there
    setForwardStack([]); // clear forward history when jumping
    const newPath = currentPath.slice(0, index + 1);
    setCurrentPath(newPath);
    const target = newPath[newPath.length - 1];
    await refreshFiles(currentStorageId.current, target.id);
  }, [currentPath, refreshFiles]);

  /**
   * Column view: navega directamente a `folder` que está en la columna `depth`,
   * sin el paso intermedio de navigateToPathIndex. Evita el doble render/parpadeo.
   */
  const navigateColumnFolder = useCallback(async (depth: number, folder: FileItem) => {
    if (!folder.isFolder) return;
    setForwardStack([]);
    const newPath = [...currentPath.slice(0, depth + 1), { id: folder.id, name: folder.name }];
    setCurrentPath(newPath);
    setFiles([]);
    await refreshFiles(currentStorageId.current, folder.id);
  }, [currentPath, refreshFiles]);

  const navigateForward = useCallback(async () => {
    if (forwardStack.length === 0) return;
    const futurePath = forwardStack[forwardStack.length - 1];
    setForwardStack(prev => prev.slice(0, -1));
    setCurrentPath(futurePath);
    const target = futurePath[futurePath.length - 1];
    await refreshFiles(currentStorageId.current, target.id);
  }, [forwardStack, refreshFiles]);

  /* ── Download ────────────────────────────────────────────────────── */
  const downloadFile = useCallback(async (file: FileItem) => {
    if (file.isFolder) return;

    // Capturar gesto del usuario ANTES de cualquier await.
    // showSaveFilePicker() pierde el contexto de gesto si se llama después de un await.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let fsWritable: any = null;
    if ('showSaveFilePicker' in window) {
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const handle = await (window as any).showSaveFilePicker({
          suggestedName: file.name,
          startIn: 'downloads',
        });
        fsWritable = await handle.createWritable();
      } catch (e: any) {
        if (e?.name === 'AbortError') return; // usuario canceló el diálogo
        // Otro error → continuar sin FSAA (fallback Blob)
      }
    }

    const controller = new AbortController();
    downloadAbortRef.current = controller;

    try {
      setIsLoading(true);
      setDownloadProgress(0);

      if (fsWritable) {
        // Modo streaming: cada bloque USB se escribe directo al disco.
        // El archivo nunca se acumula en el heap de JS → sin RangeError
        // sin importar el tamaño.
        await client.getObject(file.id, async (chunk) => {
          await fsWritable.write(chunk);
        }, controller.signal, file.size);
        await fsWritable.close();
      } else {
        // Fallback: acumular en Blob y disparar <a download>
        const blob = await client.getObject(file.id, undefined, controller.signal, file.size);
        if (!blob) throw new Error('Failed to download');
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url; a.download = file.name;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
      }
    } catch (err: any) {
      if (err.name === 'AbortError') {
        // Cancelado por el usuario — limpiar endpoint USB para la próxima descarga
        await fsWritable?.abort().catch(() => {});
        await client.clearHalts();
      } else {
        await fsWritable?.close().catch(() => {});
        console.error(err);
        setError(friendlyDownloadError(err));
      }
    } finally {
      downloadAbortRef.current = null;
      setIsLoading(false);
      setDownloadProgress(null);
    }
  }, []);

  const cancelDownload = useCallback(async () => {
    downloadAbortRef.current?.abort();
  }, []);

  /* ── Expose a "request permission" helper ─────────────────────────
     This lets the sidebar show a "+" to pair a NEW device that was
     never granted access before.
  ─────────────────────────────────────────────────────────────────── */
  const requestNewDevice = useCallback(async () => {
    try {
      await navigator.usb?.requestDevice({ filters: [] });
      await scanDevices();
    } catch (e: any) {
      if (e?.name !== 'NotFoundError') {
        setError(e.message || 'Cancelled');
      }
    }
  }, [scanDevices]);

  /** Fetch a Blob for in-app preview (no save dialog).
   *  For images and videos, tries GetThumb first (embedded JPEG, instant).
   *  Falls back to GetObject (full file) only if no thumbnail is available.
   */
  const previewFile = useCallback(async (file: FileItem): Promise<Blob | null> => {
    if (file.isFolder) return null;
    const ext = file.name.split('.').pop()?.toLowerCase() ?? '';
    const isMedia = /^(jpg|jpeg|png|gif|bmp|webp|heic|heif|mp4|mov|avi|mkv|3gp|m4v)$/.test(ext);
    try {
      if (isMedia) {
        const thumb = await client.getThumb(file.id);
        if (thumb && thumb.size > 0) return thumb;
      }
      return await client.getObject(file.id, undefined, undefined, file.size);
    } catch (e) {
      console.warn('[useMTPDevice] previewFile error:', e);
      return null;
    }
  }, []);

  /**
   * Crea un stream MSE para reproducción progresiva de video vía MTP.
   * Retorna la URL de MediaSource de forma sincrónica — el streaming USB
   * empieza en segundo plano. Para videos con moov-at-start la reproducción
   * inicia en 1-3 segundos sin esperar la transferencia completa.
   */
  const streamVideo = useCallback((
    file: FileItem,
    signal?: AbortSignal,
  ): MtpVideoStreamResult | null => {
    if (file.isFolder || !client.isConnected) return null;
    const ext = file.name.split('.').pop()?.toLowerCase() ?? '';
    if (!/^(mp4|mov|m4v|3gp|webm)$/.test(ext)) return null;
    return createMtpVideoStream(file.id, client, signal, file.size);
  }, []);

  /** Fetch a thumbnail blob via MTP GetThumb (0x100A) */
  const getThumb = useCallback(async (handle: number): Promise<Blob | null> => {
    return client.getThumb(handle);
  }, []);

  /**
   * Verify a file handle still exists on the device.
   * Returns a FileItem if found, null if the handle is invalid/deleted.
   * Used by the Recents feature.
   */
  const verifyFile = useCallback(async (id: number): Promise<FileItem | null> => {
    try {
      const info = await client.getObjectInfo(id);
      if (!info) return null;
      return {
        id,
        name: info.filename || 'Unknown',
        isFolder: info.objectFormat === 0x3001,
        size: info.objectCompressedSize,
        dateModified: info.dateModified,
      };
    } catch {
      return null;
    }
  }, []);

  /* ── Delete one or more files/folders ───────────────────────────────── */
  const deleteFiles = useCallback(async (filesToDelete: FileItem[]) => {
    setError(null);
    setIsLoading(true);
    try {
      for (const file of filesToDelete) {
        await client.deleteObject(file.id);
      }
      // Refresh current folder
      const parentId = currentPath[currentPath.length - 1]?.id ?? 0xFFFFFFFF;
      setFolderCache(prev => {
        const next = { ...prev };
        delete next[parentId];
        return next;
      });
      await refreshFiles(currentStorageId.current, parentId);
    } catch (err: any) {
      setError(err.message || 'Error al eliminar');
      throw err;
    } finally {
      setIsLoading(false);
    }
  }, [currentPath, refreshFiles]);

  /* ── Move files to a target folder ──────────────────────────────────── */
  const moveFiles = useCallback(async (filesToMove: FileItem[], targetFolder: FileItem) => {
    if (!targetFolder.isFolder) return;
    setError(null);
    setIsLoading(true);
    try {
      for (const file of filesToMove) {
        if (file.id === targetFolder.id) continue;
        await client.moveObject(file.id, currentStorageId.current, targetFolder.id);
      }
      const parentId = currentPath[currentPath.length - 1]?.id ?? 0xFFFFFFFF;
      // Invalidate both source and target caches
      setFolderCache(prev => {
        const next = { ...prev };
        delete next[parentId];
        delete next[targetFolder.id];
        return next;
      });
      await refreshFiles(currentStorageId.current, parentId);
    } catch (err: any) {
      setError(err.message || 'Error al mover archivos');
      throw err;
    } finally {
      setIsLoading(false);
    }
  }, [currentPath, refreshFiles]);

  /* ── Rename a file ───────────────────────────────────────────────────── */
  const renameFile = useCallback(async (file: FileItem, newName: string) => {
    if (!newName.trim() || newName === file.name) return;
    setError(null);
    setIsLoading(true);
    try {
      await client.renameObject(file.id, newName.trim());
      const parentId = currentPath[currentPath.length - 1]?.id ?? 0xFFFFFFFF;
      setFolderCache(prev => {
        const next = { ...prev };
        delete next[parentId];
        return next;
      });
      await refreshFiles(currentStorageId.current, parentId);
    } catch (err: any) {
      setError(err.message || 'Error al renombrar');
      throw err;
    } finally {
      setIsLoading(false);
    }
  }, [currentPath, refreshFiles]);

  /* ── Create a new folder in the current directory ───────────────────── */
  const createFolder = useCallback(async (name: string) => {
    if (!name.trim()) return;
    setError(null);
    setIsLoading(true);
    try {
      const parentId = currentPath[currentPath.length - 1]?.id ?? 0xFFFFFFFF;
      await client.createFolder(name.trim(), parentId, currentStorageId.current);
      setFolderCache(prev => {
        const next = { ...prev };
        delete next[parentId];
        return next;
      });
      await refreshFiles(currentStorageId.current, parentId);
    } catch (err: any) {
      setError(err.message || 'Error al crear carpeta');
      throw err;
    } finally {
      setIsLoading(false);
    }
  }, [currentPath, refreshFiles]);

  /* ── Navigate to a named folder from root (for Favorites) ───────────── */
  const navigateToFavoriteFolder = useCallback(async (folderName: string): Promise<boolean> => {
    if (!isConnected || !currentStorageId.current) return false;
    setError(null);
    setIsLoading(true);
    try {
      const handles = await client.getObjectHandles(currentStorageId.current, 0, 0xFFFFFFFF);
      const infos = await Promise.all(handles.map(h => client.getObjectInfo(h).catch(() => null)));
      const rootFolders: FileItem[] = [];
      for (let i = 0; i < handles.length; i++) {
        const info = infos[i];
        if (info && info.objectFormat === 0x3001) {
          rootFolders.push({ id: handles[i], name: info.filename, isFolder: true, size: 0, dateModified: info.dateModified });
        }
      }

      const target = rootFolders.find(f => f.name.toLowerCase() === folderName.toLowerCase());
      if (!target) {
        setError(`No se encontró la carpeta "${folderName}" en el dispositivo`);
        return false;
      }

      setForwardStack([]);
      setCurrentPath([{ id: 0xFFFFFFFF, name: 'Inicio' }, { id: target.id, name: target.name }]);
      setFiles([]);
      await refreshFiles(currentStorageId.current, target.id);
      return true;
    } catch (e: any) {
      setError(e.message || 'Error al navegar a la carpeta');
      return false;
    } finally {
      setIsLoading(false);
    }
  }, [isConnected, refreshFiles]);

  return {
    isConnected,
    deviceName,
    files,
    folderCache,
    currentPath,
    canGoForward: forwardStack.length > 0,
    isLoading,
    error,
    availableDevices,
    downloadProgress,
    connect,
    connectToDevice,
    requestNewDevice,
    disconnect,
    navigateIn,
    navigateOut,
    navigateToPathIndex,
    navigateColumnFolder,
    navigateForward,
    downloadFile,
    cancelDownload,
    previewFile,
    streamVideo,
    verifyFile,
    getThumb,
    scanDevices,
    deleteFiles,
    moveFiles,
    renameFile,
    createFolder,
    navigateToFavoriteFolder,
  };
}
