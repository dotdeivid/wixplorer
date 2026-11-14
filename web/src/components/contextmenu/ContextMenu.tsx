import React, { useEffect, useLayoutEffect, useRef } from 'react';
import styles from './ContextMenu.module.css';
import type { DeviceCapabilities, FileItem } from '../../hooks/useMTPDevice';
import { plural } from '../../utils/format';

interface ContextMenuProps {
  x: number;
  y: number;
  selectedFiles: FileItem[];
  capabilities: DeviceCapabilities;
  /** Motivo que se muestra junto a las acciones no disponibles en este modo. */
  unavailableReason: string;
  onClose: () => void;
  onDownload: () => void;
  onDelete: () => void;
  onRename: () => void;
  onCut: () => void;
  onPaste: () => void;
  canPaste: boolean;
  /** Destino del pegado, para el rótulo ("Pegar en «Fotos»"). */
  pasteTargetName?: string;
  onNewFolder?: () => void;
}

interface MenuEntry {
  label: string;
  shortcut?: string;
  action: () => void;
  danger?: boolean;
  disabled?: boolean;
  /** Texto secundario cuando está deshabilitada (por qué). */
  hint?: string;
  sepBefore?: boolean;
}

const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);
const MOD = isMac ? '⌘' : 'Ctrl+';

const ContextMenu: React.FC<ContextMenuProps> = ({
  x, y,
  selectedFiles,
  capabilities,
  unavailableReason,
  onClose,
  onDownload,
  onDelete,
  onRename,
  onCut,
  onPaste,
  canPaste,
  pasteTargetName,
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

  // Foco en la primera opción habilitada al abrir; devolverlo al cerrar.
  useEffect(() => {
    const previouslyFocused = document.activeElement as HTMLElement | null;
    menuRef.current?.querySelector<HTMLElement>('[role="menuitem"]:not([aria-disabled="true"])')?.focus();
    return () => { if (previouslyFocused?.isConnected) previouslyFocused.focus(); };
  }, []);

  // Close on outside click or Escape
  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (!menuRef.current?.contains(e.target as Node)) onClose();
    };
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' || e.key === 'Tab') { e.preventDefault(); e.stopPropagation(); onClose(); }
    };
    document.addEventListener('mousedown', handleClick, true);
    document.addEventListener('keydown', handleKey, true);
    return () => {
      document.removeEventListener('mousedown', handleClick, true);
      document.removeEventListener('keydown', handleKey, true);
    };
  }, [onClose]);

  /** Flechas, Home y End recorren las opciones (también las deshabilitadas, como en macOS). */
  const handleKeyDown = (e: React.KeyboardEvent) => {
    const items = Array.from(menuRef.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? []);
    if (items.length === 0) return;
    const idx = items.indexOf(document.activeElement as HTMLElement);
    let next = -1;
    if (e.key === 'ArrowDown') next = (idx + 1) % items.length;
    else if (e.key === 'ArrowUp') next = (idx - 1 + items.length) % items.length;
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = items.length - 1;
    if (next >= 0) { e.preventDefault(); e.stopPropagation(); items[next].focus(); }
  };

  const entries: MenuEntry[] = [];
  if (onNewFolder) {
    entries.push({
      label: 'Nueva carpeta', action: onNewFolder,
      disabled: !capabilities.createFolder, hint: unavailableReason,
    });
  }
  if (hasFiles) {
    entries.push({
      label: count > 1 ? `Descargar (${count})` : 'Descargar', shortcut: '↵',
      action: onDownload, sepBefore: entries.length > 0,
    });
  }
  if (count > 0) {
    entries.push({
      label: 'Cortar', shortcut: `${MOD}X`, action: onCut,
      disabled: !capabilities.move, hint: unavailableReason, sepBefore: entries.length > 0,
    });
  }
  entries.push({
    label: pasteTargetName ? `Pegar en «${pasteTargetName}»` : 'Pegar', shortcut: `${MOD}V`,
    action: onPaste,
    disabled: !capabilities.move || !canPaste,
    hint: !capabilities.move ? unavailableReason : undefined,
    sepBefore: count === 0 && entries.length > 0,
  });
  if (count === 1) {
    entries.push({
      label: 'Renombrar', shortcut: 'F2', action: onRename,
      disabled: !capabilities.rename, hint: unavailableReason, sepBefore: true,
    });
  }
  if (count > 0) {
    entries.push({
      label: 'Eliminar', shortcut: isMac ? '⌘⌫' : 'Supr', action: onDelete, danger: true,
      disabled: !capabilities.delete, hint: unavailableReason, sepBefore: count !== 1,
    });
  }

  return (
    <div
      ref={menuRef}
      className={styles.menu}
      style={{ left: x, top: y }}
      role="menu"
      aria-label={count === 1 ? `Acciones para ${selectedFiles[0].name}` : 'Acciones'}
      onKeyDown={handleKeyDown}
      onContextMenu={e => e.preventDefault()}
    >
      {count > 0 && (
        <div className={styles.header} aria-hidden="true">
          {count === 1 ? selectedFiles[0].name : `${plural(count, 'elemento seleccionado', 'elementos seleccionados')}`}
        </div>
      )}

      {entries.map(entry => (
        <React.Fragment key={entry.label}>
          {entry.sepBefore && <div className={styles.separator} role="separator" />}
          <button
            type="button"
            role="menuitem"
            tabIndex={-1}
            aria-disabled={entry.disabled || undefined}
            className={`${styles.item} ${entry.danger ? styles.danger : ''} ${entry.disabled ? styles.disabled : ''}`}
            onClick={() => { if (!entry.disabled) { entry.action(); onClose(); } }}
          >
            <span className={styles.itemLabel}>
              {entry.label}
              {entry.disabled && entry.hint && <span className={styles.itemHint}>{entry.hint}</span>}
            </span>
            {entry.shortcut && !entry.disabled && <span className={styles.shortcut} aria-hidden="true">{entry.shortcut}</span>}
          </button>
        </React.Fragment>
      ))}
    </div>
  );
};

export default ContextMenu;
