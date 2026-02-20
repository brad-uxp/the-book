"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  CreditCard,
  Users,
  BarChart3,
  FileText,
  Bell,
  DollarSign,
} from "lucide-react";
import { cn } from "@/lib/utils";

const nav = [
  { href: "/subscriptions", label: "Subscriptions", icon: CreditCard },
  { href: "/salaries", label: "Salaries", icon: Users },
  { href: "/expenses", label: "Expenses", icon: BarChart3 },
  { href: "/invoices", label: "Invoices", icon: FileText },
  { href: "/notifications", label: "Notifications", icon: Bell },
];

export function Sidebar() {
  const pathname = usePathname();

  return (
    <aside className="fixed inset-y-0 left-0 z-50 flex w-60 flex-col border-r bg-card">
      {/* Brand */}
      <div className="flex h-16 items-center gap-2 border-b px-6">
        <DollarSign className="h-6 w-6 text-primary" />
        <span className="text-lg font-semibold tracking-tight">AccountBook</span>
      </div>

      {/* Navigation */}
      <nav className="flex-1 overflow-y-auto py-4">
        <ul className="space-y-1 px-3">
          {nav.map(({ href, label, icon: Icon }) => {
            const active =
              pathname === href || pathname.startsWith(href + "/");
            return (
              <li key={href}>
                <Link
                  href={href}
                  className={cn(
                    "flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
                    active
                      ? "bg-primary text-primary-foreground"
                      : "text-muted-foreground hover:bg-accent hover:text-accent-foreground"
                  )}
                >
                  <Icon className="h-4 w-4 shrink-0" />
                  {label}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>

      {/* Footer */}
      <div className="border-t px-6 py-4">
        <p className="text-xs text-muted-foreground">AccountBook v1.0</p>
      </div>
    </aside>
  );
}
