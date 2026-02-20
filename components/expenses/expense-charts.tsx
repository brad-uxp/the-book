"use client";

import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
} from "recharts";
import { formatCents } from "@/lib/currency";
import { formatPeriodKey } from "@/lib/dates";

interface ChartDataPoint {
  period: string;
  subscriptions: number;
  salaries: number;
  total: number;
  byCategory: Record<string, number>;
}

interface Props {
  chartData: ChartDataPoint[];
}

const CATEGORY_COLORS = {
  work: "#6366f1",
  personal: "#f59e0b",
  essential_service: "#10b981",
};

const CATEGORY_LABELS = {
  work: "Work",
  personal: "Personal",
  essential_service: "Essential",
};

function formatYAxis(value: number) {
  if (value >= 100000) return `$${(value / 100000).toFixed(0)}k`;
  return `$${(value / 100).toFixed(0)}`;
}

function CustomTooltip({
  active,
  payload,
  label,
}: {
  active?: boolean;
  payload?: Array<{ name: string; value: number; color: string }>;
  label?: string;
}) {
  if (!active || !payload) return null;
  return (
    <div className="rounded-lg border bg-popover p-3 shadow-md text-sm">
      <p className="font-semibold mb-1">{label}</p>
      {payload.map((p) => (
        <div key={p.name} className="flex items-center gap-2">
          <span
            className="inline-block h-2 w-2 rounded-full"
            style={{ backgroundColor: p.color }}
          />
          <span className="text-muted-foreground">{p.name}:</span>
          <span className="font-medium">{formatCents(p.value)}</span>
        </div>
      ))}
    </div>
  );
}

export function ExpenseCharts({ chartData }: Props) {
  const barData = chartData.map((d) => ({
    period: formatPeriodKey(d.period),
    Subscriptions: d.subscriptions,
    Salaries: d.salaries,
  }));

  // Aggregate categories across all months
  const categoryTotals: Record<string, number> = {};
  for (const d of chartData) {
    for (const [cat, val] of Object.entries(d.byCategory)) {
      categoryTotals[cat] = (categoryTotals[cat] ?? 0) + val;
    }
  }
  const pieData = Object.entries(categoryTotals)
    .filter(([, v]) => v > 0)
    .map(([k, v]) => ({
      name: CATEGORY_LABELS[k as keyof typeof CATEGORY_LABELS] ?? k,
      value: v,
      color: CATEGORY_COLORS[k as keyof typeof CATEGORY_COLORS] ?? "#94a3b8",
    }));

  // KPIs
  const totalSpend = chartData.reduce((a, b) => a + b.total, 0);
  const lastMonth = chartData[chartData.length - 1];
  const prevMonth = chartData[chartData.length - 2];
  const momChange = prevMonth && prevMonth.total > 0
    ? ((lastMonth?.total ?? 0) - prevMonth.total) / prevMonth.total * 100
    : null;

  return (
    <div className="space-y-6">
      {/* KPI cards */}
      <div className="grid grid-cols-3 gap-4">
        <div className="rounded-lg border bg-card p-4">
          <p className="text-sm text-muted-foreground">Total (12 months)</p>
          <p className="text-2xl font-bold mt-1">{formatCents(totalSpend)}</p>
        </div>
        <div className="rounded-lg border bg-card p-4">
          <p className="text-sm text-muted-foreground">Last Month</p>
          <p className="text-2xl font-bold mt-1">
            {formatCents(lastMonth?.total ?? 0)}
          </p>
          {momChange !== null && (
            <p
              className={`text-xs mt-1 ${
                momChange > 0 ? "text-destructive" : "text-green-600"
              }`}
            >
              {momChange > 0 ? "+" : ""}
              {momChange.toFixed(1)}% vs prev month
            </p>
          )}
        </div>
        <div className="rounded-lg border bg-card p-4">
          <p className="text-sm text-muted-foreground">Avg/Month</p>
          <p className="text-2xl font-bold mt-1">
            {formatCents(Math.round(totalSpend / (chartData.length || 1)))}
          </p>
        </div>
      </div>

      {/* Stacked bar chart */}
      <div className="rounded-lg border bg-card p-4">
        <h3 className="text-sm font-semibold mb-4">Monthly Expenses (12 months)</h3>
        <ResponsiveContainer width="100%" height={280}>
          <BarChart data={barData} margin={{ left: 20 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
            <XAxis
              dataKey="period"
              tick={{ fontSize: 11 }}
              stroke="hsl(var(--muted-foreground))"
            />
            <YAxis
              tickFormatter={formatYAxis}
              tick={{ fontSize: 11 }}
              stroke="hsl(var(--muted-foreground))"
            />
            <Tooltip content={<CustomTooltip />} />
            <Legend />
            <Bar dataKey="Salaries" stackId="a" fill="#6366f1" radius={[0, 0, 0, 0]} />
            <Bar dataKey="Subscriptions" stackId="a" fill="#f59e0b" radius={[4, 4, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>

      {/* Category breakdown */}
      {pieData.length > 0 && (
        <div className="rounded-lg border bg-card p-4">
          <h3 className="text-sm font-semibold mb-4">Subscription Category Breakdown (total)</h3>
          <div className="flex items-center gap-8">
            <ResponsiveContainer width={200} height={200}>
              <PieChart>
                <Pie
                  data={pieData}
                  cx="50%"
                  cy="50%"
                  innerRadius={60}
                  outerRadius={90}
                  paddingAngle={2}
                  dataKey="value"
                >
                  {pieData.map((entry, index) => (
                    <Cell key={index} fill={entry.color} />
                  ))}
                </Pie>
                <Tooltip
                  formatter={(value) => formatCents(Number(value))}
                />
              </PieChart>
            </ResponsiveContainer>
            <div className="space-y-2">
              {pieData.map((item) => (
                <div key={item.name} className="flex items-center gap-2 text-sm">
                  <span
                    className="inline-block h-3 w-3 rounded-sm"
                    style={{ backgroundColor: item.color }}
                  />
                  <span className="text-muted-foreground">{item.name}</span>
                  <span className="font-medium ml-auto">
                    {formatCents(item.value)}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
