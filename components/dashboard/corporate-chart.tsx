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
import { Download, Filter, X } from "lucide-react";
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

function hexToRgb(hex: string): [number, number, number] {
  const m = hex.match(/^#([\da-f]{2})([\da-f]{2})([\da-f]{2})$/i);
  if (!m) return [0, 0, 0];
  return [parseInt(m[1], 16), parseInt(m[2], 16), parseInt(m[3], 16)];
}

function compactCurrency(cents: number): string {
  const v = cents / 100;
  const abs = Math.abs(v);
  const sign = v < 0 ? "-" : "";
  if (abs >= 1_000_000) return `${sign}$${(abs / 1_000_000).toFixed(1)}M`;
  if (abs >= 1_000) return `${sign}$${(abs / 1_000).toFixed(1)}k`;
  return `${sign}$${abs.toFixed(0)}`;
}

type ChartPoint = {
  month: string;
  income: number;
  workExpenses: number;
  salary: number;
  workSubs: number;
  corporateNet: number;
  label: string;
};

function fmtCurrencyNoCents(cents: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(cents / 100);
}

type ExportLine = { key: LineKey; label: string; color: string };

// Native vector chart drawn directly in jsPDF — avoids html2canvas/oklch issues.
function drawLineChart(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  doc: any,
  area: { x: number; y: number; w: number; h: number },
  chartData: ChartPoint[],
  lines: ExportLine[],
  showDataLabels: boolean = false
) {
  const { x, y, w, h } = area;
  const padding = { top: 6, right: 10, bottom: 18, left: 26 };
  const plotX = x + padding.left;
  const plotY = y + padding.top;
  const plotW = w - padding.left - padding.right;
  const plotH = h - padding.top - padding.bottom;

  if (lines.length === 0 || chartData.length === 0) return;

  // Compute y-axis range across visible lines
  let minVal = 0;
  let maxVal = 0;
  for (const d of chartData) {
    for (const L of lines) {
      const v = d[L.key];
      if (v > maxVal) maxVal = v;
      if (v < minVal) minVal = v;
    }
  }
  // Pad slightly so peaks don't touch the top (extra top room for data labels)
  const range = (maxVal - minVal) || 1;
  maxVal = maxVal + range * (showDataLabels ? 0.1 : 0.05);
  minVal = minVal - range * 0.05;

  const gridLines = 5;
  const valToY = (v: number) => plotY + plotH - ((v - minVal) / (maxVal - minVal || 1)) * plotH;
  const idxToX = (i: number) =>
    plotX + (chartData.length === 1 ? plotW / 2 : (i / (chartData.length - 1)) * plotW);

  // Horizontal gridlines
  doc.setDrawColor(226, 232, 240);
  doc.setLineWidth(0.15);
  for (let i = 0; i <= gridLines; i++) {
    const py = plotY + plotH - (i / gridLines) * plotH;
    doc.line(plotX, py, plotX + plotW, py);
  }

  // Y-axis labels
  doc.setFontSize(8);
  doc.setTextColor(100, 116, 139);
  for (let i = 0; i <= gridLines; i++) {
    const val = minVal + (i / gridLines) * (maxVal - minVal);
    const py = plotY + plotH - (i / gridLines) * plotH;
    doc.text(compactCurrency(val), plotX - 2, py + 1.4, { align: "right" });
  }

  // X-axis labels
  for (let i = 0; i < chartData.length; i++) {
    doc.text(chartData[i].label, idxToX(i), plotY + plotH + 5, { align: "center" });
  }

  // Zero line (slightly darker if min < 0 < max)
  if (minVal < 0 && maxVal > 0) {
    doc.setDrawColor(160, 174, 192);
    doc.setLineWidth(0.3);
    const zeroY = valToY(0);
    doc.line(plotX, zeroY, plotX + plotW, zeroY);
  }

  // Lines + dots
  for (const L of lines) {
    const [r, g, b] = hexToRgb(L.color);
    doc.setDrawColor(r, g, b);
    doc.setFillColor(r, g, b);
    doc.setLineWidth(0.7);
    for (let i = 0; i < chartData.length - 1; i++) {
      doc.line(
        idxToX(i),
        valToY(chartData[i][L.key]),
        idxToX(i + 1),
        valToY(chartData[i + 1][L.key])
      );
    }
    for (let i = 0; i < chartData.length; i++) {
      doc.circle(idxToX(i), valToY(chartData[i][L.key]), 1.0, "F");
    }
  }

  // Data labels: numeric tag above each dot, colored by line
  if (showDataLabels) {
    doc.setFontSize(6.5);
    for (const L of lines) {
      const [r, g, b] = hexToRgb(L.color);
      doc.setTextColor(r, g, b);
      for (let i = 0; i < chartData.length; i++) {
        const v = chartData[i][L.key];
        const px = idxToX(i);
        const py = valToY(v) - 2.2;
        doc.text(fmtCurrencyNoCents(v), px, py, { align: "center" });
      }
    }
  }

  // Legend (below x-labels)
  const legendY = y + h - 2;
  let legendX = plotX;
  doc.setFontSize(8);
  for (const L of lines) {
    const [r, g, b] = hexToRgb(L.color);
    doc.setFillColor(r, g, b);
    doc.circle(legendX + 1.2, legendY - 1.2, 1.1, "F");
    doc.setTextColor(60, 60, 60);
    doc.text(L.label, legendX + 3.5, legendY);
    legendX += doc.getTextWidth(L.label) + 10;
  }
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

interface WorkExpenseRow {
  id: string;
  name: string;
  monthly: Record<string, number>;
}

interface WorkExpensesByItem {
  salaries: WorkExpenseRow[];
  workSubs: WorkExpenseRow[];
  workOther: WorkExpenseRow[];
}

interface Props {
  data: MonthData[];
  incomeByClient: MonthIncomeByClient[];
  clientsIndex: Record<string, ClientInfo>;
  workExpensesByItem: WorkExpensesByItem;
}

export function CorporateChart({ data, incomeByClient, clientsIndex, workExpensesByItem }: Props) {
  const [visible, setVisible] = useState<Record<LineKey, boolean>>({
    income: true,
    workExpenses: true,
    salary: true,
    workSubs: true,
    corporateNet: true,
  });
  const [excluded, setExcluded] = useState<Set<string>>(new Set());
  const [popoverOpen, setPopoverOpen] = useState(false);
  const [exporting, setExporting] = useState(false);

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

  const handleExport = async () => {
    if (chartData.length === 0 || exporting) return;
    setExporting(true);
    try {
      const [{ default: jsPDF }, { default: autoTable }] = await Promise.all([
        import("jspdf"),
        import("jspdf-autotable"),
      ]);

      const doc = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4" });
      const pageW = doc.internal.pageSize.getWidth();
      const pageH = doc.internal.pageSize.getHeight();
      const margin = 12;

      const primary: [number, number, number] = [15, 23, 42];
      const muted: [number, number, number] = [100, 116, 139];
      const bgLight: [number, number, number] = [248, 250, 252];

      const months = chartData.map((d) => d.month);
      const monthLabels = chartData.map((d) => d.label);

      // Header bar
      doc.setFillColor(...primary);
      doc.rect(0, 0, pageW, 22, "F");
      doc.setTextColor(255, 255, 255);
      doc.setFontSize(14);
      doc.text("Corporate profitability report", margin, 10);
      doc.setFontSize(8);
      const periodLabel =
        months.length === 0
          ? "—"
          : months.length === 1
          ? shortMonth(months[0])
          : `${shortMonth(months[0])} – ${shortMonth(months[months.length - 1])}`;
      doc.text(`Period: ${periodLabel}`, margin, 16);
      doc.text(
        new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" }),
        pageW - margin,
        16,
        { align: "right" }
      );

      let cursorY = 26;

      // Excluded note
      if (excluded.size > 0) {
        const names = Array.from(excluded)
          .map((id) => clientsIndex[id]?.name ?? "Unknown")
          .join(", ");
        doc.setTextColor(...muted);
        doc.setFontSize(8);
        doc.text(`Excluded clients: ${names}`, margin, cursorY);
        cursorY += 4;
      }

      // ── Chart: only Income / Work expenses / Corporate net, full first page
      const EXPORT_KEYS: LineKey[] = ["income", "workExpenses", "corporateNet"];
      const exportLines: ExportLine[] = LINES
        .filter((L) => EXPORT_KEYS.includes(L.key) && visible[L.key])
        .map((L) => ({ key: L.key, label: L.label, color: L.color }));

      const chartTop = cursorY;
      const chartBottom = pageH - margin - 4; // leave room for page footer
      drawLineChart(
        doc,
        { x: margin, y: chartTop, w: pageW - margin * 2, h: chartBottom - chartTop },
        chartData,
        exportLines,
        true
      );

      // ── Page 2+: unified table ────────────────────────────────────────────
      doc.addPage();
      cursorY = margin + 4;

      doc.setTextColor(...primary);
      doc.setFontSize(12);
      doc.setFont("helvetica", "bold");
      doc.text("Detail by item", margin, cursorY);
      doc.setFont("helvetica", "normal");
      cursorY += 5;

      // Build rows: income clients (positive) + work expense items (negative)
      const includedClients = visibleClients.filter((c) => !excluded.has(c.id));
      const incomeRowsBuilt = includedClients.map((c) => {
        const monthAmounts = months.map((m) => {
          const byClient = incomeByClient.find((x) => x.month === m)?.byClient ?? {};
          return byClient[c.id] ?? 0;
        });
        const total = monthAmounts.reduce((s, v) => s + v, 0);
        return { name: c.name, monthAmounts, total };
      });

      const buildExpenseRows = (rows: WorkExpenseRow[]) =>
        rows
          .map((r) => {
            // Negate so values display as expense outflow
            const monthAmounts = months.map((m) => -(r.monthly[m] ?? 0));
            const total = monthAmounts.reduce((s, v) => s + v, 0);
            return { name: r.name, monthAmounts, total };
          })
          .filter((r) => r.total !== 0)
          .sort((a, b) => a.total - b.total); // most negative first

      const salariesRowsBuilt = buildExpenseRows(workExpensesByItem.salaries);
      const workSubsRowsBuilt = buildExpenseRows(workExpensesByItem.workSubs);
      const workOtherRowsBuilt = buildExpenseRows(workExpensesByItem.workOther);

      // Net per month (= corporateNet from chartData, already excluded-aware)
      const netMonths = chartData.map((d) => d.corporateNet);
      const netGrand = netMonths.reduce((s, v) => s + v, 0);

      // Format helper: signed currency, em-dash for zero
      const fmtSigned = (cents: number) => {
        if (cents === 0) return "—";
        if (cents < 0) return `−${formatCents(Math.abs(cents))}`;
        return formatCents(cents);
      };

      // Build flat row metadata for autotable + cell-level styling lookup
      type RowMeta = { kind: "subheader" | "income" | "expense" | "total" };
      const rowMeta: RowMeta[] = [];
      const tableBody: string[][] = [];

      const pushSubheader = (label: string) => {
        rowMeta.push({ kind: "subheader" });
        tableBody.push([label, ...monthLabels.map(() => ""), ""]);
      };
      const pushDataRows = (
        rows: { name: string; monthAmounts: number[]; total: number }[],
        kind: "income" | "expense"
      ) => {
        for (const r of rows) {
          rowMeta.push({ kind });
          tableBody.push([
            r.name,
            ...r.monthAmounts.map(fmtSigned),
            fmtSigned(r.total),
          ]);
        }
      };

      pushSubheader("INCOME");
      if (incomeRowsBuilt.length === 0) {
        rowMeta.push({ kind: "income" });
        tableBody.push(["No income in this period", ...monthLabels.map(() => ""), ""]);
      } else {
        pushDataRows(incomeRowsBuilt, "income");
      }

      if (salariesRowsBuilt.length > 0) {
        pushSubheader("SALARIES");
        pushDataRows(salariesRowsBuilt, "expense");
      }
      if (workSubsRowsBuilt.length > 0) {
        pushSubheader("WORK SUBSCRIPTIONS");
        pushDataRows(workSubsRowsBuilt, "expense");
      }
      if (workOtherRowsBuilt.length > 0) {
        pushSubheader("OTHER WORK EXPENSES");
        pushDataRows(workOtherRowsBuilt, "expense");
      }

      // Final Net row
      rowMeta.push({ kind: "total" });
      tableBody.push([
        "Net (Income − Work expenses)",
        ...netMonths.map(fmtSigned),
        fmtSigned(netGrand),
      ]);

      const orange: [number, number, number] = [249, 115, 22];

      autoTable(doc, {
        startY: cursorY,
        head: [["Item", ...monthLabels, "Total"]],
        body: tableBody,
        theme: "plain",
        headStyles: {
          fillColor: bgLight,
          textColor: muted,
          fontStyle: "bold",
          fontSize: 7,
          cellPadding: { top: 1.8, bottom: 1.8, left: 2, right: 2 },
          lineWidth: { bottom: 0.3 },
          lineColor: [226, 232, 240],
        },
        bodyStyles: {
          textColor: primary,
          fontSize: 7,
          cellPadding: { top: 1.2, bottom: 1.2, left: 2, right: 2 },
          lineWidth: { bottom: 0.15 },
          lineColor: [226, 232, 240],
        },
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        didParseCell: (data: any) => {
          if (data.section !== "body") return;
          const meta = rowMeta[data.row.index];
          if (!meta) return;

          if (data.column.index > 0) data.cell.styles.halign = "right";

          if (meta.kind === "subheader") {
            data.cell.styles.fillColor = bgLight;
            data.cell.styles.textColor = muted;
            data.cell.styles.fontStyle = "bold";
            data.cell.styles.fontSize = 6.5;
            data.cell.styles.cellPadding = { top: 2, bottom: 1.5, left: 2, right: 2 };
          } else if (meta.kind === "expense" && data.column.index > 0) {
            data.cell.styles.textColor = orange;
          } else if (meta.kind === "total") {
            data.cell.styles.fillColor = primary;
            data.cell.styles.textColor = [255, 255, 255];
            data.cell.styles.fontStyle = "bold";
            data.cell.styles.cellPadding = { top: 2, bottom: 2, left: 2, right: 2 };
          }
        },
        margin: { left: margin, right: margin },
      });

      // Footer with page numbers
      const totalPages = doc.getNumberOfPages();
      for (let p = 1; p <= totalPages; p++) {
        doc.setPage(p);
        doc.setTextColor(...muted);
        doc.setFontSize(7);
        doc.text(`Page ${p} of ${totalPages}`, pageW - margin, pageH - 4, { align: "right" });
      }

      const today = new Date().toISOString().slice(0, 10);
      doc.save(`corporate-profitability-${today}.pdf`);
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className="rounded-md border bg-card p-4 sm:p-6 space-y-4">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h2 className="text-sm font-semibold">Corporate profitability</h2>
          <p className="text-xs text-muted-foreground mt-0.5">Income vs work expenses (salaries + work subscriptions &amp; costs)</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <Button
            variant="outline"
            size="sm"
            className="h-7 gap-1.5 text-xs font-normal"
            disabled={chartData.length === 0 || exporting}
            onClick={handleExport}
          >
            <Download className="h-3 w-3" />
            {exporting ? "Exporting…" : "Export PDF"}
          </Button>

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
