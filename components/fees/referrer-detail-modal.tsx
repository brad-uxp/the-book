"use client";

import { useState, useEffect } from "react";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Pencil, Trash2, Plus, X, Download } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatCents } from "@/lib/currency";
import { formatDate } from "@/lib/dates";

interface ReferrerSummary {
  id: string;
  name: string;
  color_hex: string;
  invoice_count: number;
  fee_payment_count: number;
  total_fee_cents: number;
  total_paid_cents: number;
  default_client_count: number;
}

interface ClientMinimal {
  id: string;
  name: string;
  color_hex: string;
}

interface InvoiceDetail {
  id: string;
  invoice_number: string | null;
  amount_cents: number;
  fee_cents: number;
  status: string;
  due_date: string;
  client: { name: string };
}

interface PaymentDetail {
  id: string;
  paid_at: string;
  amount_cents: number;
}

interface ReferrerDetailModalProps {
  referrer: ReferrerSummary | null;
  onClose: () => void;
  onRefresh: () => Promise<void>;
  allClients: ClientMinimal[];
}

const STATUS_COLORS: Record<string, string> = {
  pending: "bg-yellow-100 text-yellow-800",
  accounting: "bg-blue-100 text-blue-800",
  sent: "bg-purple-100 text-purple-800",
  paid: "bg-emerald-100 text-emerald-800",
};

