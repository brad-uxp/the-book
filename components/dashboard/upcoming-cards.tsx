import { formatCents } from "@/lib/currency";
import { formatDate } from "@/lib/dates";
import { Badge } from "@/components/ui/badge";

interface UpcomingPayment {
  id: string;
  type: "subscription" | "salary";
  name: string;
  amount_cents: number;
  due_date: string;
}

interface UpcomingInvoice {
  id: string;
  invoice_number: string | null;
  client: { name: string; color_hex: string };
  amount_cents: number;
  fee_cents: number;
  status: string;
  due_date: string;
}

const STATUS_CLASSES: Record<string, string> = {
  pending:    "bg-gray-100 text-gray-600 border-gray-200 dark:bg-gray-800 dark:text-gray-400 dark:border-gray-700",
  accounting: "bg-orange-100 text-orange-700 border-orange-200 dark:bg-orange-900/30 dark:text-orange-400 dark:border-orange-800",
  sent:       "bg-blue-100 text-blue-700 border-blue-200 dark:bg-blue-900/30 dark:text-blue-400 dark:border-blue-800",
};

const STATUS_LABELS: Record<string, string> = {
  pending:    "Pending",
  accounting: "Accounting",
  sent:       "Sent",
};

interface Props {
  payments: UpcomingPayment[];
  invoices: UpcomingInvoice[];
}

export function UpcomingCards({ payments, invoices }: Props) {
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
      {/* Upcoming Payments */}
      <div className="rounded-md border bg-card p-5 space-y-3">
        <div>
          <h3 className="text-sm font-semibold">Upcoming Payments</h3>
          <p className="text-xs text-muted-foreground mt-0.5">Next 5 days</p>
        </div>

        {payments.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">
            No payments due in the next 5 days.
          </p>
        ) : (
          <ul className="space-y-2">
            {payments.map((p) => (
              <li
                key={p.id}
                className="flex items-center justify-between gap-3 rounded-md border px-3 py-2.5 text-sm"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="font-medium truncate">{p.name}</span>
                    <Badge
                      variant="outline"
                      className={
                        p.type === "salary"
                          ? "shrink-0 text-xs bg-purple-100 text-purple-700 border-purple-200 dark:bg-purple-900/30 dark:text-purple-400 dark:border-purple-800"
                          : "shrink-0 text-xs bg-sky-100 text-sky-700 border-sky-200 dark:bg-sky-900/30 dark:text-sky-400 dark:border-sky-800"
                      }
                    >
                      {p.type === "salary" ? "Salary" : "Subscription"}
                    </Badge>
                  </div>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    Due {formatDate(p.due_date)}
                  </p>
                </div>
                <span className="font-semibold tabular-nums shrink-0">
                  {formatCents(p.amount_cents)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Upcoming Invoices */}
      <div className="rounded-md border bg-card p-5 space-y-3">
        <div>
          <h3 className="text-sm font-semibold">Upcoming Invoices</h3>
          <p className="text-xs text-muted-foreground mt-0.5">Next 5 days</p>
        </div>

        {invoices.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">
            No invoices due in the next 5 days.
          </p>
        ) : (
          <ul className="space-y-2">
            {invoices.map((inv) => (
              <li
                key={inv.id}
                className="flex items-center justify-between gap-3 rounded-md border px-3 py-2.5 text-sm"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span
                      className="inline-block h-2 w-2 rounded-full shrink-0"
                      style={{ backgroundColor: inv.client.color_hex }}
                    />
                    <span className="font-medium truncate">{inv.client.name}</span>
                    {inv.invoice_number && (
                      <span className="font-mono text-xs text-muted-foreground shrink-0">
                        {inv.invoice_number}
                      </span>
                    )}
                    <Badge
                      variant="outline"
                      className={`shrink-0 text-xs ${STATUS_CLASSES[inv.status] ?? ""}`}
                    >
                      {STATUS_LABELS[inv.status] ?? inv.status}
                    </Badge>
                  </div>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    Due {formatDate(inv.due_date)}
                  </p>
                </div>
                <span className="font-semibold tabular-nums shrink-0">
                  {formatCents(inv.amount_cents + inv.fee_cents)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
