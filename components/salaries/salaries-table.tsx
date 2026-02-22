"use client";

import { useState, useEffect } from "react";
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
import { MoreHorizontal, Plus, ArrowUpDown, ArrowUp, ArrowDown, History, User, FileText, LayoutList, LayoutGrid, Pencil, DollarSign, Users } from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
import { useRouter } from "next/navigation";
import { formatCents, parseToCents, centsToDecimalString } from "@/lib/currency";
import { formatDate } from "@/lib/dates";
import { PersonForm } from "./person-form";
import { RoleManager } from "./role-manager";
import type { PersonInput } from "@/lib/validations";

interface SalaryReminder {
  id: string;
  effective_date: string;
  suggested_new_base_cents: number;
  status: "scheduled" | "ignored" | "done";
}

interface SalaryPayment {
  id: string;
  due_date: string;
  paid_at: string;
  total_cents: number;
  base_salary_cents_snapshot: number;
  adjustment_cents: number;
  adjustment_note: string | null;
}

interface Role {
  id: string;
  name: string;
}

interface Person {
  id: string;
  name: string;
  payday_day: number;
  status: "active" | "inactive";
  role_id: string | null;
  role: Role | null;
  notes: string | null;
  salary_base: { base_salary_cents: number } | null;
  salary_payments: SalaryPayment[];
  increase_reminders: SalaryReminder[];
}

interface Props {
  initialData: Person[];
  initialRoles: Role[];
}

const STATUS_CLASSES: Record<string, string> = {
  active:   "bg-orange-100 text-orange-700 border-orange-200 hover:bg-orange-100 dark:bg-orange-900/30 dark:text-orange-400 dark:border-orange-800",
  inactive: "bg-gray-100 text-gray-500 border-gray-200 hover:bg-gray-100 dark:bg-gray-800 dark:text-gray-400 dark:border-gray-700",
};

const AVATAR_CLASSES: Record<string, string> = {
  active:   "bg-orange-100 text-orange-600 dark:bg-orange-900/30 dark:text-orange-400",
  inactive: "bg-gray-100 text-gray-400 dark:bg-gray-800 dark:text-gray-500",
};

