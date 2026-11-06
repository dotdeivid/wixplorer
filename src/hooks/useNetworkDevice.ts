import { useState, useCallback, useEffect, useRef } from 'react';
import { NetworkClient } from '../services/network/NetworkClient';
import { isSelfHosted, getSelfOrigin } from '../services/network/selfHosted';
import type { FileItem, PathNode } from './useMTPDevice';
import { clearLruCache } from './useThumbnail';
import { errorMessage, errorName } from '../utils/errors';

export interface NetworkDevice {
  ip: string;
  port: number;
  deviceName: string;
}

export type { FileItem, PathNode };

export type AuthStatus = 'idle' | 'authenticating' | 'authenticated' | 'error';

export interface NetworkDeviceState {
  // ── Descubrimiento (solo modo normal) ────────────────────────────────────
  devices: NetworkDevice[];

  // ── Autenticación ─────────────────────────────────────────────────────────
  connectedDevice: NetworkDevice | null;
  authStatus: AuthStatus;
  authError: string | null;
  token: string | null;
  /** Último dispositivo cuya sesión expiró — permite re-abrir PinDialog. */
  lastExpiredDevice: NetworkDevice | null;
  clearExpiredDevice: () => void;
  authenticate: (device: NetworkDevice, pin: string) => Promise<boolean>;
  disconnect: () => void;

  // ── Exploración de archivos (misma forma que useMTPDevice) ───────────────
  files: FileItem[];
  currentPath: PathNode[];
  isLoading: boolean;
  error: string | null;
  canGoForward: boolean;
  folderCache: Record<number, FileItem[]>;
  navigateIn: (folder: FileItem) => Promise<void>;
  navigateOut: () => Promise<void>;
  navigateToPathIndex: (index: number) => Promise<void>;
  navigateColumnFolder: (depth: number, folder: FileItem) => Promise<void>;
  navigateToFavoriteFolder: (folderName: string) => Promise<boolean>;
  downloadFile: (file: FileItem) => Promise<void>;
  cancelDownload: () => void;
  deleteFiles: (files: FileItem[]) => Promise<void>;
  previewFile: (file: FileItem) => Promise<Blob | null>;
  getThumb: (id: number) => Promise<Blob | null>;
  getDirectUrl: (id: number) => string | null;

  // ── Progreso de descarga ──────────────────────────────────────────────────
  downloadProgress: number | null; // 0–100 o null cuando no hay descarga activa
  downloadSpeed: number | null;    // bytes/s o null
  downloadEta: number | null;      // segundos restantes estimados o null
}

// ── Constantes ────────────────────────────────────────────────────────────────

const HEALTH_INTERVAL_MS = 5000;
const PING_TIMEOUT_MS = 2500;
/**
 * Cantidad de ciclos de health check CONSECUTIVOS sin respuesta antes de
 * eliminar un dispositivo. 3 ciclos × 5 s = 15 s de tolerancia, suficiente
 * para que el WiFi del teléfono salga del modo de ahorro de energía.
 */
const MAX_CONSECUTIVE_FAILURES = 3;

// ── ID counter global ─────────────────────────────────────────────────────────

let _idCounter = 1;
function nextId() { return _idCounter++; }

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Resultado del ping al dispositivo.
 * `wasTimeout: true` → el WiFi estaba dormido (puede recuperarse).
 * `wasTimeout: false` + `alive: false` → ECONNREFUSED o error rápido (servidor detenido).
 */
type PingResult = { alive: true } | { alive: false; wasTimeout: boolean };

async function pingDevice(device: NetworkDevice): Promise<PingResult> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), PING_TIMEOUT_MS);
  const start = Date.now();
  try {
    const res = await fetch(`http://${device.ip}:${device.port}/api/ping`, {
      signal: ctrl.signal, redirect: 'error',
    });
    clearTimeout(t);
    const json = await res.json();
    return res.ok && json?.app === 'WiXplorer'
      ? { alive: true }
      : { alive: false, wasTimeout: false };
  } catch {
    clearTimeout(t);
    // Si el error llegó rápido (< 300 ms) es ECONNREFUSED — servidor detenido.
    // Si tardó casi todo el timeout es el WiFi del teléfono en ahorro de energía.
    const wasTimeout = (Date.now() - start) >= PING_TIMEOUT_MS - 200;
    return { alive: false, wasTimeout };
  }
}


