"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Pencil, Trash2, Plus } from "lucide-react";

interface Client {
  id: string;
  name: string;
  color_hex: string;
}

interface ClientManagerProps {
  clients: Client[];
  onRefresh: () => Promise<void>;
}

export function ClientManager({ clients, onRefresh }: ClientManagerProps) {
  const [open, setOpen] = useState(false);
  const [editClient, setEditClient] = useState<Client | null>(null);
  const [name, setName] = useState("");
  const [color, setColor] = useState("#6366f1");
  const [loading, setLoading] = useState(false);

  const openCreate = () => {
    setEditClient(null);
    setName("");
    setColor("#6366f1");
    setOpen(true);
  };

  const openEdit = (c: Client) => {
    setEditClient(c);
    setName(c.name);
    setColor(c.color_hex);
    setOpen(true);
  };

  const handleSubmit = async () => {
    if (!name.trim()) return;
    setLoading(true);
    try {
      if (editClient) {
        await fetch(`/api/clients/${editClient.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name, color_hex: color }),
        });
      } else {
        await fetch("/api/clients", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name, color_hex: color }),
        });
      }
      await onRefresh();
      setOpen(false);
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm("Delete this client?")) return;
    const res = await fetch(`/api/clients/${id}`, { method: "DELETE" });
    if (!res.ok) {
      const err = await res.json();
      alert(err.error ?? "Cannot delete client");
      return;
    }
    await onRefresh();
  };

  return (
    <>
      <Button variant="outline" onClick={openCreate}>
        <Plus className="mr-2 h-4 w-4" /> Manage Clients
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>
              {editClient ? "Edit Client" : "Clients"}
            </DialogTitle>
          </DialogHeader>

          {!editClient && (
            <div className="space-y-2 mb-4">
              {clients.map((c) => (
                <div
                  key={c.id}
                  className="flex items-center gap-2 rounded border px-3 py-2"
                >
                  <span
                    className="inline-block h-3 w-3 rounded-full shrink-0"
                    style={{ backgroundColor: c.color_hex }}
                  />
                  <span className="flex-1 text-sm">{c.name}</span>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7"
                    onClick={() => openEdit(c)}
                  >
                    <Pencil className="h-3.5 w-3.5" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7 text-destructive"
                    onClick={() => handleDelete(c.id)}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              ))}
              {clients.length === 0 && (
                <p className="text-sm text-muted-foreground text-center py-4">
                  No clients yet.
                </p>
              )}
            </div>
          )}

          <div className="space-y-3">
            <div>
              <label className="text-sm font-medium">
                {editClient ? "Name" : "New client name"}
              </label>
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Acme Corp"
                className="mt-1"
              />
            </div>
            <div>
              <label className="text-sm font-medium">Color</label>
              <div className="flex items-center gap-2 mt-1">
                <input
                  type="color"
                  value={color}
                  onChange={(e) => setColor(e.target.value)}
                  className="h-9 w-16 rounded border cursor-pointer"
                />
                <Input
                  value={color}
                  onChange={(e) => setColor(e.target.value)}
                  className="flex-1"
                />
              </div>
            </div>
            <div className="flex gap-2">
              {editClient && (
                <Button
                  variant="outline"
                  onClick={() => setEditClient(null)}
                  className="flex-1"
                >
                  Back
                </Button>
              )}
              <Button onClick={handleSubmit} disabled={loading} className="flex-1">
                {loading ? "Saving..." : editClient ? "Update" : "Add Client"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
