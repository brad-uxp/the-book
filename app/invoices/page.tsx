import { prisma } from "@/lib/db";
import { InvoicesTable } from "@/components/invoices/invoices-table";

export const dynamic = "force-dynamic";

export default async function InvoicesPage() {
  const [invoices, clients, referrers] = await Promise.all([
    prisma.invoice.findMany({
      orderBy: { created_at: "desc" },
      include: { client: true, referrer: true },
    }),
    prisma.client.findMany({ orderBy: { name: "asc" } }),
    prisma.referrer.findMany({ orderBy: { name: "asc" } }),
  ]);

  const invoicesData = invoices.map((inv) => ({
    ...inv,
    due_date: inv.due_date.toISOString(),
    reminder_date: inv.reminder_date?.toISOString() ?? null,
    created_at: inv.created_at.toISOString(),
    updated_at: inv.updated_at.toISOString(),
    client: inv.client,
  }));

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Invoices</h1>
        <p className="text-muted-foreground text-sm mt-1">
          Track issued invoices and their payment status.
        </p>
      </div>

      <InvoicesTable initialData={invoicesData} initialClients={clients} initialReferrers={referrers} />
    </div>
  );
}
