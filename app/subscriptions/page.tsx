import { prisma } from "@/lib/db";
import { SubscriptionsTable } from "@/components/subscriptions/subscriptions-table";
import { getTodayInTZ } from "@/lib/dates";

export const dynamic = "force-dynamic";

export default async function SubscriptionsPage() {
  const today = getTodayInTZ();
  const y = today.getUTCFullYear();
  const m = today.getUTCMonth() + 1;

  const startOfYear  = new Date(Date.UTC(y, 0, 1));
  const endOfYear    = new Date(Date.UTC(y, 11, 31, 23, 59, 59, 999));
  const startOfMonth = new Date(Date.UTC(y, m - 1, 1));
  const endOfMonth   = new Date(Date.UTC(y, m, 0, 23, 59, 59, 999));

  const [subscriptions, yearPayments] = await Promise.all([
    prisma.subscription.findMany({
      orderBy: { created_at: "desc" },
      include: {
        payments: {
          where: { deleted_at: null },
          orderBy: { created_at: "desc" },
          take: 1,
        },
      },
    }),
    prisma.subscriptionPayment.findMany({
      where: {
        deleted_at: null,
        due_date: { gte: startOfYear, lte: endOfYear },
      },
      select: { subscription_id: true, due_date: true },
    }),
  ]);

  // Serialize dates
  const data = subscriptions.map((s) => {
    const paid = yearPayments.some((p) => {
      if (p.subscription_id !== s.id) return false;
      if (s.frequency === "annual") return true;
      return p.due_date >= startOfMonth && p.due_date <= endOfMonth;
    });
    return {
      ...s,
      created_at: s.created_at.toISOString(),
      updated_at: s.updated_at.toISOString(),
      paid_current_period: paid,
      payments: s.payments.map((p) => ({
        ...p,
        due_date: p.due_date.toISOString(),
        paid_at: p.paid_at.toISOString(),
        created_at: p.created_at.toISOString(),
        deleted_at: p.deleted_at?.toISOString() ?? null,
      })),
    };
  });

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
