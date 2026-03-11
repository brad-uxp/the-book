import type { Metadata } from "next";
import { Inter } from "next/font/google";
import Image from "next/image";
import "./globals.css";
import { Sidebar } from "@/components/layout/sidebar";
import { MobileNav } from "@/components/layout/mobile-nav";
import { Toaster } from "@/components/ui/sonner";
import { auth } from "@/auth";
import { SessionProvider } from "next-auth/react";
import NextTopLoader from "nextjs-toploader";
import { NotificationProvider, UnreadDot } from "@/components/layout/notification-context";

const inter = Inter({ subsets: ["latin"] });

export const metadata: Metadata = {
  title: "TheBook",
  description: "Personal accounting & invoice management",
  robots: { index: false, follow: false },
};

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await auth();

  return (
    <html lang="es" suppressHydrationWarning>
      <body className={`${inter.className} bg-background`}>
        <NextTopLoader color="#18181b" showSpinner={false} height={2} shadow={false} />
        <SessionProvider session={session}>
        {session ? (
          <NotificationProvider>
          <div className="flex min-h-screen">
            <Sidebar user={session.user ?? null} />
            <div className="flex min-w-0 flex-1 flex-col lg:pl-60">
              {/* Mobile-only top bar */}
              <header className="lg:hidden sticky top-0 z-40 flex h-14 w-full items-center justify-between border-b bg-card px-4">
                <div className="flex items-center gap-2">
                  <Image src="/logo.svg" alt="BOK logo" width={88} height={30} className="h-7 w-auto shrink-0" />
                  <UnreadDot />
                </div>
                <MobileNav />
              </header>
              {/* Main content */}
              <main className="flex-1 overflow-auto p-4 lg:p-6">{children}</main>
            </div>
          </div>
          </NotificationProvider>
        ) : (
          children
        )}
        <Toaster richColors />
        </SessionProvider>
      </body>
    </html>
  );
}
