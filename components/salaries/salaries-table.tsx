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
import { formatCents, parseToCents, centsToDecimalString } from "@/lib/currency";
import { formatDate, formatPeriodKey } from "@/lib/dates";
import { PersonForm } from "./person-form";
import type { PersonInput } from "@/lib/validations";

interface SalaryReminder {
  id: string;
  effective_date: string;
  suggested_new_base_cents: number;
  status: "scheduled" | "ignored" | "done";
}

interface SalaryPayment {
  id: string;
  period_key: string;
  paid_at: string;
  total_cents: number;
  base_salary_cents_snapshot: number;
  adjustment_cents: number;
  adjustment_note: string | null;
}

interface Person {
  id: string;
  name: string;
  payday_day: number;
  status: "active" | "inactive";
  notes: string | null;
  salary_base: { base_salary_cents: number } | null;
  salary_payments: SalaryPayment[];
  increase_reminders: SalaryReminder[];
}

interface Props {
  initialData: Person[];
}

export function SalariesTable({ initialData }: Props) {
  const [data, setData] = useState(initialData);
  const [sorting, setSorting] = useState<SortingState>([]);
  const [createOpen, setCreateOpen] = useState(false);
  const [editItem, setEditItem] = useState<Person | null>(null);
  const [detailPerson, setDetailPerson] = useState<Person | null>(null);
  const [paymentPerson, setPaymentPerson] = useState<Person | null>(null);
  const [reminderPerson, setReminderPerson] = useState<Person | null>(null);
  const [loading, setLoading] = useState(false);

  // Payment form state
  const [periodKey, setPeriodKey] = useState("");
  const [paidAt, setPaidAt] = useState("");
  const [adjustmentDollars, setAdjustmentDollars] = useState("0");
  const [adjustmentNote, setAdjustmentNote] = useState("");

  // Reminder form state
  const [reminderDate, setReminderDate] = useState("");
  const [reminderAmount, setReminderAmount] = useState("");

  const refresh = async () => {
    const res = await fetch("/api/people");
    if (res.ok) setData(await res.json());
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
      const defaultPeriod = today.slice(0, 7);
      const res = await fetch(`/api/people/${paymentPerson.id}/payments`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          period_key: periodKey || defaultPeriod,
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
      setPeriodKey("");
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

  const columns: ColumnDef<Person>[] = [
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
        <Badge
          variant={row.original.status === "active" ? "default" : "secondary"}
        >
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
            {formatPeriodKey(last.period_key)} · {formatCents(last.total_cents)}
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
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" className="h-8 w-8">
                <MoreHorizontal className="h-4 w-4" />
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
        );
      },
    },
  ];

  const table = useReactTable({
    data,
    columns,
    state: { sorting },
    onSortingChange: setSorting,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
  });

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div />
        <Button onClick={() => setCreateOpen(true)}>
          <Plus className="mr-2 h-4 w-4" /> New Person
        </Button>
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

      {/* Create dialog */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Add Person</DialogTitle>
          </DialogHeader>
          <PersonForm
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
              <label className="text-sm font-medium">Period (YYYY-MM)</label>
              <Input
                placeholder={new Date().toISOString().slice(0, 7)}
                value={periodKey}
                onChange={(e) => setPeriodKey(e.target.value)}
                className="mt-1"
              />
            </div>
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

      {/* Detail dialog */}
      <Dialog
        open={!!detailPerson}
        onOpenChange={(o) => !o && setDetailPerson(null)}
      >
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>{detailPerson?.name}</DialogTitle>
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
                    <Badge
                      variant={
                        detailPerson.status === "active" ? "default" : "secondary"
                      }
                    >
                      {detailPerson.status}
                    </Badge>
                  </dd>
                </div>
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

              {/* Payment history */}
              {detailPerson.salary_payments.length > 0 && (
                <div>
                  <h4 className="mb-2 text-sm font-semibold">Payment History</h4>
                  <div className="max-h-48 space-y-1 overflow-y-auto">
                    {detailPerson.salary_payments.map((p) => (
                      <div
                        key={p.id}
                        className="flex items-center justify-between rounded border px-3 py-1.5 text-sm"
                      >
                        <span className="font-medium">
                          {formatPeriodKey(p.period_key)}
                        </span>
                        <span className="text-muted-foreground">
                          {formatDate(p.paid_at)}
                        </span>
                        <div className="text-right">
                          <span className="font-medium">
                            {formatCents(p.total_cents)}
                          </span>
                          {p.adjustment_cents !== 0 && (
                            <span className="ml-1 text-xs text-muted-foreground">
                              ({p.adjustment_cents > 0 ? "+" : ""}
                              {formatCents(p.adjustment_cents)})
                            </span>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <div className="flex justify-end gap-2">
                <Button
                  variant="outline"
                  onClick={() => {
                    setDetailPerson(null);
                    setEditItem(detailPerson);
                  }}
                >
                  Edit
                </Button>
                <Button
                  variant="outline"
                  onClick={() => setDetailPerson(null)}
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
