import React, { useEffect, useLayoutEffect, useRef } from 'react';
import styles from './ContextMenu.module.css';
import type { FileItem } from '../../hooks/useMTPDevice';

interface ContextMenuProps {
  x: number;
  y: number;
  selectedFiles: FileItem[];
  onClose: () => void;
  onDownload: () => void;
  onDelete: () => void;
  onRename: () => void;
  onCut: () => void;
  onPaste: () => void;
  canPaste: boolean;
  onNewFolder?: () => void;
}

const ContextMenu: React.FC<ContextMenuProps> = ({
  x, y,
  selectedFiles,
  onClose,
  onDownload,
  onDelete,
  onRename,
  onCut,
  onPaste,
  canPaste,
  onNewFolder,
}) => {
  const menuRef = useRef<HTMLDivElement>(null);
  const count = selectedFiles.length;
  const hasFiles = selectedFiles.some(f => !f.isFolder);

  // Adjust position so menu never goes off-screen. Se mide y se ajusta el
  // DOM antes del paint, sin pasar por estado (evita un render extra).
  useLayoutEffect(() => {
    const menu = menuRef.current;
    if (!menu) return;
    const { offsetWidth: w, offsetHeight: h } = menu;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    menu.style.left = `${x + w > vw ? Math.max(0, vw - w - 8) : x}px`;
    menu.style.top = `${y + h > vh ? Math.max(0, vh - h - 8) : y}px`;
  }, [x, y]);

  // Close on outside click or Escape
  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (!menuRef.current?.contains(e.target as Node)) onClose();
    };
    const handleKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('mousedown', handleClick, true);
    document.addEventListener('keydown', handleKey, true);
    return () => {
      document.removeEventListener('mousedown', handleClick, true);
      document.removeEventListener('keydown', handleKey, true);
    };
  }, [onClose]);

  const item = (label: string, action: () => void, opts?: { danger?: boolean; disabled?: boolean; sep?: boolean }) => (
    <React.Fragment key={label}>
      {opts?.sep && <div className={styles.separator} />}
      <button
        className={`${styles.item} ${opts?.danger ? styles.danger : ''} ${opts?.disabled ? styles.disabled : ''}`}
        onClick={() => { if (!opts?.disabled) { action(); onClose(); } }}
        disabled={opts?.disabled}
      >
        {label}
      </button>
    </React.Fragment>
  );

  return (
    <div
      ref={menuRef}
      className={styles.menu}
      style={{ left: x, top: y }}
      onContextMenu={e => e.preventDefault()}
    >
      {count > 0 && (
        <div className={styles.header}>
          {count === 1 ? selectedFiles[0].name : `${count} elementos seleccionados`}
        </div>
      )}

      {/* Nueva carpeta — only on background right-click */}
      {onNewFolder && item('Nueva carpeta', onNewFolder)}

      {/* Download — auto-ZIP when multiple */}
      {hasFiles && item(
        count > 1 ? `Descargar (${count})` : 'Descargar',
        onDownload,
        { sep: !!onNewFolder }
      )}

      {/* Clipboard */}
      {count > 0 && item('Cortar', onCut, { sep: !hasFiles })}
      {item('Pegar', onPaste, { sep: count === 0 && !onNewFolder, disabled: !canPaste })}

      {/* Rename — only for single item */}
      {count === 1 && item('Renombrar', onRename, { sep: true })}

      {/* Delete */}
      {count > 0 && item('Eliminar', onDelete, { sep: count !== 1, danger: true })}
    </div>
  );
};

export default ContextMenu;
