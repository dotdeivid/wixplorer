import React from 'react';
import styles from './Sidebar.module.css';
import type { AvailableDevice } from '../../hooks/useMTPDevice';
import type { NetworkDevice } from '../../hooks/useNetworkDevice';
import {
  House, Clock, FileText, Download, Image, Plus, X, LogOut, Usb, Wifi, CircleHelp, Info,
} from 'lucide-react';

// true solo en build de producción en localhost → Go launcher.
// false en dev (Vite), false en modo WiFi (selfHosted).
const IS_GO_LAUNCHER = import.meta.env.PROD && window.location.hostname === 'localhost';

interface SidebarProps {
  /** Hay un dispositivo conectado (USB o WiFi). */
  isConnected: boolean;
  /** Dispositivo USB conectado (nombre), o '' si no hay. */
  usbDeviceName: string;
  usbConnected: boolean;
  /** Dispositivo conectado por WiFi, o null. */
  networkDevice: NetworkDevice | null;
  isLoading: boolean;
  availableDevices: AvailableDevice[];
  hasWebUsb: boolean;
  onConnectDevice: (d: AvailableDevice) => void;
  onRequestNewDevice: () => void;
  onDisconnectUsb: () => void;
  onDisconnectNetwork: () => void;
  onConnectWifi: () => void;
  onShowHelp: () => void;
  onShowAbout: () => void;
  onSectionChange?: (section: string | null) => void;
  /** Navigate to a named root folder on the device (e.g. "DCIM", "Download") */
  onNavigateToFavorite?: (folderName: string) => Promise<boolean>;
  /** true cuando la app está siendo servida por el teléfono (modo auto-hospedado) */
  selfHosted: boolean;
  onQuit?: () => void;
}

const ICON_SIZE   = 15;
const ICON_STROKE = 1.6;
const icon = (Icon: typeof House) => <Icon size={ICON_SIZE} strokeWidth={ICON_STROKE} aria-hidden="true" />;

// Map of sidebar favorite id → Android folder name(s) to try in order
const FAVORITES: { id: string; label: string; icon: React.ReactNode; colorClass?: string; folders: string[] }[] = [
  { id: 'docs', label: 'Documentos', icon: icon(FileText), folders: ['Documents', 'Documentos', 'Document'] },
  { id: 'dl', label: 'Descargas', icon: icon(Download), folders: ['Download', 'Downloads', 'Descargas'] },
  { id: 'dcim', label: 'Cámara (DCIM)', icon: icon(Image), colorClass: 'iconPhotos', folders: ['DCIM'] },
];

