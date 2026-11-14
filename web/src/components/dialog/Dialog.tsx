import React, { useId, useRef } from 'react';
import styles from './Dialog.module.css';
import { useDialogFocus } from '../../hooks/useDialogFocus';

interface DialogProps {
  title: string;
  description?: React.ReactNode;
  /** Cerrar con Escape o clic afuera. Omitir para diálogos que no se pueden descartar. */
  onClose?: () => void;
  /** Elemento que recibe el foco al abrir (por defecto, el primero enfocable). */
  initialFocus?: React.RefObject<HTMLElement | null>;
  /** 'alertdialog' para confirmaciones destructivas. */
  role?: 'dialog' | 'alertdialog';
  wide?: boolean;
  children?: React.ReactNode;
}

/** Diálogo modal accesible: role, aria-modal, foco atrapado y devuelto al cerrar. */
const Dialog: React.FC<DialogProps> = ({
  title, description, onClose, initialFocus, role = 'dialog', wide, children,
}) => {
  const ref = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const descId = useId();
  useDialogFocus(ref, { initialFocus, onEscape: onClose });

  return (
    <div className={styles.overlay} onMouseDown={e => { if (e.target === e.currentTarget) onClose?.(); }}>
      <div
        ref={ref}
        className={`${styles.dialog} ${wide ? styles.wide : ''}`}
        role={role}
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={description ? descId : undefined}
        tabIndex={-1}
      >
        <h2 id={titleId} className={styles.title}>{title}</h2>
        {description && <div id={descId} className={styles.subtitle}>{description}</div>}
        {children}
      </div>
    </div>
  );
};

export default Dialog;
