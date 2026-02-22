"use client";

import { useState, useMemo } from "react";
import { useSearchParams } from "next/navigation";
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
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { DatePresetFilter, type DatePreset } from "@/components/ui/date-preset-filter";
import { Plus, ArrowUpDown, ArrowUp, ArrowDown, X, FileText, ChevronDown, Pencil, Link } from "lucide-react";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
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
  const searchParams = useSearchParams();
  const [data, setData] = useState(initialData);
  const [clients, setClients] = useState(initialClients);
  const [sorting, setSorting] = useState<SortingState>([
    { id: "invoice_number", desc: false },
  ]);
  const [statusFilters, setStatusFilters] = useState<string[]>(
    searchParams.get("status") ? [searchParams.get("status")!] : []
  );
  const [clientFilters, setClientFilters] = useState<string[]>([]);
  const [datePreset, setDatePreset] = useState<DatePreset>("year");
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const [detailItem, setDetailItem] = useState<Invoice | null>(null);
  const [isEditMode, setIsEditMode] = useState(false);
  const [loading, setLoading] = useState(false);
  const [addingFile, setAddingFile] = useState(false);
  const [fileUrl, setFileUrl] = useState("");

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
    setAddingFile(false);
    setFileUrl("");
  };

  const handleSaveFileUrl = async () => {
    if (!detailItem || !fileUrl.trim()) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/invoices/${detailItem.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ file_url: fileUrl.trim() }),
      });
      if (!res.ok) {
        const err = await res.json();
        alert(err.error ?? "Error saving file URL");
        return;
      }
      setDetailItem({ ...detailItem, file_url: fileUrl.trim() });
      setAddingFile(false);
      setFileUrl("");
      await refresh();
    } finally {
      setLoading(false);
    }
  };

  const hasActiveFilters =
    statusFilters.length > 0 || clientFilters.length > 0 || datePreset !== "year";

  const clearFilters = () => {
    setStatusFilters([]);
    setClientFilters([]);
    setDatePreset("year");
    setCustomFrom("");
    setCustomTo("");
  };

  const toggleStatus = (val: string) =>
    setStatusFilters((prev) =>
      prev.includes(val) ? prev.filter((s) => s !== val) : [...prev, val]
    );

  const toggleClient = (id: string) =>
    setClientFilters((prev) =>
      prev.includes(id) ? prev.filter((c) => c !== id) : [...prev, id]
    );

  const filtered = useMemo(() => {
    const now = new Date();
    const y = now.getFullYear();
    const mo = now.getMonth() + 1;
    let df = "";
    let dt = "";
    if (datePreset === "year") {
      df = `${y}-01-01`;
      dt = `${y}-12-31`;
    } else if (datePreset === "month") {
      const lastDay = new Date(y, mo, 0).getDate();
      const mStr = String(mo).padStart(2, "0");
      df = `${y}-${mStr}-01`;
      dt = `${y}-${mStr}-${String(lastDay).padStart(2, "0")}`;
    } else if (datePreset === "custom") {
      df = customFrom;
      dt = customTo;
    }
    let result = data;
    if (statusFilters.length > 0) result = result.filter((i) => statusFilters.includes(i.status));
    if (clientFilters.length > 0) result = result.filter((i) => clientFilters.includes(i.client_id));
    if (df) result = result.filter((i) => i.due_date >= df);
    if (dt) result = result.filter((i) => i.due_date <= dt);
    return result;
  }, [data, statusFilters, clientFilters, datePreset, customFrom, customTo]);

  const totals = useMemo(() => {
    const amount = filtered.reduce((sum, i) => sum + i.amount_cents, 0);
    const fee = filtered.reduce((sum, i) => sum + i.fee_cents, 0);
    return { amount, fee, net: amount + fee };
  }, [filtered]);


  const columns: ColumnDef<Invoice>[] = [
    {
      accessorKey: "invoice_number",
      size: 80,
      header: ({ column }) => {
        const sorted = column.getIsSorted();
        return (
          <Button
            variant="ghost"
            size="sm"
            className="-mx-2.5"
            onClick={() => column.toggleSorting(sorted === "asc")}
          >
            Inv{" "}
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
      cell: ({ row }) => (
        <div className="flex items-center gap-1.5">
          {row.original.invoice_number ? (
            <span className="font-mono text-sm">{row.original.invoice_number}</span>
          ) : (
            <span className="text-muted-foreground">—</span>
          )}
          {row.original.notes && (
            <span
              className="inline-flex items-center justify-center h-4 w-4 rounded-full bg-muted text-muted-foreground shrink-0"
              title={row.original.notes}
            >
              <FileText className="h-2.5 w-2.5" />
            </span>
          )}
        </div>
      ),
      sortingFn: (a, b) => {
        const aNum = a.original.invoice_number ?? "";
        const bNum = b.original.invoice_number ?? "";
        return aNum.localeCompare(bNum, undefined, { numeric: true });
      },
    },
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
      accessorKey: "amount_cents",
      header: "Amount",
      cell: ({ row }) => (
        <span className="tabular-nums">{formatCents(row.original.amount_cents)}</span>
      ),
    },
    {
      accessorKey: "fee_cents",
      header: "Fee",
      cell: ({ row }) =>
        row.original.fee_cents === 0 ? (
          <span className="text-muted-foreground">—</span>
        ) : (
          <span className="tabular-nums text-muted-foreground">
            {formatCents(row.original.fee_cents)}
          </span>
        ),
    },
    {
      id: "net",
      header: "Net",
      cell: ({ row }) => (
        <span className="tabular-nums">
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
      header: ({ column }) => {
        const sorted = column.getIsSorted();
        return (
          <Button
            variant="ghost"
            size="sm"
            className="-mx-2.5"
            onClick={() => column.toggleSorting(sorted === "asc")}
          >
            Due Date{" "}
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
      cell: ({ row }) => formatDate(row.original.due_date),
      sortingFn: (a, b) =>
        new Date(a.original.due_date).getTime() -
        new Date(b.original.due_date).getTime(),
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
    getFilteredRowModel: getFilteredRowModel(),
  });

  return (
    <div className="space-y-4">
      {/* Toolbar */}
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between sm:gap-3">
        <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm" className="h-9 w-full justify-between gap-1 font-normal sm:w-auto sm:min-w-36">
                <span className="truncate">
                  {statusFilters.length === 0
                    ? "All statuses"
                    : statusFilters.length === 1
                    ? STATUS_LABELS[statusFilters[0]]
                    : `${statusFilters.length} statuses`}
                </span>
                <ChevronDown className="h-3.5 w-3.5 shrink-0 opacity-50" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start">
              {(["pending", "accounting", "sent", "paid"] as const).map((s) => (
                <DropdownMenuCheckboxItem
                  key={s}
                  checked={statusFilters.includes(s)}
                  onCheckedChange={() => toggleStatus(s)}
                >
                  {STATUS_LABELS[s]}
                </DropdownMenuCheckboxItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm" className="h-9 w-full justify-between gap-1 font-normal sm:w-auto sm:min-w-40">
                <span className="truncate">
                  {clientFilters.length === 0
                    ? "All clients"
                    : clientFilters.length === 1
                    ? (clients.find((c) => c.id === clientFilters[0])?.name ?? "1 client")
                    : `${clientFilters.length} clients`}
                </span>
                <ChevronDown className="h-3.5 w-3.5 shrink-0 opacity-50" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start">
              {clients.map((c) => (
                <DropdownMenuCheckboxItem
                  key={c.id}
                  checked={clientFilters.includes(c.id)}
                  onCheckedChange={() => toggleClient(c.id)}
                >
                  {c.name}
                </DropdownMenuCheckboxItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>

          <DatePresetFilter
            preset={datePreset}
            customFrom={customFrom}
            customTo={customTo}
            onPresetChange={setDatePreset}
            onCustomFromChange={setCustomFrom}
            onCustomToChange={setCustomTo}
          />

          {hasActiveFilters && (
            <Button variant="ghost" size="sm" onClick={clearFilters} className="w-full text-muted-foreground sm:w-auto">
              <X className="mr-1 h-3 w-3" /> Clear
            </Button>
          )}
        </div>

        <div className="grid grid-cols-2 gap-2 sm:flex sm:shrink-0 sm:items-center sm:gap-2">
          <div className="[&>button]:w-full sm:[&>button]:w-auto">
            <ClientManager clients={clients} onRefresh={refresh} />
          </div>
          <Button className="w-full sm:w-auto" onClick={() => setCreateOpen(true)}>
            <Plus className="mr-2 h-4 w-4" /> New Invoice
          </Button>
        </div>
      </div>

      {/* Totals */}
      <div className="overflow-x-auto rounded-md border bg-muted/30">
        <div className="flex min-w-max items-center gap-6 px-4 py-2 text-sm">
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
      </div>

      {/* Table */}
      <div className="rounded-md border">
        <Table>
          <TableHeader>
            {table.getHeaderGroups().map((hg) => (
              <TableRow key={hg.id}>
                {hg.headers.map((header) => (
                  <TableHead
                    key={header.id}
                    style={header.column.getSize() !== 150 ? { width: `${header.column.getSize()}px` } : undefined}
                  >
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
        <DialogContent
          className={isEditMode ? "max-w-lg" : "max-w-md"}
          showCloseButton={isEditMode}
        >
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              {isEditMode ? (
                "Edit Invoice"
              ) : (
                <>
                  <span>{`Invoice${detailItem?.invoice_number ? ` #${detailItem.invoice_number}` : ""}`}</span>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-6 w-6 text-muted-foreground hover:text-foreground"
                    onClick={() => setIsEditMode(true)}
                  >
                    <Pencil className="h-3.5 w-3.5" />
                  </Button>
                </>
              )}
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
              {addingFile ? (
                <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                  <Input
                    placeholder="https://..."
                    value={fileUrl}
                    onChange={(e) => setFileUrl(e.target.value)}
                    className="flex-1"
                    autoFocus
                    onKeyDown={(e) => e.key === "Enter" && handleSaveFileUrl()}
                  />
                  <div className="flex gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => { setAddingFile(false); setFileUrl(""); }}
                    >
                      Cancel
                    </Button>
                    <Button
                      size="sm"
                      onClick={handleSaveFileUrl}
                      disabled={loading || !fileUrl.trim()}
                    >
                      {loading ? "Saving..." : "Save"}
                    </Button>
                  </div>
                </div>
              ) : (
                <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                  {detailItem.file_url ? (
                    <Button variant="outline" size="sm" className="w-full sm:w-auto" asChild>
                      <a href={detailItem.file_url} target="_blank" rel="noopener noreferrer">
                        <FileText className="mr-2 h-4 w-4" />
                        View file
                      </a>
                    </Button>
                  ) : (
                    <Button
                      variant="outline"
                      size="sm"
                      className="w-full sm:w-auto border-dashed text-muted-foreground"
                      onClick={() => setAddingFile(true)}
                    >
                      <Link className="mr-2 h-4 w-4" />
                      Add file
                    </Button>
                  )}
                  <div className="border-t sm:border-t-0 sm:border-l sm:h-6 sm:ml-auto" />
                  <Button
                    variant="ghost"
                    size="sm"
                    className="w-full sm:w-auto"
                    onClick={closeDetail}
                  >
                    Close
                  </Button>
                </div>
              )}
            </div>
          ) : null}
        </DialogContent>
      </Dialog>
    </div>
  );
}
