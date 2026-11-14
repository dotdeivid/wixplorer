import React from 'react';
import Dialog from './Dialog';
import styles from './Dialog.module.css';
import aboutStyles from './AboutDialog.module.css';

interface AboutDialogProps {
  onClose: () => void;
}

/** Versión y autoría, fuera de la barra lateral. */
const AboutDialog: React.FC<AboutDialogProps> = ({ onClose }) => (
  <Dialog title="WiXplorer" description="Explorá los archivos de tu teléfono Android desde el navegador, por USB o WiFi." onClose={onClose}>
    <dl className={aboutStyles.facts}>
      <dt>Versión</dt>
      <dd>{__APP_VERSION__}</dd>
      <dt>Autor</dt>
      <dd>Sandoval, Carlos David</dd>
      <dt>Código</dt>
      <dd>
        <a className={aboutStyles.link} href="https://github.com/dotdeivid/wixplorer" target="_blank" rel="noopener noreferrer">
          github.com/dotdeivid/wixplorer
        </a>
      </dd>
    </dl>
    <div className={styles.buttons}>
      <button type="button" className={styles.btnCancel} onClick={onClose}>Cerrar</button>
    </div>
  </Dialog>
);

export default AboutDialog;
