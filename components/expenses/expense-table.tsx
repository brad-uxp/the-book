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
import { ArrowUpDown } from "lucide-react";
import { formatCents } from "@/lib/currency";
import { formatDate, formatPeriodKey } from "@/lib/dates";

interface ExpenseItem {
  id: string;
  type: "subscription" | "salary";
  name: string;
  category: string | null;
  paid_at: string;
  amount_cents: number;
  period_key: string;
  source_id: string;
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
  const [sorting, setSorting] = useState<SortingState>([
    { id: "paid_at", desc: true },
  ]);
  const [columnFilters, setColumnFilters] = useState<ColumnFiltersState>([]);
  const [typeFilter, setTypeFilter] = useState<string>("all");
  const [detail, setDetail] = useState<ExpenseItem | null>(null);

  const filtered = typeFilter === "all"
    ? items
    : items.filter((i) => i.type === typeFilter);

  const columns: ColumnDef<ExpenseItem>[] = [
    {
      id: "type",
      header: "Type",
      accessorKey: "type",
      cell: ({ row }) => (
        <Badge
          variant={row.original.type === "salary" ? "default" : "secondary"}
        >
          {row.original.type === "salary" ? "Salary" : "Subscription"}
        </Badge>
      ),
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
      id: "category",
      header: "Category",
      cell: ({ row }) =>
        row.original.category
          ? CATEGORY_LABELS[row.original.category] ?? row.original.category
          : "—",
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
    {
      id: "period",
      header: "Period",
      cell: ({ row }) => formatPeriodKey(row.original.period_key),
    },
  ];

  const table = useReactTable({
    data: filtered,
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
      <div className="flex items-center gap-3">
        <Input
          placeholder="Filter by name..."
          value={(table.getColumn("name")?.getFilterValue() as string) ?? ""}
          onChange={(e) =>
            table.getColumn("name")?.setFilterValue(e.target.value)
          }
          className="max-w-xs"
        />
        <Select value={typeFilter} onValueChange={setTypeFilter}>
          <SelectTrigger className="w-40">
            <SelectValue placeholder="All types" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All types</SelectItem>
            <SelectItem value="subscription">Subscriptions</SelectItem>
            <SelectItem value="salary">Salaries</SelectItem>
          </SelectContent>
        </Select>
        <span className="text-sm text-muted-foreground ml-auto">
          {table.getRowModel().rows.length} records
        </span>
      </div>

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
                  No expenses found.
                </TableCell>
              </TableRow>
            ) : (
              table.getRowModel().rows.map((row) => (
                <TableRow
                  key={row.id}
                  className="cursor-pointer hover:bg-muted/50"
                  onClick={() => setDetail(row.original)}
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

      {/* Detail modal */}
      <Dialog open={!!detail} onOpenChange={(o) => !o && setDetail(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>{detail?.name}</DialogTitle>
          </DialogHeader>
          {detail && (
            <dl className="grid grid-cols-2 gap-3 text-sm">
              <div>
                <dt className="text-muted-foreground">Type</dt>
                <dd className="font-medium capitalize">{detail.type}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Amount</dt>
                <dd className="font-medium">{formatCents(detail.amount_cents)}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Date</dt>
                <dd className="font-medium">{formatDate(detail.paid_at)}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Period</dt>
                <dd className="font-medium">{formatPeriodKey(detail.period_key)}</dd>
              </div>
              {detail.category && (
                <div>
                  <dt className="text-muted-foreground">Category</dt>
                  <dd className="font-medium">
                    {CATEGORY_LABELS[detail.category] ?? detail.category}
                  </dd>
                </div>
              )}
              <div>
                <dt className="text-muted-foreground">Source ID</dt>
                <dd className="font-mono text-xs truncate">{detail.source_id}</dd>
              </div>
            </dl>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
