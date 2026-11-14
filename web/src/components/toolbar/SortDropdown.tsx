import React, { useState, useEffect, useRef } from 'react';
import styles from './Dropdown.module.css';
import type { SortDir, SortMode } from '../layout/AppLayout';

interface SortDropdownProps {
  sortMode: SortMode;
  sortDir: SortDir;
  /** Elegir el criterio activo de nuevo invierte la dirección. */
  onSortChange: (mode: SortMode) => void;
  triggerContent: React.ReactNode;
  triggerClassName: string;
}

const SORT_OPTIONS: { value: SortMode; label: string }[] = [
  { value: 'none', label: 'Ninguno' },
  { value: 'name', label: 'Nombre' },
  { value: 'date', label: 'Fecha de modificación' },
  { value: 'size', label: 'Tamaño' },
  { value: 'kind', label: 'Tipo' },
];

const IcoCheck = () => (
  <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
    <polyline points="1.5,6 4.5,9.5 10.5,2.5" stroke="currentColor" strokeWidth="1.8"
      strokeLinecap="round" strokeLinejoin="round" fill="none"/>
  </svg>
);

const SortDropdown: React.FC<SortDropdownProps> = ({
  sortMode,
  sortDir,
  onSortChange,
  triggerContent,
  triggerClassName,
}) => {
  const [open, setOpen] = useState(false);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  const close = (returnFocus: boolean) => {
    setOpen(false);
    if (returnFocus) triggerRef.current?.focus();
  };

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  // Al abrir, foco en la opción activa
  useEffect(() => {
    if (!open) return;
    const items = menuRef.current?.querySelectorAll<HTMLElement>('[role="menuitemradio"]');
    const active = menuRef.current?.querySelector<HTMLElement>('[aria-checked="true"]');
    (active ?? items?.[0])?.focus();
  }, [open]);

  const select = (value: SortMode) => {
    onSortChange(value);
    close(true);
  };

  const handleMenuKeyDown = (e: React.KeyboardEvent) => {
    const items = Array.from(menuRef.current?.querySelectorAll<HTMLElement>('[role="menuitemradio"]') ?? []);
    const idx = items.indexOf(document.activeElement as HTMLElement);
    let next = -1;
    if (e.key === 'ArrowDown') next = (idx + 1) % items.length;
    else if (e.key === 'ArrowUp') next = (idx - 1 + items.length) % items.length;
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = items.length - 1;
    else if (e.key === 'Escape' || e.key === 'Tab') { e.preventDefault(); e.stopPropagation(); close(e.key === 'Escape'); return; }
    if (next >= 0) { e.preventDefault(); items[next].focus(); }
  };

  const dirLabel = (value: SortMode) => {
    if (value !== sortMode || value === 'none') return null;
    return <span className={styles.dir} aria-hidden="true">{sortDir === 'asc' ? '↑' : '↓'}</span>;
  };

  return (
    <div className={styles.dropdownWrapper} ref={wrapperRef}>
      <button
        ref={triggerRef}
        type="button"
        className={triggerClassName}
        onClick={() => setOpen(o => !o)}
        onKeyDown={e => { if (e.key === 'ArrowDown' && !open) { e.preventDefault(); setOpen(true); } }}
        title="Ordenar por"
        aria-label="Ordenar por"
        aria-haspopup="menu"
        aria-expanded={open}
      >
        {triggerContent}
      </button>

      {open && (
        <div className={styles.popup} role="menu" aria-label="Ordenar por" ref={menuRef} onKeyDown={handleMenuKeyDown}>
          {SORT_OPTIONS.map((opt, i) => (
            <React.Fragment key={opt.value}>
              {i === 1 && <div className={styles.divider} role="separator" />}
              <button
                type="button"
                role="menuitemradio"
                aria-checked={sortMode === opt.value}
                tabIndex={-1}
                className={styles.option}
                onClick={() => select(opt.value)}
              >
                <span className={styles.checkIcon}>
                  {sortMode === opt.value ? <IcoCheck /> : null}
                </span>
                <span className={styles.optionLabel}>{opt.label}</span>
                {dirLabel(opt.value)}
                {sortMode === opt.value && opt.value !== 'none' && (
                  <span className="sr-only">{sortDir === 'asc' ? ', ascendente' : ', descendente'}</span>
                )}
              </button>
            </React.Fragment>
          ))}
        </div>
      )}
    </div>
  );
};

export default SortDropdown;
