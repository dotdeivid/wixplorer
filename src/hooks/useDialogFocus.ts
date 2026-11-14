import { useEffect, type RefObject } from 'react';

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Manejo de foco para diálogos modales:
 * - al abrir, enfoca [initialFocus] (o el primer elemento enfocable);
 * - Tab / Shift+Tab quedan dentro del diálogo;
 * - Escape llama a [onEscape] (si se pasa);
 * - al cerrar, devuelve el foco a lo que estaba enfocado antes.
 */
export function useDialogFocus(
  containerRef: RefObject<HTMLElement | null>,
  options: { initialFocus?: RefObject<HTMLElement | null>; onEscape?: () => void } = {},
) {
  const { initialFocus, onEscape } = options;

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const previouslyFocused = document.activeElement as HTMLElement | null;

    const target = initialFocus?.current ?? container.querySelector<HTMLElement>(FOCUSABLE) ?? container;
    target.focus();

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && onEscape) {
        e.preventDefault();
        e.stopPropagation();
        onEscape();
        return;
      }
      if (e.key !== 'Tab') return;
      const focusables = Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE));
      if (focusables.length === 0) { e.preventDefault(); return; }
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };

    container.addEventListener('keydown', onKeyDown);
    return () => {
      container.removeEventListener('keydown', onKeyDown);
      // Devolver el foco solo si sigue en el documento
      if (previouslyFocused?.isConnected) previouslyFocused.focus();
    };
    // Solo al montar/desmontar el diálogo
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}