const Sidebar: React.FC<SidebarProps> = ({
  isConnected,
  usbDeviceName,
  usbConnected,
  networkDevice,
  isLoading,
  availableDevices,
  hasWebUsb,
  onConnectDevice,
  onRequestNewDevice,
  onDisconnectUsb,
  onDisconnectNetwork,
  onConnectWifi,
  onShowHelp,
  onShowAbout,
  onSectionChange,
  onNavigateToFavorite,
  selfHosted,
  onQuit,
}) => {
  const [active, setActive] = React.useState<string | null>('home');

  const select = (id: string | null) => {
    setActive(id);
    onSectionChange?.(id);
  };

  const handleFavoriteClick = async (fav: typeof FAVORITES[0]) => {
    if (!isConnected || !onNavigateToFavorite) return;
    select(fav.id);
    // Try each possible folder name in order
    for (const name of fav.folders) {
      const found = await onNavigateToFavorite(name);
      if (found) return;
    }
    // none found — error is already set in the device hook
  };

  const navRow = (id: string, label: string, rowIcon: React.ReactNode, iconClass?: string) => (
    <button
      type="button"
      className={`${styles.row} ${active === id ? styles.active : ''}`}
      aria-current={active === id ? 'page' : undefined}
      onClick={() => select(id)}
    >
      <span className={`${styles.rowIcon} ${iconClass ? styles[iconClass] : ''}`}>{rowIcon}</span>
      <span className={styles.rowLabel}>{label}</span>
    </button>
  );

  const connectedDevice = networkDevice
    ? { name: networkDevice.deviceName || networkDevice.ip, via: 'WiFi', Icon: Wifi, onDisconnect: onDisconnectNetwork }
    : usbConnected
      ? { name: usbDeviceName || 'Dispositivo Android', via: 'USB', Icon: Usb, onDisconnect: onDisconnectUsb }
      : null;

  return (
    <nav className={styles.sidebar} aria-label="Barra lateral">
      <div className={styles.topNavbar}>
        <img src={`${import.meta.env.BASE_URL}favicon.svg`} alt="" className={styles.appLogo} />
        <span className={styles.appName}>WiXplorer</span>
      </div>

      {/* ── Top items ──────────────────────────────────────────────── */}
      {navRow('home', 'Inicio', icon(House))}
      {navRow('recents', 'Recientes', icon(Clock), 'iconRecents')}

      {/* ── Favoritos ──────────────────────────────────────────────── */}
      <h2 className={styles.sectionLabel}>Favoritos</h2>

      {FAVORITES.map(fav => (
        <button
          key={fav.id}
          type="button"
          className={`${styles.row} ${active === fav.id ? styles.active : ''}`}
          aria-current={active === fav.id ? 'page' : undefined}
          onClick={() => handleFavoriteClick(fav)}
          disabled={!isConnected}
          title={isConnected ? undefined : 'Conectá un dispositivo primero'}
        >
          <span className={`${styles.rowIcon} ${fav.colorClass ? styles[fav.colorClass] : ''}`}>{fav.icon}</span>
          <span className={styles.rowLabel}>{fav.label}</span>
        </button>
      ))}

      {/* ── Dispositivo ────────────────────────────────────────────── */}
      <h2 className={styles.sectionLabel}>Dispositivo</h2>

      {connectedDevice && (
        <div className={styles.deviceRow}>
          <button
            type="button"
            className={styles.deviceMain}
            onClick={() => select('home')}
            title={`${connectedDevice.name} — conectado por ${connectedDevice.via}`}
          >
            <span className={styles.rowIcon}>
              <connectedDevice.Icon size={ICON_SIZE} strokeWidth={ICON_STROKE} aria-hidden="true" />
            </span>
            <span className={styles.deviceText}>
              <span className={styles.rowLabel}>{connectedDevice.name}</span>
              <span className={styles.deviceVia}>
                <span className={`${styles.connDot} ${styles.on}`} aria-hidden="true" />
                Conectado por {connectedDevice.via}
              </span>
            </span>
          </button>
          {/* En modo auto-hospedado la sesión WiFi es la única: no se desconecta desde acá */}
          {!(selfHosted && networkDevice) && (
            <button
              type="button"
              className={styles.ejectBtn}
              onClick={() => { connectedDevice.onDisconnect(); select('home'); }}
              aria-label={`Desconectar ${connectedDevice.name}`}
              title="Desconectar"
            >
              <X size={12} strokeWidth={2} aria-hidden="true" />
            </button>
          )}
        </div>
      )}

      {!selfHosted && availableDevices
        .filter(d => !usbConnected || d.name !== usbDeviceName)
        .map((d, i) => (
          <button
            key={i}
            type="button"
            className={styles.row}
            onClick={() => onConnectDevice(d)}
            disabled={isLoading}
            title={`Conectar ${d.name || 'Dispositivo USB'}`}
          >
            <span className={styles.rowIcon}>{icon(Usb)}</span>
            <span className={styles.rowLabel}>{d.name || 'Dispositivo USB'}</span>
            <span className={`${styles.connDot} ${styles.off}`} aria-label="desconectado" />
          </button>
        ))}

      {!selfHosted && hasWebUsb && (
        <button type="button" className={`${styles.row} ${styles.actionRow}`} onClick={onRequestNewDevice} disabled={isLoading}>
          <span className={styles.rowIcon}>{icon(Plus)}</span>
          <span className={styles.rowLabel}>Conectar por USB…</span>
        </button>
      )}

      {!networkDevice && (
        <button type="button" className={`${styles.row} ${styles.actionRow}`} onClick={onConnectWifi} disabled={isLoading}>
          <span className={styles.rowIcon}>{icon(Wifi)}</span>
          <span className={styles.rowLabel}>{selfHosted ? 'Ingresar PIN…' : 'Conectar por WiFi…'}</span>
        </button>
      )}

      {/* ── Pie ────────────────────────────────────────────────────── */}
      <div className={styles.footer}>
        <button type="button" className={styles.footerBtn} onClick={onShowHelp}>
          {icon(CircleHelp)}
          <span>¿Cómo me conecto?</span>
        </button>
        <button type="button" className={styles.footerBtn} onClick={onShowAbout}>
          {icon(Info)}
          <span>Acerca de WiXplorer</span>
        </button>
        {/* Botón Salir — solo en Go launcher (prod + localhost) */}
        {IS_GO_LAUNCHER && (
          <button type="button" className={`${styles.footerBtn} ${styles.quitBtn}`} onClick={onQuit}>
            <LogOut size={ICON_SIZE} strokeWidth={ICON_STROKE} aria-hidden="true" />
            <span>Salir</span>
          </button>
        )}
      </div>
    </nav>
  );
};

export default Sidebar;
