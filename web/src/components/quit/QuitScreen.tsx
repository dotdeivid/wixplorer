import React from 'react';
import styles from './QuitScreen.module.css';

const QuitScreen: React.FC = () => (
  <div className={styles.overlay}>
    <div className={styles.card}>
      <img src="/favicon.svg" alt="WiXplorer" className={styles.logo} />
      <h1 className={styles.title}>WiXplorer se cerró</h1>
      <p className={styles.hint}>Podés cerrar esta pestaña</p>
    </div>
  </div>
);

export default QuitScreen;
