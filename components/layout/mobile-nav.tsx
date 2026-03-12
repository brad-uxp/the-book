"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import Image from "next/image";
import { usePathname } from "next/navigation";
import { signOut } from "next-auth/react";
import { useSession } from "next-auth/react";
import {
  Menu,
  LayoutDashboard,
  FileText,
  Receipt,
  CreditCard,
  Users,
  Bell,
  Settings,
  LogOut,
  ClipboardList,
  CheckSquare,
  Banknote,
} from "lucide-react";
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useUnreadNotifications } from "@/components/layout/notification-context";

export function MobileNav() {
  const [open, setOpen] = useState(false);
  const [confirmSignOut, setConfirmSignOut] = useState(false);
  const pathname = usePathname();
  const { data: session } = useSession();

  useEffect(() => {
    setOpen(false);
    setConfirmSignOut(false);
  }, [pathname]);

  const { unreadCount } = useUnreadNotifications();
  const user = session?.user;
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
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <Button variant="ghost" size="icon">
          <Menu className="h-5 w-5" />
        </Button>
      </SheetTrigger>
      <SheetContent side="left" className="w-60 p-0 sm:max-w-60 flex flex-col">
        <div className="flex items-center justify-center border-b py-12 shrink-0">
          <Image src="/logo.svg" alt="book logo" width={123} height={36} className="h-9 w-auto shrink-0" />
        </div>
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
        <div className="border-t px-4 py-3 shrink-0">
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
      </SheetContent>
    </Sheet>
  );
}
