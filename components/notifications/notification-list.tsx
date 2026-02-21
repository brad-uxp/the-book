"use client";

import { useState, useEffect, useCallback } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { formatDate } from "@/lib/dates";
import { Bell, CheckCheck, Inbox } from "lucide-react";

interface Notification {
  id: string;
  type: string;
  title: string;
  body: string;
  entity_type: string;
  entity_id: string;
  event_date: string;
  created_at: string;
  read_at: string | null;
}

const TYPE_LABELS: Record<string, string> = {
  subscription_auto_upcoming: "Auto Upcoming",
  subscription_manual_due: "Manual Due",
  subscription_auto_paid: "Auto Paid",
  salary_manual_due: "Salary Due",
  salary_increase_due: "Raise Due",
  invoice_reminder_due: "Invoice Reminder",
  invoice_due: "Invoice Due",
};

const TYPE_COLORS: Record<string, string> = {
  subscription_auto_upcoming: "bg-blue-100 text-blue-700",
  subscription_manual_due: "bg-amber-100 text-amber-700",
  subscription_auto_paid: "bg-green-100 text-green-700",
  salary_manual_due: "bg-purple-100 text-purple-700",
  salary_increase_due: "bg-orange-100 text-orange-700",
  invoice_reminder_due: "bg-yellow-100 text-yellow-700",
  invoice_due: "bg-red-100 text-red-700",
};

export function NotificationList() {
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [loading, setLoading] = useState(true);

  const fetchNotifications = useCallback(async () => {
    setLoading(true);
    const res = await fetch("/api/notifications?filter=all&limit=100");
    if (res.ok) {
      const data = await res.json();
      setNotifications(data.notifications);
      setUnreadCount(data.unreadCount);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    fetchNotifications();
  }, [fetchNotifications]);

  const markRead = async (id: string) => {
    await fetch("/api/notifications", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id }),
    });
    fetchNotifications();
  };

  const markAllRead = async () => {
    await fetch("/api/notifications/mark-all-read", { method: "POST" });
    fetchNotifications();
  };

  return (
    <div className="space-y-4">
      {/* Toolbar */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Bell className="h-4 w-4 text-muted-foreground" />
          <span className="text-sm text-muted-foreground">{unreadCount} unread</span>
        </div>
        {unreadCount > 0 && (
          <Button variant="outline" size="sm" onClick={markAllRead}>
            <CheckCheck className="mr-2 h-4 w-4" />
            Mark all read
          </Button>
        )}
      </div>

      {/* List */}
      {loading ? (
        <div className="space-y-2">
          {[...Array(5)].map((_, i) => (
            <div
              key={i}
              className="h-20 rounded-lg border bg-muted/30 animate-pulse"
            />
          ))}
        </div>
      ) : notifications.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
          <Inbox className="h-12 w-12 mb-3 opacity-30" />
          <p className="text-sm">No notifications</p>
        </div>
      ) : (
        <div className="space-y-2">
          {notifications.map((n) => (
            <div
              key={n.id}
              className={`flex gap-4 rounded-lg border p-4 transition-colors ${
                n.read_at
                  ? "border-muted bg-muted/30"
                  : "bg-card"
              }`}
            >
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap mb-1">
                  <span
                    className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium ${
                      n.read_at
                        ? "bg-muted text-muted-foreground"
                        : (TYPE_COLORS[n.type] ?? "bg-muted text-muted-foreground")
                    }`}
                  >
                    {TYPE_LABELS[n.type] ?? n.type}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {formatDate(n.event_date)}
                  </span>
                  {!n.read_at && (
                    <span className="inline-flex items-center rounded-full border border-orange-200 bg-orange-100 px-2 py-0.5 text-[10px] font-semibold text-orange-700">
                      New
                    </span>
                  )}
                </div>
                <p className={`font-medium text-sm ${n.read_at ? "text-muted-foreground" : ""}`}>
                  {n.title}
                </p>
                <p className="text-sm text-muted-foreground leading-snug">
                  {n.body}
                </p>
              </div>

              {!n.read_at && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="shrink-0 h-8"
                  onClick={() => markRead(n.id)}
                >
                  Mark read
                </Button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
