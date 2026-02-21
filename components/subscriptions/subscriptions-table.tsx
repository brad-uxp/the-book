"use client";

import { useState } from "react";
import {
  useReactTable,
  getCoreRowModel,
  getFilteredRowModel,
  getSortedRowModel,
  flexRender,
  type ColumnDef,
  type SortingState,
  type ColumnFiltersState,
} from "@tanstack/react-table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { MoreHorizontal, Plus, ArrowUpDown, ArrowUp, ArrowDown, History } from "lucide-react";
import { useRouter } from "next/navigation";
import { formatCents } from "@/lib/currency";
import { formatDate, formatPeriodKey } from "@/lib/dates";
import { SubscriptionForm } from "./subscription-form";
import type { SubscriptionInput } from "@/lib/validations";

function faviconSrc(iconUrl: string | null): string | null {
  if (!iconUrl) return null;
  return `${iconUrl.replace(/\/$/, "")}/favicon.ico`;
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
  status: "active" | "paused" | "canceled";
  notes: string | null;
  icon_url: string | null;
  payments: Array<{
    id: string;
    period_key: string;
    paid_at: string;
    amount_cents_snapshot: number;
  }>;
}

const STATUS_CLASSES: Record<string, string> = {
  active:   "bg-orange-100 text-orange-700 border-orange-200 hover:bg-orange-100 dark:bg-orange-900/30 dark:text-orange-400 dark:border-orange-800",
  paused:   "bg-gray-100 text-gray-600 border-gray-200 hover:bg-gray-100 dark:bg-gray-800 dark:text-gray-400 dark:border-gray-700",
  canceled: "bg-blue-100 text-blue-700 border-blue-200 hover:bg-blue-100 dark:bg-blue-900/30 dark:text-blue-400 dark:border-blue-800",
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
  const [columnFilters, setColumnFilters] = useState<ColumnFiltersState>([]);
  const [createOpen, setCreateOpen] = useState(false);
  const [editItem, setEditItem] = useState<Subscription | null>(null);
  const [detailItem, setDetailItem] = useState<Subscription | null>(null);
  const [paymentSub, setPaymentSub] = useState<Subscription | null>(null);
  const [paymentDate, setPaymentDate] = useState("");
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
          body: JSON.stringify({ paid_at: paymentDate || new Date().toISOString().slice(0, 10) }),
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
        const favicon = faviconSrc(row.original.icon_url);
        return (
          <div className="flex items-center gap-2">
            {favicon && (
              <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-sm border bg-white">
                <img
                  src={favicon}
                  alt=""
                  className="h-4 w-4 object-contain"
                  onError={(e) => { (e.currentTarget.parentElement as HTMLElement).style.display = "none"; }}
                />
              </div>
            )}
            {row.original.name}
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
            {formatPeriodKey(last.period_key)} · {formatDate(last.paid_at)}
          </span>
        );
      },
    },
    {
      id: "actions",
      header: "",
      cell: ({ row }) => {
        const sub = row.original;
        return (
          <div onClick={(e) => e.stopPropagation()}>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" className="h-5 w-5">
                <MoreHorizontal className="h-3.5 w-3.5" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={() => setDetailItem(sub)}>
                View details
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => setEditItem(sub)}>
                Edit
              </DropdownMenuItem>
              {sub.status === "active" && (
                <DropdownMenuItem onClick={() => setPaymentSub(sub)}>
                  Register payment
                </DropdownMenuItem>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
          </div>
        );
      },
    },
  ];

  const table = useReactTable({
    data,
    columns,
    state: { sorting, columnFilters },
    onSortingChange: setSorting,
    onColumnFiltersChange: setColumnFilters,
    enableMultiSort: false,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
  });

  return (
    <div className="space-y-4">
      {/* Toolbar */}
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <Input
          placeholder="Filter by name..."
          value={(table.getColumn("name")?.getFilterValue() as string) ?? ""}
          onChange={(e) =>
            table.getColumn("name")?.setFilterValue(e.target.value)
          }
          className="w-full sm:max-w-xs"
        />
        <Button className="w-full sm:w-auto" onClick={() => setCreateOpen(true)}>
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
          if (!o) { setPaymentSub(null); setPaymentDate(""); }
        }}
      >
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Register Payment — {paymentSub?.name}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 pt-2">
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
                onClick={() => { setPaymentSub(null); setPaymentDate(""); }}
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
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              {detailItem?.icon_url && (
                <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-sm border bg-white">
                  <img
                    src={faviconSrc(detailItem.icon_url)!}
                    alt=""
                    className="h-5 w-5 object-contain"
                    onError={(e) => { (e.currentTarget.parentElement as HTMLElement).style.display = "none"; }}
                  />
                </div>
              )}
              {detailItem?.name}
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
              <div className="flex items-center justify-between">
                <Button
                  variant="outline"
                  size="sm"
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
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => { setDetailItem(null); setEditItem(detailItem); }}
                  >
                    Edit
                  </Button>
                  <Button variant="outline" size="sm" onClick={() => setDetailItem(null)}>
                    Close
                  </Button>
                </div>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
