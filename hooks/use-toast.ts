"use client";

import { useState, useCallback } from "react";

interface Toast {
  id: string;
  title: string;
  description?: string;
  variant?: "default" | "destructive";
}

let toastQueue: Toast[] = [];
let listeners: Array<(toasts: Toast[]) => void> = [];

function notify(toasts: Toast[]) {
  listeners.forEach((l) => l(toasts));
}

export function toast(opts: Omit<Toast, "id">) {
  const id = Math.random().toString(36).slice(2);
  toastQueue = [...toastQueue, { ...opts, id }];
  notify(toastQueue);
  setTimeout(() => {
    toastQueue = toastQueue.filter((t) => t.id !== id);
    notify(toastQueue);
  }, 4000);
}

export function useToast() {
  const [toasts, setToasts] = useState<Toast[]>(toastQueue);

  const subscribe = useCallback(() => {
    const listener = (t: Toast[]) => setToasts([...t]);
    listeners.push(listener);
    return () => {
      listeners = listeners.filter((l) => l !== listener);
    };
  }, []);

  // Subscribe on mount
  useState(() => {
    const unsub = subscribe();
    return unsub;
  });

  const dismiss = useCallback((id: string) => {
    toastQueue = toastQueue.filter((t) => t.id !== id);
    notify(toastQueue);
  }, []);

  return { toasts, dismiss };
}
