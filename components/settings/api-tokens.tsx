"use client";

import { useCallback, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
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
import { KeyRound, Loader2, Copy, Check, Trash2 } from "lucide-react";
import { formatDate } from "@/lib/dates";
import { usePolling } from "@/hooks/use-polling";

interface ApiToken {
  id: string;
  name: string;
  token_prefix: string;
  created_at: string;
  last_used_at: string | null;
  expires_at: string | null;
  revoked_at: string | null;
}

const DEFAULT_EXPIRY_DAYS = 90;

function statusOf(t: ApiToken): { label: string; variant: "default" | "secondary" | "destructive" } {
  if (t.revoked_at) return { label: "Revocado", variant: "destructive" };
  if (t.expires_at && new Date(t.expires_at) <= new Date())
    return { label: "Expirado", variant: "destructive" };
  return { label: "Activo", variant: "default" };
}

export function ApiTokens() {
  const [tokens, setTokens] = useState<ApiToken[]>([]);
  const [name, setName] = useState("");
  const [days, setDays] = useState(String(DEFAULT_EXPIRY_DAYS));
  const [creating, setCreating] = useState(false);
  const [freshToken, setFreshToken] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const load = useCallback(async (signal: AbortSignal) => {
    const res = await fetch("/api/settings/tokens", { signal });
    if (!res.ok) throw new Error(`tokens request failed: ${res.status}`);
    setTokens(await res.json());
  }, []);

  const refresh = usePolling(load, null);

  const create = async () => {
    if (!name.trim()) {
      toast.error("Ponele un nombre al token");
      return;
    }
    setCreating(true);
    try {
      const res = await fetch("/api/settings/tokens", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          expires_in_days: Number(days) || DEFAULT_EXPIRY_DAYS,
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        toast.error(err.error?.formErrors?.[0] ?? "No se pudo crear el token");
        return;
      }
      const created = await res.json();
      setFreshToken(created.token);
      setCopied(false);
      setName("");
      refresh();
    } finally {
      setCreating(false);
    }
  };

  const revoke = async (id: string) => {
    const res = await fetch(`/api/settings/tokens/${id}`, { method: "DELETE" });
    if (!res.ok) {
      toast.error("No se pudo revocar");
      return;
    }
    toast.success("Token revocado");
    refresh();
  };

  const copy = async () => {
    if (!freshToken) return;
    await navigator.clipboard.writeText(freshToken);
    setCopied(true);
    toast.success("Copiado");
  };

  return (
    <div className="rounded-md border bg-card p-6 space-y-4 max-w-lg">
      <div>
        <h2 className="text-sm font-semibold">Tokens de API</h2>
        <p className="text-xs text-muted-foreground mt-0.5">
          Credenciales para clientes que no son el navegador. Tienen el mismo
          acceso que vos, así que revocá el que no uses.
        </p>
      </div>

      {/* Shown once: the server never returns the secret again. */}
      {freshToken && (
        <div className="rounded-md border border-amber-500/50 bg-amber-50 dark:bg-amber-950/30 p-3 space-y-2">
          <p className="text-xs font-medium">
            Copialo ahora — no se vuelve a mostrar.
          </p>
          <div className="flex items-center gap-2">
            <code className="flex-1 truncate rounded bg-background px-2 py-1.5 text-xs font-mono">
              {freshToken}
            </code>
            <Button type="button" size="sm" variant="outline" onClick={copy}>
              {copied ? (
                <Check className="h-3.5 w-3.5" />
              ) : (
                <Copy className="h-3.5 w-3.5" />
              )}
            </Button>
          </div>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            className="h-7 text-xs"
            onClick={() => setFreshToken(null)}
          >
            Ya lo guardé
          </Button>
        </div>
      )}

      <div className="flex items-end gap-2">
        <div className="flex-1 space-y-1.5">
          <Label htmlFor="token_name">Nombre</Label>
          <Input
            id="token_name"
            placeholder="claude-work-session"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </div>
        <div className="w-24 space-y-1.5">
          <Label htmlFor="token_days">Días</Label>
          <Input
            id="token_days"
            type="number"
            min={1}
            max={365}
            value={days}
            onChange={(e) => setDays(e.target.value)}
          />
        </div>
        <Button type="button" onClick={create} disabled={creating}>
          {creating ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <KeyRound className="h-4 w-4" />
          )}
          <span className="ml-1.5">Crear</span>
        </Button>
      </div>

      {tokens.length === 0 ? (
        <p className="text-xs text-muted-foreground">
          Todavía no hay tokens.
        </p>
      ) : (
        <ul className="divide-y rounded-md border">
          {tokens.map((t) => {
            const status = statusOf(t);
            return (
              <li key={t.id} className="flex items-center gap-3 p-3">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="truncate text-sm font-medium">{t.name}</span>
                    <Badge variant={status.variant} className="text-[10px]">
                      {status.label}
                    </Badge>
                  </div>
                  <p className="mt-0.5 font-mono text-[11px] text-muted-foreground">
                    {t.token_prefix}…
                  </p>
                  <p className="text-[11px] text-muted-foreground">
                    {t.last_used_at
                      ? `Último uso: ${formatDate(t.last_used_at)}`
                      : "Sin uso todavía"}
                    {t.expires_at ? ` · Expira ${formatDate(t.expires_at)}` : ""}
                  </p>
                </div>

                {!t.revoked_at && (
                  <AlertDialog>
                    <AlertDialogTrigger asChild>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 text-muted-foreground hover:text-destructive"
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </AlertDialogTrigger>
                    <AlertDialogContent>
                      <AlertDialogHeader>
                        <AlertDialogTitle>Revocar “{t.name}”</AlertDialogTitle>
                        <AlertDialogDescription>
                          Cualquier cliente que lo use deja de tener acceso al
                          instante. No se puede deshacer.
                        </AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel>Cancelar</AlertDialogCancel>
                        <AlertDialogAction onClick={() => revoke(t.id)}>
                          Revocar
                        </AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
