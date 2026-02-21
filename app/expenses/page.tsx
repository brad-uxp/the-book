import { Suspense } from "react";
import { prisma } from "@/lib/db";
import { ExpenseTable } from "@/components/expenses/expense-table";

export const dynamic = "force-dynamic";

export default async function ExpensesPage() {
  const [subPayments, salaryPayments, otherExpenses] = await Promise.all([
    prisma.subscriptionPayment.findMany({
      where: { deleted_at: null },
      include: { subscription: { select: { name: true, category: true, icon_url: true } } },
      orderBy: { paid_at: "desc" },
    }),
    prisma.salaryPayment.findMany({
      include: { person: { select: { name: true, role: { select: { name: true } } } } },
      orderBy: { paid_at: "desc" },
    }),
    prisma.otherExpense.findMany({
      orderBy: { paid_at: "desc" },
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
      period_key: p.period_key,
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
      period_key: p.period_key,
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
      period_key: p.period_key ?? null,
      source_id: p.id,
      notes: p.notes,
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
        <ExpenseTable items={items} />
      </Suspense>
    </div>
  );
}
