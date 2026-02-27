"use client";

import { useState, useEffect } from "react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatCents } from "@/lib/currency";
import { ReferrerManager } from "./referrer-manager";
import { ReferrerDetailModal } from "./referrer-detail-modal";

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

interface FeesClientProps {
  initialReferrers: ReferrerSummary[];
}

export function FeesClient({ initialReferrers }: FeesClientProps) {
  const [referrers, setReferrers] = useState(initialReferrers);
  const [selectedReferrer, setSelectedReferrer] = useState<ReferrerSummary | null>(null);
  const [allClients, setAllClients] = useState<ClientMinimal[]>([]);

  useEffect(() => {
    fetch("/api/clients")
      .then((r) => r.json())
      .then(setAllClients)
      .catch(() => {});
  }, []);

  const refresh = async () => {
    const [refRes, cliRes] = await Promise.all([
      fetch("/api/referrers/summary"),
      fetch("/api/clients"),
    ]);
    if (refRes.ok) {
      const newReferrers = await refRes.json();
      setReferrers(newReferrers);
      // Update selectedReferrer if it's still open
      if (selectedReferrer) {
        const updated = newReferrers.find((r: ReferrerSummary) => r.id === selectedReferrer.id);
        if (updated) setSelectedReferrer(updated);
      }
    }
    if (cliRes.ok) setAllClients(await cliRes.json());
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold tracking-tight">Fees</h1>
      </div>

      <section className="space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">Referrers</h2>
          <ReferrerManager onRefresh={refresh} />
        </div>

        {referrers.length > 0 ? (
          <div className="rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Referrer</TableHead>
                  <TableHead className="text-right">Invoices</TableHead>
                  <TableHead className="text-right">Total Fees</TableHead>
                  <TableHead className="text-right">Payments</TableHead>
                  <TableHead className="text-right">Paid</TableHead>
                  <TableHead className="text-right">Balance</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {referrers.map((r) => {
                  const balance = r.total_fee_cents - r.total_paid_cents;
                  return (
                    <TableRow
                      key={r.id}
                      className="cursor-pointer hover:bg-muted/50"
                      onClick={() => setSelectedReferrer(r)}
                    >
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <span
                            className="inline-block h-3 w-3 rounded-full shrink-0"
                            style={{ backgroundColor: r.color_hex }}
                          />
                          <span className="font-medium">{r.name}</span>
                        </div>
                      </TableCell>
                      <TableCell className="text-right">{r.invoice_count}</TableCell>
                      <TableCell className="text-right">{formatCents(r.total_fee_cents)}</TableCell>
                      <TableCell className="text-right">{r.fee_payment_count}</TableCell>
                      <TableCell className="text-right">{formatCents(r.total_paid_cents)}</TableCell>
                      <TableCell className={`text-right font-medium ${balance > 0 ? "text-destructive" : "text-emerald-600"}`}>
                        {formatCents(balance)}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">
            No referrers yet. Add one to get started.
          </p>
        )}
      </section>

      <ReferrerDetailModal
        referrer={selectedReferrer}
        onClose={() => setSelectedReferrer(null)}
        onRefresh={refresh}
        allClients={allClients}
      />
    </div>
  );
}
