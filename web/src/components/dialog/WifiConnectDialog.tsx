import React, { useRef, useState } from 'react';
import Dialog from './Dialog';
import styles from './Dialog.module.css';
import type { NetworkDevice } from '../../hooks/useNetworkDevice';

interface WifiConnectDialogProps {
  onFound: (device: NetworkDevice) => void;
  onCancel: () => void;
}

const DEFAULT_PORT = 7070;
const PING_TIMEOUT_MS = 4000;
const STORAGE_KEY = 'wixplorer_last_wifi_address';

function loadLastAddress(): string {
  try { return localStorage.getItem(STORAGE_KEY) ?? ''; } catch { return ''; }
}

function saveLastAddress(value: string) {
  try { localStorage.setItem(STORAGE_KEY, value); } catch { /* sin almacenamiento */ }
}

/** "http://192.168.0.10:7070/" → { ip, port }, o null si no es válida. */
function parseAddress(raw: string): { ip: string; port: number } | null {
  const cleaned = raw.trim().replace(/^https?:\/\//i, '').replace(/\/.*$/, '');
  const m = cleaned.match(/^([a-z0-9.-]+)(?::(\d{1,5}))?$/i);
  if (!m) return null;
  const port = m[2] ? Number(m[2]) : DEFAULT_PORT;
  if (port < 1 || port > 65535) return null;
  return { ip: m[1], port };
}

/** Pide la dirección del teléfono y verifica que haya un servidor WiXplorer. */
const WifiConnectDialog: React.FC<WifiConnectDialogProps> = ({ onFound, onCancel }) => {
  const [address, setAddress] = useState(loadLastAddress);
  const [error, setError] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const parsed = parseAddress(address);
    if (!parsed) {
      setError('Escribí la dirección como aparece en la app, por ejemplo 192.168.0.10:7070.');
      inputRef.current?.focus();
      return;
    }
    setChecking(true);
    setError(null);
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), PING_TIMEOUT_MS);
    try {
      const res = await fetch(`http://${parsed.ip}:${parsed.port}/api/ping`, { signal: ctrl.signal });
      const json = await res.json() as { app?: string; deviceName?: string };
      if (!res.ok || json.app !== 'WiXplorer') throw new Error('not wixplorer');
      saveLastAddress(`${parsed.ip}:${parsed.port}`);
      onFound({ ip: parsed.ip, port: parsed.port, deviceName: json.deviceName || parsed.ip });
    } catch {
      setError('No se encontró WiXplorer en esa dirección. Revisá que el servidor esté iniciado en el teléfono y que los dos estén en la misma red WiFi.');
      inputRef.current?.focus();
    } finally {
      clearTimeout(timer);
      setChecking(false);
    }
  };

  return (
    <Dialog
      title="Conectar por WiFi"
      description="Abrí WiXplorer en el teléfono, tocá Iniciar y escribí la dirección que aparece."
      onClose={checking ? undefined : onCancel}
      initialFocus={inputRef}
    >
      <form onSubmit={handleSubmit} noValidate>
        <input
          ref={inputRef}
          className={styles.input}
          aria-label="Dirección del teléfono"
          aria-invalid={error ? 'true' : undefined}
          aria-describedby={error ? 'wifi-error' : 'wifi-hint'}
          placeholder="192.168.0.10:7070"
          inputMode="url"
          autoComplete="off"
          spellCheck={false}
          value={address}
          onChange={e => { setAddress(e.target.value); setError(null); }}
          disabled={checking}
        />
        {error
          ? <p id="wifi-error" className={styles.fieldError} role="alert">{error}</p>
          : <p id="wifi-hint" className={styles.fieldHint}>Si no ponés puerto se usa el {DEFAULT_PORT}.</p>}
        <div className={styles.buttons}>
          <button type="button" className={styles.btnCancel} onClick={onCancel} disabled={checking}>Cancelar</button>
          <button type="submit" className={styles.btnConfirm} disabled={checking || !address.trim()}>
            {checking ? 'Buscando…' : 'Conectar'}
          </button>
        </div>
      </form>
    </Dialog>
  );
};

export default WifiConnectDialog;
