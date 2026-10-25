import React, { useEffect, useRef, useState } from 'react';
import styles from './RenameDialog.module.css'; // reuse same styles

interface NewFolderDialogProps {
  onConfirm: (name: string) => void;
  onCancel: () => void;
}

const NewFolderDialog: React.FC<NewFolderDialogProps> = ({ onConfirm, onCancel }) => {
  const [name, setName] = useState('Carpeta sin título');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const input = inputRef.current;
    if (!input) return;
    input.focus();
    input.select();
  }, []);

  const handleConfirm = () => {
    const trimmed = name.trim();
    if (trimmed) onConfirm(trimmed);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') { e.preventDefault(); handleConfirm(); }
    if (e.key === 'Escape') { e.preventDefault(); onCancel(); }
  };

  return (
    <div className={styles.overlay} onClick={onCancel}>
      <div className={styles.dialog} onClick={e => e.stopPropagation()}>
        <div className={styles.title}>Nueva carpeta</div>
        <div className={styles.subtitle}>Ingresa el nombre de la carpeta</div>
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
            disabled={!name.trim()}
          >
            Crear
          </button>
        </div>
      </div>
    </div>
  );
};

export default NewFolderDialog;
