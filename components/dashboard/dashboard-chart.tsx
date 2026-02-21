"use client";

import { useState, useMemo } from "react";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from "recharts";
import { formatCents } from "@/lib/currency";
import { cn } from "@/lib/utils";

const COLOR_INCOME = "#3b82f6";   // blue-500
const COLOR_EXPENSES = "#94a3b8"; // slate-400

type Preset = "1y" | "ytd" | "all";

const PRESETS: { key: Preset; label: string }[] = [
  { key: "1y",  label: "Last year" },
  { key: "ytd", label: "This year" },
  { key: "all", label: "All time" },
];

function toPeriodKey(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

function getRange(preset: Preset): { from: string; to: string } {
  const now = new Date();
  const to = toPeriodKey(now);
  switch (preset) {
    case "1y":
      return { from: toPeriodKey(new Date(now.getFullYear(), now.getMonth() - 11, 1)), to };
    case "ytd":
      return { from: `${now.getFullYear()}-01`, to };
    case "all":
      return { from: "", to }; // handled separately — trim empty edges
  }
}

function shortMonth(periodKey: string) {
  const [y, m] = periodKey.split("-");
  return new Date(parseInt(y), parseInt(m) - 1).toLocaleString("en", {
    month: "short",
    year: "2-digit",
  });
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function CustomTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null;
  const income   = payload.find((p: { dataKey: string }) => p.dataKey === "income");
  const expenses = payload.find((p: { dataKey: string }) => p.dataKey === "expenses");
  return (
    <div className="rounded-lg border bg-card px-3 py-2 text-sm shadow-md">
      <p className="mb-1 font-medium">{label}</p>
      {income && (
        <p style={{ color: COLOR_INCOME }}>
          Income:{" "}
          <span className="font-semibold">{formatCents(income.value)}</span>
        </p>
      )}
      {expenses && (
        <p style={{ color: COLOR_EXPENSES }}>
          Expenses:{" "}
          <span className="font-semibold">{formatCents(expenses.value)}</span>
        </p>
      )}
      {income && expenses && (
        <p className="mt-1 border-t pt-1 text-muted-foreground">
          Net:{" "}
          <span className="font-semibold text-foreground">
            {formatCents(income.value - expenses.value)}
          </span>
        </p>
      )}
    </div>
  );
}

interface MonthData {
  month: string;
  expenses: number;
  income: number;
}

interface Props {
  data: MonthData[];
}

export function DashboardChart({ data }: Props) {
  const [preset, setPreset] = useState<Preset>("1y");

  const filtered = useMemo(() => {
    let subset: MonthData[];

    if (preset === "all") {
      // Trim leading and trailing months that have no records at all
      const firstIdx = data.findIndex((d) => d.expenses > 0 || d.income > 0);
      const lastIdx  = data.reduce((acc, d, i) => (d.expenses > 0 || d.income > 0 ? i : acc), -1);
      subset = firstIdx === -1 ? [] : data.slice(firstIdx, lastIdx + 1);
    } else {
      const { from, to } = getRange(preset);
      subset = data.filter((d) => d.month >= from && d.month <= to);
    }

    return subset.map((d) => ({ ...d, label: shortMonth(d.month) }));
  }, [data, preset]);

  return (
    <div className="rounded-md border bg-card p-6 space-y-5">
      {/* Header + preset buttons */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-sm font-semibold">Income vs Expenses</h2>
        <div className="flex items-center gap-1">
          {PRESETS.map(({ key, label }) => (
            <button
              key={key}
              onClick={() => setPreset(key)}
              className={cn(
                "rounded-md px-3 py-1 text-xs font-medium transition-colors",
                preset === key
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:bg-accent hover:text-accent-foreground"
              )}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {filtered.length === 0 ? (
        <p className="py-20 text-center text-sm text-muted-foreground">
          No data for the selected range.
        </p>
      ) : (
        <ResponsiveContainer width="100%" height={320}>
          <LineChart
            data={filtered}
            margin={{ top: 12, right: 28, left: 8, bottom: 12 }}
          >
            <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
            <XAxis
              dataKey="label"
              tick={{ fontSize: 12, fill: "hsl(var(--muted-foreground))" }}
              tickMargin={12}
              axisLine={false}
              tickLine={false}
            />
            <YAxis
              tickFormatter={(v) => `$${(v / 100).toLocaleString("en")}`}
              tick={{ fontSize: 12, fill: "hsl(var(--muted-foreground))" }}
              tickMargin={12}
              axisLine={false}
              tickLine={false}
              width={82}
            />
            <Tooltip content={<CustomTooltip />} />
            <Legend
              formatter={(value) =>
                value === "income" ? "Income (net)" : "Expenses"
              }
              wrapperStyle={{ fontSize: 12, paddingTop: 20 }}
            />
            <Line
              type="monotone"
              dataKey="income"
              stroke={COLOR_INCOME}
              strokeWidth={2}
              dot={{ r: 3, fill: COLOR_INCOME }}
              activeDot={{ r: 5 }}
            />
            <Line
              type="monotone"
              dataKey="expenses"
              stroke={COLOR_EXPENSES}
              strokeWidth={2}
              dot={{ r: 3, fill: COLOR_EXPENSES }}
              activeDot={{ r: 5 }}
            />
          </LineChart>
        </ResponsiveContainer>
      )}
    </div>
  );
}
