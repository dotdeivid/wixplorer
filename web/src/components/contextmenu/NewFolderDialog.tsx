import React, { useEffect, useRef, useState } from 'react';
import Dialog from '../dialog/Dialog';
import styles from '../dialog/Dialog.module.css';
import { MTP_MAX_STRING_LENGTH } from '../../services/mtp/MtpPacket';

interface NewFolderDialogProps {
  onConfirm: (name: string) => void;
  onCancel: () => void;
}

const NewFolderDialog: React.FC<NewFolderDialogProps> = ({ onConfirm, onCancel }) => {
  const [name, setName] = useState('Carpeta sin título');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => { inputRef.current?.select(); }, []);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = name.trim();
    if (trimmed) onConfirm(trimmed);
  };

  return (
    <Dialog
      title="Nueva carpeta"
      description="Ingresá el nombre de la carpeta"
      onClose={onCancel}
      initialFocus={inputRef}
    >
      <form onSubmit={handleSubmit}>
        <input
          ref={inputRef}
          className={styles.input}
          aria-label="Nombre de la carpeta"
          value={name}
          onChange={e => setName(e.target.value)}
          spellCheck={false}
          maxLength={MTP_MAX_STRING_LENGTH}
        />
        <div className={styles.buttons}>
          <button type="button" className={styles.btnCancel} onClick={onCancel}>Cancelar</button>
          <button type="submit" className={styles.btnConfirm} disabled={!name.trim()}>Crear</button>
        </div>
      </form>
    </Dialog>
  );
};

export default NewFolderDialog;
