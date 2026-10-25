import React, { useState, useEffect, useRef } from 'react';
import styles from './GroupDropdown.module.css';
import type { GroupMode } from '../layout/AppLayout';

interface GroupDropdownProps {
  groupMode: GroupMode;
  onGroupModeChange: (s: GroupMode) => void;
  /** The trigger button element (the groupBtn from toolbar) */
  triggerContent: React.ReactNode;
  triggerClassName: string;
}

const GROUP_OPTIONS: { value: GroupMode; label: string }[] = [
  { value: 'none', label: 'Ninguno' },
  { value: 'kind', label: 'Tipo' },
  { value: 'date', label: 'Fecha' },
];

const IcoCheck = () => (
  <svg width="12" height="12" viewBox="0 0 12 12" fill="currentColor">
    <polyline points="1.5,6 4.5,9.5 10.5,2.5" stroke="currentColor" strokeWidth="1.8"
      strokeLinecap="round" strokeLinejoin="round" fill="none"/>
  </svg>
);

const GroupDropdown: React.FC<GroupDropdownProps> = ({
  groupMode,
  onGroupModeChange,
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

  const select = (value: GroupMode) => {
    onGroupModeChange(value);
    setOpen(false);
  };

  return (
    <div className={styles.dropdownWrapper} ref={wrapperRef}>
      <button
        className={triggerClassName}
        onClick={() => setOpen(o => !o)}
        title="Agrupar por"
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
              {groupMode === 'none' ? <IcoCheck /> : null}
            </span>
            Ninguno
          </div>

          <div className={styles.divider} />

          {GROUP_OPTIONS.filter(o => o.value !== 'none').map(opt => (
            <div
              key={opt.value}
              className={styles.option}
              onClick={() => select(opt.value)}
            >
              <span className={styles.checkIcon}>
                {groupMode === opt.value ? <IcoCheck /> : null}
              </span>
              {opt.label}
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default GroupDropdown;
