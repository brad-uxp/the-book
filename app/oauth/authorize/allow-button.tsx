"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";

/** How long the page must have had the focus before Allow can be pressed. */
const ARM_AFTER_MS = 700;

/**
 * Allow, armed only once the page has been visible and focused for a moment.
 * Against double-clickjacking: another site gets the owner to double-click,
 * the first click opens this page under the pointer and the second lands on
 * Allow. Frames are already refused (frame-ancestors 'none'); this covers a
 * top-level window, where they are no help. Losing the focus disarms it.
 */
export function AllowButton() {
  const [armed, setArmed] = useState(false);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const arm = () => {
      clearTimeout(timer);
      if (document.visibilityState === "visible" && document.hasFocus()) {
        timer = setTimeout(() => setArmed(true), ARM_AFTER_MS);
      }
    };
    const disarm = () => {
      clearTimeout(timer);
      setArmed(false);
    };
    arm();
    window.addEventListener("focus", arm);
    window.addEventListener("blur", disarm);
    document.addEventListener("visibilitychange", arm);
    return () => {
      clearTimeout(timer);
      window.removeEventListener("focus", arm);
      window.removeEventListener("blur", disarm);
      document.removeEventListener("visibilitychange", arm);
    };
  }, []);

  return (
    <Button type="submit" name="decision" value="allow" className="flex-1" disabled={!armed}>
      Allow
    </Button>
  );
}
