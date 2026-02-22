"use client";

import { createContext, useContext, useState, useEffect, useCallback } from "react";

interface NotificationContextValue {
  unreadCount: number;
}

const NotificationContext = createContext<NotificationContextValue>({ unreadCount: 0 });

export function useUnreadNotifications() {
  return useContext(NotificationContext);
}

export function NotificationProvider({ children }: { children: React.ReactNode }) {
  const [unreadCount, setUnreadCount] = useState(0);

  const fetchCount = useCallback(async () => {
    try {
      const res = await fetch("/api/notifications?filter=unread&limit=1");
      if (res.ok) {
        const data = await res.json();
        setUnreadCount(data.unreadCount);
      }
    } catch {}
  }, []);

  useEffect(() => {
    fetchCount();
    const interval = setInterval(fetchCount, 60_000);
    return () => clearInterval(interval);
  }, [fetchCount]);

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
