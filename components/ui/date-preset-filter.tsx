"use client";

import { useState } from "react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { Check, ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";

export type DatePreset = "year" | "month" | "custom" | "all";

interface Props {
  preset: DatePreset;
  customFrom: string;
  customTo: string;
  onPresetChange: (p: DatePreset) => void;
  onCustomFromChange: (v: string) => void;
  onCustomToChange: (v: string) => void;
  /** "date" (default) uses day pickers; "month" uses month pickers */
  mode?: "date" | "month";
  className?: string;
}

function fmtDateLabel(s: string) {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleString("en", { month: "short", day: "numeric" });
}

function fmtMonthLabel(s: string) {
  const [y, m] = s.split("-").map(Number);
  return new Date(y, m - 1, 1).toLocaleString("en", { month: "short", year: "numeric" });
}

export function DatePresetFilter({
  preset,
  customFrom,
  customTo,
  onPresetChange,
  onCustomFromChange,
  onCustomToChange,
  mode = "date",
  className,
}: Props) {
  const [open, setOpen] = useState(false);
  const isMonth = mode === "month";
  const fmtLabel = isMonth ? fmtMonthLabel : fmtDateLabel;

  const now = new Date();
  const label = (() => {
    if (preset === "year") return String(now.getFullYear());
    if (preset === "month") return now.toLocaleString("en", { month: "short", year: "numeric" });
    if (preset === "all") return "All time";
    if (customFrom && customTo) return `${fmtLabel(customFrom)} – ${fmtLabel(customTo)}`;
    if (customFrom) return `From ${fmtLabel(customFrom)}`;
    if (customTo) return `To ${fmtLabel(customTo)}`;
    return "Custom range";
  })();

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          className={cn("h-9 w-full justify-between gap-1 font-normal sm:w-auto sm:min-w-32", className)}
        >
          <span className="truncate">{label}</span>
          <ChevronDown className="h-3.5 w-3.5 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-56 p-1">
        {([
          { key: "month",  label: "This month" },
          { key: "year",   label: "This year" },
          { key: "custom", label: "Custom range" },
          { key: "all",    label: "All time" },
        ] as { key: DatePreset; label: string }[]).map(({ key, label: optLabel }) => (
          <button
            key={key}
            onClick={() => {
              onPresetChange(key);
              if (key !== "custom") setOpen(false);
            }}
            className={cn(
              "flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-sm transition-colors hover:bg-accent hover:text-accent-foreground",
              preset === key && "font-medium"
            )}
          >
            <Check className={cn("h-3.5 w-3.5 shrink-0", preset === key ? "opacity-100" : "opacity-0")} />
            {optLabel}
          </button>
        ))}

        {preset === "custom" && (
          <div className="mt-1 border-t pt-2 px-1 space-y-2">
            <div className="space-y-1">
              <p className="text-xs text-muted-foreground">From</p>
              <input
                type={isMonth ? "month" : "date"}
                value={customFrom}
                onChange={(e) => onCustomFromChange(e.target.value)}
                className="h-8 w-full rounded-md border bg-background px-2 text-xs text-foreground"
              />
            </div>
            <div className="space-y-1">
              <p className="text-xs text-muted-foreground">To</p>
              <input
                type={isMonth ? "month" : "date"}
                value={customTo}
                onChange={(e) => onCustomToChange(e.target.value)}
                className="h-8 w-full rounded-md border bg-background px-2 text-xs text-foreground"
              />
            </div>
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}
