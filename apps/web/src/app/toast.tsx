'use client';

import { AlertCircle, CheckCircle2, X } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';

// Define o contrato de uma notificação exibida no canto da tela.
export type ToastMessage = {
  id: number;
  isExiting?: boolean;
  message: string;
  type: 'error' | 'success';
};

// Define os dados mínimos necessários para criar uma nova notificação.
type ToastInput = Pick<ToastMessage, 'message' | 'type'>;
const TOAST_EXIT_MS = 180;

// Controla a fila de notificações, tempos de saída e remoção automática.
export function useToastQueue(timeoutMs = 4500) {
  const [toasts, setToasts] = useState<ToastMessage[]>([]);
  const nextToastId = useRef(1);
  const timeouts = useRef(new Map<number, ReturnType<typeof setTimeout>>());
  const exitTimeouts = useRef(new Map<number, ReturnType<typeof setTimeout>>());

  // Limpa todos os temporizadores associados a uma notificação.
  const clearToastTimers = useCallback((id: number) => {
    const timeout = timeouts.current.get(id);
    const exitTimeout = exitTimeouts.current.get(id);

    if (timeout) {
      clearTimeout(timeout);
      timeouts.current.delete(id);
    }

    if (exitTimeout) {
      clearTimeout(exitTimeout);
      exitTimeouts.current.delete(id);
    }
  }, []);

  // Remove uma notificação da fila depois que a animação termina.
  const removeToast = useCallback(
    (id: number) => {
      clearToastTimers(id);
      setToasts((currentToasts) =>
        currentToasts.filter((toast) => toast.id !== id),
      );
    },
    [clearToastTimers],
  );

  // Marca uma notificação como saindo e agenda sua remoção final.
  const dismissToast = useCallback((id: number) => {
    const timeout = timeouts.current.get(id);

    if (timeout) {
      clearTimeout(timeout);
      timeouts.current.delete(id);
    }

    setToasts((currentToasts) =>
      currentToasts.map((toast) =>
        toast.id === id ? { ...toast, isExiting: true } : toast,
      ),
    );

    if (exitTimeouts.current.has(id)) {
      return;
    }

    const exitTimeout = setTimeout(() => removeToast(id), TOAST_EXIT_MS);
    exitTimeouts.current.set(id, exitTimeout);
  }, [removeToast]);

  // Adiciona uma nova notificação e limita a fila visível.
  const showToast = useCallback(
    ({ message, type }: ToastInput) => {
      const id = nextToastId.current;
      nextToastId.current += 1;

      setToasts((currentToasts) => {
        const nextToasts = [
          ...currentToasts,
          { id, isExiting: false, message, type },
        ].slice(-3);
        const nextToastIds = new Set(nextToasts.map((toast) => toast.id));

        currentToasts.forEach((toast) => {
          if (!nextToastIds.has(toast.id)) {
            clearToastTimers(toast.id);
          }
        });

        return nextToasts;
      });

      const timeout = setTimeout(() => dismissToast(id), timeoutMs);
      timeouts.current.set(id, timeout);
    },
    [clearToastTimers, dismissToast, timeoutMs],
  );

  // Cancela temporizadores ativos quando o hook é desmontado.
  useEffect(() => {
    const activeTimeouts = timeouts.current;
    const activeExitTimeouts = exitTimeouts.current;

    return () => {
      activeTimeouts.forEach((timeout) => clearTimeout(timeout));
      activeTimeouts.clear();
      activeExitTimeouts.forEach((timeout) => clearTimeout(timeout));
      activeExitTimeouts.clear();
    };
  }, []);

  return { dismissToast, showToast, toasts };
}

// Renderiza a área acessível onde as notificações aparecem.
export function ToastViewport({
  onDismiss,
  toasts,
}: {
  onDismiss: (id: number) => void;
  toasts: ToastMessage[];
}) {
  return (
    <div
      aria-label="Notificações"
      aria-live="polite"
      className="toast-viewport"
      role="status"
    >
      {toasts.map((toast) => (
        <div
          className={
            toast.isExiting
              ? `toast ${toast.type} exiting`
              : `toast ${toast.type}`
          }
          key={toast.id}
        >
          {toast.type === 'success' ? (
            <CheckCircle2 size={18} aria-hidden="true" />
          ) : (
            <AlertCircle size={18} aria-hidden="true" />
          )}
          <span>{toast.message}</span>
          <button
            aria-label="Fechar notificação"
            className="toast-close"
            onClick={() => onDismiss(toast.id)}
            type="button"
          >
            <X size={16} aria-hidden="true" />
          </button>
        </div>
      ))}
    </div>
  );
}
