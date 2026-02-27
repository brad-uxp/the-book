import { Suspense } from "react";
import { prisma } from "@/lib/db";
import { ExpenseTable } from "@/components/expenses/expense-table";

export const dynamic = "force-dynamic";

export default async function ExpensesPage() {
  const [subPayments, salaryPayments, otherExpenses, feePayments, referrers] = await Promise.all([
    prisma.subscriptionPayment.findMany({
      where: { deleted_at: null },
      select: {
        id: true,
        subscription_id: true,
        paid_at: true,
        amount_cents_snapshot: true,
        subscription: { select: { name: true, category: true, icon_url: true } },
      },
      orderBy: { paid_at: "desc" },
    }),
    prisma.salaryPayment.findMany({
      select: {
        id: true,
        person_id: true,
        paid_at: true,
        total_cents: true,
        adjustment_cents: true,
        adjustment_note: true,
        person: { select: { name: true, role: { select: { name: true } } } },
      },
      orderBy: { paid_at: "desc" },
    }),
    prisma.otherExpense.findMany({
      select: {
        id: true,
        name: true,
        category: true,
        paid_at: true,
        amount_cents: true,
        notes: true,
      },
      orderBy: { paid_at: "desc" },
    }),
    prisma.feePayment.findMany({
      select: {
        id: true,
        name: true,
        paid_at: true,
        amount_cents: true,
        notes: true,
        referrer_id: true,
        referrer: { select: { id: true, name: true, color_hex: true } },
      },
      orderBy: { paid_at: "desc" },
    }),
    prisma.referrer.findMany({
      select: { id: true, name: true, color_hex: true },
      orderBy: { name: "asc" },
    }),
  ]);

  const items = [
    ...subPayments.map((p) => ({
      id: p.id,
      type: "subscription" as const,
      name: p.subscription.name,
      category: p.subscription.category as string,
      paid_at: p.paid_at.toISOString(),
      amount_cents: p.amount_cents_snapshot,
      source_id: p.subscription_id,
      icon_url: p.subscription.icon_url ?? null,
    })),
    ...salaryPayments.map((p) => ({
      id: p.id,
      type: "salary" as const,
      name: p.person.name,
      category: "work",
      paid_at: p.paid_at.toISOString(),
      amount_cents: p.total_cents,
      source_id: p.person_id,
      adjustment_cents: p.adjustment_cents,
      adjustment_note: p.adjustment_note,
      role: p.person.role?.name ?? null,
    })),
    ...otherExpenses.map((p) => ({
      id: p.id,
      type: "other" as const,
      name: p.name,
      category: p.category as string,
      paid_at: p.paid_at.toISOString(),
      amount_cents: p.amount_cents,
      source_id: p.id,
      notes: p.notes,
    })),
    ...feePayments.map((p) => ({
      id: p.id,
      type: "fee" as const,
      name: p.name,
      category: null,
      paid_at: p.paid_at.toISOString(),
      amount_cents: p.amount_cents,
      source_id: p.id,
      notes: p.notes,
      referrer_id: p.referrer_id,
      referrer: p.referrer,
    })),
  ].sort(
    (a, b) => new Date(b.paid_at).getTime() - new Date(a.paid_at).getTime()
  );

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Expenses</h1>
        <p className="text-muted-foreground text-sm mt-1">
          Unified payment history — subscriptions and salaries.
        </p>
      </div>

      <Suspense>
        <ExpenseTable items={items} referrers={referrers} />
      </Suspense>
    </div>
  );
}
