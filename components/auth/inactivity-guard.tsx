"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { signOut, useSession } from "next-auth/react";
import { Button } from "@/components/ui/button";

const INACTIVE_MS = 60 * 60 * 1000; // 1 hour
const WARN_MS     =  5 * 60 * 1000; // warn 5 min before logout

const EVENTS = [
  "mousemove",
  "mousedown",
  "keydown",
  "touchstart",
  "scroll",
] as const;

export function InactivityGuard() {
  const { data: session } = useSession();
  const [warn, setWarn] = useState(false);
  const warnTimer   = useRef<ReturnType<typeof setTimeout>>(undefined);
  const logoutTimer = useRef<ReturnType<typeof setTimeout>>(undefined);

  const resetTimers = useCallback(() => {
    setWarn(false);
    clearTimeout(warnTimer.current);
    clearTimeout(logoutTimer.current);
    warnTimer.current   = setTimeout(() => setWarn(true), INACTIVE_MS - WARN_MS);
    logoutTimer.current = setTimeout(() => signOut({ callbackUrl: "/login" }), INACTIVE_MS);
  }, []);

  useEffect(() => {
    if (!session) return;

    resetTimers();
    EVENTS.forEach((e) => window.addEventListener(e, resetTimers, { passive: true }));

    return () => {
      clearTimeout(warnTimer.current);
      clearTimeout(logoutTimer.current);
      EVENTS.forEach((e) => window.removeEventListener(e, resetTimers));
    };
  }, [session, resetTimers]);

  if (!session || !warn) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="inactivity-title"
      className="fixed inset-0 z-[200] flex items-end justify-center px-4 pb-6 sm:items-center sm:pb-0 bg-black/40 backdrop-blur-sm"
    >
      <div className="w-full max-w-sm rounded-xl border bg-card p-6 shadow-xl space-y-4">
        <div>
          <h2 id="inactivity-title" className="font-semibold">
            Session expiring
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            You&apos;ve been inactive for 55&nbsp;minutes. Your session will
            close automatically in 5&nbsp;minutes.
          </p>
        </div>
        <div className="flex gap-2">
          <Button
            variant="outline"
            className="flex-1"
            onClick={() => signOut({ callbackUrl: "/login" })}
          >
            Sign out
          </Button>
          <Button className="flex-1" onClick={resetTimers}>
            Continue session
          </Button>
        </div>
      </div>
    </div>
  );
}
