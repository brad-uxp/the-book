"use client";

import { useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";

const DAY_LABELS = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"];

interface MiniCalendarProps {
  /** Currently selected date (YYYY-MM-DD string or null) */
  value: string | null;
  /** Called when the user clicks a day */
  onSelect: (dateStr: string) => void;
  /** Called when the user clears the date */
  onClear?: () => void;
}

/** Returns YYYY-MM-DD for a local Date */
function toDateStr(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function MiniCalendar({ value, onSelect, onClear }: MiniCalendarProps) {
  const today = new Date();
  const initial = value
    ? new Date(value + "T00:00:00")
    : today;

  const [viewYear, setViewYear] = useState(initial.getFullYear());
  const [viewMonth, setViewMonth] = useState(initial.getMonth());

  const firstOfMonth = new Date(viewYear, viewMonth, 1);
  const startDay = firstOfMonth.getDay(); // 0=Sun
  const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate();

  const prevMonth = () => {
    if (viewMonth === 0) {
      setViewMonth(11);
      setViewYear(viewYear - 1);
    } else {
      setViewMonth(viewMonth - 1);
    }
  };

  const nextMonth = () => {
    if (viewMonth === 11) {
      setViewMonth(0);
      setViewYear(viewYear + 1);
    } else {
      setViewMonth(viewMonth + 1);
    }
  };

  const monthLabel = firstOfMonth.toLocaleString("default", {
    month: "long",
    year: "numeric",
  });

  const cells: (number | null)[] = [];
  for (let i = 0; i < startDay; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(d);

  const todayStr = toDateStr(today);

  return (
    <div className="w-[252px] select-none">
      {/* Header */}
      <div className="flex items-center justify-between mb-2">
        <button
          type="button"
          onClick={prevMonth}
          className="p-1 rounded hover:bg-accent transition-colors"
        >
          <ChevronLeft className="h-4 w-4" />
        </button>
        <span className="text-sm font-medium">{monthLabel}</span>
        <button
          type="button"
          onClick={nextMonth}
          className="p-1 rounded hover:bg-accent transition-colors"
        >
          <ChevronRight className="h-4 w-4" />
        </button>
      </div>

      {/* Day labels */}
      <div className="grid grid-cols-7 mb-1">
        {DAY_LABELS.map((l) => (
          <div
            key={l}
            className="text-center text-[11px] font-medium text-muted-foreground py-1"
          >
            {l}
          </div>
        ))}
      </div>

      {/* Day grid */}
      <div className="grid grid-cols-7">
        {cells.map((day, i) => {
          if (day === null) {
            return <div key={`empty-${i}`} />;
          }

          const dateStr = toDateStr(new Date(viewYear, viewMonth, day));
          const isSelected = dateStr === value?.slice(0, 10);
          const isToday = dateStr === todayStr;

          return (
            <button
              key={dateStr}
              type="button"
              onClick={() => onSelect(dateStr)}
              className={cn(
                "h-8 w-8 mx-auto rounded text-sm transition-colors",
                isSelected
                  ? "bg-primary text-primary-foreground font-medium"
                  : isToday
                  ? "bg-accent font-medium"
                  : "hover:bg-accent"
              )}
            >
              {day}
            </button>
          );
        })}
      </div>

      {/* Clear button */}
      {onClear && value && (
        <div className="mt-2 pt-2 border-t">
          <button
            type="button"
            onClick={onClear}
            className="w-full py-1.5 rounded text-xs text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
          >
            Clear date
          </button>
        </div>
      )}
    </div>
  );
}