export function ReferrerDetailModal({
  referrer,
  onClose,
  onRefresh,
  allClients,
}: ReferrerDetailModalProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [name, setName] = useState("");
  const [color, setColor] = useState("#6366f1");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [defaultClients, setDefaultClients] = useState<ClientMinimal[]>([]);
  const [addClientOpen, setAddClientOpen] = useState(false);
  const [invoices, setInvoices] = useState<InvoiceDetail[]>([]);
  const [payments, setPayments] = useState<PaymentDetail[]>([]);

  useEffect(() => {
    if (!referrer) return;
    setIsEditing(false);
    setError(null);
    Promise.all([
      fetch(`/api/referrers/${referrer.id}/clients`).then((r) => r.json()),
      fetch(`/api/referrers/${referrer.id}/detail`).then((r) => r.json()),
    ]).then(([clients, detail]) => {
      setDefaultClients(clients);
      // Natural sort: "a5" before "a49", nulls last
      const sorted = [...(detail.invoices ?? [])].sort((a: InvoiceDetail, b: InvoiceDetail) => {
        const an = a.invoice_number ?? "";
        const bn = b.invoice_number ?? "";
        if (!an && !bn) return 0;
        if (!an) return 1;
        if (!bn) return -1;
        return an.localeCompare(bn, undefined, { numeric: true, sensitivity: "base" });
      });
      setInvoices(sorted);
      setPayments(detail.feePayments ?? []);
    }).catch(() => {
      setDefaultClients([]);
      setInvoices([]);
      setPayments([]);
    });
  }, [referrer]);

  const handleStartEdit = () => {
    if (!referrer) return;
    setName(referrer.name);
    setColor(referrer.color_hex);
    setError(null);
    setIsEditing(true);
  };

  const handleUpdate = async () => {
    if (!referrer || !name.trim()) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/referrers/${referrer.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, color_hex: color }),
      });
      if (!res.ok) {
        const err = await res.json();
        setError(err.error ?? "Something went wrong");
        return;
      }
      await onRefresh();
      setIsEditing(false);
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async () => {
    if (!referrer) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/referrers/${referrer.id}`, {
        method: "DELETE",
      });
      if (!res.ok) {
        const err = await res.json();
        alert(err.error ?? "Cannot delete referrer");
        return;
      }
      await onRefresh();
      onClose();
    } finally {
      setLoading(false);
    }
  };

  const handleAddClient = async (clientId: string) => {
    if (!referrer) return;
    setAddClientOpen(false);
    await fetch(`/api/clients/${clientId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ default_referrer_id: referrer.id }),
    });
    const client = allClients.find((c) => c.id === clientId);
    if (client) setDefaultClients((prev) => [...prev, client]);
    await onRefresh();
  };

  const handleRemoveClient = async (clientId: string) => {
    await fetch(`/api/clients/${clientId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ default_referrer_id: null }),
    });
    setDefaultClients((prev) => prev.filter((c) => c.id !== clientId));
    await onRefresh();
  };

  const handleExportPdf = async () => {
    if (!referrer) return;
    const { default: jsPDF } = await import("jspdf");
    const { default: autoTable } = await import("jspdf-autotable");

    const doc = new jsPDF();
    const fmt = (cents: number) =>
      new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(cents / 100);
    const pageW = doc.internal.pageSize.getWidth();

    // Colors matching UI
    const primary: [number, number, number] = [15, 23, 42];     // slate-900
    const muted: [number, number, number] = [100, 116, 139];    // slate-500
    const accent: [number, number, number] = [59, 130, 246];    // blue-500
    const bgLight: [number, number, number] = [248, 250, 252];  // slate-50

    // Header bar
    doc.setFillColor(...primary);
    doc.rect(0, 0, pageW, 32, "F");
    doc.setTextColor(255, 255, 255);
    doc.setFontSize(16);
    doc.text(referrer.name, 14, 15);
    doc.setFontSize(9);
    doc.text("Referrer Statement", 14, 22);
    doc.text(
      new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" }),
      pageW - 14, 22, { align: "right" }
    );

    // Summary cards row
    doc.setTextColor(...muted);
    doc.setFontSize(8);
    const cardY = 40;
    doc.text("TOTAL FEES", 14, cardY);
    doc.text("TOTAL PAID", 80, cardY);
    doc.text("BALANCE OWED", 146, cardY);
    doc.setTextColor(...primary);
    doc.setFontSize(14);
    doc.text(fmt(totalInvoiceFees), 14, cardY + 7);
    doc.text(fmt(totalPayments), 80, cardY + 7);
    doc.setTextColor(balance > 0 ? 220 : 22, balance > 0 ? 38 : 163, balance > 0 ? 38 : 74);
    doc.text(fmt(balance), 146, cardY + 7);

    // Divider
    doc.setDrawColor(226, 232, 240);
    doc.line(14, 53, pageW - 14, 53);

    let y = 60;

    // Invoices table
    if (invoices.length > 0) {
      doc.setTextColor(...muted);
      doc.setFontSize(9);
      doc.text(`INVOICES (${invoices.length})`, 14, y);
      y += 3;

      autoTable(doc, {
        startY: y,
        head: [["#", "Client", "Status", "Amount", "Fee"]],
        body: invoices.map((inv) => [
          inv.invoice_number ?? "—",
          inv.client.name,
          inv.status.charAt(0).toUpperCase() + inv.status.slice(1),
          fmt(inv.amount_cents),
          fmt(Math.abs(inv.fee_cents)),
        ]),
        foot: [["", "", "", "Total", fmt(totalInvoiceFees)]],
        theme: "plain",
        headStyles: {
          fillColor: bgLight,
          textColor: muted,
          fontStyle: "bold",
          fontSize: 8,
          cellPadding: { top: 3, bottom: 3, left: 4, right: 4 },
        },
        bodyStyles: {
          textColor: primary,
          fontSize: 9,
          cellPadding: { top: 2.5, bottom: 2.5, left: 4, right: 4 },
        },
        footStyles: {
          fillColor: bgLight,
          textColor: primary,
          fontStyle: "bold",
          fontSize: 9,
          cellPadding: { top: 3, bottom: 3, left: 4, right: 4 },
        },
        alternateRowStyles: { fillColor: [255, 255, 255] },
        columnStyles: {
          0: { cellWidth: 24 },
        },
        didParseCell: (data: { column: { index: number }; cell: { styles: { halign: string } } }) => {
          if (data.column.index === 4) data.cell.styles.halign = "right";
        },
        margin: { left: 14, right: 14 },
      });

      y = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 10;
    }

    // Payments table
    if (payments.length > 0) {
      doc.setTextColor(...muted);
      doc.setFontSize(9);
      doc.text(`PAYMENTS (${payments.length})`, 14, y);
      y += 3;

      autoTable(doc, {
        startY: y,
        head: [["Date", "Amount"]],
        body: payments.map((p) => [
          formatDate(p.paid_at),
          fmt(p.amount_cents),
        ]),
        foot: [["Total Paid", fmt(totalPayments)]],
        theme: "plain",
        headStyles: {
          fillColor: bgLight,
          textColor: muted,
          fontStyle: "bold",
          fontSize: 8,
          cellPadding: { top: 3, bottom: 3, left: 4, right: 4 },
        },
        bodyStyles: {
          textColor: primary,
          fontSize: 9,
          cellPadding: { top: 2.5, bottom: 2.5, left: 4, right: 4 },
        },
        footStyles: {
          fillColor: bgLight,
          textColor: primary,
          fontStyle: "bold",
          fontSize: 9,
          cellPadding: { top: 3, bottom: 3, left: 4, right: 4 },
        },
        alternateRowStyles: { fillColor: [255, 255, 255] },
        didParseCell: (data: { column: { index: number }; cell: { styles: { halign: string } } }) => {
          if (data.column.index === 1) data.cell.styles.halign = "right";
        },
        margin: { left: 14, right: 14 },
      });
    }

    doc.save(`referrer-${referrer.name.toLowerCase().replace(/\s+/g, "-")}.pdf`);
  };

  const availableClients = allClients.filter(
    (c) => !defaultClients.some((dc) => dc.id === c.id)
  );

  const totalInvoiceFees = invoices.reduce((s, inv) => s + Math.abs(inv.fee_cents), 0);
  const totalPayments = payments.reduce((s, p) => s + p.amount_cents, 0);
  const balance = totalInvoiceFees - totalPayments;

  return (
    <Sheet open={!!referrer} onOpenChange={(o) => !o && onClose()}>
      <SheetContent
        side="right"
        showCloseButton={false}
        className="w-full sm:max-w-none sm:w-120 p-0 flex flex-col"
        onOpenAutoFocus={(e) => e.preventDefault()}
      >
        <SheetHeader className="sr-only">
          <SheetTitle>{referrer?.name ?? "Referrer"}</SheetTitle>
        </SheetHeader>

        {referrer && (
          <>
            {/* Header */}
            <div className="px-6 py-5 space-y-4 border-b shrink-0">
              {isEditing ? (
                <div className="space-y-3">
                  <h2 className="text-lg font-semibold">Edit Referrer</h2>
                  <div>
                    <label className="text-sm font-medium">Name</label>
                    <Input
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      placeholder="e.g. John Doe"
                      className="mt-1"
                      onKeyDown={(e) => e.key === "Enter" && handleUpdate()}
                    />
                  </div>
                  <div>
                    <label className="text-sm font-medium">Color</label>
                    <div className="flex items-center gap-2 mt-1">
                      <input
                        type="color"
                        value={color}
                        onChange={(e) => setColor(e.target.value)}
                        className="h-9 w-16 rounded border cursor-pointer"
                      />
                      <Input
                        value={color}
                        onChange={(e) => setColor(e.target.value)}
                        className="flex-1"
                      />
                    </div>
                  </div>
                  {error && <p className="text-sm text-destructive">{error}</p>}
                  <div className="flex items-center justify-between">
                    <AlertDialog>
                      <AlertDialogTrigger asChild>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="text-destructive hover:text-destructive hover:bg-destructive/10"
                          disabled={loading}
                        >
                          <Trash2 className="mr-1 h-3.5 w-3.5" /> Delete
                        </Button>
                      </AlertDialogTrigger>
                      <AlertDialogContent>
                        <AlertDialogHeader>
                          <AlertDialogTitle>Delete Referrer</AlertDialogTitle>
                          <AlertDialogDescription>
                            Are you sure you want to delete &quot;{referrer.name}
                            &quot;? This action cannot be undone.
                          </AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                          <AlertDialogCancel>Cancel</AlertDialogCancel>
                          <AlertDialogAction
                            onClick={handleDelete}
                            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                          >
                            Delete
                          </AlertDialogAction>
                        </AlertDialogFooter>
                      </AlertDialogContent>
                    </AlertDialog>
                    <div className="flex gap-2">
                      <Button variant="outline" size="sm" onClick={() => setIsEditing(false)}>
                        Cancel
                      </Button>
                      <Button size="sm" onClick={handleUpdate} disabled={loading}>
                        {loading ? "Saving..." : "Update"}
                      </Button>
                    </div>
                  </div>
                </div>
              ) : (
                <>
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span
                        className="inline-block h-3.5 w-3.5 rounded-full shrink-0"
                        style={{ backgroundColor: referrer.color_hex }}
                      />
                      <h2 className="text-lg font-semibold">{referrer.name}</h2>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-6 w-6 text-muted-foreground hover:text-foreground"
                        onClick={handleStartEdit}
                      >
                        <Pencil className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7 text-muted-foreground"
                      onClick={onClose}
                    >
                      <X className="h-4 w-4" />
                    </Button>
                  </div>

                  {/* Stats */}
                  <dl className="grid grid-cols-2 gap-3 text-sm">
                    <div>
                      <dt className="text-muted-foreground">Invoices</dt>
                      <dd className="font-medium">{referrer.invoice_count}</dd>
                    </div>
                    <div>
                      <dt className="text-muted-foreground">Total Fees</dt>
                      <dd className="font-medium">
                        {formatCents(referrer.total_fee_cents)}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-muted-foreground">Payments Made</dt>
                      <dd className="font-medium">
                        {referrer.fee_payment_count}
                        {referrer.fee_payment_count > 0 && (
                          <span className="text-muted-foreground font-normal">
                            {" "}({formatCents(referrer.total_paid_cents)})
                          </span>
                        )}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-muted-foreground">Balance Owed</dt>
                      <dd className={cn(
                        "font-medium",
                        referrer.total_fee_cents - referrer.total_paid_cents > 0
                          ? "text-destructive"
                          : "text-emerald-600"
                      )}>
                        {formatCents(referrer.total_fee_cents - referrer.total_paid_cents)}
                      </dd>
                    </div>
                  </dl>

                  {/* Business Lines */}
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <h3 className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Business Lines</h3>
                      <Popover open={addClientOpen} onOpenChange={setAddClientOpen}>
                        <PopoverTrigger asChild>
                          <Button variant="outline" size="sm" className="h-6 text-xs px-2">
                            <Plus className="mr-1 h-3 w-3" /> Add
                          </Button>
                        </PopoverTrigger>
                        <PopoverContent className="p-0 w-52" align="end">
                          <Command>
                            <CommandInput placeholder="Search client..." />
                            <CommandList>
                              <CommandEmpty>No clients available.</CommandEmpty>
                              <CommandGroup>
                                {availableClients.map((c) => (
                                  <CommandItem
                                    key={c.id}
                                    value={c.name}
                                    onSelect={() => handleAddClient(c.id)}
                                  >
                                    <span
                                      className="mr-2 inline-block h-2.5 w-2.5 rounded-full shrink-0"
                                      style={{ backgroundColor: c.color_hex }}
                                    />
                                    {c.name}
                                  </CommandItem>
                                ))}
                              </CommandGroup>
                            </CommandList>
                          </Command>
                        </PopoverContent>
                      </Popover>
                    </div>

                    {defaultClients.length > 0 ? (
                      <div className="flex flex-wrap gap-1.5">
                        {defaultClients.map((c) => (
                          <span
                            key={c.id}
                            className="inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs"
                          >
                            <span
                              className="inline-block h-2 w-2 rounded-full shrink-0"
                              style={{ backgroundColor: c.color_hex }}
                            />
                            {c.name}
                            <button
                              className="text-muted-foreground hover:text-destructive"
                              onClick={() => handleRemoveClient(c.id)}
                            >
                              <X className="h-3 w-3" />
                            </button>
                          </span>
                        ))}
                      </div>
                    ) : (
                      <p className="text-xs text-muted-foreground">
                        No clients assigned.
                      </p>
                    )}
                  </div>
                </>
              )}
            </div>

            {/* Scrollable body */}
            {!isEditing && (
              <div className="flex-1 overflow-y-auto">
                {/* Invoices */}
                <div className="px-6 py-4 space-y-2 border-b">
                  <h3 className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                    Invoices ({invoices.length})
                  </h3>
                  {invoices.length > 0 ? (
                    <div className="space-y-0.5">
                      {invoices.map((inv) => (
                        <div
                          key={inv.id}
                          className="flex items-center justify-between py-1.5 text-sm"
                        >
                          <div className="flex items-center gap-2 min-w-0">
                            <Badge
                              variant="secondary"
                              className={cn("text-[10px] px-1.5 py-0 shrink-0", STATUS_COLORS[inv.status])}
                            >
                              {inv.status}
                            </Badge>
                            <span className="truncate">
                              {inv.invoice_number && (
                                <span className="font-medium">#{inv.invoice_number}</span>
                              )}
                              {inv.invoice_number && " "}
                              <span className="text-muted-foreground">{inv.client.name}</span>
                            </span>
                          </div>
                          <div className="flex items-center gap-3 shrink-0 text-right">
                            <span className="text-muted-foreground text-xs">
                              {formatCents(inv.amount_cents)}
                            </span>
                            <span className="font-medium w-20 text-right">
                              {formatCents(Math.abs(inv.fee_cents))}
                            </span>
                          </div>
                        </div>
                      ))}
                      <div className="flex items-center justify-end pt-1.5 border-t text-sm">
                        <span className="text-muted-foreground mr-3">Total fees</span>
                        <span className="font-semibold w-20 text-right">{formatCents(totalInvoiceFees)}</span>
                      </div>
                    </div>
                  ) : (
                    <p className="text-xs text-muted-foreground">No invoices.</p>
                  )}
                </div>

                {/* Payments */}
                <div className="px-6 py-4 space-y-2 border-b">
                  <h3 className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                    Payments ({payments.length})
                  </h3>
                  {payments.length > 0 ? (
                    <div className="space-y-0.5">
                      {payments.map((p) => (
                        <div
                          key={p.id}
                          className="flex items-center justify-between py-1.5 text-sm"
                        >
                          <span className="text-muted-foreground">
                            {formatDate(p.paid_at)}
                          </span>
                          <span className="font-medium shrink-0 w-20 text-right">
                            {formatCents(p.amount_cents)}
                          </span>
                        </div>
                      ))}
                      <div className="flex items-center justify-end pt-1.5 border-t text-sm">
                        <span className="text-muted-foreground mr-3">Total paid</span>
                        <span className="font-semibold w-20 text-right">{formatCents(totalPayments)}</span>
                      </div>
                    </div>
                  ) : (
                    <p className="text-xs text-muted-foreground">No payments.</p>
                  )}
                </div>

                {/* Summary */}
                <div className="px-6 py-4 space-y-1.5 text-sm">
                  <div className="flex items-center justify-between">
                    <span className="text-muted-foreground">Total Fees</span>
                    <span className="font-medium">{formatCents(totalInvoiceFees)}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-muted-foreground">Total Paid</span>
                    <span className="font-medium">{formatCents(totalPayments)}</span>
                  </div>
                  <div className="flex items-center justify-between pt-1.5 border-t">
                    <span className="font-medium">Balance Owed</span>
                    <span className={cn(
                      "font-semibold",
                      balance > 0 ? "text-destructive" : "text-emerald-600"
                    )}>
                      {formatCents(balance)}
                    </span>
                  </div>
                </div>
              </div>
            )}

            {/* Sticky footer — Export PDF */}
            {!isEditing && (
              <div className="px-6 py-3 border-t shrink-0 bg-background">
                <Button
                  variant="outline"
                  size="sm"
                  className="w-full"
                  onClick={handleExportPdf}
                >
                  <Download className="mr-1.5 h-3.5 w-3.5" /> Export PDF
                </Button>
              </div>
            )}
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}
