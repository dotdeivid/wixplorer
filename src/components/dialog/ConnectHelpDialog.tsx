import React from 'react';
import Dialog from './Dialog';
import styles from './Dialog.module.css';
import ConnectGuide, { type ConnectGuideProps } from '../onboarding/ConnectGuide';

interface ConnectHelpDialogProps extends ConnectGuideProps {
  onClose: () => void;
}

/** "¿Cómo me conecto?": la misma guía del estado vacío, disponible siempre. */
const ConnectHelpDialog: React.FC<ConnectHelpDialogProps> = ({ onClose, ...guide }) => (
  <Dialog title="¿Cómo me conecto?" onClose={onClose} wide>
    <div className={styles.section}>
      <ConnectGuide {...guide} />
    </div>
    <div className={styles.buttons}>
      <button type="button" className={styles.btnCancel} onClick={onClose}>Cerrar</button>
    </div>
  </Dialog>
);

export default ConnectHelpDialog;
