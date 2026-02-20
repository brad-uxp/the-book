import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import { Sidebar } from "@/components/layout/sidebar";
import { NotificationBell } from "@/components/layout/notification-bell";
import { Toaster } from "@/components/ui/sonner";

const inter = Inter({ subsets: ["latin"] });

export const metadata: Metadata = {
  title: "AccountBook",
  description: "Personal accounting & invoice management",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="es" suppressHydrationWarning>
      <body className={`${inter.className} bg-background`}>
        <div className="flex min-h-screen">
          <Sidebar />
          <div className="flex flex-1 flex-col pl-60">
            {/* Top bar */}
            <header className="sticky top-0 z-40 flex h-16 items-center justify-end border-b bg-card px-6">
              <NotificationBell />
            </header>
            {/* Main content */}
            <main className="flex-1 overflow-auto p-6">{children}</main>
          </div>
        </div>
        <Toaster richColors />
      </body>
    </html>
  );
}
