import React from 'react';
import { Usb, Wifi } from 'lucide-react';
import styles from './ConnectGuide.module.css';

export interface ConnectGuideProps {
  /** El navegador expone WebUSB (Chrome/Edge en contexto seguro). */
  hasWebUsb: boolean;
  /** La página la sirve el propio teléfono: solo aplica el camino WiFi. */
  selfHosted: boolean;
  onConnectUsb?: () => void;
  onConnectWifi?: () => void;
  isBusy?: boolean;
}

const ICON = { size: 18, strokeWidth: 1.8 };

/** Los dos caminos para conectar el teléfono, con pasos y acción. */
const ConnectGuide: React.FC<ConnectGuideProps> = ({
  hasWebUsb, selfHosted, onConnectUsb, onConnectWifi, isBusy,
}) => {
  const wifi = (
    <section className={styles.path} aria-labelledby="connect-wifi">
      <div className={styles.pathHeader}>
        <span className={styles.pathIcon}><Wifi {...ICON} /></span>
        <h3 id="connect-wifi" className={styles.pathTitle}>Por WiFi</h3>
      </div>
      {selfHosted ? (
        <ol className={styles.steps}>
          <li>Mirá el <strong>PIN de 6 dígitos</strong> en la app WiXplorer del teléfono.</li>
          <li>Ingresalo para ver tus archivos.</li>
        </ol>
      ) : (
        <ol className={styles.steps}>
          <li>Abrí <strong>WiXplorer en el teléfono</strong> y tocá Iniciar.</li>
          <li>Conectá esta computadora a la <strong>misma red WiFi</strong>.</li>
          <li>Ingresá la dirección que muestra la app y después el PIN.</li>
        </ol>
      )}
      {onConnectWifi && (
        <button type="button" className={selfHosted ? styles.primaryBtn : styles.secondaryBtn}
          onClick={onConnectWifi} disabled={isBusy}>
          {selfHosted ? 'Ingresar PIN' : 'Conectar por WiFi…'}
        </button>
      )}
    </section>
  );

  if (selfHosted) {
    return <div className={`${styles.guide} ${styles.single}`}>{wifi}</div>;
  }

  return (
    <div className={styles.guide}>
      <section className={styles.path} aria-labelledby="connect-usb">
        <div className={styles.pathHeader}>
          <span className={styles.pathIcon}><Usb {...ICON} /></span>
          <h3 id="connect-usb" className={styles.pathTitle}>Por cable USB</h3>
        </div>
        <ol className={styles.steps}>
          <li>Conectá el teléfono con el cable y <strong>desbloqueá la pantalla</strong>.</li>
          <li>En la notificación de USB elegí <strong>Transferencia de archivos</strong>.</li>
          <li>Tocá Conectar y elegí el teléfono en la lista.</li>
        </ol>
        {hasWebUsb ? (
          onConnectUsb && (
            <button type="button" className={styles.primaryBtn} onClick={onConnectUsb} disabled={isBusy}>
              Conectar por USB
            </button>
          )
        ) : (
          <p className={styles.unsupported}>
            Este navegador no puede acceder a USB. Abrí WiXplorer en Chrome o Edge, o conectate por WiFi.
          </p>
        )}
      </section>
      <div className={styles.rule} aria-hidden="true" />
      {wifi}
    </div>
  );
};

export default ConnectGuide;
