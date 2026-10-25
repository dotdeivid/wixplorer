import React, { useRef, useState, useEffect } from 'react';
import styles from './PinDialog.module.css';
import type { NetworkDevice } from '../../hooks/useNetworkDevice';
import { X } from 'lucide-react';

interface PinDialogProps {
  device: NetworkDevice;
  authError: string | null;
  isAuthenticating: boolean;
  onConfirm: (pin: string) => void;
  onCancel: () => void;
  selfHosted?: boolean;
}

const PIN_LENGTH = 6;

const PinDialog: React.FC<PinDialogProps> = ({
  device,
  authError,
  isAuthenticating,
  onConfirm,
  onCancel,
  selfHosted = false,
}) => {
  const [digits, setDigits] = useState<string[]>(Array(PIN_LENGTH).fill(''));
  const [shake, setShake] = useState(false);
  const inputRefs = useRef<(HTMLInputElement | null)[]>([]);

  useEffect(() => {
    inputRefs.current[0]?.focus();
  }, []);

  useEffect(() => {
    if (authError) {
      setShake(true);
      setDigits(Array(PIN_LENGTH).fill(''));
      setTimeout(() => {
        setShake(false);
        inputRefs.current[0]?.focus();
      }, 500);
    }
  }, [authError]);

  const submit = (pin: string) => {
    if (pin.length === PIN_LENGTH && !isAuthenticating) onConfirm(pin);
  };

  const handleChange = (index: number, value: string) => {
    const digit = value.replace(/\D/g, '').slice(-1);
    const next = [...digits];
    next[index] = digit;
    setDigits(next);

    if (digit && index < PIN_LENGTH - 1) {
      inputRefs.current[index + 1]?.focus();
    }
    if (digit && index === PIN_LENGTH - 1) {
      submit(next.join(''));
    }
  };

  const handleKeyDown = (index: number, e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Backspace') {
      if (digits[index]) {
        const next = [...digits];
        next[index] = '';
        setDigits(next);
      } else if (index > 0) {
        inputRefs.current[index - 1]?.focus();
      }
    } else if (e.key === 'Escape' && !selfHosted) {
      onCancel();
    }
  };

  const handlePaste = (e: React.ClipboardEvent) => {
    e.preventDefault();
    const pasted = e.clipboardData.getData('text').replace(/\D/g, '').slice(0, PIN_LENGTH);
    const next = Array(PIN_LENGTH).fill('');
    pasted.split('').forEach((d, i) => { next[i] = d; });
    setDigits(next);
    const focusIdx = Math.min(pasted.length, PIN_LENGTH - 1);
    inputRefs.current[focusIdx]?.focus();
    if (pasted.length === PIN_LENGTH) submit(pasted);
  };

  const handleBackdropClick = (e: React.MouseEvent) => {
    if (!selfHosted && e.target === e.currentTarget) onCancel();
  };

  return (
    <div className={styles.backdrop} onClick={handleBackdropClick}>
      <div className={styles.dialog}>
        {/* X para cerrar — oculto en modo self-hosted (sin recarga no se puede reabrir) */}
        {!selfHosted && (
          <button className={styles.closeBtn} onClick={onCancel} disabled={isAuthenticating}>
            <X size={14} strokeWidth={2} />
          </button>
        )}

        <div className={styles.header}>
          <div className={styles.deviceIcon}>📱</div>
          <div>
            <div className={styles.title}>Conectar con {device.deviceName}</div>
            <div className={styles.subtitle}>Ingresá el PIN que aparece en la pantalla del teléfono</div>
          </div>
        </div>

        <div className={`${styles.pinRow} ${shake ? styles.shake : ''}`} onPaste={handlePaste}>
          {digits.map((d, i) => (
            <input
              key={i}
              ref={el => { inputRefs.current[i] = el; }}
              className={`${styles.pinInput} ${authError ? styles.error : ''}`}
              type="text"
              inputMode="numeric"
              maxLength={1}
              value={d}
              disabled={isAuthenticating}
              onChange={e => handleChange(i, e.target.value)}
              onKeyDown={e => handleKeyDown(i, e)}
              onClick={() => inputRefs.current[i]?.select()}
              autoComplete="off"
            />
          ))}
        </div>

        {isAuthenticating && (
          <div className={styles.connectingMsg}>Conectando…</div>
        )}

        {authError && !isAuthenticating && (
          <div className={styles.errorMsg}>{authError}</div>
        )}
      </div>
    </div>
  );
};

export default PinDialog;
