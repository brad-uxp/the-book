"use client";

import { createContext, useContext, useState, useCallback } from "react";
import { usePolling } from "@/hooks/use-polling";

interface NotificationContextValue {
  unreadCount: number;
}

const NotificationContext = createContext<NotificationContextValue>({ unreadCount: 0 });

export function useUnreadNotifications() {
  return useContext(NotificationContext);
}

export function NotificationProvider({ children }: { children: React.ReactNode }) {
  const [unreadCount, setUnreadCount] = useState(0);

  const fetchCount = useCallback(async (signal: AbortSignal) => {
    const res = await fetch("/api/notifications/count", { signal });
    if (!res.ok) throw new Error(`count request failed: ${res.status}`);
    const data = await res.json();
    setUnreadCount(data.unreadCount);
  }, []);

  usePolling(fetchCount);

  return (
    <NotificationContext.Provider value={{ unreadCount }}>
      {children}
    </NotificationContext.Provider>
  );
}

export function UnreadDot() {
  const { unreadCount } = useUnreadNotifications();
  if (unreadCount === 0) return null;
  return <span className="h-2 w-2 rounded-full bg-orange-500 animate-pulse" />;
}
