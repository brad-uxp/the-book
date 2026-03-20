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
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Plus, ArrowUpDown, ArrowUp, ArrowDown, History, FileText, X, CreditCard, Pencil } from "lucide-react";
import { useRouter } from "next/navigation";
import { formatCents } from "@/lib/currency";
import { formatDate } from "@/lib/dates";
import { SubscriptionForm } from "./subscription-form";
import type { SubscriptionInput } from "@/lib/validations";

function faviconSrc(iconUrl: string | null): string | null {
  if (!iconUrl) return null;
  try {
    const domain = new URL(iconUrl).hostname;
    return `https://www.google.com/s2/favicons?domain=${domain}&sz=64`;
  } catch {
    return null;
  }
}

function SubscriptionIcon({
  name,
  iconUrl,
  size = "sm",
}: {
  name: string;
  iconUrl: string | null;
  size?: "sm" | "md";
}) {
  const [imgError, setImgError] = useState(false);
  const favicon = faviconSrc(iconUrl);
  const showImg = favicon && !imgError;

  const outer = size === "sm"
    ? "flex h-6 w-6 shrink-0 items-center justify-center rounded-sm border"
    : "flex h-7 w-7 shrink-0 items-center justify-center rounded-sm border";

  return (
    <div className={`${outer} ${showImg ? "bg-white dark:bg-white/10" : "bg-muted text-muted-foreground"}`}>
      {showImg ? (
        <img
          src={favicon}
          alt=""
          className={size === "sm" ? "h-4 w-4 object-contain" : "h-5 w-5 object-contain"}
          onError={() => setImgError(true)}
        />
      ) : (
        <span className={size === "sm" ? "text-[10px] font-semibold leading-none" : "text-xs font-semibold leading-none"}>
          {name[0]?.toUpperCase()}
        </span>
      )}
    </div>
  );
}

interface Subscription {
  id: string;
  name: string;
  amount_cents: number;
  frequency: "monthly" | "annual";
  pay_day: number;
  pay_month: number | null;
  category: "work" | "personal" | "essential_service";
  payment_mode: "auto" | "manual";
  status: "active" | "inactive";
  notes: string | null;
  icon_url: string | null;
  paid_current_period: boolean;
  payments: Array<{
    id: string;
    due_date: string;
    paid_at: string;
    amount_cents_snapshot: number;
  }>;
}

const STATUS_CLASSES: Record<string, string> = {
  active:   "bg-orange-100 text-orange-700 border-orange-200 hover:bg-orange-100 dark:bg-orange-900/30 dark:text-orange-400 dark:border-orange-800",
  inactive: "bg-gray-100 text-gray-500 border-gray-200 hover:bg-gray-100 dark:bg-gray-800 dark:text-gray-400 dark:border-gray-700",
};

const CATEGORY_LABELS = {
  work: "Work",
  personal: "Personal",
  essential_service: "Essential",
};

interface Props {
  initialData: Subscription[];
}

