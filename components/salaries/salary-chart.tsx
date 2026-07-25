"use client";

import { useMemo, useState } from "react";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
import { formatCents } from "@/lib/currency";
import { cn } from "@/lib/utils";

interface SalaryPayment {
  due_date: string;
  total_cents: number;
}

interface Person {
  id: string;
  name: string;
  status: "active" | "inactive";
  salary_payments: SalaryPayment[];
}

const PALETTE = [
  "#f97316", "#ef4444", "#ec4899", "#f59e0b", "#e11d48", "#d946ef",
  "#a855f7", "#6366f1", "#14b8a6", "#84cc16", "#06b6d4", "#8b5cf6",
];
const TOTAL_COLOR = "#64748b";

const MONTH_LABELS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

interface LineConfig {
  key: string;
  label: string;
  color: string;
}

 
function SalaryTooltip({ active, payload, label, lines }: any) {
  if (!active || !payload?.length) return null;
  const visibleLines = (lines as LineConfig[]).filter(({ key }) => {
    const entry = payload.find((p: { dataKey: string }) => p.dataKey === key);
    return entry && entry.value > 0;
  });
  if (visibleLines.length === 0) return null;
  return (
    <div className="rounded-lg border bg-card px-3 py-2 text-sm shadow-md">
      <p className="mb-1.5 font-medium">{label}</p>
      {visibleLines.map(({ key, label: name, color }) => {
        const entry = payload.find((p: { dataKey: string }) => p.dataKey === key);
        return (
          <p key={key} style={{ color }}>
            {name}: <span className="font-semibold">{formatCents(entry.value)}</span>
          </p>
        );
      })}
    </div>
  );
}

interface Props {
  data: Person[];
}

export function SalaryChart({ data }: Props) {
  const currentYear = new Date().getFullYear();
  const currentMonth = new Date().getMonth(); // 0-indexed

  const { lines, chartData } = useMemo(() => {
    const yearStr = String(currentYear);

    // People with at least one payment this year (active or inactive)
    const activePeople = data.filter((p) =>
      p.salary_payments.some((sp) => sp.due_date.startsWith(yearStr))
    );

    // Build person lines
    const personLines: LineConfig[] = activePeople.map((p, i) => ({
      key: p.id,
      label: p.name,
      color: PALETTE[i % PALETTE.length],
    }));

    const allLines: LineConfig[] = [
      ...personLines,
      { key: "total", label: "Total", color: TOTAL_COLOR },
    ];

    // Bucket payments by "YYYY-MM" per person
    const buckets = new Map<string, Map<string, number>>();
    for (const person of activePeople) {
      const personMap = new Map<string, number>();
      for (const sp of person.salary_payments) {
        const key = sp.due_date.slice(0, 7); // "YYYY-MM"
        if (!key.startsWith(yearStr)) continue;
        personMap.set(key, (personMap.get(key) ?? 0) + sp.total_cents);
      }
      buckets.set(person.id, personMap);
    }

    // Build chart data — one point per month up to current month
    const points: Record<string, string | number>[] = [];
    for (let m = 0; m <= currentMonth; m++) {
      const monthKey = `${yearStr}-${String(m + 1).padStart(2, "0")}`;
      const point: Record<string, string | number> = { label: MONTH_LABELS[m] };
      let total = 0;
      for (const person of activePeople) {
        const val = buckets.get(person.id)?.get(monthKey) ?? 0;
        point[person.id] = val;
        total += val;
      }
      point.total = total;
      points.push(point);
    }

    return { lines: allLines, chartData: points };
  }, [data, currentYear, currentMonth]);

  // Toggle visibility — all visible by default
  const [overrides, setOverrides] = useState<Record<string, boolean>>({});
  const isVisible = (key: string) => overrides[key] ?? true;
  const toggle = (key: string) =>
    setOverrides((prev) => ({ ...prev, [key]: !(prev[key] ?? true) }));

  return (
    <div className="rounded-md border bg-card p-4 sm:p-6 space-y-4">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <h2 className="text-sm font-semibold">Salaries — {currentYear}</h2>
        <div className="flex flex-wrap gap-2">
          {lines.map(({ key, label, color }) => (
            <button
              key={key}
              onClick={() => toggle(key)}
              className={cn(
                "flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-medium transition-opacity",
                isVisible(key) ? "opacity-100" : "opacity-35"
              )}
              style={{ borderColor: color, color: isVisible(key) ? color : undefined }}
            >
              <span
                className="inline-block h-2 w-2 rounded-full"
                style={{ background: color }}
              />
              {label}
            </button>
          ))}
        </div>
      </div>

      {chartData.length === 0 ? (
        <p className="py-20 text-center text-sm text-muted-foreground">
          No salary data for {currentYear}.
        </p>
      ) : (
        <div className="h-55 sm:h-75">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart
              data={chartData}
              margin={{ top: 12, right: 12, left: 4, bottom: 12 }}
            >
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
              <XAxis
                dataKey="label"
                tick={{ fontSize: 12, fill: "hsl(var(--muted-foreground))" }}
                tickMargin={12}
                axisLine={false}
                tickLine={false}
                padding={{ left: 20, right: 8 }}
              />
              <YAxis hide />
              <Tooltip content={<SalaryTooltip lines={lines} />} />
              {lines.map(({ key, color }) => (
                <Line
                  key={key}
                  type="monotone"
                  dataKey={key}
                  stroke={color}
                  strokeWidth={key === "total" ? 3 : 2}
                  dot={{ r: key === "total" ? 4 : 3, fill: color }}
                  activeDot={{ r: 5 }}
                  hide={!isVisible(key)}
                  strokeDasharray={key === "total" ? "6 3" : undefined}
                />
              ))}
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
}
