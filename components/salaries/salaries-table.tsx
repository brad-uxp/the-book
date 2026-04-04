"use client";

import { useState, useEffect, useMemo } from "react";
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
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { MoreHorizontal, Plus, ArrowUpDown, ArrowUp, ArrowDown, History, User, FileText, LayoutList, LayoutGrid, Pencil, DollarSign, Users, ClipboardList, Link2, Trash2 } from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
import { useRouter, useSearchParams } from "next/navigation";
import { formatCents, parseToCents, centsToDecimalString } from "@/lib/currency";
import { formatDate } from "@/lib/dates";
import dynamic from "next/dynamic";
import { PersonForm } from "./person-form";
import { RoleManager } from "./role-manager";

const SalaryChart = dynamic(() => import("./salary-chart").then((m) => m.SalaryChart), { ssr: false });
import type { PersonInput } from "@/lib/validations";
import { LinkedIssues } from "@/components/issues/linked-issues";

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
  const searchParams = useSearchParams();
  const [data, setData] = useState(initialData);
  const [roles, setRoles] = useState(initialRoles);
  const [sorting, setSorting] = useState<SortingState>([{ id: "name", desc: false }]);
  const [createOpen, setCreateOpen] = useState(false);
  const [editItem, setEditItem] = useState<Person | null>(null);
  const [detailPerson, setDetailPerson] = useState<Person | null>(null);
  const [paymentPerson, setPaymentPerson] = useState<Person | null>(null);
  const [reminderPerson, setReminderPerson] = useState<Person | null>(null);
  const [loading, setLoading] = useState(false);
  const [view, setView] = useState<"table" | "cards" | "report">("table");
  const [rolesOpen, setRolesOpen] = useState(false);

  // Deep-link: open person detail from ?person=<id> (e.g. from task @mentions)
  useEffect(() => {
    const personId = searchParams.get("person");
    if (personId) {
      const person = data.find((p) => p.id === personId);
      if (person) setDetailPerson(person);
      router.replace("/salaries", { scroll: false });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Linked issue counts for table/card indicator
  const [linkedIssueCounts, setLinkedIssueCounts] = useState<Record<string, number>>({});

  useEffect(() => {
    fetch("/api/issues/linked-counts?type=person")
      .then((r) => r.json())
      .then(setLinkedIssueCounts)
      .catch(() => {});
  }, []);

  // Unpaid this month filter
  const [unpaidThisMonth, setUnpaidThisMonth] = useState(false);

  const isPaidThisMonth = (p: Person) => {
    const last = p.salary_payments[0];
    if (!last) return false;
    const d = new Date(last.due_date);
    const now = new Date();
    return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth();
  };

  const filteredData = useMemo(() => {
    if (!unpaidThisMonth) return data;
    return data.filter((p) => p.status === "active" && !isPaidThisMonth(p));
  }, [data, unpaidThisMonth]);

  // Report state
  const [reportSelected, setReportSelected] = useState<Set<string>>(new Set());
  const [reportAdj, setReportAdj] = useState<Record<string, string>>({});

  const setReportAdjFor = (id: string, val: string) =>
    setReportAdj((prev) => ({ ...prev, [id]: val }));

  const getReportTotal = (p: Person) => {
    const base = p.salary_base?.base_salary_cents ?? 0;
    const adj = parseToCents(reportAdj[p.id] || "0");
    return base + adj;
  };

  const toggleReportAll = () => {
    const active = data.filter((p) => p.status === "active");
    if (active.every((p) => reportSelected.has(p.id))) {
      setReportSelected(new Set());
      setReportAdj({});
    } else {
      setReportSelected(new Set(active.map((p) => p.id)));
    }
  };

  const toggleReportOne = (id: string) =>
    setReportSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
        setReportAdj((a) => { const n = { ...a }; delete n[id]; return n; });
      } else {
        next.add(id);
      }
      return next;
    });

  const applyReportPreset = (preset: "unpaid") => {
    if (preset === "unpaid") {
      const unpaid = data.filter((p) => p.status === "active" && !isPaidThisMonth(p));
      setReportSelected(new Set(unpaid.map((p) => p.id)));
      setReportAdj({});
    }
  };

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
  const [editingReminderId, setEditingReminderId] = useState<string | null>(null);
  const [deleteReminderOpen, setDeleteReminderOpen] = useState(false);

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

  const closeReminder = () => {
    setReminderPerson(null);
    setReminderDate("");
    setReminderAmount("");
    setEditingReminderId(null);
  };

  const handleSubmitReminder = async () => {
    if (!reminderPerson) return;
    setLoading(true);
    try {
      if (editingReminderId) {
        const res = await fetch(`/api/people/${reminderPerson.id}/reminders`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            reminderId: editingReminderId,
            action: "reschedule",
            new_effective_date: reminderDate,
            new_suggested_base_cents: parseToCents(reminderAmount),
          }),
        });
        if (!res.ok) {
          const err = await res.json();
          alert(err.error ?? "Error updating reminder");
          return;
        }
      } else {
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
      }
      await refresh();
      closeReminder();
    } finally {
      setLoading(false);
    }
  };

  const handleDeleteReminder = async () => {
    if (!reminderPerson || !editingReminderId) return;
    setLoading(true);
    try {
      const res = await fetch(
        `/api/people/${reminderPerson.id}/reminders?reminderId=${editingReminderId}`,
        { method: "DELETE" }
      );
      if (!res.ok) {
        const err = await res.json();
        alert(err.error ?? "Error deleting reminder");
        return;
      }
      await refresh();
      setDeleteReminderOpen(false);
      closeReminder();
    } finally {
      setLoading(false);
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
              {(linkedIssueCounts[row.original.id] ?? 0) > 0 && (
                <span
                  className="inline-flex items-center justify-center h-4 w-4 rounded-full bg-blue-100 text-blue-600 dark:bg-blue-900/30 dark:text-blue-400 shrink-0"
                  title={`${linkedIssueCounts[row.original.id]} linked issue(s)`}
                >
                  <Link2 className="h-2.5 w-2.5" />
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
        const next = row.original.increase_reminders.find((r) => r.status === "scheduled");
        if (!next) return <span className="text-muted-foreground">—</span>;
        return (
          <span className="text-sm text-amber-600">
            {formatDate(next.effective_date)} · {formatCents(next.suggested_new_base_cents)}
          </span>
        );
      },
    },
  ];

  const table = useReactTable({
    data: filteredData,
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
            className="h-9 w-9 rounded-none border-r"
            onClick={() => setView("cards")}
            title="Cards view"
          >
            <LayoutGrid className="h-4 w-4" />
          </Button>
          <Button
            variant={view === "report" ? "secondary" : "ghost"}
            size="icon"
            className="h-9 w-9 rounded-none"
            onClick={() => { setView("report"); setReportSelected(new Set()); setReportAdj({}); }}
            title="Report view"
          >
            <ClipboardList className="h-4 w-4" />
          </Button>
        </div>

        {/* Right */}
        <div className="flex items-center gap-2">
          {/* Desktop-only buttons */}
          <div className="hidden sm:flex items-center gap-2">
            {view !== "report" && (
            <Button
              variant={unpaidThisMonth ? "default" : "outline"}
              className="h-9"
              onClick={() => setUnpaidThisMonth((v) => !v)}
            >
              Unpaid this month
            </Button>
            )}
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
              {view !== "report" && (
              <>
              <DropdownMenuItem onClick={() => setUnpaidThisMonth((v) => !v)}>
                {unpaidThisMonth ? "Show all" : "Unpaid this month"}
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              </>
              )}
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
          {filteredData.length === 0 ? (
            <p className="col-span-full text-center text-muted-foreground py-12">
              {unpaidThisMonth ? "All salaries paid this month." : "No people found. Add one to get started."}
            </p>
          ) : (
            filteredData.map((p) => (
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
                        {(linkedIssueCounts[p.id] ?? 0) > 0 && (
                          <span
                            className="inline-flex items-center justify-center h-4 w-4 rounded-full bg-blue-100 text-blue-600 dark:bg-blue-900/30 dark:text-blue-400 shrink-0"
                            title={`${linkedIssueCounts[p.id]} linked issue(s)`}
                          >
                            <Link2 className="h-2.5 w-2.5" />
                          </span>
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
                    {(() => {
                      const reminder = p.increase_reminders.find((r) => r.status === "scheduled");
                      return reminder ? (
                        <button
                          onClick={() => {
                            setEditingReminderId(reminder.id);
                            setReminderDate(reminder.effective_date);
                            setReminderAmount(centsToDecimalString(reminder.suggested_new_base_cents));
                            setReminderPerson(p);
                          }}
                          className="text-sm font-medium text-amber-600 dark:text-amber-400 underline-offset-2 hover:underline transition-colors text-right"
                        >
                          {formatDate(reminder.effective_date)} → {formatCents(reminder.suggested_new_base_cents)}
                        </button>
                      ) : p.status === "active" ? (
                        <button
                          onClick={() => {
                            setEditingReminderId(null);
                            setReminderDate("");
                            setReminderAmount("");
                            setReminderPerson(p);
                          }}
                          className="text-xs text-muted-foreground underline-offset-2 hover:text-foreground hover:underline transition-colors"
                        >
                          + Set reminder
                        </button>
                      ) : (
                        <span className="text-muted-foreground text-xs">—</span>
                      );
                    })()}
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
                  {p.salary_payments.length === 0 && (
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-10 text-sm text-destructive hover:text-destructive hover:bg-destructive/10"
                      onClick={() => handleDelete(p.id)}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  )}
                </div>
              </div>
            ))
          )}
        </div>
      )}

      {/* ── Report view ────────────────────────────────────────────────── */}
      {view === "report" && (
        <>
        <SalaryChart data={data} />
        <div className="grid gap-5 lg:grid-cols-[1fr_1fr]">
          {/* Left — selection */}
          <div className="rounded-xl border bg-card p-4 sm:p-5 space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold">Select people</h3>
              <span className="text-xs text-muted-foreground tabular-nums">
                {reportSelected.size}/{activePeople.length}
              </span>
            </div>

            <div className="flex flex-wrap gap-1.5">
              <Button
                variant="outline"
                size="sm"
                className="h-7 text-xs rounded-full"
                onClick={() => applyReportPreset("unpaid")}
              >
                Unpaid this month
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="h-7 text-xs rounded-full"
                onClick={() => toggleReportAll()}
              >
                {activePeople.length > 0 && activePeople.every((p) => reportSelected.has(p.id)) ? "Deselect all" : "Select all"}
              </Button>
              {reportSelected.size > 0 && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 text-xs rounded-full"
                  onClick={() => { setReportSelected(new Set()); setReportAdj({}); }}
                >
                  Clear
                </Button>
              )}
            </div>

            <div className="space-y-1">
              {activePeople.map((p) => {
                const isSelected = reportSelected.has(p.id);
                const adjVal = reportAdj[p.id] || "0";
                const adjCents = parseToCents(adjVal);
                return (
                  <div
                    key={p.id}
                    className={`rounded-lg border px-3 py-2 transition-colors ${
                      isSelected
                        ? "border-orange-200 bg-orange-50 dark:border-orange-800 dark:bg-orange-900/20"
                        : "border-transparent hover:bg-muted/50"
                    }`}
                  >
                    <div
                      className="flex items-center gap-2.5 cursor-pointer"
                      onClick={() => toggleReportOne(p.id)}
                    >
                      <Checkbox
                        checked={isSelected}
                        onCheckedChange={() => toggleReportOne(p.id)}
                      />
                      <div className="flex min-w-0 flex-1 items-center justify-between gap-2">
                        <span className="truncate text-sm font-medium">{p.name}</span>
                        <span className="shrink-0 text-sm tabular-nums">
                          {p.salary_base ? formatCents(p.salary_base.base_salary_cents) : "—"}
                          {isSelected && adjCents !== 0 && (
                            <span className={`ml-1 text-xs ${adjCents < 0 ? "text-destructive" : "text-emerald-600"}`}>
                              ({adjCents > 0 ? "+" : ""}{formatCents(adjCents)})
                            </span>
                          )}
                        </span>
                      </div>
                    </div>
                    {isSelected && (
                      <div className="mt-2 ml-7 flex items-center gap-2">
                        <Input
                          type="number"
                          step="0.01"
                          value={adjVal === "0" ? "" : adjVal}
                          onChange={(e) => setReportAdjFor(p.id, e.target.value || "0")}
                          onClick={(e) => e.stopPropagation()}
                          className="h-7 w-32 text-xs"
                          placeholder="Adjustment"
                        />
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          {/* Right — report output */}
          <div className="rounded-xl border bg-muted/30 p-4 sm:p-5 space-y-3">
            <h3 className="text-sm font-semibold">Report</h3>

            {reportSelected.size === 0 ? (
              <div className="flex items-center justify-center py-16">
                <p className="text-sm text-muted-foreground">Select people to generate a report.</p>
              </div>
            ) : (
              <div className="rounded-lg border bg-card overflow-hidden">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="text-xs">Name</TableHead>
                      <TableHead className="text-xs text-right">Amount</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {activePeople
                      .filter((p) => reportSelected.has(p.id))
                      .map((p) => (
                        <TableRow key={p.id}>
                          <TableCell className="py-2.5 font-medium">{p.name}</TableCell>
                          <TableCell className="py-2.5 text-right tabular-nums">
                            {formatCents(getReportTotal(p))}
                          </TableCell>
                        </TableRow>
                      ))}
                  </TableBody>
                </Table>
                <div className="flex items-center justify-between border-t bg-card px-4 py-3">
                  <span className="text-sm font-semibold">Total</span>
                  <span className="text-sm font-bold tabular-nums">
                    {formatCents(
                      activePeople
                        .filter((p) => reportSelected.has(p.id))
                        .reduce((sum, p) => sum + getReportTotal(p), 0)
                    )}
                  </span>
                </div>
              </div>
            )}
          </div>
        </div>
        </>
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
                  {unpaidThisMonth ? "All salaries paid this month." : "No people found. Add one to get started."}
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

      {/* Raise reminder dialog (create / edit) */}
      <Dialog
        open={!!reminderPerson}
        onOpenChange={(o) => !o && closeReminder()}
      >
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>
              {editingReminderId ? "Edit" : "New"} Raise Reminder — {reminderPerson?.name}
            </DialogTitle>
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
            <div className="flex items-center gap-2">
              {editingReminderId && (
                <Button
                  variant="destructive"
                  size="icon"
                  onClick={() => setDeleteReminderOpen(true)}
                  disabled={loading}
                  title="Delete reminder"
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              )}
              <div className="ml-auto flex gap-2">
                <Button variant="outline" onClick={closeReminder}>
                  Cancel
                </Button>
                <Button onClick={handleSubmitReminder} disabled={loading}>
                  {loading ? "Saving..." : editingReminderId ? "Save" : "Create"}
                </Button>
              </div>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Delete reminder confirmation */}
      <AlertDialog open={deleteReminderOpen} onOpenChange={setDeleteReminderOpen}>
        <AlertDialogContent size="sm">
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Reminder</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete this raise reminder? This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={loading}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={handleDeleteReminder}
              disabled={loading}
            >
              {loading ? "Deleting..." : "Delete"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

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
        <DialogContent className="max-w-2xl" showCloseButton={false}>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              {detailPerson && (
                <>
                  <div className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full ${AVATAR_CLASSES[detailPerson.status] ?? "bg-muted text-muted-foreground"}`}>
                    <User className="h-4 w-4" />
                  </div>
                  <span>{detailPerson.name}</span>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-6 w-6 text-muted-foreground hover:text-foreground"
                    onClick={() => { setDetailPerson(null); setEditItem(detailPerson); }}
                  >
                    <Pencil className="h-3.5 w-3.5" />
                  </Button>
                </>
              )}
            </DialogTitle>
          </DialogHeader>
          {detailPerson && (
            <div className="space-y-5">
              <dl className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-3">
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
                  <div className="col-span-2 sm:col-span-3">
                    <dt className="text-muted-foreground">Notes</dt>
                    <dd>{detailPerson.notes}</dd>
                  </div>
                )}
              </dl>

              {/* Raise reminder */}
              {(() => {
                const reminder = detailPerson.increase_reminders.find((r) => r.status === "scheduled");
                return (
                  <div>
                    <h4 className="mb-2 text-sm font-semibold">Raise Reminder</h4>
                    {reminder ? (
                      <button
                        className="w-full flex items-center justify-between rounded border px-3 py-2.5 text-sm hover:bg-muted/50 transition-colors text-left"
                        onClick={() => {
                          setEditingReminderId(reminder.id);
                          setReminderDate(reminder.effective_date);
                          setReminderAmount(centsToDecimalString(reminder.suggested_new_base_cents));
                          setDetailPerson(null);
                          setReminderPerson(detailPerson);
                        }}
                      >
                        <div>
                          <span className="font-medium">{formatDate(reminder.effective_date)}</span>
                          {" → "}
                          {formatCents(reminder.suggested_new_base_cents)}
                        </div>
                        <Pencil className="h-3.5 w-3.5 text-muted-foreground" />
                      </button>
                    ) : detailPerson.status === "active" ? (
                      <button
                        className="w-full rounded border border-dashed px-3 py-3 text-sm text-muted-foreground hover:bg-muted/50 hover:text-foreground transition-colors"
                        onClick={() => {
                          setEditingReminderId(null);
                          setReminderDate("");
                          setReminderAmount("");
                          setDetailPerson(null);
                          setReminderPerson(detailPerson);
                        }}
                      >
                        + Set a raise reminder
                      </button>
                    ) : (
                      <p className="text-sm text-muted-foreground">No reminder set</p>
                    )}
                  </div>
                );
              })()}

              <LinkedIssues personId={detailPerson.id} />

              <div className="border-t" />
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                <Button
                  variant="outline"
                  size="sm"
                  className="w-full sm:w-auto"
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
                {detailPerson.status === "active" && (
                  <Button
                    variant="outline"
                    size="sm"
                    className="w-full sm:w-auto"
                    onClick={() => {
                      setDetailPerson(null);
                      setPaymentPerson(detailPerson);
                    }}
                  >
                    <DollarSign className="mr-2 h-4 w-4" />
                    Register payment
                  </Button>
                )}
                <div className="border-t sm:border-t-0 sm:border-l sm:h-6 sm:ml-auto" />
                {detailPerson.salary_payments.length === 0 && (
                  <Button
                    variant="outline"
                    size="sm"
                    className="w-full sm:w-auto text-destructive hover:text-destructive hover:bg-destructive/10"
                    onClick={() => {
                      setDetailPerson(null);
                      handleDelete(detailPerson.id);
                    }}
                  >
                    <Trash2 className="mr-2 h-4 w-4" />
                    Delete
                  </Button>
                )}
                <Button
                  variant="ghost"
                  size="sm"
                  className="w-full sm:w-auto"
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
