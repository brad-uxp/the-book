"use client";

import { useState } from "react";
import { CalendarDays, ChevronLeft, ChevronRight } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";

// Safari on macOS has no <input type="month"> — it degrades to a plain text
// box — so month fields use this popover instead. Values are "YYYY-MM", the
// same string the native input produced.

const MONTH_LABELS = Array.from({ length: 12 }, (_, i) =>
  new Date(2000, i, 1).toLocaleString("en", { month: "short" })
);

function toMonthStr(year: number, monthIndex: number): string {
  return `${year}-${String(monthIndex + 1).padStart(2, "0")}`;
}

function formatMonthLabel(value: string): string {
  const [y, m] = value.split("-").map(Number);
  return new Date(y, m - 1, 1).toLocaleString("en", { month: "short", year: "numeric" });
}

interface MonthPickerProps
  extends Omit<React.ComponentProps<"button">, "value" | "onChange"> {
  /** Selected month as "YYYY-MM", or "" for none */
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  /** Show a "Clear" action that sets the value back to "" */
  clearable?: boolean;
}

export function MonthPicker({
  value,
  onChange,
  placeholder = "Pick a month",
  clearable = false,
  className,
  ...buttonProps
}: MonthPickerProps) {
  const [open, setOpen] = useState(false);
  const now = new Date();
  const selectedYear = value ? Number(value.slice(0, 4)) : now.getFullYear();
  const [viewYear, setViewYear] = useState(selectedYear);
  const currentMonth = toMonthStr(now.getFullYear(), now.getMonth());

  return (
    <Popover
      open={open}
      onOpenChange={(o) => {
        // Reopen on the selected year, not wherever the user last browsed to
        if (o) setViewYear(selectedYear);
        setOpen(o);
      }}
    >
      <PopoverTrigger asChild>
        <button
          type="button"
          className={cn(
            "border-input dark:bg-input/30 flex h-9 w-full min-w-0 items-center gap-2 rounded-md border bg-transparent px-3 py-1 text-left text-base shadow-xs transition-[color,box-shadow] outline-none disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50 md:text-sm",
            "focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px]",
            "aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 aria-invalid:border-destructive",
            className
          )}
          {...buttonProps}
        >
          <span className={cn("flex-1 truncate", !value && "text-muted-foreground")}>
            {value ? formatMonthLabel(value) : placeholder}
          </span>
          <CalendarDays className="h-4 w-4 shrink-0 opacity-50" />
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-auto p-3" align="start">
        <div className="w-[216px] select-none">
          <div className="flex items-center justify-between mb-2">
            <button
              type="button"
              aria-label="Previous year"
              onClick={() => setViewYear((y) => y - 1)}
              className="p-1 rounded hover:bg-accent transition-colors"
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
            <span className="text-sm font-medium">{viewYear}</span>
            <button
              type="button"
              aria-label="Next year"
              onClick={() => setViewYear((y) => y + 1)}
              className="p-1 rounded hover:bg-accent transition-colors"
            >
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>

          <div className="grid grid-cols-3 gap-1">
            {MONTH_LABELS.map((label, i) => {
              const monthStr = toMonthStr(viewYear, i);
              const isSelected = monthStr === value;
              const isCurrent = monthStr === currentMonth;
              return (
                <button
                  key={monthStr}
                  type="button"
                  onClick={() => {
                    onChange(monthStr);
                    setOpen(false);
                  }}
                  className={cn(
                    "h-8 rounded text-sm transition-colors",
                    isSelected
                      ? "bg-primary text-primary-foreground font-medium"
                      : isCurrent
                      ? "bg-accent font-medium"
                      : "hover:bg-accent"
                  )}
                >
                  {label}
                </button>
              );
            })}
          </div>

          {clearable && value && (
            <div className="mt-2 pt-2 border-t">
              <button
                type="button"
                onClick={() => {
                  onChange("");
                  setOpen(false);
                }}
                className="w-full py-1.5 rounded text-xs text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
              >
                Clear
              </button>
            </div>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
