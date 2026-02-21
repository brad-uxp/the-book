"use client";

import { useState, useMemo } from "react";
import {
  useReactTable,
  getCoreRowModel,
  getSortedRowModel,
  flexRender,
  type ColumnDef,
  type SortingState,
} from "@tanstack/react-table";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { DateRangePicker } from "@/components/ui/date-range-picker";
import { ArrowUpDown, X, Plus, Trash2, Pencil } from "lucide-react";
import { formatCents } from "@/lib/currency";
import { formatDate, formatPeriodKey } from "@/lib/dates";
import { useSearchParams, useRouter } from "next/navigation";
import { OtherExpenseForm } from "./other-expense-form";
import { toast } from "sonner";

interface ExpenseItem {
  id: string;
  type: "subscription" | "salary" | "other";
  name: string;
  category: string | null;
  paid_at: string;
  amount_cents: number;
  period_key: string;
  source_id: string;
  // salary-specific
  adjustment_cents?: number;
  adjustment_note?: string | null;
  // other-specific
  notes?: string | null;
}

const CATEGORY_LABELS: Record<string, string> = {
  work: "Work",
  personal: "Personal",
  essential_service: "Essential",
};

interface Props {
  items: ExpenseItem[];
}

export function ExpenseTable({ items }: Props) {
  const searchParams = useSearchParams();
  const router = useRouter();
  const sourceId = searchParams.get("source");
  const sourceName = searchParams.get("name");

  const [sorting, setSorting] = useState<SortingState>([
    { id: "paid_at", desc: true },
  ]);
  const [detail, setDetail] = useState<ExpenseItem | null>(null);
  const [createOpen, setCreateOpen] = useState(false);

  // Detail modal state
  const [editing, setEditing] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [editValues, setEditValues] = useState({
    name: "",
    category: "",
    paid_at: "",
    amount: "",
    adjustment: "",
    adjustment_note: "",
    notes: "",
  });

  // Filters
  const [nameFilter, setNameFilter] = useState("");
  const [typeFilter, setTypeFilter] = useState("all");
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");

  const hasActiveFilters =
    nameFilter || typeFilter !== "all" || categoryFilter !== "all" ||
    dateFrom || dateTo;

  const clearFilters = () => {
    setNameFilter("");
    setTypeFilter("all");
    setCategoryFilter("all");
    setDateFrom("");
    setDateTo("");
  };

  const openDetail = (item: ExpenseItem) => {
    setDetail(item);
    setEditing(false);
    setDeleteConfirm(false);
  };

  const startEdit = () => {
    if (!detail) return;
    setEditValues({
      name: detail.name,
      category: detail.category ?? "",
      paid_at: detail.paid_at.slice(0, 10),
      amount: detail.type !== "salary"
        ? (detail.amount_cents / 100).toFixed(2)
        : "",
      adjustment: detail.type === "salary"
        ? ((detail.adjustment_cents ?? 0) / 100).toFixed(2)
        : "",
      adjustment_note: detail.adjustment_note ?? "",
      notes: detail.notes ?? "",
    });
    setEditing(true);
    setDeleteConfirm(false);
  };

  const handleSave = async () => {
    if (!detail) return;
    setSaving(true);
    try {
      if (detail.type === "other") {
        const amount_cents = Math.round(parseFloat(editValues.amount) * 100);
        if (!amount_cents || amount_cents <= 0) {
          toast.error("Amount must be greater than 0");
          return;
        }
        const res = await fetch(`/api/other-expenses/${detail.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: editValues.name.trim(),
            category: editValues.category,
            paid_at: editValues.paid_at,
            amount_cents,
            notes: editValues.notes.trim() || null,
          }),
        });
        if (!res.ok) throw new Error();
      } else if (detail.type === "salary") {
        const adjustment_cents = Math.round(
          parseFloat(editValues.adjustment || "0") * 100
        );
        const res = await fetch(`/api/salary-payments/${detail.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            paid_at: editValues.paid_at,
            adjustment_cents,
            adjustment_note: editValues.adjustment_note.trim() || null,
          }),
        });
        if (!res.ok) throw new Error();
      } else if (detail.type === "subscription") {
        const amount_cents = Math.round(parseFloat(editValues.amount) * 100);
        if (!amount_cents || amount_cents <= 0) {
          toast.error("Amount must be greater than 0");
          return;
        }
        const res = await fetch(`/api/subscription-payments/${detail.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            paid_at: editValues.paid_at,
            amount_cents,
          }),
        });
        if (!res.ok) throw new Error();
      }
      toast.success("Updated");
      setDetail(null);
      setEditing(false);
      router.refresh();
    } catch {
      toast.error("Failed to update");
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!detail) return;
    setSaving(true);
    try {
      let url = "";
      if (detail.type === "other") url = `/api/other-expenses/${detail.id}`;
      else if (detail.type === "salary") url = `/api/salary-payments/${detail.id}`;
      else if (detail.type === "subscription") url = `/api/subscription-payments/${detail.id}`;

      const res = await fetch(url, { method: "DELETE" });
      if (!res.ok) throw new Error();
      toast.success("Deleted");
      setDetail(null);
      router.refresh();
    } catch {
      toast.error("Failed to delete");
    } finally {
      setSaving(false);
    }
  };

  const filtered = useMemo(() => {
    let result = items;
    if (sourceId) result = result.filter((i) => i.source_id === sourceId);
    if (typeFilter !== "all") result = result.filter((i) => i.type === typeFilter);
    if (categoryFilter !== "all") result = result.filter((i) => i.category === categoryFilter);
    if (nameFilter) result = result.filter((i) => i.name.toLowerCase().includes(nameFilter.toLowerCase()));
    if (dateFrom) result = result.filter((i) => i.paid_at >= dateFrom);
    if (dateTo) result = result.filter((i) => i.paid_at <= dateTo + "T23:59:59");
    return result;
  }, [items, sourceId, typeFilter, categoryFilter, nameFilter, dateFrom, dateTo]);

  const totalAmount = useMemo(
    () => filtered.reduce((sum, i) => sum + i.amount_cents, 0),
    [filtered]
  );

  const columns: ColumnDef<ExpenseItem>[] = [
    {
      accessorKey: "type",
      header: "Type",
      cell: ({ row }) => {
        const t = row.original.type;
        const cls =
          t === "salary"
            ? "bg-purple-100 text-purple-700 border-purple-200 hover:bg-purple-100 dark:bg-purple-900/30 dark:text-purple-300 dark:border-purple-800"
            : t === "other"
            ? "bg-gray-200 text-gray-600 border-gray-300 hover:bg-gray-200 dark:bg-gray-800 dark:text-gray-400 dark:border-gray-700"
            : "bg-orange-100 text-orange-700 border-orange-200 hover:bg-orange-100 dark:bg-orange-900/30 dark:text-orange-400 dark:border-orange-800";
        const label = t === "salary" ? "Salary" : t === "other" ? "Other" : "Subscription";
        return <Badge variant="outline" className={cls}>{label}</Badge>;
      },
    },
    {
      accessorKey: "name",
      header: ({ column }) => (
        <Button
          variant="ghost"
          size="sm"
          onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
        >
          Name <ArrowUpDown className="ml-1 h-3 w-3" />
        </Button>
      ),
    },
    {
      accessorKey: "category",
      header: "Category",
      cell: ({ row }) =>
        row.original.category
          ? CATEGORY_LABELS[row.original.category] ?? row.original.category
          : "—",
    },
    {
      accessorKey: "period_key",
      header: "Period",
      cell: ({ row }) => formatPeriodKey(row.original.period_key),
    },
    {
      accessorKey: "paid_at",
      header: ({ column }) => (
        <Button
          variant="ghost"
          size="sm"
          onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
        >
          Date <ArrowUpDown className="ml-1 h-3 w-3" />
        </Button>
      ),
      cell: ({ row }) => formatDate(row.original.paid_at),
      sortingFn: (a, b) =>
        new Date(a.original.paid_at).getTime() -
        new Date(b.original.paid_at).getTime(),
    },
    {
      accessorKey: "amount_cents",
      header: ({ column }) => (
        <Button
          variant="ghost"
          size="sm"
          onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
        >
          Amount <ArrowUpDown className="ml-1 h-3 w-3" />
        </Button>
      ),
      cell: ({ row }) => (
        <span className="font-medium tabular-nums">
          {formatCents(row.original.amount_cents)}
        </span>
      ),
    },
  ];

  const table = useReactTable({
    data: filtered,
    columns,
    state: { sorting },
    onSortingChange: setSorting,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
  });

  return (
    <div className="space-y-4">
      {/* Source filter banner */}
      {sourceId && (
        <div className="flex items-center gap-2 rounded-md border border-blue-200 bg-blue-50 px-3 py-2 text-sm text-blue-800 dark:border-blue-800 dark:bg-blue-950 dark:text-blue-200">
          <span>
            Showing payment history for <strong>{sourceName ?? sourceId}</strong>
          </span>
          <Button
            variant="ghost"
            size="icon"
            className="ml-auto h-5 w-5 text-blue-600 hover:text-blue-800 hover:bg-blue-100 dark:text-blue-300"
            onClick={() => router.push("/expenses")}
          >
            <X className="h-3 w-3" />
          </Button>
        </div>
      )}

      {/* Filters */}
      <div className="space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <Input
            placeholder="Filter by name..."
            value={nameFilter}
            onChange={(e) => setNameFilter(e.target.value)}
            className="w-48"
          />
          <Select value={typeFilter} onValueChange={setTypeFilter}>
            <SelectTrigger className="w-36">
              <SelectValue placeholder="All types" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All types</SelectItem>
              <SelectItem value="subscription">Subscription</SelectItem>
              <SelectItem value="salary">Salary</SelectItem>
              <SelectItem value="other">Other</SelectItem>
            </SelectContent>
          </Select>
          <Select value={categoryFilter} onValueChange={setCategoryFilter}>
            <SelectTrigger className="w-36">
              <SelectValue placeholder="All categories" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All categories</SelectItem>
              <SelectItem value="work">Work</SelectItem>
              <SelectItem value="personal">Personal</SelectItem>
              <SelectItem value="essential_service">Essential</SelectItem>
            </SelectContent>
          </Select>
          <DateRangePicker
            value={{ from: dateFrom, to: dateTo }}
            onChange={({ from, to }) => { setDateFrom(from); setDateTo(to); }}
          />
          {hasActiveFilters && (
            <Button variant="ghost" size="sm" onClick={clearFilters} className="text-muted-foreground">
              <X className="mr-1 h-3 w-3" /> Clear
            </Button>
          )}
          <Button className="ml-auto shrink-0" onClick={() => setCreateOpen(true)}>
            <Plus className="mr-2 h-4 w-4" /> Add expense
          </Button>
        </div>
      </div>

      {/* Totals */}
      <div className="flex items-center gap-6 rounded-md border bg-muted/30 px-4 py-2 text-sm">
        <div>
          <span className="text-muted-foreground">Total </span>
          <span className="font-semibold tabular-nums">{formatCents(totalAmount)}</span>
        </div>
        <span className="ml-auto text-muted-foreground">
          {filtered.length} records
        </span>
      </div>

      {/* Table */}
      <div className="rounded-md border">
        <Table>
          <TableHeader>
            {table.getHeaderGroups().map((hg) => (
              <TableRow key={hg.id}>
                {hg.headers.map((header) => (
                  <TableHead key={header.id}>
                    {header.isPlaceholder
                      ? null
                      : flexRender(header.column.columnDef.header, header.getContext())}
                  </TableHead>
                ))}
              </TableRow>
            ))}
          </TableHeader>
          <TableBody>
            {table.getRowModel().rows.length === 0 ? (
              <TableRow>
                <TableCell
                  colSpan={columns.length}
                  className="h-24 text-center text-muted-foreground"
                >
                  No expenses found.
                </TableCell>
              </TableRow>
            ) : (
              table.getRowModel().rows.map((row) => (
                <TableRow
                  key={row.id}
                  className="cursor-pointer hover:bg-muted/50"
                  onClick={() => openDetail(row.original)}
                >
                  {row.getVisibleCells().map((cell) => (
                    <TableCell key={cell.id}>
                      {flexRender(cell.column.columnDef.cell, cell.getContext())}
                    </TableCell>
                  ))}
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      {/* Detail / Edit modal */}
      <Dialog
        open={!!detail}
        onOpenChange={(o) => {
          if (!o) {
            setDetail(null);
            setEditing(false);
            setDeleteConfirm(false);
          }
        }}
      >
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>
              {editing ? "Edit expense" : detail?.name}
            </DialogTitle>
          </DialogHeader>

          {/* ── Detail view ── */}
          {detail && !editing && (
            <>
              <dl className="grid grid-cols-2 gap-3 text-sm">
                <div>
                  <dt className="text-muted-foreground">Type</dt>
                  <dd className="font-medium capitalize">{detail.type}</dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">Amount</dt>
                  <dd className="font-medium">{formatCents(detail.amount_cents)}</dd>
                </div>
                {detail.type === "salary" &&
                  detail.adjustment_cents !== undefined &&
                  detail.adjustment_cents !== 0 && (
                    <div>
                      <dt className="text-muted-foreground">Adjustment</dt>
                      <dd className="font-medium">{formatCents(detail.adjustment_cents)}</dd>
                    </div>
                  )}
                <div>
                  <dt className="text-muted-foreground">Period</dt>
                  <dd className="font-medium">{formatPeriodKey(detail.period_key)}</dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">Date</dt>
                  <dd className="font-medium">{formatDate(detail.paid_at)}</dd>
                </div>
                {detail.category && (
                  <div>
                    <dt className="text-muted-foreground">Category</dt>
                    <dd className="font-medium">
                      {CATEGORY_LABELS[detail.category] ?? detail.category}
                    </dd>
                  </div>
                )}
                {detail.type === "salary" && detail.adjustment_note && (
                  <div className="col-span-2">
                    <dt className="text-muted-foreground">Adjustment note</dt>
                    <dd className="font-medium">{detail.adjustment_note}</dd>
                  </div>
                )}
                {detail.type === "other" && detail.notes && (
                  <div className="col-span-2">
                    <dt className="text-muted-foreground">Notes</dt>
                    <dd className="font-medium">{detail.notes}</dd>
                  </div>
                )}
              </dl>

              <div className="border-t" />

              {!deleteConfirm ? (
                <div className="flex items-center justify-between">
                  <Button variant="ghost" size="sm" onClick={startEdit}>
                    <Pencil className="mr-2 h-4 w-4" />
                    Edit
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-destructive hover:text-destructive hover:bg-destructive/10"
                    onClick={() => setDeleteConfirm(true)}
                  >
                    <Trash2 className="mr-2 h-4 w-4" />
                    Delete
                  </Button>
                </div>
              ) : (
                <div className="space-y-3">
                  <p className="text-sm text-muted-foreground">
                    Are you sure you want to delete this expense? This action cannot be undone.
                  </p>
                  <div className="flex justify-end gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setDeleteConfirm(false)}
                      disabled={saving}
                    >
                      Cancel
                    </Button>
                    <Button
                      variant="destructive"
                      size="sm"
                      onClick={handleDelete}
                      disabled={saving}
                    >
                      {saving ? "Deleting..." : "Confirm delete"}
                    </Button>
                  </div>
                </div>
              )}
            </>
          )}

          {/* ── Edit form ── */}
          {detail && editing && (
            <>
              <div className="space-y-3">
                {detail.type === "other" && (
                  <>
                    <div className="space-y-1.5">
                      <Label>Name</Label>
                      <Input
                        value={editValues.name}
                        onChange={(e) =>
                          setEditValues((v) => ({ ...v, name: e.target.value }))
                        }
                      />
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <div className="space-y-1.5">
                        <Label>Category</Label>
                        <Select
                          value={editValues.category}
                          onValueChange={(v) =>
                            setEditValues((e) => ({ ...e, category: v }))
                          }
                        >
                          <SelectTrigger>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="work">Work</SelectItem>
                            <SelectItem value="personal">Personal</SelectItem>
                            <SelectItem value="essential_service">Essential</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="space-y-1.5">
                        <Label>Date</Label>
                        <Input
                          type="date"
                          value={editValues.paid_at}
                          onChange={(e) =>
                            setEditValues((v) => ({ ...v, paid_at: e.target.value }))
                          }
                        />
                      </div>
                    </div>
                    <div className="space-y-1.5">
                      <Label>Amount (USD)</Label>
                      <Input
                        type="number"
                        step="0.01"
                        min="0.01"
                        value={editValues.amount}
                        onChange={(e) =>
                          setEditValues((v) => ({ ...v, amount: e.target.value }))
                        }
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label>Notes</Label>
                      <Input
                        value={editValues.notes}
                        placeholder="Optional"
                        onChange={(e) =>
                          setEditValues((v) => ({ ...v, notes: e.target.value }))
                        }
                      />
                    </div>
                  </>
                )}

                {detail.type === "subscription" && (
                  <>
                    <div className="space-y-1.5">
                      <Label>Date</Label>
                      <Input
                        type="date"
                        value={editValues.paid_at}
                        onChange={(e) =>
                          setEditValues((v) => ({ ...v, paid_at: e.target.value }))
                        }
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label>Amount (USD)</Label>
                      <Input
                        type="number"
                        step="0.01"
                        min="0.01"
                        value={editValues.amount}
                        onChange={(e) =>
                          setEditValues((v) => ({ ...v, amount: e.target.value }))
                        }
                      />
                    </div>
                  </>
                )}

                {detail.type === "salary" && (
                  <>
                    <div className="space-y-1.5">
                      <Label>Date</Label>
                      <Input
                        type="date"
                        value={editValues.paid_at}
                        onChange={(e) =>
                          setEditValues((v) => ({ ...v, paid_at: e.target.value }))
                        }
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label>Adjustment (USD)</Label>
                      <Input
                        type="number"
                        step="0.01"
                        value={editValues.adjustment}
                        placeholder="0.00"
                        onChange={(e) =>
                          setEditValues((v) => ({ ...v, adjustment: e.target.value }))
                        }
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label>Adjustment note</Label>
                      <Input
                        value={editValues.adjustment_note}
                        placeholder="Optional reason"
                        onChange={(e) =>
                          setEditValues((v) => ({
                            ...v,
                            adjustment_note: e.target.value,
                          }))
                        }
                      />
                    </div>
                  </>
                )}
              </div>

              <div className="border-t" />

              <div className="flex justify-end gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setEditing(false)}
                  disabled={saving}
                >
                  Cancel
                </Button>
                <Button size="sm" onClick={handleSave} disabled={saving}>
                  {saving ? "Saving..." : "Save"}
                </Button>
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>

      {/* Create other expense dialog */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Add expense</DialogTitle>
          </DialogHeader>
          <OtherExpenseForm
            onSuccess={() => {
              setCreateOpen(false);
              router.refresh();
            }}
            onCancel={() => setCreateOpen(false)}
          />
        </DialogContent>
      </Dialog>
    </div>
  );
}