function formatSpeed(bps: number): string {
  if (bps < 1024) return `${Math.round(bps)} B/s`;
  if (bps < 1024 * 1024) return `${(bps / 1024).toFixed(1)} KB/s`;
  return `${(bps / (1024 * 1024)).toFixed(1)} MB/s`;
}
export { formatSpeed };

// ── Hook ─────────────────────────────────────────────────────────────────────

function friendlyDownloadError(err: unknown): string {
  const name: string = errorName(err) ?? '';
  const msg: string  = (errorMessage(err) ?? '').toLowerCase();

  if (err instanceof RangeError || msg.includes('array buffer') || msg.includes('allocation failed') || msg.includes('out of memory')) {
    return 'El archivo es demasiado grande para cargarlo en memoria. Intentá reintentar — si el problema persiste, el dispositivo o navegador no tiene suficientes recursos disponibles.';
  }

  if (name === 'QuotaExceededError' || msg.includes('quota') || msg.includes('no space') || msg.includes('disk full')) {
    return 'No hay suficiente espacio en el disco para guardar el archivo.';
  }

  if (name === 'NotAllowedError') {
    return 'El navegador no tiene permiso para guardar archivos en esa ubicación. '
      + 'Intentá elegir otra carpeta o revisá los permisos del sitio.';
  }

  if (name === 'SecurityError') {
    return 'El navegador bloqueó el acceso al disco (puede ocurrir en modo privado). '
      + 'Intentá en una ventana normal.';
  }

  return errorMessage(err) || 'Error al descargar';
}

