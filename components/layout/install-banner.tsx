"use client";

import { useState, useEffect, useCallback } from "react";
import Image from "next/image";
import { X, Share, PlusSquare } from "lucide-react";

interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

const DISMISSED_KEY = "pwa-install-dismissed";
const DISMISS_DAYS = 14;

function wasDismissedRecently(): boolean {
  if (typeof window === "undefined") return true;
  const ts = localStorage.getItem(DISMISSED_KEY);
  if (!ts) return false;
  return Date.now() - Number(ts) < DISMISS_DAYS * 24 * 60 * 60 * 1000;
}

function isStandalone(): boolean {
  if (typeof window === "undefined") return false;
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    (navigator as unknown as { standalone?: boolean }).standalone === true
  );
}

type Platform = "android" | "ios" | null;

function detectMobilePlatform(): Platform {
  if (typeof navigator === "undefined") return null;
  const ua = navigator.userAgent;
  if (/android/i.test(ua)) return "android";
  if (/iPad|iPhone|iPod/.test(ua)) return "ios";
  return null;
}

export function InstallBanner() {
  const [visible, setVisible] = useState(false);
  const [platform, setPlatform] = useState<Platform>(null);
  const [deferredPrompt, setDeferredPrompt] =
    useState<BeforeInstallPromptEvent | null>(null);

  useEffect(() => {
    if (isStandalone() || wasDismissedRecently()) return;

    const plat = detectMobilePlatform();
    if (!plat) return;

    setPlatform(plat);

    if (plat === "ios") {
      setVisible(true);
      return;
    }

    // Android: wait for beforeinstallprompt
    const handler = (e: Event) => {
      e.preventDefault();
      setDeferredPrompt(e as BeforeInstallPromptEvent);
      setVisible(true);
    };

    window.addEventListener("beforeinstallprompt", handler);
    return () => window.removeEventListener("beforeinstallprompt", handler);
  }, []);

  const dismiss = useCallback(() => {
    setVisible(false);
    localStorage.setItem(DISMISSED_KEY, String(Date.now()));
  }, []);

  const install = useCallback(async () => {
    if (deferredPrompt) {
      await deferredPrompt.prompt();
      const { outcome } = await deferredPrompt.userChoice;
      if (outcome === "accepted") setVisible(false);
      setDeferredPrompt(null);
    }
  }, [deferredPrompt]);

  if (!visible) return null;

  return (
    <div className="fixed bottom-0 inset-x-0 z-50 safe-bottom animate-in slide-in-from-bottom duration-300">
      <div className="mx-3 mb-3 rounded-2xl border bg-card shadow-2xl shadow-black/20 p-4">
        <button
          onClick={dismiss}
          className="absolute top-3 right-3 p-1 rounded-full text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
        >
          <X className="h-4 w-4" />
        </button>

        <div className="flex items-center gap-3.5">
          <Image
            src="/icons/icon-192.png"
            alt="TheBook"
            width={56}
            height={56}
            className="rounded-xl shrink-0 shadow-md"
          />
          <div className="flex-1 min-w-0">
            <p className="font-semibold text-sm">TheBook</p>
            <p className="text-xs text-muted-foreground mt-0.5">
              Instala la app para acceso rápido desde tu pantalla de inicio.
            </p>
          </div>
        </div>

        {platform === "android" && deferredPrompt && (
          <button
            onClick={install}
            className="mt-3 w-full rounded-xl bg-primary py-2.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors"
          >
            Instalar app
          </button>
        )}

        {platform === "ios" && (
          <div className="mt-3 flex items-center gap-2 rounded-xl bg-muted/50 px-3 py-2.5">
            <span className="text-xs text-muted-foreground">
              Toca{" "}
              <Share className="inline h-3.5 w-3.5 -mt-0.5 text-foreground" />{" "}
              y luego{" "}
              <span className="inline-flex items-center gap-0.5 font-medium text-foreground">
                <PlusSquare className="inline h-3.5 w-3.5 -mt-0.5" />
                Agregar a inicio
              </span>
            </span>
          </div>
        )}
      </div>
    </div>
  );
}
