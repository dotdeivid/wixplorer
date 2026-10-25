import React, { useState, useEffect, useRef } from 'react';
import styles from './GroupDropdown.module.css'; // Re-use the same styles
import type { SortMode } from '../layout/AppLayout';

interface SortDropdownProps {
  sortMode: SortMode;
  onSortModeChange: (s: SortMode) => void;
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
  <svg width="12" height="12" viewBox="0 0 12 12" fill="currentColor">
    <polyline points="1.5,6 4.5,9.5 10.5,2.5" stroke="currentColor" strokeWidth="1.8"
      strokeLinecap="round" strokeLinejoin="round" fill="none"/>
  </svg>
);

const SortDropdown: React.FC<SortDropdownProps> = ({
  sortMode,
  onSortModeChange,
  triggerContent,
  triggerClassName,
}) => {
  const [open, setOpen] = useState(false);
  const wrapperRef = useRef<HTMLDivElement>(null);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  const select = (value: SortMode) => {
    onSortModeChange(value);
    setOpen(false);
  };

  return (
    <div className={styles.dropdownWrapper} ref={wrapperRef}>
      <button
        className={triggerClassName}
        onClick={() => setOpen(o => !o)}
        title="Ordenar por"
      >
        {triggerContent}
      </button>

      {open && (
        <div className={styles.popup}>
          {/* "Ninguno" with check if selected */}
          <div
            className={styles.option}
            onClick={() => select('none')}
          >
            <span className={styles.checkIcon}>
              {sortMode === 'none' ? <IcoCheck /> : null}
            </span>
            Ninguno
          </div>

          <div className={styles.divider} />

          {SORT_OPTIONS.filter(o => o.value !== 'none').map(opt => (
            <div
              key={opt.value}
              className={styles.option}
              onClick={() => select(opt.value)}
            >
              <span className={styles.checkIcon}>
                {sortMode === opt.value ? <IcoCheck /> : null}
              </span>
              {opt.label}
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default SortDropdown;
