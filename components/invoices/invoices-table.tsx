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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { MoreHorizontal, Plus, ArrowUpDown, ChevronRight } from "lucide-react";
import { formatCents } from "@/lib/currency";
import { formatDate } from "@/lib/dates";
import { InvoiceForm } from "./invoice-form";
import { ClientManager } from "./client-manager";
import type { InvoiceInput } from "@/lib/validations";

interface Client {
  id: string;
  name: string;
  color_hex: string;
}

interface Invoice {
  id: string;
  invoice_number: string | null;
  client_id: string;
  amount_cents: number;
  fee_cents: number;
  status: "pending" | "accounting" | "sent" | "paid";
  due_date: string;
  reminder_date: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
  client: Client;
}

const STATUS_COLORS: Record<string, "default" | "secondary" | "outline" | "destructive"> = {
  pending: "outline",
  accounting: "secondary",
  sent: "default",
  paid: "secondary",
};

const STATUS_FLOW: Record<string, string> = {
  pending: "accounting",
  accounting: "sent",
  sent: "paid",
};

const STATUS_LABELS: Record<string, string> = {
  pending: "Pending",
  accounting: "Accounting",
  sent: "Sent",
  paid: "Paid",
};

interface Props {
  initialData: Invoice[];
  initialClients: Client[];
}

