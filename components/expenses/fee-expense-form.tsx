"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { parseToCents } from "@/lib/currency";
import { toast } from "sonner";

interface Props {
  onSuccess: () => void;
  onCancel: () => void;
}

export function FeeExpenseForm({ onSuccess, onCancel }: Props) {
  const [name, setName] = useState("");
  const [paidAt, setPaidAt] = useState("");
  const [amount, setAmount] = useState("");
  const [notes, setNotes] = useState("");
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !paidAt || !amount) return;

    const amount_cents = parseToCents(amount);
    if (amount_cents <= 0) {
      toast.error("Amount must be greater than 0");
      return;
    }

    setLoading(true);
    try {
      const res = await fetch("/api/fee-payments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          paid_at: paidAt,
          amount_cents,
          notes: notes.trim() || null,
        }),
      });
      if (!res.ok) throw new Error("Failed to create fee");
      toast.success("Fee added");
      onSuccess();
    } catch {
      toast.error("Failed to add fee");
    } finally {
      setLoading(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="space-y-1.5">
        <Label htmlFor="fee-name">Name</Label>
        <Input
          id="fee-name"
          placeholder="e.g. Platform fee"
          value={name}
          onChange={(e) => setName(e.target.value)}
          required
        />
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-1.5">
          <Label htmlFor="fee-amount">Amount (USD)</Label>
          <Input
            id="fee-amount"
            type="number"
            step="0.01"
            min="0.01"
            placeholder="0.00"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            required
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="fee-date">Date</Label>
          <Input
            id="fee-date"
            type="date"
            value={paidAt}
            onChange={(e) => setPaidAt(e.target.value)}
            required
          />
        </div>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="fee-notes">Notes</Label>
        <Input
          id="fee-notes"
          placeholder="Optional"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
        />
      </div>

      <div className="flex justify-end gap-2 pt-1">
        <Button type="button" variant="outline" onClick={onCancel} disabled={loading}>
          Cancel
        </Button>
        <Button type="submit" disabled={loading}>
          {loading ? "Saving..." : "Save"}
        </Button>
      </div>
    </form>
  );
}
