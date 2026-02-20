"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { Bell } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Badge } from "@/components/ui/badge";
import { formatDate } from "@/lib/dates";

interface Notification {
  id: string;
  type: string;
  title: string;
  body: string;
  event_date: string;
  created_at: string;
  read_at: string | null;
}

const TYPE_LABELS: Record<string, string> = {
  subscription_auto_upcoming: "Upcoming",
  subscription_manual_due: "Due",
  subscription_auto_paid: "Paid",
  salary_manual_due: "Salary Due",
  salary_increase_due: "Raise",
  invoice_reminder_due: "Invoice Reminder",
  invoice_due: "Invoice Due",
};

export function NotificationBell() {
  const [unread, setUnread] = useState(0);
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [open, setOpen] = useState(false);

  const fetchUnread = useCallback(async () => {
    const res = await fetch("/api/notifications?filter=unread&limit=5");
    if (res.ok) {
      const data = await res.json();
      setUnread(data.unreadCount);
      setNotifications(data.notifications);
    }
  }, []);

  useEffect(() => {
    fetchUnread();
    const interval = setInterval(fetchUnread, 60_000); // refresh every minute
    return () => clearInterval(interval);
  }, [fetchUnread]);

  const markRead = async (id: string) => {
    await fetch("/api/notifications", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id }),
    });
    fetchUnread();
  };

  const markAllRead = async () => {
    await fetch("/api/notifications/mark-all-read", { method: "POST" });
    fetchUnread();
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="icon" className="relative">
          <Bell className="h-5 w-5" />
          {unread > 0 && (
            <span className="absolute -right-1 -top-1 flex h-4 w-4 items-center justify-center rounded-full bg-destructive text-[10px] font-bold text-destructive-foreground">
              {unread > 9 ? "9+" : unread}
            </span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-96 p-0" align="end">
        <div className="flex items-center justify-between border-b px-4 py-3">
          <h3 className="font-semibold">Notifications</h3>
          <div className="flex items-center gap-2">
            {unread > 0 && (
              <Button
                variant="ghost"
                size="sm"
                className="h-7 text-xs"
                onClick={markAllRead}
              >
                Mark all read
              </Button>
            )}
            <Link href="/notifications" onClick={() => setOpen(false)}>
              <Button variant="ghost" size="sm" className="h-7 text-xs">
                View all
              </Button>
            </Link>
          </div>
        </div>

        <div className="max-h-80 overflow-y-auto">
          {notifications.length === 0 ? (
            <div className="px-4 py-8 text-center text-sm text-muted-foreground">
              No unread notifications
            </div>
          ) : (
            notifications.map((n) => (
              <div
                key={n.id}
                className={`flex gap-3 border-b px-4 py-3 last:border-0 ${
                  !n.read_at ? "bg-accent/30" : ""
                }`}
              >
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <Badge variant="outline" className="text-[10px]">
                      {TYPE_LABELS[n.type] ?? n.type}
                    </Badge>
                    <span className="text-xs text-muted-foreground">
                      {formatDate(n.event_date)}
                    </span>
                  </div>
                  <p className="mt-1 text-sm font-medium leading-tight">
                    {n.title}
                  </p>
                  <p className="text-xs text-muted-foreground leading-snug">
                    {n.body}
                  </p>
                </div>
                {!n.read_at && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 shrink-0 text-xs"
                    onClick={() => markRead(n.id)}
                  >
                    ✓
                  </Button>
                )}
              </div>
            ))
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
