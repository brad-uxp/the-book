"use client";

import { useState, useMemo } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { ArrowUpRight } from "lucide-react";
import { formatCents } from "@/lib/currency";
import { cn } from "@/lib/utils";

const DashboardChart = dynamic(() => import("./dashboard-chart").then((m) => m.DashboardChart), { ssr: false });
const CorporateChart = dynamic(() => import("./corporate-chart").then((m) => m.CorporateChart), { ssr: false });

type Preset = "ytd" | "last12" | "all";

const PRESETS: { key: Preset; label: string }[] = [
  { key: "ytd",    label: "This year" },
  { key: "last12", label: "Last 12 months" },
  { key: "all",    label: "All time" },
];

function toPeriodKey(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

export interface MonthData {
  month: string;
  income: number;
  salary: number;
  subscriptions: number;
  subsPersonal: number;
  subsWork: number;
  subsEssential: number;
  other: number;
  otherWork: number;
  otherPersonal: number;
}

export interface MonthIncomeByClient {
  month: string;
  byClient: Record<string, number>;
}

export interface ClientInfo {
  name: string;
  color: string;
}

export interface WorkExpenseRow {
  id: string;
  name: string;
  monthly: Record<string, number>;
}

export interface WorkExpensesByItem {
  salaries: WorkExpenseRow[];
  workSubs: WorkExpenseRow[];
  workOther: WorkExpenseRow[];
}

interface Props {
  monthlyData: MonthData[];
  monthlyIncomeByClient: MonthIncomeByClient[];
  clientsIndex: Record<string, ClientInfo>;
  workExpensesByItem: WorkExpensesByItem;
  sentTotal: number;
  sentCount: number;
}

export function DashboardMetrics({ monthlyData, monthlyIncomeByClient, clientsIndex, workExpensesByItem, sentTotal, sentCount }: Props) {
  const [preset, setPreset] = useState<Preset>("ytd");

  const filtered = useMemo(() => {
    const now = new Date();
    const currentMonth = toPeriodKey(now);

    if (preset === "ytd") {
      const yearStart = `${now.getFullYear()}-01`;
      return monthlyData.filter((d) => d.month >= yearStart && d.month <= currentMonth);
    }
    if (preset === "last12") {
      const from = toPeriodKey(new Date(now.getFullYear(), now.getMonth() - 11, 1));
      return monthlyData.filter((d) => d.month >= from && d.month <= currentMonth);
    }
    // all — trim leading/trailing months with no data
    const hasData = (d: MonthData) => d.income > 0 || d.salary > 0 || d.subscriptions > 0 || d.other > 0;
    const firstIdx = monthlyData.findIndex(hasData);
    const lastIdx  = monthlyData.reduce((acc, d, i) => (hasData(d) ? i : acc), -1);
    return firstIdx === -1 ? [] : monthlyData.slice(firstIdx, lastIdx + 1);
  }, [monthlyData, preset]);

  const totals = useMemo(() => {
    const salary        = filtered.reduce((s, d) => s + d.salary, 0);
    const subscriptions = filtered.reduce((s, d) => s + d.subscriptions, 0);
    const subsPersonal  = filtered.reduce((s, d) => s + d.subsPersonal, 0);
    const subsWork      = filtered.reduce((s, d) => s + d.subsWork, 0);
    const subsEssential = filtered.reduce((s, d) => s + d.subsEssential, 0);
    const income        = filtered.reduce((s, d) => s + d.income, 0);
    const expenses      = filtered.reduce((s, d) => s + d.salary + d.subscriptions + d.other, 0);
    const net           = income - expenses;
    const n             = filtered.length || 1;
    return {
      salary, subscriptions, net,
      avgSalary:        salary / n,
      avgSubsPersonal:  subsPersonal / n,
      avgSubsWork:      subsWork / n,
      avgSubsEssential: subsEssential / n,
      avgNet:           net / n,
      avgExpenses:      expenses / n,
    };
  }, [filtered]);

  const chartData = useMemo(
    () => filtered.map((d) => {
      const expenses = d.salary + d.subscriptions + d.other;
      const workExpenses = d.salary + d.subsWork + d.otherWork;
      return {
        month: d.month,
        income: d.income,
        expenses,
        workExpenses,
        personalExpenses: d.subsPersonal + d.otherPersonal,
        essentialExpenses: d.subsEssential,
        salary: d.salary,
        workSubs: d.subsWork,
        net: d.income - expenses,
        corporateNet: d.income - workExpenses,
      };
    }),
    [filtered]
  );

  const incomeByClientFiltered = useMemo(() => {
    const visibleMonths = new Set(filtered.map((d) => d.month));
    return monthlyIncomeByClient.filter((d) => visibleMonths.has(d.month));
  }, [filtered, monthlyIncomeByClient]);

  return (
    <div className="space-y-4">
      {/* Preset filter */}
      <div className="flex items-center gap-1">
        {PRESETS.map(({ key, label }) => (
          <button
            key={key}
            onClick={() => setPreset(key)}
            className={cn(
              "rounded-md px-3 py-1.5 text-xs font-medium transition-colors",
              preset === key
                ? "bg-primary text-primary-foreground"
                : "text-muted-foreground hover:bg-accent hover:text-accent-foreground"
            )}
          >
            {label}
          </button>
        ))}
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <Link
          href="/invoices?status=sent"
          className="group relative rounded-lg border bg-card p-4 shadow-sm hover:bg-muted/50 transition-colors"
        >
          <ArrowUpRight className="absolute top-3 right-3 h-3.5 w-3.5 text-muted-foreground opacity-40 group-hover:opacity-80 transition-opacity" />
          <p className="text-2xl font-bold tabular-nums leading-none">
            {formatCents(sentTotal)}
          </p>
          <p className="mt-1.5 text-xs text-muted-foreground">
            {sentCount} invoice{sentCount !== 1 ? "s" : ""} awaiting payment
          </p>
        </Link>

        <Link
          href="/expenses?type=salary"
          className="group relative rounded-lg border bg-card p-4 shadow-sm hover:bg-muted/50 transition-colors"
        >
          <ArrowUpRight className="absolute top-3 right-3 h-3.5 w-3.5 text-muted-foreground opacity-40 group-hover:opacity-80 transition-opacity" />
          <p className="text-2xl font-bold tabular-nums leading-none">
            {formatCents(totals.salary)}
          </p>
          <p className="mt-1.5 text-xs text-muted-foreground">salary paid</p>
        </Link>

        <Link
          href="/expenses?type=subscription"
          className="group relative rounded-lg border bg-card p-4 shadow-sm hover:bg-muted/50 transition-colors"
        >
          <ArrowUpRight className="absolute top-3 right-3 h-3.5 w-3.5 text-muted-foreground opacity-40 group-hover:opacity-80 transition-opacity" />
          <p className="text-2xl font-bold tabular-nums leading-none">
            {formatCents(totals.subscriptions)}
          </p>
          <p className="mt-1.5 text-xs text-muted-foreground">subscriptions paid</p>
        </Link>

        <div className="rounded-lg border bg-card p-4 shadow-sm">
          <p className={`text-2xl font-bold tabular-nums leading-none ${totals.net < 0 ? "text-destructive" : ""}`}>
            {totals.net < 0 ? "-" : ""}{formatCents(Math.abs(totals.net))}
          </p>
          <p className="mt-1.5 text-xs text-muted-foreground">net income</p>
        </div>
      </div>

      {/* Average metrics */}
      <div>
        <p className="text-xs font-medium text-muted-foreground mb-2">
          Monthly averages · {filtered.length} month{filtered.length !== 1 ? "s" : ""}
        </p>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
          <div className="rounded-lg border bg-card p-3 shadow-sm">
            <p className="text-lg font-bold tabular-nums leading-none">
              {formatCents(Math.round(totals.avgSalary))}
            </p>
            <p className="mt-1.5 text-xs text-muted-foreground">avg salary</p>
          </div>
          <div className="rounded-lg border bg-card p-3 shadow-sm">
            <p className="text-lg font-bold tabular-nums leading-none">
              {formatCents(Math.round(totals.avgSubsPersonal))}
            </p>
            <p className="mt-1.5 text-xs text-muted-foreground">avg personal subs</p>
          </div>
          <div className="rounded-lg border bg-card p-3 shadow-sm">
            <p className="text-lg font-bold tabular-nums leading-none">
              {formatCents(Math.round(totals.avgSubsWork))}
            </p>
            <p className="mt-1.5 text-xs text-muted-foreground">avg work subs</p>
          </div>
          <div className="rounded-lg border bg-card p-3 shadow-sm">
            <p className="text-lg font-bold tabular-nums leading-none">
              {formatCents(Math.round(totals.avgSubsEssential))}
            </p>
            <p className="mt-1.5 text-xs text-muted-foreground">avg essential subs</p>
          </div>
          <div className="rounded-lg border bg-card p-3 shadow-sm">
            <p className="text-lg font-bold tabular-nums leading-none">
              {formatCents(Math.round(totals.avgExpenses))}
            </p>
            <p className="mt-1.5 text-xs text-muted-foreground">avg total expense</p>
          </div>
          <div className="rounded-lg border bg-card p-3 shadow-sm">
            <p className={`text-lg font-bold tabular-nums leading-none ${totals.avgNet < 0 ? "text-destructive" : ""}`}>
              {totals.avgNet < 0 ? "-" : ""}{formatCents(Math.round(Math.abs(totals.avgNet)))}
            </p>
            <p className="mt-1.5 text-xs text-muted-foreground">avg net income</p>
          </div>
        </div>
      </div>

      {/* Chart */}
      <DashboardChart data={chartData} />

      {/* Corporate profitability chart */}
      <CorporateChart
        data={chartData}
        incomeByClient={incomeByClientFiltered}
        clientsIndex={clientsIndex}
        workExpensesByItem={workExpensesByItem}
      />
    </div>
  );
}
