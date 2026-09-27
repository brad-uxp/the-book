"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";

interface Client {
  id: string;
  name: string;
  color_hex: string;
}

interface Props {
  clients: Client[];
  initial: string[];
}

/**
 * Which clients' income is left out of corporate profitability.
 *
 * Saved in Settings and read by both the dashboard's corporate chart and
 * GET /api/metrics, so the web and the mobile app always show the same
 * corporate net and the same partner split.
 */
export function CorporateExclusions({ clients, initial }: Props) {
  const [saved, setSaved] = useState<string[]>(initial);
  const [selected, setSelected] = useState<Set<string>>(new Set(initial));
  const [saving, setSaving] = useState(false);

  const dirty =
    selected.size !== saved.length || saved.some((id) => !selected.has(id));

  const toggle = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const save = async () => {
    setSaving(true);
    try {
      const ids = [...selected];
      const res = await fetch("/api/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ corporate_excluded_client_ids: ids }),
      });
      if (!res.ok) throw new Error(`PATCH settings ${res.status}`);
      setSaved(ids);
      toast.success("Corporate profitability updated");
    } catch (err) {
      console.error(err);
      toast.error("Could not save the excluded clients");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="max-w-lg space-y-4 rounded-md border bg-card p-6">
      <div>
        <h2 className="text-sm font-semibold">Corporate profitability</h2>
        <p className="mt-0.5 text-xs text-muted-foreground">
          Clients whose income is left out of corporate profitability and the
          60/40 partner split, on the dashboard and in the mobile app.
        </p>
      </div>

      {clients.length === 0 ? (
        <p className="text-sm text-muted-foreground">No clients yet.</p>
      ) : (
        <div className="grid gap-1 sm:grid-cols-2">
          {clients.map((c) => (
            <label
              key={c.id}
              className="flex cursor-pointer items-center gap-2 rounded-sm px-2 py-1.5 hover:bg-accent"
            >
              <Checkbox
                id={`exclude-${c.id}`}
                checked={selected.has(c.id)}
                onCheckedChange={() => toggle(c.id)}
              />
              <span
                className="inline-block h-2 w-2 shrink-0 rounded-full"
                style={{ background: c.color_hex }}
              />
              <span className="truncate text-sm">{c.name}</span>
            </label>
          ))}
        </div>
      )}

      <Button type="button" onClick={save} disabled={!dirty || saving}>
        {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
        Save excluded clients
      </Button>
    </div>
  );
}
