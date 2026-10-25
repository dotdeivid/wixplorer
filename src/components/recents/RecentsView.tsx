import React, { useEffect, useState, useCallback } from 'react';
import { toast } from 'sonner';
import { X } from 'lucide-react';
import styles from './RecentsView.module.css';
import { RecentsStorage, type RecentEntry } from '../../services/recents/RecentsStorage';
import type { FileItem } from '../../hooks/useMTPDevice';
import { getFileEmoji } from '../explorer/fileEmoji';

/* ─── Helpers ────────────────────────────────────────────────────────────── */
function formatSize(bytes: number): string {
  if (!bytes) return '--';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

function formatDate(raw: string): string {
  if (!raw) return '';
  const m = raw.match(/(\d{4})(\d{2})(\d{2})/);
  if (m) return `${m[3]}/${m[2]}/${m[1]}`;
  try {
    const d = new Date(raw);
    if (!isNaN(d.getTime())) {
      return `${String(d.getDate()).padStart(2,'0')}/${String(d.getMonth()+1).padStart(2,'0')}/${d.getFullYear()}`;
    }
  } catch { /* ignore */ }
  return raw;
}

function formatAccessedAt(iso: string): string {
  try {
    const d = new Date(iso);
    const now = new Date();
    const diffMs = now.getTime() - d.getTime();
    const diffMin = Math.floor(diffMs / 60000);
    if (diffMin < 1) return 'Ahora mismo';
    if (diffMin < 60) return `Hace ${diffMin} min`;
    const diffH = Math.floor(diffMin / 60);
    if (diffH < 24) return `Hace ${diffH} h`;
    const diffD = Math.floor(diffH / 24);
    if (diffD === 1) return 'Ayer';
    if (diffD < 7) return `Hace ${diffD} días`;
    return `${String(d.getDate()).padStart(2,'0')}/${String(d.getMonth()+1).padStart(2,'0')}/${d.getFullYear()}`;
  } catch { return ''; }
}

/* ─── Props ──────────────────────────────────────────────────────────────── */
interface RecentsViewProps {
  isConnected: boolean;
  /**
   * Verify a file handle still exists on the device.
   * Returns FileItem if valid, null if not found.
   */
  onVerify: (id: number) => Promise<FileItem | null>;
  /** Called after verification succeeds (e.g. download or preview) */
  onActivate: (file: FileItem) => void;
}

/* ─── Component ──────────────────────────────────────────────────────────── */
const RecentsView: React.FC<RecentsViewProps> = ({ isConnected, onVerify, onActivate }) => {
  const [entries, setEntries] = useState<RecentEntry[]>([]);
  const [verifying, setVerifying] = useState<number | null>(null);

  // Load on mount and whenever storage changes
  const loadEntries = useCallback(() => {
    setEntries(RecentsStorage.getAll());
  }, []);

  useEffect(() => { loadEntries(); }, [loadEntries]);

  const handleRemove = useCallback((e: React.MouseEvent, id: number) => {
    e.stopPropagation();
    RecentsStorage.remove(id);
    setEntries(prev => prev.filter(en => en.id !== id));
  }, []);

  const handleClick = useCallback(async (entry: RecentEntry) => {
    if (!isConnected) {
      toast.warning('Conecta un dispositivo para acceder al archivo.');
      return;
    }
    if (verifying !== null) return;

    setVerifying(entry.id);
    try {
      const file = await onVerify(entry.id);
      if (!file) {
        // File no longer exists
        RecentsStorage.remove(entry.id);
        setEntries(prev => prev.filter(en => en.id !== entry.id));
        toast.error(`"${entry.name}" ya no existe en el dispositivo.`, {
          description: 'Fue eliminado o movido desde el celular.',
        });
        return;
      }
      // File exists — activate it
      RecentsStorage.touch(file); // update accessedAt
      onActivate(file);
    } catch {
      toast.error('No se pudo verificar el archivo. Verifica la conexión.');
    } finally {
      setVerifying(null);
    }
  }, [isConnected, onVerify, onActivate, verifying]);

  if (entries.length === 0) {
    return (
      <div className={styles.container}>
        <div className={styles.empty}>
          <div className={styles.emptyIcon}>🕐</div>
          <div className={styles.emptyText}>
            Los archivos a los que accedas aparecerán aquí
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className={styles.container}>
      {!isConnected && (
        <div className={styles.disconnectedBanner}>
          ⚠️ Conecta tu dispositivo para acceder a los archivos recientes
        </div>
      )}

      <div className={styles.header}>Recientes</div>

      {entries.map(entry => {
        const isVerifying = verifying === entry.id;
        const emoji = getFileEmoji(entry.name);
        return (
          <div
            key={entry.id}
            className={styles.row}
            onClick={() => handleClick(entry)}
            style={{ opacity: isVerifying ? 0.55 : 1 }}
          >
            <span className={styles.rowIcon}>{emoji}</span>
            <div className={styles.rowBody}>
              <span className={styles.rowName} title={entry.name}>
                {isVerifying ? `Verificando "${entry.name}"...` : entry.name}
              </span>
              <span className={styles.rowMeta}>
                {formatSize(entry.size)}
                {entry.dateModified ? ` · ${formatDate(entry.dateModified)}` : ''}
                {' · '}
                {formatAccessedAt(entry.accessedAt)}
              </span>
            </div>
            <button
              className={styles.removeBtn}
              onClick={e => handleRemove(e, entry.id)}
              title="Quitar de Recientes"
            >
              <X size={12} strokeWidth={2} />
            </button>
          </div>
        );
      })}
    </div>
  );
};

export default RecentsView;
