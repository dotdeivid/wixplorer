import React, { useRef } from 'react';
import Dialog from './Dialog';
import styles from './Dialog.module.css';
import type { FileItem } from '../../hooks/useMTPDevice';
import { formatBytes, plural } from '../../utils/format';

interface ConfirmDeleteDialogProps {
  files: FileItem[];
  onConfirm: () => void;
  onCancel: () => void;
}

const MAX_LISTED = 3;

/** Confirmación de borrado: nombra lo que se va a eliminar y que no se puede deshacer. */
const ConfirmDeleteDialog: React.FC<ConfirmDeleteDialogProps> = ({ files, onConfirm, onCancel }) => {
  const cancelRef = useRef<HTMLButtonElement>(null);
  const listed = files.slice(0, MAX_LISTED);
  const rest = files.length - listed.length;
  const totalSize = files.filter(f => !f.isFolder).reduce((s, f) => s + (f.size || 0), 0);
  const hasFolders = files.some(f => f.isFolder);

  return (
    <Dialog
      role="alertdialog"
      title={files.length === 1 ? '¿Eliminar del teléfono?' : `¿Eliminar ${plural(files.length, 'elemento', 'elementos')} del teléfono?`}
      onClose={onCancel}
      initialFocus={cancelRef}
    >
      <div className={styles.itemList}>
        {listed.map(f => (
          <span key={f.id} className={styles.itemName} title={f.name}>
            {f.name}{f.isFolder ? ' (carpeta)' : ''}
          </span>
        ))}
        {rest > 0 && <span className={styles.itemMore}>y {plural(rest, 'elemento más', 'elementos más')}</span>}
      </div>
      <p className={styles.warning}>
        {totalSize > 0 && <>{formatBytes(totalSize)}{hasFolders ? ' más el contenido de las carpetas' : ''}. </>}
        Se borra del dispositivo y no se puede deshacer.
      </p>
      <div className={styles.buttons}>
        <button ref={cancelRef} type="button" className={styles.btnCancel} onClick={onCancel}>Cancelar</button>
        <button type="button" className={styles.btnDanger} onClick={onConfirm}>Eliminar</button>
      </div>
    </Dialog>
  );
};

export default ConfirmDeleteDialog;
