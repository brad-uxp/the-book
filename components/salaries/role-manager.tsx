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
import { Pencil, Trash2, UserCog } from "lucide-react";

interface Role {
  id: string;
  name: string;
}

interface RoleManagerProps {
  roles: Role[];
  onRefresh: () => Promise<void>;
  open?: boolean;
  onOpenChange?: (v: boolean) => void;
}

export function RoleManager({ roles, onRefresh, open: externalOpen, onOpenChange: externalOnOpenChange }: RoleManagerProps) {
  const [internalOpen, setInternalOpen] = useState(false);
  const open = externalOpen ?? internalOpen;
  const setOpen = (v: boolean) => { setInternalOpen(v); externalOnOpenChange?.(v); };
  const [editRole, setEditRole] = useState<Role | null>(null);
  const [name, setName] = useState("");
  const [loading, setLoading] = useState(false);

  const openCreate = () => {
    setEditRole(null);
    setName("");
    setOpen(true);
  };

  const openEdit = (r: Role) => {
    setEditRole(r);
    setName(r.name);
    setOpen(true);
  };

  const handleSubmit = async () => {
    if (!name.trim()) return;
    setLoading(true);
    try {
      if (editRole) {
        await fetch(`/api/roles/${editRole.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: name.trim() }),
        });
      } else {
        await fetch("/api/roles", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: name.trim() }),
        });
      }
      await onRefresh();
      setEditRole(null);
      setName("");
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm("Delete this role?")) return;
    const res = await fetch(`/api/roles/${id}`, { method: "DELETE" });
    if (!res.ok) {
      const err = await res.json();
      alert(err.error ?? "Cannot delete role");
      return;
    }
    await onRefresh();
  };

  return (
    <>
      <Button variant="outline" className="hidden sm:inline-flex" onClick={openCreate}>
        <UserCog className="mr-2 h-4 w-4" /> Manage Roles
      </Button>

      <Dialog open={open} onOpenChange={(o) => { if (!o) { setOpen(false); setEditRole(null); setName(""); } else setOpen(true); }}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>{editRole ? "Edit Role" : "Roles"}</DialogTitle>
          </DialogHeader>

          {!editRole && (
            <div className="max-h-70 overflow-y-auto space-y-2 mb-4 pr-1">
              {roles.map((r) => (
                <div
                  key={r.id}
                  className="flex items-center gap-2 rounded border px-3 py-2"
                >
                  <span className="flex-1 text-sm">{r.name}</span>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7"
                    onClick={() => openEdit(r)}
                  >
                    <Pencil className="h-3.5 w-3.5" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7 text-destructive"
                    onClick={() => handleDelete(r.id)}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              ))}
              {roles.length === 0 && (
                <p className="text-sm text-muted-foreground text-center py-4">
                  No roles yet.
                </p>
              )}
            </div>
          )}

          <div className="space-y-3">
            <div>
              <label className="text-sm font-medium">
                {editRole ? "Name" : "New role name"}
              </label>
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Engineer"
                className="mt-1"
                onKeyDown={(e) => e.key === "Enter" && handleSubmit()}
              />
            </div>
            <div className="flex gap-2">
              {editRole && (
                <Button
                  variant="outline"
                  onClick={() => { setEditRole(null); setName(""); }}
                  className="flex-1"
                >
                  Back
                </Button>
              )}
              <Button onClick={handleSubmit} disabled={loading} className="flex-1">
                {loading ? "Saving..." : editRole ? "Update" : "Add Role"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
