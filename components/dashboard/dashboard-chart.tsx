"use client";

import { useMemo } from "react";
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

const COLOR_INCOME   = "#3b82f6"; // blue-500
const COLOR_EXPENSES = "#94a3b8"; // slate-400

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
          Income: <span className="font-semibold">{formatCents(income.value)}</span>
        </p>
      )}
      {expenses && (
        <p style={{ color: COLOR_EXPENSES }}>
          Expenses: <span className="font-semibold">{formatCents(expenses.value)}</span>
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
  const chartData = useMemo(
    () => data.map((d) => ({ ...d, label: shortMonth(d.month) })),
    [data]
  );

  return (
    <div className="rounded-md border bg-card p-4 sm:p-6 space-y-5">
      <h2 className="text-sm font-semibold">Income vs Expenses</h2>

      {chartData.length === 0 ? (
        <p className="py-20 text-center text-sm text-muted-foreground">
          No data for the selected range.
        </p>
      ) : (
        <ResponsiveContainer width="100%" height={300}>
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
            <Legend
              formatter={(value) => (value === "income" ? "Income (net)" : "Expenses")}
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
