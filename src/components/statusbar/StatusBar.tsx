import React from 'react';
import styles from './StatusBar.module.css';
import type { FileItem } from '../../hooks/useMTPDevice';
import { formatSpeed } from '../../hooks/useNetworkDevice';

interface StatusBarProps {
  isConnected: boolean;
  fileCount: number;
  isLoading: boolean;
  selectedFiles: FileItem[];
  downloadProgress?: number | null;
  downloadSpeed?: number | null;
  downloadEta?: number | null;
  isZip?: boolean;
  onCancelDownload?: () => void;
}

function formatEta(sec: number): string {
  if (sec < 60) return `${sec}s`;
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  if (m < 60) return s > 0 ? `${m}m ${s}s` : `${m}m`;
  const h = Math.floor(m / 60);
  const rm = m % 60;
  return rm > 0 ? `${h}h ${rm}m` : `${h}h`;
}

function formatSize(bytes: number): string {
  if (bytes === 0) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

const StatusBar: React.FC<StatusBarProps> = ({
  isConnected, fileCount, isLoading, selectedFiles,
  downloadProgress, downloadSpeed, downloadEta, isZip, onCancelDownload,
}) => {
  // Descarga o preparación ZIP en curso — tiene prioridad sobre el resto
  if (downloadProgress !== null && downloadProgress !== undefined) {
    const isDone = downloadProgress >= 100;
    const speedStr = downloadSpeed ? ` — ${formatSpeed(downloadSpeed)}` : '';
    const etaStr = downloadEta != null && downloadEta > 0 ? ` — ${formatEta(downloadEta)}` : '';
    const pctStr = isDone ? 'Completado' : `${downloadProgress}%`;
    const labelText = isDone
      ? (isZip ? 'ZIP listo' : 'Descarga completada')
      : isZip
        ? `Preparando ZIP ${pctStr}`
        : `Descargando ${pctStr}${speedStr}${etaStr}`;
    return (
      <div className={styles.statusBar}>
        <div className={styles.downloadTrack}>
          <div
            className={`${styles.downloadBar} ${!downloadSpeed && !isDone ? styles.downloadIndeterminate : ''}`}
            style={{ width: isDone ? '100%' : `${Math.max(downloadProgress, 2)}%` }}
          />
        </div>
        <span className={styles.label}>{labelText}</span>
        {!isDone && onCancelDownload && (
          <button
            className={styles.cancelBtn}
            onClick={onCancelDownload}
            aria-label="Cancelar descarga"
            title="Cancelar"
          >
            <svg width="8" height="8" viewBox="0 0 8 8" fill="currentColor">
              <path d="M1 1l6 6M7 1l-6 6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
            </svg>
          </button>
        )}
      </div>
    );
  }

  let label = '';
  if (!isConnected) {
    label = 'Sin dispositivo';
  } else if (isLoading) {
    label = 'Cargando...';
  } else if (selectedFiles.length === 1) {
    const f = selectedFiles[0];
    const size = f.isFolder ? '' : ` — ${formatSize(f.size)}`;
    label = `"${f.name}"${size}`;
  } else if (selectedFiles.length > 1) {
    const totalSize = selectedFiles.filter(f => !f.isFolder).reduce((s, f) => s + (f.size || 0), 0);
    const sizeStr = totalSize > 0 ? ` — ${formatSize(totalSize)} total` : '';
    label = `${selectedFiles.length} elementos seleccionados${sizeStr}`;
  } else {
    label = `${fileCount} ${fileCount === 1 ? 'elemento' : 'elementos'}`;
  }

  return (
    <div className={styles.statusBar}>
      <span className={styles.label}>{label}</span>
    </div>
  );
};

export default StatusBar;