export function SalariesTable({ initialData, initialRoles }: Props) {
  const router = useRouter();
  const [data, setData] = useState(initialData);
  const [roles, setRoles] = useState(initialRoles);
  const [sorting, setSorting] = useState<SortingState>([{ id: "name", desc: false }]);
  const [createOpen, setCreateOpen] = useState(false);
  const [editItem, setEditItem] = useState<Person | null>(null);
  const [detailPerson, setDetailPerson] = useState<Person | null>(null);
  const [paymentPerson, setPaymentPerson] = useState<Person | null>(null);
  const [reminderPerson, setReminderPerson] = useState<Person | null>(null);
  const [loading, setLoading] = useState(false);
  const [view, setView] = useState<"table" | "cards">("table");
  const [rolesOpen, setRolesOpen] = useState(false);

  // Bulk payment state
  const [bulkOpen, setBulkOpen] = useState(false);
  const [bulkDate, setBulkDate] = useState("");
  const [bulkSelected, setBulkSelected] = useState<Set<string>>(new Set());
  const [bulkOverrides, setBulkOverrides] = useState<Record<string, { adj: string; note: string }>>({});
  const [bulkErrors, setBulkErrors] = useState<Record<string, string>>({});

  // Default to cards on mobile
  useEffect(() => {
    if (window.innerWidth < 640) setView("cards");
  }, []);

  // Payment form state
  const [paidAt, setPaidAt] = useState("");
  const [adjustmentDollars, setAdjustmentDollars] = useState("0");
  const [adjustmentNote, setAdjustmentNote] = useState("");

  // Reminder form state
  const [reminderDate, setReminderDate] = useState("");
  const [reminderAmount, setReminderAmount] = useState("");

  const refresh = async () => {
    const [peopleRes, rolesRes] = await Promise.all([
      fetch("/api/people"),
      fetch("/api/roles"),
    ]);
    if (peopleRes.ok) setData(await peopleRes.json());
    if (rolesRes.ok) setRoles(await rolesRes.json());
  };

  const handleCreate = async (input: PersonInput) => {
    setLoading(true);
    try {
      await fetch("/api/people", {
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

  const handleEdit = async (input: PersonInput) => {
    if (!editItem) return;
    setLoading(true);
    try {
      await fetch(`/api/people/${editItem.id}`, {
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
    if (!confirm("Delete this person and all related data?")) return;
    await fetch(`/api/people/${id}`, { method: "DELETE" });
    await refresh();
  };

  const handleRegisterPayment = async () => {
    if (!paymentPerson) return;
    setLoading(true);
    try {
      const today = new Date().toISOString().slice(0, 10);
      const res = await fetch(`/api/people/${paymentPerson.id}/payments`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          paid_at: paidAt || today,
          adjustment_cents: parseToCents(adjustmentDollars || "0"),
          adjustment_note: adjustmentNote || null,
        }),
      });
      if (!res.ok) {
        const err = await res.json();
        alert(err.error ?? "Error registering payment");
        return;
      }
      await refresh();
      setPaymentPerson(null);
      setPaidAt("");
      setAdjustmentDollars("0");
      setAdjustmentNote("");
    } finally {
      setLoading(false);
    }
  };

  const handleCreateReminder = async () => {
    if (!reminderPerson) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/people/${reminderPerson.id}/reminders`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          effective_date: reminderDate,
          suggested_new_base_cents: parseToCents(reminderAmount),
        }),
      });
      if (!res.ok) {
        const err = await res.json();
        alert(err.error ?? "Error creating reminder");
        return;
      }
      await refresh();
      setReminderPerson(null);
      setReminderDate("");
      setReminderAmount("");
    } finally {
      setLoading(false);
    }
  };

  const handleReminderAction = async (
    personId: string,
    reminderId: string,
    action: "apply" | "ignore" | "reschedule",
    extra?: { new_effective_date?: string; new_suggested_base_cents?: number }
  ) => {
    const res = await fetch(`/api/people/${personId}/reminders`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ reminderId, action, ...extra }),
    });
    if (!res.ok) {
      const err = await res.json();
      alert(err.error ?? "Error updating reminder");
      return;
    }
    await refresh();
    // Refresh detail view
    if (detailPerson?.id === personId) {
      const refreshedRes = await fetch(`/api/people/${personId}`);
      if (refreshedRes.ok) setDetailPerson(await refreshedRes.json());
    }
  };

  // Bulk payment helpers
  const activePeople = data.filter((p) => p.status === "active");
  const allBulkSelected =
    activePeople.length > 0 && activePeople.every((p) => bulkSelected.has(p.id));
  const someBulkSelected = bulkSelected.size > 0 && !allBulkSelected;

  const toggleBulkAll = () => {
    if (allBulkSelected) setBulkSelected(new Set());
    else setBulkSelected(new Set(activePeople.map((p) => p.id)));
  };

  const toggleBulkOne = (id: string) =>
    setBulkSelected((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });

  const setBulkOverride = (id: string, field: "adj" | "note", val: string) =>
    setBulkOverrides((prev) => ({
      ...prev,
      [id]: { ...(prev[id] ?? { adj: "0", note: "" }), [field]: val },
    }));

  const closeBulk = () => {
    setBulkOpen(false);
    setBulkErrors({});
  };

  const handleBulkPayment = async () => {
    if (bulkSelected.size === 0) return;
    setLoading(true);
    try {
      const today = new Date().toISOString().slice(0, 10);
      const date = bulkDate || today;
      const results = await Promise.allSettled(
        [...bulkSelected].map(async (id) => {
          const override = bulkOverrides[id] ?? { adj: "0", note: "" };
          const res = await fetch(`/api/people/${id}/payments`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              paid_at: date,
              adjustment_cents: parseToCents(override.adj || "0"),
              adjustment_note: override.note || null,
            }),
          });
          if (!res.ok) {
            const err = await res.json();
            // eslint-disable-next-line @typescript-eslint/no-throw-literal
            throw { id, message: err.error ?? "Error registering payment" };
          }
        })
      );
      await refresh();
      const errors: Record<string, string> = {};
      for (const r of results) {
        if (r.status === "rejected") {
          const e = r.reason as { id?: string; message?: string };
          if (e?.id) errors[e.id] = e.message ?? "Error";
        }
      }
      if (Object.keys(errors).length === 0) {
        setBulkOpen(false);
        setBulkSelected(new Set());
        setBulkOverrides({});
        setBulkDate("");
        setBulkErrors({});
      } else {
        setBulkErrors(errors);
      }
    } finally {
      setLoading(false);
    }
  };

  const columns: ColumnDef<Person>[] = [
    {
      accessorKey: "name",
      cell: ({ row }) => (
        <div className="flex items-center gap-2">
          <div className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full ${AVATAR_CLASSES[row.original.status] ?? "bg-muted text-muted-foreground"}`}>
            <User className="h-3.5 w-3.5" />
          </div>
          <div>
            <div className="flex items-center gap-1.5">
              <span>{row.original.name}</span>
              {row.original.notes && (
                <span
                  className="inline-flex items-center justify-center h-4 w-4 rounded-full bg-muted text-muted-foreground shrink-0"
                  title={row.original.notes}
                >
                  <FileText className="h-2.5 w-2.5" />
                </span>
              )}
            </div>
            {row.original.role && (
              <p className="text-xs text-muted-foreground leading-tight">
                {row.original.role.name}
              </p>
            )}
          </div>
        </div>
      ),
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
    },
    {
      id: "salary",
      header: "Base Salary",
      cell: ({ row }) =>
        row.original.salary_base
          ? formatCents(row.original.salary_base.base_salary_cents)
          : "—",
    },
    {
      accessorKey: "payday_day",
      header: "Pay Day",
      cell: ({ row }) => `Day ${row.original.payday_day}`,
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
        const last = row.original.salary_payments[0];
        if (!last) return <span className="text-muted-foreground">—</span>;
        return (
          <span className="text-sm">
            {new Date(last.due_date).toLocaleString("en", { month: "short", year: "numeric" })} · {formatCents(last.total_cents)}
          </span>
        );
      },
    },
    {
      id: "next_reminder",
      header: "Raise Reminder",
      cell: ({ row }) => {
        const next = row.original.increase_reminders[0];
        if (!next) return <span className="text-muted-foreground">—</span>;
        return (
          <span className="text-sm text-amber-600">
            {formatDate(next.effective_date)} · {formatCents(next.suggested_new_base_cents)}
          </span>
        );
      },
    },
    {
      id: "actions",
      header: "",
      cell: ({ row }) => {
        const person = row.original;
        return (
          <div onClick={(e) => e.stopPropagation()}>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" className="h-5 w-5">
                <MoreHorizontal className="h-3.5 w-3.5" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={() => setDetailPerson(person)}>
                View details
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => setEditItem(person)}>
                Edit
              </DropdownMenuItem>
              {person.status === "active" && (
                <>
                  <DropdownMenuItem onClick={() => setPaymentPerson(person)}>
                    Register salary payment
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => setReminderPerson(person)}>
                    Add raise reminder
                  </DropdownMenuItem>
                </>
              )}
              <DropdownMenuSeparator />
              <DropdownMenuItem
                className="text-destructive"
                onClick={() => handleDelete(person.id)}
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
    data,
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
      <div className="flex items-center justify-between gap-2">
        {/* Left: view toggle — always visible */}
        <div className="flex overflow-hidden rounded-md border">
          <Button
            variant={view === "table" ? "secondary" : "ghost"}
            size="icon"
            className="h-9 w-9 rounded-none border-r"
            onClick={() => setView("table")}
            title="Table view"
          >
            <LayoutList className="h-4 w-4" />
          </Button>
          <Button
            variant={view === "cards" ? "secondary" : "ghost"}
            size="icon"
            className="h-9 w-9 rounded-none"
            onClick={() => setView("cards")}
            title="Cards view"
          >
            <LayoutGrid className="h-4 w-4" />
          </Button>
        </div>

        {/* Right */}
        <div className="flex items-center gap-2">
          {/* Desktop-only buttons */}
          <div className="hidden sm:flex items-center gap-2">
            <RoleManager roles={roles} onRefresh={refresh} open={rolesOpen} onOpenChange={setRolesOpen} />
            <Button variant="outline" className="h-9" onClick={() => setBulkOpen(true)}>
              <Users className="mr-2 h-4 w-4" /> Bulk Pay
            </Button>
            <Button className="h-9" onClick={() => setCreateOpen(true)}>
              <Plus className="mr-2 h-4 w-4" /> New Person
            </Button>
          </div>

          {/* Mobile-only 3-dot */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="icon" className="h-9 w-9 sm:hidden">
                <MoreHorizontal className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={() => setCreateOpen(true)}>
                <Plus className="mr-2 h-4 w-4" /> New Person
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => setBulkOpen(true)}>
                <Users className="mr-2 h-4 w-4" /> Bulk Pay
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={() => setRolesOpen(true)}>
                Manage Roles
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      {/* ── Cards view ─────────────────────────────────────────────────── */}
      {view === "cards" && (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {data.length === 0 ? (
            <p className="col-span-full text-center text-muted-foreground py-12">
              No people found. Add one to get started.
            </p>
          ) : (
            data.map((p) => (
              <div
                key={p.id}
                className="flex flex-col rounded-xl border bg-card shadow-sm overflow-hidden"
              >
                {/* Header */}
                <div className="flex items-start justify-between gap-2 p-4">
                  <div className="flex items-center gap-3 min-w-0">
                    <div
                      className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-full ${AVATAR_CLASSES[p.status] ?? "bg-muted text-muted-foreground"}`}
                    >
                      <User className="h-5 w-5" />
                    </div>
                    <div className="min-w-0">
                      <p className="font-semibold leading-tight truncate">{p.name}</p>
                      <div className="mt-1 flex flex-wrap items-center gap-1.5">
                        <Badge variant="outline" className={`${STATUS_CLASSES[p.status]} capitalize text-[11px] px-1.5 py-0`}>
                          {p.status}
                        </Badge>
                        {p.role && (
                          <span className="text-xs text-muted-foreground truncate">{p.role.name}</span>
                        )}
                      </div>
                    </div>
                  </div>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-9 w-9 shrink-0 -mr-1 -mt-1 text-muted-foreground hover:text-foreground"
                    onClick={() => setEditItem(p)}
                    title="Edit"
                  >
                    <Pencil className="h-4 w-4" />
                  </Button>
                </div>

                {/* Body */}
                <div className="px-4 pb-4 flex-1 space-y-1">
                  <div className="grid grid-cols-2 gap-3 mb-3">
                    <div className="rounded-lg bg-muted/50 px-3 py-2.5">
                      <p className="text-[11px] text-muted-foreground uppercase tracking-wide mb-0.5">Base Salary</p>
                      <p className="text-sm font-semibold">
                        {p.salary_base ? formatCents(p.salary_base.base_salary_cents) : "—"}
                      </p>
                    </div>
                    <div className="rounded-lg bg-muted/50 px-3 py-2.5">
                      <p className="text-[11px] text-muted-foreground uppercase tracking-wide mb-0.5">Pay Day</p>
                      <p className="text-sm font-semibold">Day {p.payday_day}</p>
                    </div>
                  </div>

                  <div className="flex items-center justify-between py-2.5">
                    <span className="text-muted-foreground text-xs">Last payment</span>
                    {p.salary_payments[0] ? (
                      <span className="text-sm font-medium">
                        {new Date(p.salary_payments[0].due_date).toLocaleString("en", {
                          month: "short",
                          year: "numeric",
                        })}{" "}
                        · {formatCents(p.salary_payments[0].total_cents)}
                      </span>
                    ) : (
                      <span className="text-muted-foreground text-xs">None yet</span>
                    )}
                  </div>

                  <div className="flex items-center justify-between py-2.5">
                    <span className="text-muted-foreground text-xs">Raise reminder</span>
                    {p.increase_reminders[0] ? (
                      <button
                        onClick={() => setReminderPerson(p)}
                        className="text-sm font-medium text-amber-600 dark:text-amber-400 underline-offset-2 hover:underline transition-colors text-right"
                      >
                        {formatDate(p.increase_reminders[0].effective_date)} → {formatCents(p.increase_reminders[0].suggested_new_base_cents)}
                      </button>
                    ) : (
                      <button
                        onClick={() => setReminderPerson(p)}
                        className="text-xs text-muted-foreground underline-offset-2 hover:text-foreground hover:underline transition-colors"
                      >
                        + Set reminder
                      </button>
                    )}
                  </div>

                  {p.notes && (
                    <p className="text-xs text-muted-foreground italic border-t pt-3 mt-1">{p.notes}</p>
                  )}
                </div>

                {/* Footer actions */}
                <div className="border-t flex gap-2 px-4 py-3">
                  {p.status === "active" ? (
                    <>
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-10 flex-1 text-sm"
                        onClick={() => setPaymentPerson(p)}
                      >
                        <DollarSign className="mr-1.5 h-4 w-4" /> Register Pay
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-10 flex-1 text-sm"
                        onClick={() =>
                          router.push(
                            `/expenses?source=${p.id}&name=${encodeURIComponent(p.name)}`
                          )
                        }
                      >
                        <History className="mr-1.5 h-4 w-4" /> History
                      </Button>
                    </>
                  ) : (
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-10 w-full text-sm"
                      onClick={() =>
                        router.push(
                          `/expenses?source=${p.id}&name=${encodeURIComponent(p.name)}`
                        )
                      }
                    >
                      <History className="mr-1.5 h-4 w-4" /> History
                    </Button>
                  )}
                </div>
              </div>
            ))
          )}
        </div>
      )}

      {/* ── Table view ─────────────────────────────────────────────────── */}
      {view === "table" && (
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
                  No people found. Add one to get started.
                </TableCell>
              </TableRow>
            ) : (
              table.getRowModel().rows.map((row) => (
                <TableRow
                  key={row.id}
                  className="cursor-pointer hover:bg-muted/50"
                  onClick={() => setDetailPerson(row.original)}
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
      )}

      {/* Create dialog */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Add Person</DialogTitle>
          </DialogHeader>
          <PersonForm
            roles={roles}
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
            <DialogTitle>Edit Person</DialogTitle>
          </DialogHeader>
          {editItem && (
            <PersonForm
              defaultValues={{
                ...editItem,
                base_salary_cents: editItem.salary_base?.base_salary_cents ?? 0,
              }}
              roles={roles}
              onSubmit={handleEdit}
              onCancel={() => setEditItem(null)}
              loading={loading}
            />
          )}
        </DialogContent>
      </Dialog>

      {/* Register salary payment dialog */}
      <Dialog
        open={!!paymentPerson}
        onOpenChange={(o) => !o && setPaymentPerson(null)}
      >
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Register Salary — {paymentPerson?.name}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 pt-2">
            <div>
              <label className="text-sm font-medium">Paid At</label>
              <Input
                type="date"
                value={paidAt}
                onChange={(e) => setPaidAt(e.target.value)}
                className="mt-1"
              />
            </div>
            <div>
              <label className="text-sm font-medium">Adjustment (USD, can be negative)</label>
              <Input
                type="number"
                step="0.01"
                value={adjustmentDollars}
                onChange={(e) => setAdjustmentDollars(e.target.value)}
                className="mt-1"
              />
            </div>
            <div>
              <label className="text-sm font-medium">Adjustment Note</label>
              <Input
                placeholder="Optional reason..."
                value={adjustmentNote}
                onChange={(e) => setAdjustmentNote(e.target.value)}
                className="mt-1"
              />
            </div>
            {paymentPerson?.salary_base && (
              <p className="text-sm text-muted-foreground">
                Base: {formatCents(paymentPerson.salary_base.base_salary_cents)} + Adj:{" "}
                {formatCents(parseToCents(adjustmentDollars || "0"))} ={" "}
                <strong>
                  {formatCents(
                    paymentPerson.salary_base.base_salary_cents +
                      parseToCents(adjustmentDollars || "0")
                  )}
                </strong>
              </p>
            )}
            <div className="flex justify-end gap-2">
              <Button
                variant="outline"
                onClick={() => setPaymentPerson(null)}
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

      {/* Add raise reminder dialog */}
      <Dialog
        open={!!reminderPerson}
        onOpenChange={(o) => !o && setReminderPerson(null)}
      >
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Raise Reminder — {reminderPerson?.name}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 pt-2">
            <div>
              <label className="text-sm font-medium">Effective Date</label>
              <Input
                type="date"
                value={reminderDate}
                onChange={(e) => setReminderDate(e.target.value)}
                className="mt-1"
              />
            </div>
            <div>
              <label className="text-sm font-medium">Suggested New Salary (USD)</label>
              <Input
                type="number"
                step="0.01"
                min="0"
                placeholder="0.00"
                value={reminderAmount}
                onChange={(e) => setReminderAmount(e.target.value)}
                className="mt-1"
              />
            </div>
            <div className="flex justify-end gap-2">
              <Button
                variant="outline"
                onClick={() => setReminderPerson(null)}
              >
                Cancel
              </Button>
              <Button onClick={handleCreateReminder} disabled={loading}>
                {loading ? "Saving..." : "Create Reminder"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Bulk payment dialog */}
      <Dialog open={bulkOpen} onOpenChange={(o) => !o && closeBulk()}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Bulk Salary Payment</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 pt-1">
            {/* Shared date */}
            <div>
              <label className="text-sm font-medium">Payment Date</label>
              <Input
                type="date"
                value={bulkDate}
                onChange={(e) => setBulkDate(e.target.value)}
                className="mt-1"
              />
              <p className="mt-1 text-xs text-muted-foreground">
                Leave empty to use today.
              </p>
            </div>

            {/* Select all header */}
            <div className="flex items-center gap-2 border-b pb-2">
              <Checkbox
                id="bulk-all"
                checked={allBulkSelected ? true : someBulkSelected ? "indeterminate" : false}
                onCheckedChange={toggleBulkAll}
              />
              <label htmlFor="bulk-all" className="flex-1 cursor-pointer text-sm font-medium">
                Select all active people
              </label>
              <span className="text-xs text-muted-foreground">
                {bulkSelected.size} / {activePeople.length} selected
              </span>
            </div>

            {/* People list */}
            <div className="max-h-[45vh] overflow-y-auto -mx-1 px-1 space-y-1.5">
              {activePeople.length === 0 && (
                <p className="py-8 text-center text-sm text-muted-foreground">
                  No active people.
                </p>
              )}
              {activePeople.map((p) => {
                const isSelected = bulkSelected.has(p.id);
                const override = bulkOverrides[p.id] ?? { adj: "0", note: "" };
                const error = bulkErrors[p.id];
                return (
                  <div
                    key={p.id}
                    className={`rounded-lg border px-3 py-2.5 transition-colors ${
                      isSelected
                        ? "border-orange-200 bg-orange-50 dark:border-orange-800 dark:bg-orange-900/20"
                        : "border-transparent hover:bg-muted/50"
                    }`}
                  >
                    <div className="flex items-center gap-2.5">
                      <Checkbox
                        id={`bulk-${p.id}`}
                        checked={isSelected}
                        onCheckedChange={() => toggleBulkOne(p.id)}
                      />
                      <label
                        htmlFor={`bulk-${p.id}`}
                        className="flex min-w-0 flex-1 cursor-pointer items-center justify-between gap-2"
                      >
                        <div className="min-w-0">
                          <p className="truncate text-sm font-medium">{p.name}</p>
                          {p.role && (
                            <p className="text-xs text-muted-foreground">{p.role.name}</p>
                          )}
                        </div>
                        <span className="shrink-0 text-sm font-semibold">
                          {p.salary_base
                            ? formatCents(p.salary_base.base_salary_cents)
                            : <span className="text-muted-foreground text-xs">No salary</span>}
                        </span>
                      </label>
                    </div>

                    {isSelected && (
                      <div className="mt-2.5 grid grid-cols-2 gap-2 pl-7">
                        <div>
                          <label className="text-xs text-muted-foreground">Adjustment</label>
                          <Input
                            type="number"
                            step="0.01"
                            value={override.adj}
                            onChange={(e) => setBulkOverride(p.id, "adj", e.target.value)}
                            className="mt-0.5 h-9"
                            placeholder="0.00"
                          />
                        </div>
                        <div>
                          <label className="text-xs text-muted-foreground">Note</label>
                          <Input
                            value={override.note}
                            onChange={(e) => setBulkOverride(p.id, "note", e.target.value)}
                            className="mt-0.5 h-9"
                            placeholder="Optional..."
                          />
                        </div>
                        {error && (
                          <p className="col-span-2 text-xs text-destructive">{error}</p>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            {/* Footer */}
            <div className="flex flex-col gap-3 border-t pt-3 sm:flex-row sm:items-center sm:justify-between">
              <span className="text-sm text-muted-foreground">
                {bulkSelected.size > 0
                  ? `Total: ${formatCents(
                      [...bulkSelected].reduce((sum, id) => {
                        const person = data.find((p) => p.id === id);
                        const base = person?.salary_base?.base_salary_cents ?? 0;
                        const adj = parseToCents(bulkOverrides[id]?.adj || "0");
                        return sum + base + adj;
                      }, 0)
                    )}`
                  : "No people selected"}
              </span>
              <div className="flex gap-2">
                <Button variant="outline" className="flex-1 sm:flex-none" onClick={closeBulk}>
                  Cancel
                </Button>
                <Button
                  className="flex-1 sm:flex-none"
                  onClick={handleBulkPayment}
                  disabled={loading || bulkSelected.size === 0}
                >
                  {loading
                    ? "Saving..."
                    : `Register ${bulkSelected.size} payment${bulkSelected.size !== 1 ? "s" : ""}`}
                </Button>
              </div>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Detail dialog */}
      <Dialog
        open={!!detailPerson}
        onOpenChange={(o) => !o && setDetailPerson(null)}
      >
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <div className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full ${AVATAR_CLASSES[detailPerson?.status ?? ""] ?? "bg-muted text-muted-foreground"}`}>
                <User className="h-4 w-4" />
              </div>
              {detailPerson?.name}
            </DialogTitle>
          </DialogHeader>
          {detailPerson && (
            <div className="space-y-5">
              <dl className="grid grid-cols-3 gap-3 text-sm">
                <div>
                  <dt className="text-muted-foreground">Base Salary</dt>
                  <dd className="font-medium">
                    {detailPerson.salary_base
                      ? formatCents(detailPerson.salary_base.base_salary_cents)
                      : "—"}
                  </dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">Pay Day</dt>
                  <dd className="font-medium">Day {detailPerson.payday_day}</dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">Status</dt>
                  <dd>
                    <Badge variant="outline" className={STATUS_CLASSES[detailPerson.status]}>
                      {detailPerson.status}
                    </Badge>
                  </dd>
                </div>
                {detailPerson.role && (
                  <div>
                    <dt className="text-muted-foreground">Role</dt>
                    <dd className="font-medium">{detailPerson.role.name}</dd>
                  </div>
                )}
                {detailPerson.notes && (
                  <div className="col-span-3">
                    <dt className="text-muted-foreground">Notes</dt>
                    <dd>{detailPerson.notes}</dd>
                  </div>
                )}
              </dl>

              {/* Raise reminders */}
              {detailPerson.increase_reminders.length > 0 && (
                <div>
                  <h4 className="mb-2 text-sm font-semibold">Raise Reminders</h4>
                  <div className="space-y-2">
                    {detailPerson.increase_reminders.map((r) => (
                      <div
                        key={r.id}
                        className="flex items-center justify-between rounded border px-3 py-2 text-sm"
                      >
                        <div>
                          <span className="font-medium">
                            {formatDate(r.effective_date)}
                          </span>{" "}
                          → {formatCents(r.suggested_new_base_cents)}
                          <Badge
                            variant={
                              r.status === "scheduled"
                                ? "default"
                                : r.status === "done"
                                ? "secondary"
                                : "outline"
                            }
                            className="ml-2 text-[10px]"
                          >
                            {r.status}
                          </Badge>
                        </div>
                        {r.status === "scheduled" && (
                          <div className="flex gap-1">
                            <Button
                              size="sm"
                              variant="outline"
                              className="h-7 text-xs"
                              onClick={() =>
                                handleReminderAction(
                                  detailPerson.id,
                                  r.id,
                                  "apply"
                                )
                              }
                            >
                              Apply
                            </Button>
                            <Button
                              size="sm"
                              variant="outline"
                              className="h-7 text-xs"
                              onClick={() =>
                                handleReminderAction(
                                  detailPerson.id,
                                  r.id,
                                  "ignore"
                                )
                              }
                            >
                              Ignore
                            </Button>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <div className="border-t" />
              <div className="flex items-center justify-between">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    setDetailPerson(null);
                    router.push(
                      `/expenses?source=${detailPerson.id}&name=${encodeURIComponent(detailPerson.name)}`
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
                    onClick={() => {
                      setDetailPerson(null);
                      setEditItem(detailPerson);
                    }}
                  >
                    Edit
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setDetailPerson(null)}
                  >
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
