import { prisma } from "@/lib/db";
import { AuditLogTable } from "@/components/admin-logs/audit-log-table";

export const dynamic = "force-dynamic";

const LIMIT = 50;

export const metadata = {
  title: "Admin Logs",
};

export default async function AdminLogsPage() {
  const [logs, total] = await Promise.all([
    prisma.auditLog.findMany({
      orderBy: { created_at: "desc" },
      take: LIMIT,
    }),
    prisma.auditLog.count(),
  ]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Admin Logs</h1>
        <p className="text-muted-foreground text-sm mt-1">
          All create, update, and delete activity across the system.
        </p>
      </div>
      <AuditLogTable
        initialLogs={JSON.parse(JSON.stringify(logs))}
        initialTotal={total}
      />
    </div>
  );
}
