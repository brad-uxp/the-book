"use client";

import { useState, useCallback, useEffect, useRef } from "react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ChevronLeft, ChevronRight, Search } from "lucide-react";

type AuditLog = {
  id: string;
  entity_type: string;
  entity_id: string;
  entity_name: string;
  action: string;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
  created_at: string;
};

const ENTITY_TYPE_LABELS: Record<string, string> = {
  invoice: "Invoice",
  client: "Client",
  subscription: "Subscription",
  subscription_payment: "Sub. Payment",
  person: "Person",
  salary_payment: "Salary Payment",
  other_expense: "Other Expense",
  role: "Role",
};

const ACTION_COLORS: Record<string, string> = {
  create: "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400",
  update: "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400",
  delete: "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400",
};

function formatValue(val: unknown): string {
  if (val === null || val === undefined) return "—";
  if (typeof val === "boolean") return val ? "Yes" : "No";
  if (val instanceof Date) return val.toLocaleString();
  if (typeof val === "string") {
    if (/^\d{4}-\d{2}-\d{2}T/.test(val)) {
      return new Date(val).toLocaleString();
    }
    return val || "—";
  }
  return String(val);
}

function DetailView({ log }: { log: AuditLog }) {
  if (log.action === "create" && log.after) {
    return (
      <div>
        <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3">
          Created with
        </p>
        <div className="space-y-0 divide-y rounded-md border overflow-hidden">
          {Object.entries(log.after).map(([k, v]) => (
            <div key={k} className="flex gap-3 px-3 py-2 text-sm bg-card">
              <span className="text-muted-foreground font-mono text-xs leading-5 w-36 shrink-0">
                {k}
              </span>
              <span className="break-all min-w-0">{formatValue(v)}</span>
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (log.action === "delete" && log.before) {
    return (
      <div>
        <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3">
          Deleted data
        </p>
        <div className="space-y-0 divide-y rounded-md border overflow-hidden">
          {Object.entries(log.before).map(([k, v]) => (
            <div key={k} className="flex gap-3 px-3 py-2 text-sm bg-card">
              <span className="text-muted-foreground font-mono text-xs leading-5 w-36 shrink-0">
                {k}
              </span>
              <span className="break-all min-w-0">{formatValue(v)}</span>
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (log.action === "update") {
    const before = log.before ?? {};
    const after = log.after ?? {};
    const allKeys = Array.from(
      new Set([...Object.keys(before), ...Object.keys(after)])
    );
    return (
      <div className="space-y-2">
        {allKeys.map((k) => {
          const changed = JSON.stringify(before[k]) !== JSON.stringify(after[k]);
          return (
            <div
              key={k}
              className={`rounded-md border p-3 text-sm ${
                changed
                  ? "border-amber-300 bg-amber-50 dark:border-amber-700 dark:bg-amber-950/20"
                  : "border-border bg-card"
              }`}
            >
              <p className="font-mono text-xs text-muted-foreground mb-1.5">{k}</p>
              {changed ? (
                <div className="space-y-1">
                  <div className="flex gap-2">
                    <span className="text-xs text-red-500 w-10 shrink-0 pt-0.5">Before</span>
                    <span className="line-through text-muted-foreground break-all min-w-0">
                      {formatValue(before[k])}
                    </span>
                  </div>
                  <div className="flex gap-2">
                    <span className="text-xs text-green-600 w-10 shrink-0 pt-0.5">After</span>
                    <span className="break-all min-w-0">{formatValue(after[k])}</span>
                  </div>
                </div>
              ) : (
                <span className="text-muted-foreground break-all">
                  {formatValue(after[k] ?? before[k])}
                </span>
              )}
            </div>
          );
        })}
      </div>
    );
  }

  return <p className="text-muted-foreground text-sm">No detail available.</p>;
}

const LIMIT = 50;

export function AuditLogTable({
  initialLogs,
  initialTotal,
}: {
  initialLogs: AuditLog[];
  initialTotal: number;
}) {
  const [logs, setLogs] = useState<AuditLog[]>(initialLogs);
  const [total, setTotal] = useState(initialTotal);
  const [page, setPage] = useState(1);
  const [entityType, setEntityType] = useState("all");
  const [action, setAction] = useState("all");
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<AuditLog | null>(null);
  const [loading, setLoading] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const fetchLogs = useCallback(async (p: number, et: string, ac: string, q: string) => {
    setLoading(true);
    try {
      const params = new URLSearchParams({
        page: String(p),
        limit: String(LIMIT),
        ...(et !== "all" ? { entity_type: et } : {}),
        ...(ac !== "all" ? { action: ac } : {}),
        ...(q.trim() ? { search: q.trim() } : {}),
      });
      const res = await window.fetch(`/api/audit-logs?${params}`);
      const data = await res.json();
      setLogs(data.logs);
      setTotal(data.total);
      setPage(p);
    } finally {
      setLoading(false);
    }
  }, []);

  const handleEntityType = (val: string) => {
    setEntityType(val);
    fetchLogs(1, val, action, search);
  };

  const handleAction = (val: string) => {
    setAction(val);
    fetchLogs(1, entityType, val, search);
  };

  const handleSearch = (val: string) => {
    setSearch(val);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      fetchLogs(1, entityType, action, val);
    }, 300);
  };

  const totalPages = Math.max(1, Math.ceil(total / LIMIT));

  return (
    <div className="space-y-4">
      {/* Toolbar */}
      <div className="flex flex-col gap-2">
        {/* Search */}
        <div className="relative">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground pointer-events-none" />
          <Input
            placeholder="Search by name…"
            value={search}
            onChange={(e) => handleSearch(e.target.value)}
            className="pl-8 h-9"
          />
        </div>
        {/* Selects + count */}
        <div className="flex flex-wrap items-center gap-2">
          <Select value={entityType} onValueChange={handleEntityType}>
            <SelectTrigger className="h-9 w-full sm:w-auto sm:min-w-40">
              <SelectValue placeholder="All types" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All types</SelectItem>
              {Object.entries(ENTITY_TYPE_LABELS).map(([val, label]) => (
                <SelectItem key={val} value={val}>
                  {label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select value={action} onValueChange={handleAction}>
            <SelectTrigger className="h-9 w-full sm:w-auto sm:min-w-36">
              <SelectValue placeholder="All actions" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All actions</SelectItem>
              <SelectItem value="create">Create</SelectItem>
              <SelectItem value="update">Update</SelectItem>
              <SelectItem value="delete">Delete</SelectItem>
            </SelectContent>
          </Select>

          <span className="text-sm text-muted-foreground sm:ml-auto">
            {total.toLocaleString()} record{total !== 1 ? "s" : ""}
          </span>
        </div>
      </div>

      {/* Table */}
      <div className={`rounded-md border transition-opacity ${loading ? "opacity-50" : ""}`}>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="hidden sm:table-cell w-32">Type</TableHead>
              <TableHead>Name</TableHead>
              <TableHead className="w-24">Action</TableHead>
              <TableHead className="hidden sm:table-cell w-40">Date</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {logs.length === 0 ? (
              <TableRow>
                <TableCell colSpan={4} className="py-8 text-center text-muted-foreground">
                  No logs found.
                </TableCell>
              </TableRow>
            ) : (
              logs.map((log) => (
                <TableRow
                  key={log.id}
                  className="cursor-pointer"
                  onClick={() => setSelected(log)}
                >
                  <TableCell className="hidden sm:table-cell">
                    <span className="text-xs bg-muted px-1.5 py-0.5 rounded font-mono">
                      {ENTITY_TYPE_LABELS[log.entity_type] ?? log.entity_type}
                    </span>
                  </TableCell>
                  <TableCell className="max-w-0 w-full">
                    <p className="truncate">{log.entity_name}</p>
                    <p className="sm:hidden text-xs text-muted-foreground mt-0.5 truncate">
                      {ENTITY_TYPE_LABELS[log.entity_type] ?? log.entity_type}
                      {" · "}
                      {new Date(log.created_at).toLocaleString()}
                    </p>
                  </TableCell>
                  <TableCell>
                    <span
                      className={`text-xs px-2 py-0.5 rounded-full font-medium capitalize ${
                        ACTION_COLORS[log.action] ?? ""
                      }`}
                    >
                      {log.action}
                    </span>
                  </TableCell>
                  <TableCell className="hidden sm:table-cell text-muted-foreground text-xs">
                    {new Date(log.created_at).toLocaleString()}
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between">
          <Button
            variant="outline"
            size="sm"
            disabled={page <= 1 || loading}
            onClick={() => fetchLogs(page - 1, entityType, action, search)}
          >
            <ChevronLeft className="h-4 w-4 mr-1" />
            Previous
          </Button>
          <span className="text-sm text-muted-foreground">
            Page {page} of {totalPages}
          </span>
          <Button
            variant="outline"
            size="sm"
            disabled={page >= totalPages || loading}
            onClick={() => fetchLogs(page + 1, entityType, action, search)}
          >
            Next
            <ChevronRight className="h-4 w-4 ml-1" />
          </Button>
        </div>
      )}

      {/* Detail Sheet */}
      <Sheet open={!!selected} onOpenChange={(o) => !o && setSelected(null)}>
        <SheetContent className="w-full sm:max-w-md overflow-y-auto">
          {selected && (
            <>
              <SheetHeader className="mb-4">
                <SheetTitle className="text-base leading-snug pr-6">
                  {selected.entity_name}
                </SheetTitle>
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-xs bg-muted px-1.5 py-0.5 rounded font-mono">
                    {ENTITY_TYPE_LABELS[selected.entity_type] ?? selected.entity_type}
                  </span>
                  <span
                    className={`text-xs px-2 py-0.5 rounded-full font-medium capitalize ${
                      ACTION_COLORS[selected.action] ?? ""
                    }`}
                  >
                    {selected.action}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {new Date(selected.created_at).toLocaleString()}
                  </span>
                </div>
              </SheetHeader>
              <DetailView log={selected} />
            </>
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
}
