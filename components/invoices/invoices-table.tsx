"use client";

import { useState, useMemo } from "react";
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
import { DateRangePicker } from "@/components/ui/date-range-picker";
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
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { MoreHorizontal, Plus, ArrowUpDown, X, FileText } from "lucide-react";
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
  file_url: string | null;
  created_at: string;
  updated_at: string;
  client: Client;
}

const STATUS_CLASSES: Record<string, string> = {
  pending: "bg-gray-100 text-gray-600 border-gray-200 hover:bg-gray-100 dark:bg-gray-800 dark:text-gray-400 dark:border-gray-700",
  accounting: "bg-orange-100 text-orange-700 border-orange-200 hover:bg-orange-100 dark:bg-orange-900/30 dark:text-orange-400 dark:border-orange-800",
  sent: "bg-blue-100 text-blue-700 border-blue-200 hover:bg-blue-100 dark:bg-blue-900/30 dark:text-blue-400 dark:border-blue-800",
  paid: "bg-green-100 text-green-800 border-green-300 hover:bg-green-100 dark:bg-green-900/25 dark:text-green-500 dark:border-green-900",
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
  const [statusFilter, setStatusFilter] = useState("all");
  const [clientFilter, setClientFilter] = useState("all");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const [detailItem, setDetailItem] = useState<Invoice | null>(null);
  const [isEditMode, setIsEditMode] = useState(false);
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
    if (!detailItem) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/invoices/${detailItem.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      });
      if (!res.ok) {
        const err = await res.json();
        alert(err.error ?? "Error updating invoice");
        return;
      }
      await refresh();
      setDetailItem(null);
      setIsEditMode(false);
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async (id: string) => {
    await fetch(`/api/invoices/${id}`, { method: "DELETE" });
    await refresh();
  };

  const openDetail = (inv: Invoice) => {
    setIsEditMode(false);
    setDetailItem(inv);
  };

  const openEdit = (inv: Invoice) => {
    setDetailItem(inv);
    setIsEditMode(true);
  };

  const closeDetail = () => {
    setDetailItem(null);
    setIsEditMode(false);
  };

  const hasActiveFilters =
    statusFilter !== "all" || clientFilter !== "all" || !!dateFrom || !!dateTo;

  const clearFilters = () => {
    setStatusFilter("all");
    setClientFilter("all");
    setDateFrom("");
    setDateTo("");
  };

  const filtered = useMemo(() => {
    let result = data;
    if (statusFilter !== "all") result = result.filter((i) => i.status === statusFilter);
    if (clientFilter !== "all") result = result.filter((i) => i.client_id === clientFilter);
    if (dateFrom) result = result.filter((i) => i.due_date >= dateFrom);
    if (dateTo) result = result.filter((i) => i.due_date <= dateTo);
    return result;
  }, [data, statusFilter, clientFilter, dateFrom, dateTo]);

  const totals = useMemo(() => {
    const amount = filtered.reduce((sum, i) => sum + i.amount_cents, 0);
    const fee = filtered.reduce((sum, i) => sum + i.fee_cents, 0);
    return { amount, fee, net: amount + fee };
  }, [filtered]);

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
      accessorKey: "amount_cents",
      header: "Amount",
      cell: ({ row }) => (
        <span className="tabular-nums">{formatCents(row.original.amount_cents)}</span>
      ),
    },
    {
      accessorKey: "fee_cents",
      header: "Fee",
      cell: ({ row }) => (
        <span className="tabular-nums text-muted-foreground">
          {formatCents(row.original.fee_cents)}
        </span>
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
        <Badge variant="outline" className={STATUS_CLASSES[row.original.status]}>
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
        return (
          <div onClick={(e) => e.stopPropagation()}>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon" className="h-8 w-8">
                  <MoreHorizontal className="h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={() => openDetail(inv)}>
                  View details
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => openEdit(inv)}>
                  Edit
                </DropdownMenuItem>
                {inv.file_url && (
                  <DropdownMenuItem asChild>
                    <a href={inv.file_url} target="_blank" rel="noopener noreferrer">
                      View file
                    </a>
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
      <div className="flex items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
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

          <Select value={clientFilter} onValueChange={setClientFilter}>
            <SelectTrigger className="w-40">
              <SelectValue placeholder="All clients" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All clients</SelectItem>
              {clients.map((c) => (
                <SelectItem key={c.id} value={c.id}>
                  {c.name}
                </SelectItem>
              ))}
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

        </div>

        <div className="flex items-center gap-2 shrink-0">
          <ClientManager clients={clients} onRefresh={refresh} />
          <Button onClick={() => setCreateOpen(true)}>
            <Plus className="mr-2 h-4 w-4" /> New Invoice
          </Button>
        </div>
      </div>

      {/* Totals */}
      <div className="flex items-center gap-6 rounded-md border bg-muted/30 px-4 py-2 text-sm">
        <div>
          <span className="text-muted-foreground">Amount </span>
          <span className="font-medium tabular-nums">{formatCents(totals.amount)}</span>
        </div>
        <div>
          <span className="text-muted-foreground">Fee </span>
          <span className="font-medium tabular-nums">{formatCents(totals.fee)}</span>
        </div>
        <div>
          <span className="text-muted-foreground">Net </span>
          <span className="font-semibold tabular-nums">{formatCents(totals.net)}</span>
        </div>
        <span className="ml-auto text-muted-foreground">
          {filtered.length} invoices
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

      {/* Detail / Edit dialog — single Dialog to avoid Radix focus conflicts */}
      <Dialog open={!!detailItem} onOpenChange={(o) => !o && closeDetail()}>
        <DialogContent className={isEditMode ? "max-w-lg" : "max-w-md"}>
          <DialogHeader>
            <DialogTitle>
              {isEditMode
                ? "Edit Invoice"
                : `Invoice${detailItem?.invoice_number ? ` #${detailItem.invoice_number}` : ""}`}
            </DialogTitle>
          </DialogHeader>

          {detailItem && isEditMode ? (
            <InvoiceForm
              key={detailItem.id}
              clients={clients}
              defaultValues={{
                ...detailItem,
                due_date: detailItem.due_date.slice(0, 10),
                reminder_date: detailItem.reminder_date?.slice(0, 10) ?? null,
              }}
              onSubmit={handleEdit}
              onCancel={() => setIsEditMode(false)}
              onDelete={async () => {
                await handleDelete(detailItem.id);
                closeDetail();
              }}
              loading={loading}
            />
          ) : detailItem ? (
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
                    <Select
                      value={detailItem.status}
                      onValueChange={async (newStatus) => {
                        await fetch(`/api/invoices/${detailItem.id}`, {
                          method: "PATCH",
                          headers: { "Content-Type": "application/json" },
                          body: JSON.stringify({ status: newStatus }),
                        });
                        setDetailItem({ ...detailItem, status: newStatus as Invoice["status"] });
                        await refresh();
                      }}
                    >
                      <SelectTrigger className="h-7 w-36 text-xs">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="pending">Pending</SelectItem>
                        <SelectItem value="accounting">Accounting</SelectItem>
                        <SelectItem value="sent">Sent</SelectItem>
                        <SelectItem value="paid">Paid</SelectItem>
                      </SelectContent>
                    </Select>
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

              <div className="border-t" />
              <div className="flex items-center justify-between">
                {detailItem.file_url ? (
                  <Button variant="outline" size="sm" asChild>
                    <a href={detailItem.file_url} target="_blank" rel="noopener noreferrer">
                      <FileText className="mr-1.5 h-4 w-4" />
                      View file
                    </a>
                  </Button>
                ) : (
                  <span />
                )}
                <div className="flex gap-2">
                  <Button variant="outline" onClick={() => setIsEditMode(true)}>
                    Edit
                  </Button>
                  <Button variant="outline" onClick={closeDetail}>
                    Close
                  </Button>
                </div>
              </div>
            </div>
          ) : null}
        </DialogContent>
      </Dialog>
    </div>
  );
}
