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

const LINES = [
  { key: "income",             label: "Income",             color: "#3b82f6" },
  { key: "expenses",           label: "Expenses",           color: "#94a3b8" },
  { key: "workExpenses",       label: "Work expenses",      color: "#f97316" },
  { key: "personalExpenses",   label: "Personal expenses",  color: "#ec4899" },
  { key: "essentialExpenses",  label: "Essential services",  color: "#f59e0b" },
  { key: "net",                label: "Net",                color: "#10b981" },
] as const;

type LineKey = (typeof LINES)[number]["key"];

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
  return (
    <div className="rounded-lg border bg-card px-3 py-2 text-sm shadow-md">
      <p className="mb-1.5 font-medium">{label}</p>
      {LINES.map(({ key, label: name, color }) => {
        const entry = payload.find((p: { dataKey: string }) => p.dataKey === key);
        if (!entry) return null;
        return (
          <p key={key} style={{ color }}>
            {name}: <span className="font-semibold">{formatCents(entry.value)}</span>
          </p>
        );
      })}
      {(() => {
        const inc = payload.find((p: { dataKey: string }) => p.dataKey === "income");
        const exp = payload.find((p: { dataKey: string }) => p.dataKey === "expenses");
        if (!inc || !exp) return null;
        return (
          <p className="mt-1 border-t pt-1 text-muted-foreground">
            Net:{" "}
            <span className="font-semibold text-foreground">
              {formatCents(inc.value - exp.value)}
            </span>
          </p>
        );
      })()}
    </div>
  );
}

interface MonthData {
  month: string;
  income: number;
  expenses: number;
  workExpenses: number;
  personalExpenses: number;
  essentialExpenses: number;
  net: number;
}

interface Props {
  data: MonthData[];
}

export function DashboardChart({ data }: Props) {
  const [visible, setVisible] = useState<Record<LineKey, boolean>>({
    income: true,
    expenses: true,
    workExpenses: true,
    personalExpenses: true,
    essentialExpenses: true,
    net: true,
  });

  const toggle = (key: LineKey) =>
    setVisible((prev) => ({ ...prev, [key]: !prev[key] }));

  const chartData = useMemo(
    () => data.map((d) => ({ ...d, label: shortMonth(d.month) })),
    [data]
  );

  return (
    <div className="rounded-md border bg-card p-4 sm:p-6 space-y-4">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <h2 className="text-sm font-semibold">Income vs Expenses</h2>
        <div className="flex flex-wrap gap-2">
          {LINES.map(({ key, label, color }) => (
            <button
              key={key}
              onClick={() => toggle(key)}
              className={cn(
                "flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-medium transition-opacity",
                visible[key] ? "opacity-100" : "opacity-35"
              )}
              style={{ borderColor: color, color: visible[key] ? color : undefined }}
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
          No data for the selected range.
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
              <Tooltip content={<CustomTooltip />} />
              {LINES.map(({ key, color }) => (
                <Line
                  key={key}
                  type="monotone"
                  dataKey={key}
                  stroke={color}
                  strokeWidth={2}
                  dot={{ r: 3, fill: color }}
                  activeDot={{ r: 5 }}
                  hide={!visible[key]}
                />
              ))}
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
}