export function useNetworkDevice(): NetworkDeviceState {
  // Descubrimiento
  const [devices, setDevices] = useState<NetworkDevice[]>([]);

  // Auth
  const [connectedDevice, setConnectedDevice] = useState<NetworkDevice | null>(null);
  const [authStatus, setAuthStatus] = useState<AuthStatus>('idle');
  const [authError, setAuthError] = useState<string | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [lastExpiredDevice, setLastExpiredDevice] = useState<NetworkDevice | null>(null);

  // Exploración de archivos
  const [files, setFiles] = useState<FileItem[]>([]);
  const [currentPath, setCurrentPath] = useState<PathNode[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [forwardStack, setForwardStack] = useState<PathNode[][]>([]);
  const [folderCache, setFolderCache] = useState<Record<number, FileItem[]>>({});

  // Progreso de descarga
  const [downloadProgress, setDownloadProgress] = useState<number | null>(null);
  const [downloadSpeed, setDownloadSpeed] = useState<number | null>(null);
  const [downloadEta, setDownloadEta] = useState<number | null>(null);

  const downloadAbortRef = useRef<AbortController | null>(null);

  // Mapa id → path real del sistema de archivos
  const pathById = useRef<Map<number, string>>(new Map());
  // Mapa path → id estable (mismo archivo/carpeta siempre obtiene el mismo id)
  const idByPath = useRef<Map<string, number>>(new Map());
  // Cache de thumbnails (path → Blob) para evitar re-descargas
  const thumbCache = useRef<Map<string, Blob>>(new Map());
  // Path strings paralelos a currentPath
  const pathStrings = useRef<string[]>([]);
  // Nodo raíz para navigateToFavoriteFolder
  const rootNodeRef = useRef<PathNode | null>(null);
  // Cliente HTTP activo
  const client = useRef<NetworkClient | null>(null);

  // Ref para health check sin stale closure
  const connectedRef = useRef<NetworkDevice | null>(null);
  connectedRef.current = connectedDevice;

  // True mientras hay una descarga en curso — el health check no desconecta
  // aunque el ping falle (el servidor está ocupado sirviendo el archivo).
  const isDownloadingRef = useRef(false);

  // Conteo de fallos consecutivos por IP — se necesitan MAX_CONSECUTIVE_FAILURES
  // ciclos fallidos seguidos para eliminar un dispositivo.
  const failCountRef = useRef<Map<string, number>>(new Map());

  // ── Modo auto-hospedado: pre-cargar el propio teléfono como dispositivo ───
  useEffect(() => {
    if (!isSelfHosted()) return;
    const origin = getSelfOrigin()!;

    // Hacer ping para obtener el nombre real del dispositivo
    fetch(`http://${origin.ip}:${origin.port}/api/ping`)
      .then(r => r.json())
      .then((json: { deviceName?: string }) => {
        setDevices([{
          ip: origin.ip,
          port: origin.port,
          deviceName: json.deviceName ?? origin.ip,
        }]);
      })
      .catch(() => {
        // Si el ping falla (inesperado, ya que la página cargó desde aquí),
        // igual pre-cargar con la IP como nombre
        setDevices([{ ip: origin.ip, port: origin.port, deviceName: origin.ip }]);
      });
  }, []);

  // ── Health check — solo verifica el dispositivo conectado ────────────────
  useEffect(() => {
    const id = setInterval(async () => {
      const connected = connectedRef.current;
      if (!connected) return;

      const result = await pingDevice(connected);
      if (result.alive) {
        failCountRef.current.delete(connected.ip);
      } else {
        const gracePeriod = result.wasTimeout ? MAX_CONSECUTIVE_FAILURES : 1;
        const fails = (failCountRef.current.get(connected.ip) ?? 0) + 1;
        failCountRef.current.set(connected.ip, fails);
        if (fails >= gracePeriod && !isDownloadingRef.current) resetConnection();
      }
    }, HEALTH_INTERVAL_MS);

    return () => clearInterval(id);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Internal helpers ──────────────────────────────────────────────────────

  const resetConnection = useCallback((fromExpiry?: boolean) => {
    if (fromExpiry) {
      setLastExpiredDevice(connectedRef.current);
    }
    setConnectedDevice(null);
    setToken(null);
    setAuthStatus('idle');
    setAuthError(null);
    setFiles([]);
    setCurrentPath([]);
    setFolderCache({});
    setForwardStack([]);
    pathById.current.clear();
    idByPath.current.clear();
    thumbCache.current.clear();
    clearLruCache();
    pathStrings.current = [];
    rootNodeRef.current = null;
    client.current = null;
  }, []);

  const clearExpiredDevice = useCallback(() => {
    setLastExpiredDevice(null);
  }, []);

  /**
   * Convierte los datos de la API en FileItem[] usando IDs estables por path.
   */
  const toFileItems = (data: Awaited<ReturnType<NetworkClient['listFiles']>>): FileItem[] => {
    return data.map(d => {
      let id = idByPath.current.get(d.path);
      if (id === undefined) {
        id = nextId();
        idByPath.current.set(d.path, id);
      }
      pathById.current.set(id, d.path);
      return {
        id,
        name: d.name,
        isFolder: d.isFolder,
        size: d.size,
        dateModified: new Date(d.dateModified).toISOString(),
      };
    });
  };

  /**
   * Lista una carpeta. Si [onProgress] se provee, invoca a la función con la
   * lista acumulada parcial a medida que llegan batches NDJSON del servidor,
   * permitiendo renderizado progresivo mientras el listado está en curso.
   */
  const listPath = useCallback(async (
    path: string,
    onProgress?: (partial: FileItem[]) => void,
  ): Promise<FileItem[]> => {
    if (!client.current) return [];
    try {
      const data = await client.current.listFiles(
        path,
        onProgress ? (chunk) => onProgress(toFileItems(chunk)) : undefined,
      );
      return toFileItems(data);
    } catch (e) {
      if (errorMessage(e) === 'SESSION_EXPIRED') resetConnection(true);
      throw e;
    }
  }, [resetConnection]);

  // ── Autenticación ─────────────────────────────────────────────────────────

  const authenticate = useCallback(async (device: NetworkDevice, pin: string): Promise<boolean> => {
    setAuthStatus('authenticating');
    setAuthError(null);

    try {
      const res = await fetch(`http://${device.ip}:${device.port}/api/auth`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pin }),
      });
      const json = await res.json();

      if (res.status === 429) {
        setAuthStatus('error');
        setAuthError('Demasiados intentos. Reiniciá el servidor en el teléfono.');
        return false;
      }
      if (!res.ok || !json.token) {
        setAuthStatus('error');
        setAuthError('PIN incorrecto. Verificá el número en tu teléfono.');
        return false;
      }

      const sessionToken: string = json.token;
      setToken(sessionToken);
      setConnectedDevice(device);
      setAuthStatus('authenticated');
      setLastExpiredDevice(null);

      client.current = new NetworkClient(device.ip, device.port, sessionToken);
      setIsLoading(true);
      setError(null);
      try {
        const storages = await client.current.getStorages();
        const rootPath = storages[0]?.path ?? '/';
        pathStrings.current = [rootPath];
        const rootItems = await listPath(rootPath);
        const rootNode: PathNode = { id: 0, name: device.deviceName || device.ip };
        rootNodeRef.current = rootNode;
        setFiles(rootItems);
        setCurrentPath([rootNode]);
        setFolderCache({ 0: rootItems });
        setForwardStack([]);
      } catch {
        setError('No se pudieron cargar los archivos del dispositivo.');
      } finally {
        setIsLoading(false);
      }

      return true;
    } catch {
      setAuthStatus('error');
      setAuthError('No se pudo conectar al dispositivo. Verificá que estés en la misma red.');
      return false;
    }
  }, [listPath]);

  const disconnect = useCallback(() => {
    resetConnection();
  }, [resetConnection]);

  // ── Navegación ────────────────────────────────────────────────────────────

  const navigateIn = useCallback(async (folder: FileItem) => {
    if (!folder.isFolder) return;
    const path = pathById.current.get(folder.id);
    if (!path) return;

    const newNodeId = pathStrings.current.length;

    setForwardStack([]);
    setCurrentPath(prev => [...prev, { id: prev.length, name: folder.name }]);
    pathStrings.current = [...pathStrings.current, path];
    setIsLoading(true);
    setError(null);
    try {
      const items = await listPath(path, setFiles); // renderizado progresivo
      setFiles(items); // resultado final ordenado
      setFolderCache(prev => ({ ...prev, [newNodeId]: items }));
    } catch (e) {
      setError(errorMessage(e) ?? 'Error al cargar la carpeta');
    } finally {
      setIsLoading(false);
    }
  }, [listPath]);

  const navigateOut = useCallback(async () => {
    if (currentPath.length <= 1) return;
    setForwardStack(prev => [...prev, currentPath]);
    const newPath = currentPath.slice(0, -1);
    const newPathStrings = pathStrings.current.slice(0, -1);
    setCurrentPath(newPath);
    pathStrings.current = newPathStrings;
    const targetPath = newPathStrings[newPathStrings.length - 1];
    const targetNodeId = newPath.length - 1;
    setIsLoading(true);
    setError(null);
    try {
      const items = await listPath(targetPath, setFiles);
      setFiles(items);
      setFolderCache(prev => ({ ...prev, [targetNodeId]: items }));
    } catch (e) {
      setError(errorMessage(e) ?? 'Error al navegar');
    } finally {
      setIsLoading(false);
    }
  }, [currentPath, listPath]);

  const navigateToPathIndex = useCallback(async (index: number) => {
    if (index < 0 || index >= currentPath.length) return;
    if (index === currentPath.length - 1) return;
    setForwardStack([]);
    const newPath = currentPath.slice(0, index + 1);
    const newPathStrings = pathStrings.current.slice(0, index + 1);
    setCurrentPath(newPath);
    pathStrings.current = newPathStrings;
    const targetPath = newPathStrings[newPathStrings.length - 1];
    setIsLoading(true);
    setError(null);
    try {
      const items = await listPath(targetPath, setFiles);
      setFiles(items);
      setFolderCache(prev => ({ ...prev, [index]: items }));
    } catch (e) {
      setError(errorMessage(e) ?? 'Error al navegar');
    } finally {
      setIsLoading(false);
    }
  }, [currentPath, listPath]);

  /**
   * Column view: navega directamente a `folder` que está en la columna `depth`,
   * sin el paso intermedio de navigateToPathIndex. Evita el doble render/parpadeo.
   */
  const navigateColumnFolder = useCallback(async (depth: number, folder: FileItem) => {
    if (!folder.isFolder) return;
    const path = pathById.current.get(folder.id);
    if (!path) return;

    const newDepth = depth + 1;
    const newPathNodes = [...currentPath.slice(0, depth + 1), { id: newDepth, name: folder.name }];
    const newPathStrings = [...pathStrings.current.slice(0, depth + 1), path];

    setCurrentPath(newPathNodes);
    pathStrings.current = newPathStrings;
    setForwardStack([]);
    setIsLoading(true);
    setError(null);
    try {
      const items = await listPath(path, setFiles);
      setFiles(items);
      setFolderCache(prev => ({ ...prev, [newDepth]: items }));
    } catch (e) {
      setError(errorMessage(e) ?? 'Error al cargar la carpeta');
    } finally {
      setIsLoading(false);
    }
  }, [currentPath, listPath]);

  const navigateToFavoriteFolder = useCallback(async (folderName: string): Promise<boolean> => {
    if (!client.current || pathStrings.current.length === 0) return false;
    const rootNode = rootNodeRef.current;
    if (!rootNode) return false;

    const rootPath = pathStrings.current[0];
    setIsLoading(true);
    setError(null);
    try {
      const rootItems = await listPath(rootPath);
      const folder = rootItems.find(
        f => f.isFolder && f.name.toLowerCase() === folderName.toLowerCase()
      );
      if (!folder) return false;

      const folderPath = pathById.current.get(folder.id);
      if (!folderPath) return false;

      const folderNode: PathNode = { id: 1, name: folder.name };
      pathStrings.current = [rootPath, folderPath];
      setCurrentPath([rootNode, folderNode]);
      setForwardStack([]);

      const folderItems = await listPath(folderPath);
      setFiles(folderItems);
      setFolderCache({ 0: rootItems, 1: folderItems });
      return true;
    } catch {
      return false;
    } finally {
      setIsLoading(false);
    }
  }, [listPath]);

  // ── Descarga y preview ────────────────────────────────────────────────────

  const downloadFile = useCallback(async (file: FileItem) => {
    if (file.isFolder || !client.current) return;
    const path = pathById.current.get(file.id);
    if (!path) return;
    const controller = new AbortController();
    downloadAbortRef.current = controller;
    try {
      isDownloadingRef.current = true;
      setDownloadProgress(0);
      setDownloadSpeed(null);

      await client.current.downloadFileChunked(path, file.name, (pct, speed, eta) => {
        setDownloadProgress(pct);
        if (speed > 0) setDownloadSpeed(speed);
        setDownloadEta(eta);
      }, controller.signal);
    } catch (e) {
      if (errorName(e) === 'AbortError') { /* cancelado por el usuario — no mostrar error */ }
      else if (errorMessage(e) === 'SESSION_EXPIRED') resetConnection(true);
      else setError(friendlyDownloadError(e));
    } finally {
      downloadAbortRef.current = null;
      isDownloadingRef.current = false;
      setDownloadProgress(null);
      setDownloadSpeed(null);
      setDownloadEta(null);
    }
  }, [resetConnection]);

  const cancelDownload = useCallback(() => {
    downloadAbortRef.current?.abort();
  }, []);

  const deleteFiles = useCallback(async (files: FileItem[]) => {
    if (!client.current) return;
    const paths = files
      .map(f => pathById.current.get(f.id))
      .filter((p): p is string => p !== undefined);
    if (paths.length === 0) return;
    setError(null);
    setIsLoading(true);
    try {
      await client.current.deleteFiles(paths);
      // Refrescar la carpeta actual
      const currentFolder = pathStrings.current[pathStrings.current.length - 1];
      const nodeId = pathStrings.current.length - 1;
      const items = await listPath(currentFolder);
      setFiles(items);
      setFolderCache(prev => ({ ...prev, [nodeId]: items }));
    } catch (e) {
      if (errorMessage(e) === 'SESSION_EXPIRED') resetConnection(true);
      else setError(errorMessage(e) ?? 'Error al eliminar');
      throw e;
    } finally {
      setIsLoading(false);
    }
  }, [listPath, resetConnection]);

  const previewFile = useCallback(async (file: FileItem): Promise<Blob | null> => {
    if (file.isFolder || !client.current) return null;
    const path = pathById.current.get(file.id);
    if (!path) return null;
    try {
      return await client.current.getFileBlob(path);
    } catch {
      return null;
    }
  }, []);

  /**
   * Devuelve una URL directa al archivo para usarla en <img>/<video>/<audio>.
   * El token va embebido como query param — el servidor lo acepta en lugar del
   * header Authorization para soportar elementos que no admiten headers custom.
   */
  const getDirectUrl = useCallback((id: number): string | null => {
    if (!client.current) return null;
    const path = pathById.current.get(id);
    if (!path) return null;
    return client.current.getFileUrl(path);
  }, []);

  const getThumb = useCallback(async (id: number): Promise<Blob | null> => {
    if (!client.current) return null;
    const path = pathById.current.get(id);
    if (!path) return null;

    // Servir desde cache si ya se descargó
    const cached = thumbCache.current.get(path);
    if (cached) return cached;

    const blob = await client.current.getThumbBlob(path);
    if (blob) thumbCache.current.set(path, blob);
    return blob;
  }, []);

  return {
    devices,
    connectedDevice, authStatus, authError, token,
    lastExpiredDevice, clearExpiredDevice,
    authenticate, disconnect,
    files, currentPath, isLoading, error,
    canGoForward: forwardStack.length > 0,
    folderCache,
    navigateIn, navigateOut, navigateToPathIndex, navigateColumnFolder, navigateToFavoriteFolder,
    downloadFile, cancelDownload, deleteFiles, previewFile, getThumb, getDirectUrl,
    downloadProgress, downloadSpeed, downloadEta,
  };
}
