"use client";

import { useState } from "react";
import { CalendarDays, X } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

interface DateRange {
  from: string;
  to: string;
}

interface Props {
  value: DateRange;
  onChange: (range: DateRange) => void;
  className?: string;
}

function formatDisplay(date: string): string {
  const d = new Date(date + "T00:00:00");
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

export function DateRangePicker({ value, onChange, className }: Props) {
  const [open, setOpen] = useState(false);
  const hasFrom = !!value.from;
  const hasTo = !!value.to;
  const hasAny = hasFrom || hasTo;

  let label = "All dates";
  if (hasFrom && hasTo) {
    label = `${formatDisplay(value.from)} – ${formatDisplay(value.to)}`;
  } else if (hasFrom) {
    label = `From ${formatDisplay(value.from)}`;
  } else if (hasTo) {
    label = `Until ${formatDisplay(value.to)}`;
  }

  const clear = (e: React.MouseEvent) => {
    e.stopPropagation();
    onChange({ from: "", to: "" });
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          className={cn(
            "h-9 gap-1.5 text-sm font-normal",
            hasAny ? "text-foreground" : "text-muted-foreground",
            className
          )}
        >
          <CalendarDays className="h-3.5 w-3.5 shrink-0" />
          <span className="max-w-52 truncate">{label}</span>
          {hasAny && (
            <X
              className="h-3 w-3 ml-0.5 shrink-0 opacity-50 hover:opacity-100"
              onClick={clear}
            />
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-60 p-4" align="start">
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label className="text-xs">From</Label>
            <Input
              type="date"
              value={value.from}
              max={value.to || undefined}
              onChange={(e) => onChange({ ...value, from: e.target.value })}
            />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">To</Label>
            <Input
              type="date"
              value={value.to}
              min={value.from || undefined}
              onChange={(e) => onChange({ ...value, to: e.target.value })}
            />
          </div>
          {hasAny && (
            <Button
              variant="ghost"
              size="sm"
              className="w-full text-muted-foreground"
              onClick={() => {
                onChange({ from: "", to: "" });
                setOpen(false);
              }}
            >
              Clear
            </Button>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
