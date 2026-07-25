"use client";

import { useState, useEffect, useCallback, useSyncExternalStore } from "react";
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

/** Nothing to subscribe to: the platform cannot change while the tab is open. */
const noopSubscribe = () => () => {};

/**
 * Which install banner this device is eligible for, or null for none.
 *
 * All three inputs — display mode, user agent, localStorage — are invisible to
 * the server, so this cannot be computed during render or seeded into
 * useState. useSyncExternalStore is the sanctioned way to read a client-only
 * value: it returns the server snapshot for SSR and re-renders after
 * hydration, without a synchronous setState inside an effect.
 */
function useInstallPlatform(): Platform {
  return useSyncExternalStore(
    noopSubscribe,
    () =>
      isStandalone() || wasDismissedRecently() ? null : detectMobilePlatform(),
    () => null
  );
}

export function InstallBanner() {
  const platform = useInstallPlatform();
  const [dismissed, setDismissed] = useState(false);
  const [deferredPrompt, setDeferredPrompt] =
    useState<BeforeInstallPromptEvent | null>(null);

  useEffect(() => {
    if (platform !== "android") return;

    // Android only: the banner waits for the browser to offer the prompt.
    const handler = (e: Event) => {
      e.preventDefault();
      setDeferredPrompt(e as BeforeInstallPromptEvent);
    };

    window.addEventListener("beforeinstallprompt", handler);
    return () => window.removeEventListener("beforeinstallprompt", handler);
  }, [platform]);

  const dismiss = useCallback(() => {
    setDismissed(true);
    localStorage.setItem(DISMISSED_KEY, String(Date.now()));
  }, []);

  const install = useCallback(async () => {
    if (deferredPrompt) {
      await deferredPrompt.prompt();
      const { outcome } = await deferredPrompt.userChoice;
      if (outcome === "accepted") setDismissed(true);
      setDeferredPrompt(null);
    }
  }, [deferredPrompt]);

  // Derived rather than stored: iOS shows instructions immediately, Android
  // only once the browser has offered a prompt to defer.
  const visible =
    !dismissed &&
    (platform === "ios" || (platform === "android" && deferredPrompt !== null));

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