export function SubscriptionsTable({ initialData }: Props) {
  const router = useRouter();
  const [data, setData] = useState(initialData);
  const [sorting, setSorting] = useState<SortingState>([{ id: "name", desc: false }]);
  const [createOpen, setCreateOpen] = useState(false);

  // Filters
  const [nameFilter, setNameFilter] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [modeFilter, setModeFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [unpaidThisMonth, setUnpaidThisMonth] = useState(false);

  const currentMonth = useMemo(() => new Date().getMonth() + 1, []);

  const hasActiveFilters = nameFilter || categoryFilter !== "all" || modeFilter !== "all" || statusFilter !== "all" || unpaidThisMonth;

  const clearFilters = () => {
    setNameFilter("");
    setCategoryFilter("all");
    setModeFilter("all");
    setStatusFilter("all");
    setUnpaidThisMonth(false);
  };

  const filtered = useMemo(() => {
    let result = data;
    if (nameFilter) result = result.filter((s) => s.name.toLowerCase().includes(nameFilter.toLowerCase()));
    if (categoryFilter !== "all") result = result.filter((s) => s.category === categoryFilter);
    if (modeFilter !== "all") result = result.filter((s) => s.payment_mode === modeFilter);
    if (statusFilter !== "all") result = result.filter((s) => s.status === statusFilter);
    if (unpaidThisMonth) {
      result = result.filter((s) => {
        if (s.status !== "active") return false;
        const shouldPay = s.frequency === "monthly" || (s.frequency === "annual" && s.pay_month === currentMonth);
        return shouldPay && !s.paid_current_period;
      });
    }
    return result;
  }, [data, nameFilter, categoryFilter, modeFilter, statusFilter, unpaidThisMonth, currentMonth]);
  const [editItem, setEditItem] = useState<Subscription | null>(null);
  const [detailItem, setDetailItem] = useState<Subscription | null>(null);
  const [paymentSub, setPaymentSub] = useState<Subscription | null>(null);
  const [paymentDate, setPaymentDate] = useState("");
  const [paymentAmount, setPaymentAmount] = useState("");
  const [loading, setLoading] = useState(false);

  const refresh = async () => {
    const res = await fetch("/api/subscriptions");
    if (res.ok) setData(await res.json());
  };

  const handleCreate = async (input: SubscriptionInput) => {
    setLoading(true);
    try {
      await fetch("/api/subscriptions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      });
      await refresh();
      setCreateOpen(false);
    } finally {
      setLoading(false);
    }
  };

  const handleEdit = async (input: SubscriptionInput) => {
    if (!editItem) return;
    setLoading(true);
    try {
      await fetch(`/api/subscriptions/${editItem.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      });
      await refresh();
      setEditItem(null);
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async (id: string) => {
    await fetch(`/api/subscriptions/${id}`, { method: "DELETE" });
    await refresh();
  };

  const handleRegisterPayment = async () => {
    if (!paymentSub) return;
    setLoading(true);
    try {
      const res = await fetch(
        `/api/subscriptions/${paymentSub.id}/payments`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            paid_at: paymentDate || new Date().toISOString().slice(0, 10),
            amount_cents: paymentAmount ? Math.round(parseFloat(paymentAmount) * 100) : undefined,
          }),
        }
      );
      if (!res.ok) {
        const err = await res.json();
        alert(err.error ?? "Error registering payment");
        return;
      }
      await refresh();
      setPaymentSub(null);
      setPaymentDate("");
      setPaymentAmount("");
    } finally {
      setLoading(false);
    }
  };

  const columns: ColumnDef<Subscription>[] = [
    {
      accessorKey: "name",
      header: ({ column }) => {
        const sorted = column.getIsSorted();
        return (
          <Button
            variant="ghost"
            size="sm"
            className="-mx-2.5"
            onClick={() => column.toggleSorting(sorted === "asc")}
          >
            Name{" "}
            {sorted === "asc" ? (
              <ArrowUp className="ml-0.5 h-3 w-3 text-primary" />
            ) : sorted === "desc" ? (
              <ArrowDown className="ml-0.5 h-3 w-3 text-primary" />
            ) : (
              <ArrowUpDown className="ml-0.5 h-3 w-3 text-muted-foreground opacity-50" />
            )}
          </Button>
        );
      },
      cell: ({ row }) => {
        return (
          <div className="flex items-center gap-2">
            <SubscriptionIcon name={row.original.name} iconUrl={row.original.icon_url} />
            {row.original.name}
            {row.original.notes && (
              <span
                className="inline-flex items-center justify-center h-4 w-4 rounded-full bg-muted text-muted-foreground shrink-0"
                title={row.original.notes}
              >
                <FileText className="h-2.5 w-2.5" />
              </span>
            )}
          </div>
        );
      },
    },
    {
      accessorKey: "amount_cents",
      header: "Amount",
      cell: ({ row }) => formatCents(row.original.amount_cents),
    },
    {
      accessorKey: "frequency",
      header: "Frequency",
      cell: ({ row }) => (
        <Badge variant="outline">
          {row.original.frequency === "monthly" ? "Monthly" : "Annual"}
        </Badge>
      ),
    },
    {
      accessorKey: "category",
      header: "Category",
      cell: ({ row }) => CATEGORY_LABELS[row.original.category],
    },
    {
      accessorKey: "payment_mode",
      header: "Mode",
      cell: ({ row }) => (
        <Badge
          variant="outline"
          className={
            row.original.payment_mode === "auto"
              ? "bg-gray-200 text-gray-600 border-gray-300 hover:bg-gray-200 dark:bg-gray-700 dark:text-gray-300 dark:border-gray-600"
              : "bg-gray-100 text-gray-500 border-gray-200 hover:bg-gray-100 dark:bg-gray-800 dark:text-gray-400 dark:border-gray-700"
          }
        >
          {row.original.payment_mode === "auto" ? "Auto" : "Manual"}
        </Badge>
      ),
    },
    {
      accessorKey: "status",
      header: "Status",
      cell: ({ row }) => (
        <Badge variant="outline" className={STATUS_CLASSES[row.original.status]}>
          {row.original.status}
        </Badge>
      ),
    },
    {
      id: "last_payment",
      header: "Last Payment",
      cell: ({ row }) => {
        const last = row.original.payments[0];
        if (!last) return <span className="text-muted-foreground">—</span>;
        return (
          <span className="text-sm">
            {formatDate(last.paid_at)}
          </span>
        );
      },
    },
  ];

  const table = useReactTable({
    data: filtered,
    columns,
    state: { sorting },
    onSortingChange: setSorting,
    enableMultiSort: false,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
  });

  return (
    <div className="space-y-4">
      {/* Toolbar */}
      <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
        <Input
          placeholder="Filter by name..."
          value={nameFilter}
          onChange={(e) => setNameFilter(e.target.value)}
          className="w-full sm:w-44"
        />
        <Select value={categoryFilter} onValueChange={setCategoryFilter}>
          <SelectTrigger className="w-full sm:w-36">
            <SelectValue placeholder="All categories" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All categories</SelectItem>
            <SelectItem value="work">Work</SelectItem>
            <SelectItem value="personal">Personal</SelectItem>
            <SelectItem value="essential_service">Essential</SelectItem>
          </SelectContent>
        </Select>
        <Select value={modeFilter} onValueChange={setModeFilter}>
          <SelectTrigger className="w-full sm:w-32">
            <SelectValue placeholder="All modes" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All modes</SelectItem>
            <SelectItem value="auto">Auto</SelectItem>
            <SelectItem value="manual">Manual</SelectItem>
          </SelectContent>
        </Select>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-full sm:w-32">
            <SelectValue placeholder="All statuses" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All statuses</SelectItem>
            <SelectItem value="active">Active</SelectItem>
            <SelectItem value="inactive">Inactive</SelectItem>
          </SelectContent>
        </Select>
        <Button
          variant={unpaidThisMonth ? "default" : "outline"}
          size="sm"
          className="w-full sm:w-auto h-9"
          onClick={() => setUnpaidThisMonth((v) => !v)}
        >
          Unpaid this month
        </Button>
        {hasActiveFilters && (
          <Button variant="ghost" size="sm" onClick={clearFilters} className="w-full text-muted-foreground sm:w-auto">
            <X className="mr-1 h-3 w-3" /> Clear
          </Button>
        )}
        <Button className="w-full sm:ml-auto sm:w-auto sm:shrink-0" onClick={() => setCreateOpen(true)}>
          <Plus className="mr-2 h-4 w-4" /> New Subscription
        </Button>
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
                      : flexRender(
                          header.column.columnDef.header,
                          header.getContext()
                        )}
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
                  No subscriptions found.
                </TableCell>
              </TableRow>
            ) : (
              table.getRowModel().rows.map((row) => (
                <TableRow
                  key={row.id}
                  className="cursor-pointer hover:bg-muted/50"
                  onClick={() => setDetailItem(row.original)}
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

      {/* Create dialog */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>New Subscription</DialogTitle>
          </DialogHeader>
          <SubscriptionForm
            onSubmit={handleCreate}
            onCancel={() => setCreateOpen(false)}
            loading={loading}
          />
        </DialogContent>
      </Dialog>

      {/* Edit dialog */}
      <Dialog open={!!editItem} onOpenChange={(o) => !o && setEditItem(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Edit Subscription</DialogTitle>
          </DialogHeader>
          {editItem && (
            <SubscriptionForm
              defaultValues={editItem}
              onSubmit={handleEdit}
              onCancel={() => setEditItem(null)}
              onDelete={async () => {
                await handleDelete(editItem.id);
                setEditItem(null);
              }}
              loading={loading}
            />
          )}
        </DialogContent>
      </Dialog>

      {/* Register payment dialog */}
      <Dialog
        open={!!paymentSub}
        onOpenChange={(o) => {
          if (!o) { setPaymentSub(null); setPaymentDate(""); setPaymentAmount(""); }
        }}
      >
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Register Payment — {paymentSub?.name}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 pt-2">
            <div>
              <label className="text-sm font-medium">Amount (USD)</label>
              <Input
                type="number"
                step="0.01"
                min="0.01"
                value={paymentAmount}
                onChange={(e) => setPaymentAmount(e.target.value)}
                className="mt-1"
              />
            </div>
            <div>
              <label className="text-sm font-medium">Payment Date</label>
              <Input
                type="date"
                value={paymentDate}
                onChange={(e) => setPaymentDate(e.target.value)}
                className="mt-1"
              />
              <p className="mt-1 text-xs text-muted-foreground">
                Leave empty to use today.
              </p>
            </div>
            <div className="flex justify-end gap-2">
              <Button
                variant="outline"
                onClick={() => { setPaymentSub(null); setPaymentDate(""); setPaymentAmount(""); }}
              >
                Cancel
              </Button>
              <Button onClick={handleRegisterPayment} disabled={loading}>
                {loading ? "Saving..." : "Register"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Detail dialog */}
      <Dialog
        open={!!detailItem}
        onOpenChange={(o) => !o && setDetailItem(null)}
      >
        <DialogContent className="max-w-lg" showCloseButton={false}>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              {detailItem && (
                <>
                  <SubscriptionIcon name={detailItem.name} iconUrl={detailItem.icon_url} size="md" />
                  <span>{detailItem.name}</span>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-6 w-6 text-muted-foreground hover:text-foreground"
                    onClick={() => { setDetailItem(null); setEditItem(detailItem); }}
                  >
                    <Pencil className="h-3.5 w-3.5" />
                  </Button>
                </>
              )}
            </DialogTitle>
          </DialogHeader>
          {detailItem && (
            <div className="space-y-4">
              <dl className="grid grid-cols-2 gap-3 text-sm">
                <div>
                  <dt className="text-muted-foreground">Amount</dt>
                  <dd className="font-medium">{formatCents(detailItem.amount_cents)}</dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">Frequency</dt>
                  <dd className="font-medium capitalize">{detailItem.frequency}</dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">Pay Day</dt>
                  <dd className="font-medium">
                    {detailItem.frequency === "annual"
                      ? `${detailItem.pay_month}/${detailItem.pay_day}`
                      : detailItem.pay_day}
                  </dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">Category</dt>
                  <dd className="font-medium">{CATEGORY_LABELS[detailItem.category]}</dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">Mode</dt>
                  <dd className="font-medium capitalize">{detailItem.payment_mode}</dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">Status</dt>
                  <dd>
                    <Badge variant="outline" className={STATUS_CLASSES[detailItem.status]}>
                      {detailItem.status}
                    </Badge>
                  </dd>
                </div>
                {detailItem.notes && (
                  <div className="col-span-2">
                    <dt className="text-muted-foreground">Notes</dt>
                    <dd className="font-medium">{detailItem.notes}</dd>
                  </div>
                )}
              </dl>

              <div className="border-t" />
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                <Button
                  variant="outline"
                  size="sm"
                  className="w-full sm:w-auto"
                  onClick={() => {
                    setDetailItem(null);
                    router.push(
                      `/expenses?source=${detailItem.id}&name=${encodeURIComponent(detailItem.name)}`
                    );
                  }}
                >
                  <History className="mr-2 h-4 w-4" />
                  Payment history
                </Button>
                {detailItem.status === "active" && (
                  <Button
                    variant="outline"
                    size="sm"
                    className="w-full sm:w-auto"
                    onClick={() => {
                      setDetailItem(null);
                      setPaymentSub(detailItem);
                      setPaymentAmount((detailItem.amount_cents / 100).toFixed(2));
                    }}
                  >
                    <CreditCard className="mr-2 h-4 w-4" />
                    Register payment
                  </Button>
                )}
                <div className="border-t sm:border-t-0 sm:border-l sm:h-6 sm:ml-auto" />
                <Button
                  variant="ghost"
                  size="sm"
                  className="w-full sm:w-auto"
                  onClick={() => setDetailItem(null)}
                >
                  Close
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
