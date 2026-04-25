'use client';

import { AlertCircle, CheckCircle2, X } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';

export type ToastMessage = {
  id: number;
  message: string;
  type: 'error' | 'success';
};

type ToastInput = Pick<ToastMessage, 'message' | 'type'>;

export function useToastQueue(timeoutMs = 4500) {
  const [toasts, setToasts] = useState<ToastMessage[]>([]);
  const nextToastId = useRef(1);
  const timeouts = useRef(new Map<number, ReturnType<typeof setTimeout>>());

  const dismissToast = useCallback((id: number) => {
    const timeout = timeouts.current.get(id);

    if (timeout) {
      clearTimeout(timeout);
      timeouts.current.delete(id);
    }

    setToasts((currentToasts) =>
      currentToasts.filter((toast) => toast.id !== id),
    );
  }, []);

  const showToast = useCallback(
    ({ message, type }: ToastInput) => {
      const id = nextToastId.current;
      nextToastId.current += 1;

      setToasts((currentToasts) =>
        [...currentToasts, { id, message, type }].slice(-3),
      );

      const timeout = setTimeout(() => dismissToast(id), timeoutMs);
      timeouts.current.set(id, timeout);
    },
    [dismissToast, timeoutMs],
  );

  useEffect(() => {
    const activeTimeouts = timeouts.current;

    return () => {
      activeTimeouts.forEach((timeout) => clearTimeout(timeout));
      activeTimeouts.clear();
    };
  }, []);

  return { dismissToast, showToast, toasts };
}

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
        <div className={`toast ${toast.type}`} key={toast.id}>
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
