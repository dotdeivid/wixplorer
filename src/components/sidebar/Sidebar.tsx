import React from 'react';
import styles from './Sidebar.module.css';
import type { PathNode, AvailableDevice } from '../../hooks/useMTPDevice';
import {
  House, Clock, FileText, Download, Image, Plus, X, LogOut,
} from 'lucide-react';

// true solo en build de producción en localhost → Go launcher.
// false en dev (Vite), false en modo WiFi (selfHosted).
const IS_GO_LAUNCHER = import.meta.env.PROD && window.location.hostname === 'localhost';

interface SidebarProps {
  isConnected: boolean;
  deviceName: string;
  isLoading: boolean;
  availableDevices: AvailableDevice[];
  onConnectDevice: (d: AvailableDevice) => void;
  onRequestNewDevice: () => void;
  onDisconnect: () => void;
  currentPath: PathNode[];
  onSectionChange?: (section: string | null) => void;
  /** Navigate to a named root folder on the device (e.g. "DCIM", "Download") */
  onNavigateToFavorite?: (folderName: string) => Promise<boolean>;
  /** true cuando la app está siendo servida por el teléfono (modo auto-hospedado) */
  selfHosted: boolean;
  onQuit?: () => void;
}

const ICON_SIZE   = 15;
const ICON_STROKE = 1.6;

// Map of sidebar favorite id → Android folder name(s) to try in order
const FAVORITES: { id: string; label: string; icon: React.ReactNode; color: string; folders: string[] }[] = [
  {
    id: 'docs',
    label: 'Documentos',
    icon: <FileText size={ICON_SIZE} strokeWidth={ICON_STROKE} />,
    color: 'rgba(255,255,255,0.65)',
    folders: ['Documents', 'Documentos', 'Document'],
  },
  {
    id: 'dl',
    label: 'Descargas',
    icon: <Download size={ICON_SIZE} strokeWidth={ICON_STROKE} />,
    color: 'rgba(255,255,255,0.65)',
    folders: ['Download', 'Downloads', 'Descargas'],
  },
  {
    id: 'dcim',
    label: 'DCIM',
    icon: <Image size={ICON_SIZE} strokeWidth={ICON_STROKE} />,
    color: '#ffd60a',
    folders: ['DCIM'],
  },
];

const Sidebar: React.FC<SidebarProps> = ({
  isConnected,
  deviceName,
  isLoading,
  availableDevices,
  onConnectDevice,
  onRequestNewDevice,
  onDisconnect,
  onSectionChange,
  onNavigateToFavorite,
  selfHosted,
  onQuit,
}) => {
  const [active, setActive] = React.useState<string | null>(null);

  const select = (id: string | null) => {
    setActive(id);
    onSectionChange?.(id);
  };

  const handleEject = (e: React.MouseEvent) => {
    e.stopPropagation();
    onDisconnect();
    select(null);
  };

  const handleFavoriteClick = async (fav: typeof FAVORITES[0]) => {
    if (!isConnected) { select(fav.id); return; }
    if (!onNavigateToFavorite) return;

    select(fav.id);
    // Try each possible folder name in order
    for (const name of fav.folders) {
      const found = await onNavigateToFavorite(name);
      if (found) return;
    }
    // none found — error is already set in useMTPDevice
  };

  return (
    <div className={styles.sidebar}>
      <div className={styles.topNavbar}>
        <img src="/favicon.svg" alt="WiXplorer" className={styles.appLogo} />
        <span className={styles.appName}>WiXplorer</span>
      </div>

      {/* ── Top items ──────────────────────────────────────────────── */}
      <div
        className={`${styles.row} ${active === 'home' ? styles.active : ''}`}
        onClick={() => select('home')}
      >
        <span className={styles.rowIcon} style={{ color: 'rgba(255,255,255,0.65)' }}>
          <House size={ICON_SIZE} strokeWidth={ICON_STROKE} />
        </span>
        <span className={styles.rowLabel}>Inicio</span>
      </div>

      <div
        className={`${styles.row} ${active === 'recents' ? styles.active : ''}`}
        onClick={() => select('recents')}
      >
        <span className={styles.rowIcon} style={{ color: '#ff9f0a' }}>
          <Clock size={ICON_SIZE} strokeWidth={ICON_STROKE} />
        </span>
        <span className={styles.rowLabel}>Recientes</span>
      </div>

      {/* ── Favoritos ──────────────────────────────────────────────── */}
      <div className={styles.sectionLabel}>Favoritos</div>

      {FAVORITES.map(fav => (
        <div
          key={fav.id}
          className={`${styles.row} ${active === fav.id ? styles.active : ''} ${!isConnected ? styles.dimmed : ''}`}
          onClick={() => handleFavoriteClick(fav)}
          title={isConnected ? undefined : 'Conecta un dispositivo primero'}
        >
          <span className={styles.rowIcon} style={{ color: fav.color }}>{fav.icon}</span>
          <span className={styles.rowLabel}>{fav.label}</span>
        </div>
      ))}

      {/* ── Ubicaciones (USB) — oculto en modo auto-hospedado ─────── */}
      {!selfHosted && (
        <>
          <div className={styles.sectionLabel}>Ubicaciones</div>

          {isConnected && (
            <div
              className={`${styles.deviceRow} ${active === 'device' ? styles.activeDevice : ''}`}
              onClick={() => select('device')}
              title={deviceName || 'Android Device'}
            >
              <span className={`${styles.connDot} ${styles.on}`} />
              <span className={styles.rowLabel}>{deviceName || 'Android Device'}</span>
              <button className={styles.ejectBtn} onClick={handleEject} title="Desconectar">
                <X size={11} strokeWidth={2} />
              </button>
            </div>
          )}

          {availableDevices
            .filter(d => !isConnected || d.name !== deviceName)
            .map((d, i) => (
              <div
                key={i}
                className={`${styles.deviceRow} ${isLoading ? styles.dimmed : ''}`}
                onClick={() => !isLoading && onConnectDevice(d)}
                title={d.name || 'USB Device'}
              >
                <span className={`${styles.connDot} ${styles.off}`} />
                <span className={styles.rowLabel}>{d.name || 'USB Device'}</span>
              </div>
            ))}

          <button
            className={styles.addDeviceBtn}
            onClick={onRequestNewDevice}
            disabled={isLoading}
          >
            <span className={styles.rowIcon} style={{ color: '#4a9eff' }}>
              <Plus size={ICON_SIZE} strokeWidth={ICON_STROKE} />
            </span>
            <span className={styles.addDeviceLabel}>Agregar dispositivo...</span>
          </button>
        </>
      )}

      {/* Footer — autor + versión */}
      <div className={`${styles.footer} ${IS_GO_LAUNCHER ? '' : styles.footerNoQuit}`}>
        <span className={styles.footerVersion}>v1.0.0</span>
        <span className={styles.footerAuthor}>Sandoval, Carlos David</span>
        <a
          className={styles.footerLink}
          href="https://github.com/dotdeivid"
          target="_blank"
          rel="noopener noreferrer"
        >
          github.com/dotdeivid
        </a>
      </div>

      {/* Botón Salir — solo en Go launcher (prod + localhost) */}
      {IS_GO_LAUNCHER && (
        <div className={styles.quitArea}>
          <button
            className={styles.quitBtn}
            onClick={onQuit}
            title="Cerrar WiXplorer"
          >
            <LogOut size={ICON_SIZE} strokeWidth={ICON_STROKE} />
            <span>Salir</span>
          </button>
        </div>
      )}
    </div>
  );
};

export default Sidebar;
