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
import { Filter, X } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { formatCents } from "@/lib/currency";
import { cn } from "@/lib/utils";

const LINES = [
  { key: "income",       label: "Income",        color: "#3b82f6" },
  { key: "workExpenses", label: "Work expenses",  color: "#f97316" },
  { key: "salary",       label: "Salaries",       color: "#ef4444" },
  { key: "workSubs",     label: "Work subs",      color: "#eab308" },
  { key: "corporateNet", label: "Corporate net",  color: "#10b981" },
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
    </div>
  );
}

interface MonthData {
  month: string;
  income: number;
  workExpenses: number;
  salary: number;
  workSubs: number;
  corporateNet: number;
}

interface MonthIncomeByClient {
  month: string;
  byClient: Record<string, number>;
}

interface ClientInfo {
  name: string;
  color: string;
}

interface Props {
  data: MonthData[];
  incomeByClient: MonthIncomeByClient[];
  clientsIndex: Record<string, ClientInfo>;
}

export function CorporateChart({ data, incomeByClient, clientsIndex }: Props) {
  const [visible, setVisible] = useState<Record<LineKey, boolean>>({
    income: true,
    workExpenses: true,
    salary: true,
    workSubs: true,
    corporateNet: true,
  });
  const [excluded, setExcluded] = useState<Set<string>>(new Set());
  const [popoverOpen, setPopoverOpen] = useState(false);

  const toggle = (key: LineKey) =>
    setVisible((prev) => ({ ...prev, [key]: !prev[key] }));

  const toggleExcluded = (clientId: string) =>
    setExcluded((prev) => {
      const next = new Set(prev);
      if (next.has(clientId)) next.delete(clientId);
      else next.add(clientId);
      return next;
    });

  // Clients that have any income across the visible months — sorted by total desc.
  const visibleClients = useMemo(() => {
    const totals = new Map<string, number>();
    for (const m of incomeByClient) {
      for (const [id, amount] of Object.entries(m.byClient)) {
        totals.set(id, (totals.get(id) ?? 0) + amount);
      }
    }
    return Array.from(totals.entries())
      .filter(([, amt]) => amt > 0)
      .sort((a, b) => b[1] - a[1])
      .map(([id, total]) => ({
        id,
        total,
        name: clientsIndex[id]?.name ?? "Unknown",
        color: clientsIndex[id]?.color ?? "#6366f1",
      }));
  }, [incomeByClient, clientsIndex]);

  const incomeByMonth = useMemo(() => {
    const map = new Map<string, Record<string, number>>();
    for (const m of incomeByClient) map.set(m.month, m.byClient);
    return map;
  }, [incomeByClient]);

  const chartData = useMemo(
    () =>
      data.map((d) => {
        let excludedAmount = 0;
        if (excluded.size > 0) {
          const byClient = incomeByMonth.get(d.month);
          if (byClient) {
            for (const id of excluded) excludedAmount += byClient[id] ?? 0;
          }
        }
        const adjustedIncome = d.income - excludedAmount;
        return {
          ...d,
          income: adjustedIncome,
          corporateNet: adjustedIncome - d.workExpenses,
          label: shortMonth(d.month),
        };
      }),
    [data, excluded, incomeByMonth]
  );

  // Excluded clients that actually appear in the visible window (for the chip row).
  const excludedVisible = visibleClients.filter((c) => excluded.has(c.id));
  // Excluded clients NOT in visible window — still in the set but invisible to user; keep them excluded.

  return (
    <div className="rounded-md border bg-card p-4 sm:p-6 space-y-4">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h2 className="text-sm font-semibold">Corporate profitability</h2>
          <p className="text-xs text-muted-foreground mt-0.5">Income vs work expenses (salaries + work subscriptions &amp; costs)</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <Popover open={popoverOpen} onOpenChange={setPopoverOpen}>
            <PopoverTrigger asChild>
              <Button
                variant="outline"
                size="sm"
                className="h-7 gap-1.5 text-xs font-normal"
                disabled={visibleClients.length === 0}
              >
                <Filter className="h-3 w-3" />
                Exclude clients
                {excluded.size > 0 && (
                  <span className="ml-0.5 rounded-full bg-primary px-1.5 py-0.5 text-[10px] font-semibold text-primary-foreground leading-none">
                    {excluded.size}
                  </span>
                )}
              </Button>
            </PopoverTrigger>
            <PopoverContent align="end" className="w-64 p-2">
              <div className="flex items-center justify-between px-1 py-1">
                <p className="text-xs font-medium text-muted-foreground">
                  Exclude from Income
                </p>
                {excluded.size > 0 && (
                  <button
                    onClick={() => setExcluded(new Set())}
                    className="text-xs text-muted-foreground hover:text-foreground"
                  >
                    Clear
                  </button>
                )}
              </div>
              <div className="max-h-64 overflow-y-auto">
                {visibleClients.length === 0 ? (
                  <p className="px-2 py-3 text-center text-xs text-muted-foreground">
                    No clients in range.
                  </p>
                ) : (
                  visibleClients.map((c) => {
                    const isExcluded = excluded.has(c.id);
                    return (
                      <label
                        key={c.id}
                        className="flex cursor-pointer items-center gap-2 rounded-sm px-2 py-1.5 hover:bg-accent"
                      >
                        <Checkbox
                          checked={isExcluded}
                          onCheckedChange={() => toggleExcluded(c.id)}
                        />
                        <span
                          className="inline-block h-2 w-2 shrink-0 rounded-full"
                          style={{ background: c.color }}
                        />
                        <span className="flex-1 truncate text-sm">{c.name}</span>
                        <span className="text-[10px] tabular-nums text-muted-foreground">
                          {formatCents(c.total)}
                        </span>
                      </label>
                    );
                  })
                )}
              </div>
            </PopoverContent>
          </Popover>

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
      </div>

      {excludedVisible.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-xs text-muted-foreground">Excluding:</span>
          {excludedVisible.map((c) => (
            <button
              key={c.id}
              onClick={() => toggleExcluded(c.id)}
              className="flex items-center gap-1 rounded-full border bg-muted/50 px-2 py-0.5 text-xs hover:bg-muted"
            >
              <span
                className="inline-block h-1.5 w-1.5 rounded-full"
                style={{ background: c.color }}
              />
              {c.name}
              <X className="h-2.5 w-2.5 opacity-60" />
            </button>
          ))}
        </div>
      )}

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
