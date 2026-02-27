"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Check, ChevronsUpDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { parseToCents } from "@/lib/currency";
import { toast } from "sonner";

interface Referrer {
  id: string;
  name: string;
  color_hex: string;
}

interface Props {
  referrers: Referrer[];
  onSuccess: () => void;
  onCancel: () => void;
}

export function FeeExpenseForm({ referrers, onSuccess, onCancel }: Props) {
  const [name, setName] = useState("");
  const [paidAt, setPaidAt] = useState("");
  const [amount, setAmount] = useState("");
  const [notes, setNotes] = useState("");
  const [referrerId, setReferrerId] = useState("");
  const [referrerOpen, setReferrerOpen] = useState(false);
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
          referrer_id: referrerId || null,
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
        <Label>Referrer (optional)</Label>
        <Popover open={referrerOpen} onOpenChange={setReferrerOpen}>
          <PopoverTrigger asChild>
            <Button
              variant="outline"
              role="combobox"
              type="button"
              className={cn(
                "w-full justify-between font-normal",
                !referrerId && "text-muted-foreground"
              )}
            >
              {referrerId
                ? (() => {
                    const r = referrers.find((r) => r.id === referrerId);
                    return r ? (
                      <span className="flex items-center gap-1.5 truncate">
                        <span
                          className="inline-block h-2 w-2 rounded-full shrink-0"
                          style={{ backgroundColor: r.color_hex }}
                        />
                        {r.name}
                      </span>
                    ) : "No referrer";
                  })()
                : "No referrer"}
              <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
            </Button>
          </PopoverTrigger>
          <PopoverContent className="p-0" align="start">
            <Command>
              <CommandInput placeholder="Search referrer..." />
              <CommandList>
                <CommandEmpty>No referrer found.</CommandEmpty>
                <CommandGroup>
                  <CommandItem
                    value="__none__"
                    onSelect={() => {
                      setReferrerId("");
                      setReferrerOpen(false);
                    }}
                  >
                    <Check
                      className={cn(
                        "mr-2 h-4 w-4",
                        !referrerId ? "opacity-100" : "opacity-0"
                      )}
                    />
                    <span className="text-muted-foreground">None</span>
                  </CommandItem>
                  {referrers.map((r) => (
                    <CommandItem
                      key={r.id}
                      value={r.name}
                      onSelect={() => {
                        setReferrerId(r.id);
                        setReferrerOpen(false);
                      }}
                    >
                      <Check
                        className={cn(
                          "mr-2 h-4 w-4",
                          r.id === referrerId ? "opacity-100" : "opacity-0"
                        )}
                      />
                      <span
                        className="mr-2 inline-block h-2.5 w-2.5 rounded-full shrink-0"
                        style={{ backgroundColor: r.color_hex }}
                      />
                      {r.name}
                    </CommandItem>
                  ))}
                </CommandGroup>
              </CommandList>
            </Command>
          </PopoverContent>
        </Popover>
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
