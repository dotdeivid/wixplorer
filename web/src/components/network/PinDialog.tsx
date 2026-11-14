import React, { useRef, useState, useEffect, useId } from 'react';
import styles from './PinDialog.module.css';
import type { NetworkDevice } from '../../hooks/useNetworkDevice';
import { Smartphone, X } from 'lucide-react';
import { useDialogFocus } from '../../hooks/useDialogFocus';

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
  const dialogRef = useRef<HTMLDivElement>(null);
  const firstInputRef = useRef<HTMLInputElement | null>(null);
  const titleId = useId();
  const descId = useId();
  const errorId = useId();

  // Foco atrapado en el diálogo; Escape cierra salvo en modo auto-hospedado
  // (ahí no hay otra forma de reabrirlo sin recargar).
  useDialogFocus(dialogRef, { initialFocus: firstInputRef, onEscape: selfHosted ? undefined : onCancel });

  // Ante un nuevo error: limpiar los dígitos y sacudir. Se ajusta el estado
  // durante el render (patrón recomendado por React) en lugar de en un effect.
  const [prevAuthError, setPrevAuthError] = useState(authError);
  if (authError !== prevAuthError) {
    setPrevAuthError(authError);
    if (authError) {
      setShake(true);
      setDigits(Array(PIN_LENGTH).fill(''));
    }
  }

  useEffect(() => {
    if (!shake) return;
    const timer = setTimeout(() => {
      setShake(false);
      inputRefs.current[0]?.focus();
    }, 500);
    return () => clearTimeout(timer);
  }, [shake]);

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
      <div
        ref={dialogRef}
        className={styles.dialog}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descId}
      >
        {/* X para cerrar — oculto en modo self-hosted (sin recarga no se puede reabrir) */}
        {!selfHosted && (
          <button className={styles.closeBtn} onClick={onCancel} disabled={isAuthenticating} aria-label="Cerrar">
            <X size={14} strokeWidth={2} />
          </button>
        )}

        <div className={styles.header}>
          <div className={styles.deviceIcon}><Smartphone size={26} strokeWidth={1.5} aria-hidden="true" /></div>
          <div>
            <h2 id={titleId} className={styles.title}>Conectar con {device.deviceName}</h2>
            <p id={descId} className={styles.subtitle}>Ingresá el PIN que aparece en la pantalla del teléfono</p>
          </div>
        </div>

        <div
          className={`${styles.pinRow} ${shake ? styles.shake : ''}`}
          onPaste={handlePaste}
          role="group"
          aria-label="PIN de 6 dígitos"
        >
          {digits.map((d, i) => (
            <input
              key={i}
              ref={el => { inputRefs.current[i] = el; if (i === 0) firstInputRef.current = el; }}
              aria-label={`Dígito ${i + 1} de ${PIN_LENGTH}`}
              aria-invalid={authError ? 'true' : undefined}
              aria-describedby={authError ? errorId : undefined}
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
          <div className={styles.connectingMsg} role="status">Conectando…</div>
        )}

        {authError && !isAuthenticating && (
          <div id={errorId} className={styles.errorMsg} role="alert">{authError}</div>
        )}
      </div>
    </div>
  );
};

export default PinDialog;
