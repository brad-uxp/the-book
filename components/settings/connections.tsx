"use client";

import { useCallback, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Plug, Trash2 } from "lucide-react";
import { formatDate } from "@/lib/dates";
import { usePolling } from "@/hooks/use-polling";

interface Connection {
  id: string;
  client_name: string;
  redirect_uri: string;
  created_at: string;
  last_used_at: string | null;
}

/** Where a connection hands its access: Claude's apps, or Claude Code on a machine. */
function surface(redirectUri: string): string {
  try {
    const url = new URL(redirectUri);
    return url.hostname === "claude.ai" ? "claude.ai, Desktop and mobile" : "Claude Code on a computer";
  } catch {
    return "";
  }
}

/**
 * The apps connected to book's MCP through OAuth (lib/oauth-service.ts):
 * each one an approval on the consent screen. Disconnecting revokes it and
 * every token it holds; its next call is refused.
 */
export function Connections() {
  const [connections, setConnections] = useState<Connection[] | null>(null);

  const load = useCallback(async (signal: AbortSignal) => {
    const res = await fetch("/api/settings/connections", { signal });
    if (!res.ok) throw new Error(`connections request failed: ${res.status}`);
    setConnections(await res.json());
  }, []);

  const refresh = usePolling(load, null);

  const disconnect = async (id: string) => {
    const res = await fetch(`/api/settings/connections/${id}`, { method: "DELETE" });
    if (!res.ok) {
      toast.error("Could not disconnect it");
      return;
    }
    toast.success("Disconnected");
    refresh();
  };

  return (
    <div className="rounded-md border bg-card p-6 space-y-4 max-w-lg">
      <div>
        <h2 className="text-sm font-semibold">Connected apps</h2>
        <p className="text-xs text-muted-foreground mt-0.5">
          Claude, connected to book&apos;s MCP. It works your tasks as an agent:
          reads them, writes its note, log and progress, and moves them to In
          Progress, Review or Blocked — never to Done. Add it in Claude as a
          connector with the URL <span className="font-mono">https://book.bolstro.com/api/mcp</span>.
        </p>
      </div>

      {connections !== null && connections.length === 0 ? (
        <p className="text-xs text-muted-foreground">Nothing connected.</p>
      ) : (
        <ul className="divide-y rounded-md border">
          {(connections ?? []).map((c) => (
            <li key={c.id} className="flex items-center gap-3 px-3 py-2.5">
              <Plug className="h-4 w-4 shrink-0 text-muted-foreground" />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{c.client_name}</p>
                <p className="text-[11px] text-muted-foreground">{surface(c.redirect_uri)}</p>
                <p className="text-[11px] text-muted-foreground">
                  Connected {formatDate(c.created_at)}
                  {c.last_used_at ? ` · Last used ${formatDate(c.last_used_at)}` : ""}
                </p>
              </div>
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 text-muted-foreground hover:text-destructive"
                    aria-label={`Disconnect ${c.client_name}`}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Disconnect “{c.client_name}”?</AlertDialogTitle>
                    <AlertDialogDescription>
                      It loses access right away. To use it again, connect it from Claude.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Cancel</AlertDialogCancel>
                    <AlertDialogAction onClick={() => disconnect(c.id)}>Disconnect</AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
