import { prisma } from "@/lib/db";
import { SalariesTable } from "@/components/salaries/salaries-table";

export const dynamic = "force-dynamic";

export default async function SalariesPage() {
  const people = await prisma.person.findMany({
    orderBy: { name: "asc" },
    include: {
      salary_base: true,
      salary_payments: { orderBy: { due_date: "desc" }, take: 5 },
      increase_reminders: { orderBy: { effective_date: "asc" } },
    },
  });

  const data = people.map((p) => ({
    ...p,
    created_at: p.created_at.toISOString(),
    updated_at: p.updated_at.toISOString(),
    salary_base: p.salary_base
      ? { ...p.salary_base, updated_at: p.salary_base.updated_at.toISOString() }
      : null,
    salary_payments: p.salary_payments.map((sp) => ({
      ...sp,
      due_date: sp.due_date.toISOString(),
      paid_at: sp.paid_at.toISOString(),
      created_at: sp.created_at.toISOString(),
    })),
    increase_reminders: p.increase_reminders.map((ir) => ({
      ...ir,
      effective_date: ir.effective_date.toISOString(),
      created_at: ir.created_at.toISOString(),
      updated_at: ir.updated_at.toISOString(),
    })),
  }));

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Salaries</h1>
        <p className="text-muted-foreground text-sm mt-1">
          Manage team members, salary payments, and raise reminders.
        </p>
      </div>

      <SalariesTable initialData={data} />
    </div>
  );
}
