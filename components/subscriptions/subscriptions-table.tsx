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
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { MoreHorizontal, Plus, ArrowUpDown } from "lucide-react";
import { formatCents } from "@/lib/currency";
import { formatDate, formatPeriodKey } from "@/lib/dates";
import { SubscriptionForm } from "./subscription-form";
import type { SubscriptionInput } from "@/lib/validations";

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
  payments: Array<{
    id: string;
    period_key: string;
    paid_at: string;
    amount_cents_snapshot: number;
  }>;
}

const STATUS_COLORS = {
  active: "default",
  paused: "secondary",
  canceled: "destructive",
} as const;

const CATEGORY_LABELS = {
  work: "Work",
  personal: "Personal",
  essential_service: "Essential",
};

interface Props {
  initialData: Subscription[];
}

export function SubscriptionsTable({ initialData }: Props) {
  const [data, setData] = useState(initialData);
  const [sorting, setSorting] = useState<SortingState>([]);
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
    if (!confirm("Delete this subscription and all its payments?")) return;
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
        <Badge variant={row.original.payment_mode === "auto" ? "default" : "secondary"}>
          {row.original.payment_mode === "auto" ? "Auto" : "Manual"}
        </Badge>
      ),
    },
    {
      accessorKey: "status",
      header: "Status",
      cell: ({ row }) => (
        <Badge variant={STATUS_COLORS[row.original.status]}>
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
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" className="h-8 w-8">
                <MoreHorizontal className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={() => setDetailItem(sub)}>
                View details
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => setEditItem(sub)}>
                Edit
              </DropdownMenuItem>
              {sub.status === "active" && sub.payment_mode === "manual" && (
                <DropdownMenuItem onClick={() => setPaymentSub(sub)}>
                  Register payment
                </DropdownMenuItem>
              )}
              <DropdownMenuSeparator />
              <DropdownMenuItem
                className="text-destructive"
                onClick={() => handleDelete(sub.id)}
              >
                Delete
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
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
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
  });

  return (
    <div className="space-y-4">
      {/* Toolbar */}
      <div className="flex items-center justify-between">
        <Input
          placeholder="Filter by name..."
          value={(table.getColumn("name")?.getFilterValue() as string) ?? ""}
          onChange={(e) =>
            table.getColumn("name")?.setFilterValue(e.target.value)
          }
          className="max-w-xs"
        />
        <Button onClick={() => setCreateOpen(true)}>
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
            <DialogTitle>{detailItem?.name}</DialogTitle>
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
                    <Badge variant={STATUS_COLORS[detailItem.status]}>
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

              {detailItem.payments.length > 0 && (
                <div>
                  <h4 className="mb-2 text-sm font-semibold">Payment History</h4>
                  <div className="space-y-1 max-h-40 overflow-y-auto">
                    {detailItem.payments.map((p) => (
                      <div
                        key={p.id}
                        className="flex justify-between text-sm border rounded px-3 py-1.5"
                      >
                        <span>{formatPeriodKey(p.period_key)}</span>
                        <span className="text-muted-foreground">
                          {formatDate(p.paid_at)}
                        </span>
                        <span className="font-medium">
                          {formatCents(p.amount_cents_snapshot)}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <div className="flex justify-end gap-2">
                <Button
                  variant="outline"
                  onClick={() => { setDetailItem(null); setEditItem(detailItem); }}
                >
                  Edit
                </Button>
                <Button variant="outline" onClick={() => setDetailItem(null)}>
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
