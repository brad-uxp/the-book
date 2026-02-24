"use client";

import { useMemo, useState } from "react";
import {
  useReactTable,
  getCoreRowModel,
  getSortedRowModel,
  flexRender,
  type ColumnDef,
  type SortingState,
} from "@tanstack/react-table";
import { ArrowUpDown, MoreHorizontal } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatDate } from "@/lib/dates";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  type Issue,
  type Client,
  COLUMNS,
} from "./inline-editors";

interface Props {
  issues: Issue[];
  clients: Client[];
  onSelectIssue: (issue: Issue) => void;
  onDeleteIssue: (issue: Issue) => void;
  onConvertCategory: (issue: Issue) => void;
}

export function IssuesList({ issues, clients, onSelectIssue, onDeleteIssue, onConvertCategory }: Props) {
  const [sorting, setSorting] = useState<SortingState>([]);

  const columns = useMemo<ColumnDef<Issue>[]>(
    () => [
      {
        accessorKey: "title",
        header: ({ column }) => (
          <button
            className="flex items-center gap-1 hover:text-foreground transition-colors"
            onClick={() => column.toggleSorting()}
          >
            Title
            <ArrowUpDown className="h-3 w-3" />
          </button>
        ),
        cell: ({ row }) => (
          <span className="font-medium">{row.original.title}</span>
        ),
      },
      {
        accessorKey: "client",
        header: ({ column }) => (
          <button
            className="flex items-center gap-1 hover:text-foreground transition-colors"
            onClick={() => column.toggleSorting()}
          >
            Client
            <ArrowUpDown className="h-3 w-3" />
          </button>
        ),
        sortingFn: (a, b) => {
          const aName = a.original.client?.name ?? "";
          const bName = b.original.client?.name ?? "";
          return aName.localeCompare(bName);
        },
        cell: ({ row }) => {
          const client = row.original.client;
          if (!client) {
            return (
              <span className="text-xs text-muted-foreground/50">
                No client
              </span>
            );
          }
          return (
            <span
              className="inline-flex items-center rounded px-1.5 py-0.5 text-xs font-medium"
              style={{
                backgroundColor: client.color_hex + "18",
                color: client.color_hex,
                border: `1px solid ${client.color_hex}30`,
              }}
            >
              {client.name}
            </span>
          );
        },
      },
      {
        accessorKey: "status",
        header: ({ column }) => (
          <button
            className="flex items-center gap-1 hover:text-foreground transition-colors"
            onClick={() => column.toggleSorting()}
          >
            Status
            <ArrowUpDown className="h-3 w-3" />
          </button>
        ),
        cell: ({ row }) => {
          if (row.original.category === "note") {
            return <span className="text-xs text-muted-foreground/50">{"\u2014"}</span>;
          }
          const col = COLUMNS.find((c) => c.id === row.original.status);
          return (
            <div className="flex items-center gap-1.5">
              <span
                className="h-2 w-2 rounded-full shrink-0"
                style={{ backgroundColor: col?.color }}
              />
              <span className="text-sm">{col?.label}</span>
            </div>
          );
        },
      },
      {
        accessorKey: "progress",
        header: ({ column }) => (
          <button
            className="flex items-center gap-1 hover:text-foreground transition-colors"
            onClick={() => column.toggleSorting()}
          >
            Progress
            <ArrowUpDown className="h-3 w-3" />
          </button>
        ),
        cell: ({ row }) => {
          if (row.original.category === "note") {
            return <span className="text-xs text-muted-foreground/50">{"\u2014"}</span>;
          }
          const value = row.original.progress;
          const col = COLUMNS.find((c) => c.id === row.original.status);
          const color = col?.color ?? "#94a3b8";
          return (
            <div className="flex items-center gap-2 min-w-24">
              <span className="text-xs font-medium tabular-nums shrink-0">
                {value}%
              </span>
              <div className="h-1 flex-1 rounded-full bg-muted overflow-hidden">
                <div
                  className="h-full rounded-full"
                  style={{ width: `${value}%`, backgroundColor: color }}
                />
              </div>
            </div>
          );
        },
      },
      {
        accessorKey: "due_date",
        header: ({ column }) => (
          <button
            className="flex items-center gap-1 hover:text-foreground transition-colors"
            onClick={() => column.toggleSorting()}
          >
            Due date
            <ArrowUpDown className="h-3 w-3" />
          </button>
        ),
        cell: ({ row }) => {
          if (row.original.category === "note") {
            return <span className="text-xs text-muted-foreground/50">{"\u2014"}</span>;
          }
          const dateStr = row.original.due_date;
          if (!dateStr) {
            return <span className="text-xs text-muted-foreground/50">{"\u2014"}</span>;
          }
          const status = row.original.status;
          const diff = new Date(dateStr).getTime() - Date.now();
          const overdue = diff < 0;
          const dueSoon = diff > 0 && diff < 3 * 24 * 60 * 60 * 1000;

          return (
            <span
              className={cn(
                "text-sm",
                status !== "done" && overdue
                  ? "text-red-600 font-medium"
                  : status !== "done" && dueSoon
                  ? "text-orange-600 font-medium"
                  : "text-muted-foreground"
              )}
            >
              {formatDate(dateStr)}
            </span>
          );
        },
      },
      {
        id: "actions",
        header: () => null,
        cell: ({ row }) => (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                className="p-1 rounded opacity-0 group-hover/row:opacity-100 text-muted-foreground hover:text-foreground hover:bg-accent transition-all"
                onClick={(e) => e.stopPropagation()}
              >
                <MoreHorizontal className="h-3.5 w-3.5" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" onClick={(e) => e.stopPropagation()}>
              <DropdownMenuItem onClick={() => onConvertCategory(row.original)}>
                {row.original.category === "task" ? "Convert to note" : "Convert to task"}
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem variant="destructive" onClick={() => onDeleteIssue(row.original)}>
                Delete
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        ),
      },
    ],
    [onDeleteIssue, onConvertCategory]
  );

  const table = useReactTable({
    data: issues,
    columns,
    state: { sorting },
    onSortingChange: setSorting,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
  });

  return (
    <div className="rounded-lg border overflow-hidden">
      <table className="w-full text-sm">
        <thead>
          {table.getHeaderGroups().map((hg) => (
            <tr key={hg.id} className="border-b bg-muted/50">
              {hg.headers.map((header) => (
                <th
                  key={header.id}
                  className="px-4 py-2.5 text-left text-xs font-medium text-muted-foreground"
                >
                  {header.isPlaceholder
                    ? null
                    : flexRender(header.column.columnDef.header, header.getContext())}
                </th>
              ))}
            </tr>
          ))}
        </thead>
        <tbody>
          {table.getRowModel().rows.length === 0 ? (
            <tr>
              <td colSpan={columns.length} className="px-4 py-12 text-center text-muted-foreground">
                No issues
              </td>
            </tr>
          ) : (
            table.getRowModel().rows.map((row) => (
              <tr
                key={row.id}
                className="border-b last:border-b-0 hover:bg-muted/30 transition-colors cursor-pointer group/row"
                onClick={() => onSelectIssue(row.original)}
              >
                {row.getVisibleCells().map((cell) => (
                  <td key={cell.id} className="px-4 py-2.5">
                    {flexRender(cell.column.columnDef.cell, cell.getContext())}
                  </td>
                ))}
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}