export function InvoicesTable({ initialData, initialClients }: Props) {
  const [data, setData] = useState(initialData);
  const [clients, setClients] = useState(initialClients);
  const [sorting, setSorting] = useState<SortingState>([
    { id: "due_date", desc: true },
  ]);
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [createOpen, setCreateOpen] = useState(false);
  const [editItem, setEditItem] = useState<Invoice | null>(null);
  const [detailItem, setDetailItem] = useState<Invoice | null>(null);
  const [loading, setLoading] = useState(false);

  const refresh = async () => {
    const [invRes, cliRes] = await Promise.all([
      fetch("/api/invoices"),
      fetch("/api/clients"),
    ]);
    if (invRes.ok) setData(await invRes.json());
    if (cliRes.ok) setClients(await cliRes.json());
  };

  const handleCreate = async (input: InvoiceInput) => {
    setLoading(true);
    try {
      const res = await fetch("/api/invoices", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      });
      if (!res.ok) {
        const err = await res.json();
        alert(err.error ?? "Error creating invoice");
        return;
      }
      await refresh();
      setCreateOpen(false);
    } finally {
      setLoading(false);
    }
  };

  const handleEdit = async (input: InvoiceInput) => {
    if (!editItem) return;
    setLoading(true);
    try {
      await fetch(`/api/invoices/${editItem.id}`, {
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

  const handleAdvanceStatus = async (invoice: Invoice) => {
    const next = STATUS_FLOW[invoice.status];
    if (!next) return;
    await fetch(`/api/invoices/${invoice.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: next }),
    });
    await refresh();
  };

  const handleDelete = async (id: string) => {
    if (!confirm("Delete this invoice?")) return;
    await fetch(`/api/invoices/${id}`, { method: "DELETE" });
    await refresh();
  };

  const filtered =
    statusFilter === "all" ? data : data.filter((i) => i.status === statusFilter);

  const columns: ColumnDef<Invoice>[] = [
    {
      id: "client",
      header: "Client",
      cell: ({ row }) => (
        <div className="flex items-center gap-2">
          <span
            className="inline-block h-2.5 w-2.5 rounded-full shrink-0"
            style={{ backgroundColor: row.original.client.color_hex }}
          />
          <span>{row.original.client.name}</span>
        </div>
      ),
    },
    {
      accessorKey: "invoice_number",
      header: "Invoice #",
      cell: ({ row }) =>
        row.original.invoice_number ? (
          <span className="font-mono text-sm">{row.original.invoice_number}</span>
        ) : (
          <span className="text-muted-foreground">—</span>
        ),
    },
    {
      id: "amount",
      header: "Amount",
      cell: ({ row }) => (
        <div className="text-right tabular-nums">
          <div>{formatCents(row.original.amount_cents)}</div>
          {row.original.fee_cents !== 0 && (
            <div className="text-xs text-muted-foreground">
              fee: {formatCents(row.original.fee_cents)}
            </div>
          )}
        </div>
      ),
    },
    {
      id: "net",
      header: "Net",
      cell: ({ row }) => (
        <span className="font-semibold tabular-nums">
          {formatCents(row.original.amount_cents + row.original.fee_cents)}
        </span>
      ),
    },
    {
      accessorKey: "status",
      header: "Status",
      cell: ({ row }) => (
        <Badge variant={STATUS_COLORS[row.original.status]}>
          {STATUS_LABELS[row.original.status]}
        </Badge>
      ),
    },
    {
      accessorKey: "due_date",
      header: ({ column }) => (
        <Button
          variant="ghost"
          size="sm"
          onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
        >
          Due Date <ArrowUpDown className="ml-1 h-3 w-3" />
        </Button>
      ),
      cell: ({ row }) => formatDate(row.original.due_date),
      sortingFn: (a, b) =>
        new Date(a.original.due_date).getTime() -
        new Date(b.original.due_date).getTime(),
    },
    {
      id: "actions",
      header: "",
      cell: ({ row }) => {
        const inv = row.original;
        const nextStatus = STATUS_FLOW[inv.status];
        return (
          <div className="flex items-center gap-1">
            {nextStatus && (
              <Button
                variant="ghost"
                size="sm"
                className="h-7 text-xs"
                onClick={(e) => {
                  e.stopPropagation();
                  handleAdvanceStatus(inv);
                }}
              >
                → {STATUS_LABELS[nextStatus]}
              </Button>
            )}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8"
                  onClick={(e) => e.stopPropagation()}
                >
                  <MoreHorizontal className="h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={() => setDetailItem(inv)}>
                  View details
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => setEditItem(inv)}>
                  Edit
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  className="text-destructive"
                  onClick={() => handleDelete(inv.id)}
                >
                  Delete
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        );
      },
    },
  ];

  const table = useReactTable({
    data: filtered,
    columns,
    state: { sorting },
    onSortingChange: setSorting,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
  });

  return (
    <div className="space-y-4">
      {/* Toolbar */}
      <div className="flex items-center gap-3">
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-36">
            <SelectValue placeholder="All statuses" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All statuses</SelectItem>
            <SelectItem value="pending">Pending</SelectItem>
            <SelectItem value="accounting">Accounting</SelectItem>
            <SelectItem value="sent">Sent</SelectItem>
            <SelectItem value="paid">Paid</SelectItem>
          </SelectContent>
        </Select>

        <span className="text-sm text-muted-foreground">
          {filtered.length} invoices
        </span>

        <div className="ml-auto flex gap-2">
          <ClientManager clients={clients} onRefresh={refresh} />
          <Button onClick={() => setCreateOpen(true)}>
            <Plus className="mr-2 h-4 w-4" /> New Invoice
          </Button>
        </div>
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
                  No invoices found.
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
            <DialogTitle>New Invoice</DialogTitle>
          </DialogHeader>
          <InvoiceForm
            clients={clients}
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
            <DialogTitle>Edit Invoice</DialogTitle>
          </DialogHeader>
          {editItem && (
            <InvoiceForm
              clients={clients}
              defaultValues={{
                ...editItem,
                due_date: editItem.due_date.slice(0, 10),
                reminder_date: editItem.reminder_date?.slice(0, 10) ?? null,
              }}
              onSubmit={handleEdit}
              onCancel={() => setEditItem(null)}
              loading={loading}
            />
          )}
        </DialogContent>
      </Dialog>

      {/* Detail dialog */}
      <Dialog
        open={!!detailItem}
        onOpenChange={(o) => !o && setDetailItem(null)}
      >
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>
              Invoice{detailItem?.invoice_number ? ` #${detailItem.invoice_number}` : ""}
            </DialogTitle>
          </DialogHeader>
          {detailItem && (
            <div className="space-y-4">
              <dl className="grid grid-cols-2 gap-3 text-sm">
                <div>
                  <dt className="text-muted-foreground">Client</dt>
                  <dd className="flex items-center gap-1.5 font-medium">
                    <span
                      className="inline-block h-2.5 w-2.5 rounded-full"
                      style={{ backgroundColor: detailItem.client.color_hex }}
                    />
                    {detailItem.client.name}
                  </dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">Status</dt>
                  <dd>
                    <Badge variant={STATUS_COLORS[detailItem.status]}>
                      {STATUS_LABELS[detailItem.status]}
                    </Badge>
                  </dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">Amount (gross)</dt>
                  <dd className="font-medium">
                    {formatCents(detailItem.amount_cents)}
                  </dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">Fee</dt>
                  <dd className="font-medium">
                    {formatCents(detailItem.fee_cents)}
                  </dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">Net (received)</dt>
                  <dd className="font-bold text-base">
                    {formatCents(detailItem.amount_cents + detailItem.fee_cents)}
                  </dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">Due Date</dt>
                  <dd className="font-medium">{formatDate(detailItem.due_date)}</dd>
                </div>
                {detailItem.reminder_date && (
                  <div>
                    <dt className="text-muted-foreground">Reminder</dt>
                    <dd className="font-medium">
                      {formatDate(detailItem.reminder_date)}
                    </dd>
                  </div>
                )}
                {detailItem.notes && (
                  <div className="col-span-2">
                    <dt className="text-muted-foreground">Notes</dt>
                    <dd>{detailItem.notes}</dd>
                  </div>
                )}
              </dl>

              {/* Status flow */}
              {STATUS_FLOW[detailItem.status] && (
                <div className="flex items-center gap-2 text-sm">
                  <Badge variant={STATUS_COLORS[detailItem.status]}>
                    {STATUS_LABELS[detailItem.status]}
                  </Badge>
                  <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      handleAdvanceStatus(detailItem);
                      setDetailItem(null);
                    }}
                  >
                    Move to {STATUS_LABELS[STATUS_FLOW[detailItem.status]]}
                  </Button>
                </div>
              )}

              <div className="flex justify-end gap-2">
                <Button
                  variant="outline"
                  onClick={() => {
                    setDetailItem(null);
                    setEditItem(detailItem);
                  }}
                >
                  Edit
                </Button>
                <Button
                  variant="outline"
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
