"use client";

import Link from "next/link";
import Image from "next/image";
import { usePathname } from "next/navigation";
import { signOut } from "next-auth/react";
import {
  CreditCard,
  Users,
  FileText,
  Bell,
  LayoutDashboard,
  Receipt,
  Settings,
  LogOut,
  ClipboardList,
  CheckSquare,
  Banknote,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { useUnreadNotifications } from "@/components/layout/notification-context";

interface Props {
  user: {
    name?: string | null;
    image?: string | null;
    email?: string | null;
  } | null;
}

export function Sidebar({ user }: Props) {
  const pathname = usePathname();
  const [confirmSignOut, setConfirmSignOut] = useState(false);
  const { unreadCount } = useUnreadNotifications();

  const firstName = user?.name?.split(" ")[0] ?? "User";
  const initial = firstName[0]?.toUpperCase() ?? "U";

  const linkClass = (href: string, exact = false) =>
    cn(
      "flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
      (exact ? pathname === href : pathname === href || pathname.startsWith(href + "/"))
        ? "bg-primary text-primary-foreground"
        : "text-muted-foreground hover:bg-accent hover:text-accent-foreground"
    );

  return (
    <aside className="hidden lg:flex fixed inset-y-0 left-0 z-50 w-60 flex-col border-r bg-card">
      {/* Brand */}
      <div className="flex h-16 items-center border-b px-6 gap-2.5">
        <img src="/logo.svg" alt="TheBook logo" className="h-6 w-auto shrink-0" />
        <span className="text-lg font-semibold tracking-tight">TheBook</span>
      </div>

      {/* Navigation */}
      <nav className="flex-1 overflow-y-auto py-4 px-3 space-y-0.5">
        <Link href="/dashboard" className={linkClass("/dashboard")}>
          <LayoutDashboard className="h-4 w-4 shrink-0" />
          Dashboard
        </Link>

        <div className="pt-3">
          <Link href="/issues" className={linkClass("/issues")}>
            <CheckSquare className="h-4 w-4 shrink-0" />
            Issues
          </Link>
        </div>

        {/* Incomes group */}
        <div className="pt-3">
          <div className="rounded-lg bg-muted/40 shadow-[inset_0_1px_3px_rgba(0,0,0,0.04)] px-1 py-1.5 space-y-0.5">
            <p className="px-2 pt-0.5 pb-1 text-xs font-semibold uppercase tracking-wider text-muted-foreground/50">
              Incomes
            </p>
            <Link href="/invoices" className={linkClass("/invoices")}>
              <FileText className="h-4 w-4 shrink-0" />
              Invoices
            </Link>
            <Link href="/fees" className={linkClass("/fees")}>
              <Banknote className="h-4 w-4 shrink-0" />
              Fees
            </Link>
          </div>
        </div>

        {/* Expenses group */}
        <div className="pt-3">
          <div className="rounded-lg bg-muted/40 shadow-[inset_0_1px_3px_rgba(0,0,0,0.04)] px-1 py-1.5 space-y-0.5">
            <p className="px-2 pt-0.5 pb-1 text-xs font-semibold uppercase tracking-wider text-muted-foreground/50">
              Expenses
            </p>
            <Link href="/expenses" className={linkClass("/expenses", true)}>
              <Receipt className="h-4 w-4 shrink-0" />
              Overview
            </Link>
            <Link href="/subscriptions" className={linkClass("/subscriptions")}>
              <CreditCard className="h-4 w-4 shrink-0" />
              Subscriptions
            </Link>
            <Link href="/salaries" className={linkClass("/salaries")}>
              <Users className="h-4 w-4 shrink-0" />
              Salaries
            </Link>
          </div>
        </div>

        <div className="pt-3">
          <Link href="/notifications" className={linkClass("/notifications")}>
            <Bell className="h-4 w-4 shrink-0" />
            Notifications
            {unreadCount > 0 && <span className="ml-auto h-2 w-2 rounded-full bg-orange-500" />}
          </Link>
        </div>

        <div className="pt-3">
          <Link href="/admin-logs" className={linkClass("/admin-logs")}>
            <ClipboardList className="h-4 w-4 shrink-0" />
            Admin Logs
          </Link>
        </div>

        <div className="pt-3">
          <Link href="/settings" className={linkClass("/settings")}>
            <Settings className="h-4 w-4 shrink-0" />
            Settings
          </Link>
        </div>
      </nav>

      {/* Footer — user info + sign out */}
      <div className="border-t px-4 py-3">
        {!confirmSignOut ? (
          <div className="flex items-center gap-2">
            {user?.image ? (
              <Image
                src={user.image}
                alt={firstName}
                width={32}
                height={32}
                className="rounded-full shrink-0"
              />
            ) : (
              <div className="h-8 w-8 shrink-0 rounded-full bg-primary/10 flex items-center justify-center text-xs font-semibold text-primary">
                {initial}
              </div>
            )}
            <span className="flex-1 truncate text-sm font-medium">{firstName}</span>
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7 shrink-0 text-muted-foreground hover:text-destructive"
              onClick={() => setConfirmSignOut(true)}
              title="Sign out"
            >
              <LogOut className="h-4 w-4" />
            </Button>
          </div>
        ) : (
          <div className="space-y-2">
            <p className="text-xs text-muted-foreground">Sign out of TheBook?</p>
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                className="flex-1 h-7 text-xs"
                onClick={() => setConfirmSignOut(false)}
              >
                Cancel
              </Button>
              <Button
                variant="destructive"
                size="sm"
                className="flex-1 h-7 text-xs"
                onClick={() => signOut({ callbackUrl: "/login" })}
              >
                Sign out
              </Button>
            </div>
          </div>
        )}
      </div>
    </aside>
  );
}
