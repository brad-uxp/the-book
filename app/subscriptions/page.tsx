import { prisma } from "@/lib/db";
import { SubscriptionsTable } from "@/components/subscriptions/subscriptions-table";

export const dynamic = "force-dynamic";

export default async function SubscriptionsPage() {
  const subscriptions = await prisma.subscription.findMany({
    orderBy: { created_at: "desc" },
    include: {
      payments: {
        where: { deleted_at: null },
        orderBy: { created_at: "desc" },
        take: 1,
      },
    },
  });

  // Serialize dates
  const data = subscriptions.map((s) => ({
    ...s,
    created_at: s.created_at.toISOString(),
    updated_at: s.updated_at.toISOString(),
    payments: s.payments.map((p) => ({
      ...p,
      due_date: p.due_date.toISOString(),
      paid_at: p.paid_at.toISOString(),
      created_at: p.created_at.toISOString(),
      deleted_at: p.deleted_at?.toISOString() ?? null,
    })),
  }));

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Subscriptions</h1>
        <p className="text-muted-foreground text-sm mt-1">
          Manage your recurring subscriptions and payments.
        </p>
      </div>

      <SubscriptionsTable initialData={data} />
    </div>
  );
}
