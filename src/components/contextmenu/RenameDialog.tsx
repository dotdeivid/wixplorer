import React, { useEffect, useRef, useState } from 'react';
import styles from './RenameDialog.module.css';
import type { FileItem } from '../../hooks/useMTPDevice';

interface RenameDialogProps {
  file: FileItem;
  onConfirm: (newName: string) => void;
  onCancel: () => void;
}

const RenameDialog: React.FC<RenameDialogProps> = ({ file, onConfirm, onCancel }) => {
  const [name, setName] = useState(file.name);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const input = inputRef.current;
    if (!input) return;
    input.focus();
    // Select name without extension for files
    const dotIdx = file.isFolder ? -1 : file.name.lastIndexOf('.');
    input.setSelectionRange(0, dotIdx > 0 ? dotIdx : file.name.length);
  }, [file]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') { e.preventDefault(); handleConfirm(); }
    if (e.key === 'Escape') { e.preventDefault(); onCancel(); }
  };

  const handleConfirm = () => {
    const trimmed = name.trim();
    if (trimmed && trimmed !== file.name) {
      onConfirm(trimmed);
    } else {
      onCancel();
    }
  };

  return (
    <div className={styles.overlay} onClick={onCancel}>
      <div className={styles.dialog} onClick={e => e.stopPropagation()}>
        <div className={styles.title}>Renombrar</div>
        <div className={styles.subtitle}>{file.isFolder ? 'Carpeta' : 'Archivo'}</div>
        <input
          ref={inputRef}
          className={styles.input}
          value={name}
          onChange={e => setName(e.target.value)}
          onKeyDown={handleKeyDown}
          spellCheck={false}
        />
        <div className={styles.buttons}>
          <button className={styles.btnCancel} onClick={onCancel}>Cancelar</button>
          <button
            className={styles.btnConfirm}
            onClick={handleConfirm}
            disabled={!name.trim() || name.trim() === file.name}
          >
            Renombrar
          </button>
        </div>
      </div>
    </div>
  );
};

export default RenameDialog;
