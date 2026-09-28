import { prisma } from "@/lib/db";
import { getTodayInTZ, isSameDay, addDaysUTC } from "@/lib/dates";
import {
  subscriptionEvents,
  buildSubscriptionNotification,
  advanceNotice,
} from "@/lib/cron-helpers";
import { syncPurgeCutoffs } from "@/lib/sync";
import type { NotificationType } from "@/app/generated/prisma/client";
import { pushToAll } from "@/lib/push";

/**
 * Core of the daily job. Pure of any HTTP concern so it can be invoked both by
 * the protected HTTP route (`/api/cron/daily`) and by the in-process scheduler
 * (`instrumentation.ts`). Returns the run log.
 *
 * IMPORTANT — by design this only acts on TODAY's due date (isSameDay). It does
 * NOT back-fill missed periods: deactivating a subscription for a month is the
 * intended way to "pause" it, and a catch-up pass would wrongly re-create that
 * skipped month when it is reactivated. Keep it current-day-only.
 */
export async function runDailyJob(): Promise<string[]> {
  const today = getTodayInTZ();
  const log: string[] = [`[cron/daily] Running for ${today.toISOString()}`];

  // Load settings (use defaults if not configured yet)
  const settings = await prisma.settings.findUnique({
    where: { id: "singleton" },
  });
  const daysSub     = settings?.days_before_subscription ?? 2;
  const daysSalary  = settings?.days_before_salary ?? 4;
  const daysInvoice = settings?.days_before_invoice ?? 0;

  log.push(`  [settings] daysSub=${daysSub}, daysSalary=${daysSalary}, daysInvoice=${daysInvoice}`);

  // Purge notifications older than 7 days
  const sevenDaysAgo = new Date(today.getTime() - 7 * 24 * 60 * 60 * 1000);
  const purged = await prisma.notification.deleteMany({
    where: { created_at: { lt: sevenDaysAgo } },
  });
  log.push(`  [cleanup] Deleted ${purged.count} notifications older than 7 days`);

  // Purge audit logs older than 12 months
  const twelveMonthsAgo = new Date(today.getTime() - 365 * 24 * 60 * 60 * 1000);
  const purgedLogs = await prisma.auditLog.deleteMany({
    where: { created_at: { lt: twelveMonthsAgo } },
  });
  log.push(`  [cleanup] Deleted ${purgedLogs.count} audit logs older than 12 months`);

  // The phone's sync bookkeeping: deletions older than any cursor the pull
  // still accepts, and the answers kept for retried pushes (lib/sync.ts).
  const { tombstonesBefore, mutationsBefore } = syncPurgeCutoffs(new Date());
  const purgedTombstones = await prisma.syncTombstone.deleteMany({
    where: { deleted_at: { lt: tombstonesBefore } },
  });
  const purgedMutations = await prisma.syncMutation.deleteMany({
    where: { created_at: { lt: mutationsBefore } },
  });
  log.push(
    `  [cleanup] Deleted ${purgedTombstones.count} sync tombstones (60 days) and ${purgedMutations.count} sync answers (30 days)`
  );

  // The ids of the notifications this run CREATED — not the ones a re-run
  // finds already there — are the ones the phone gets pushed.
  const created: string[] = [];
  await runSubscriptions(today, daysSub, log, created);
  await runSalaries(today, daysSalary, log, created);
  await runIncreaseReminders(today, log, created);
  await runInvoices(today, daysInvoice, log, created);
  await runIssues(today, log, created);

  await pushCreated(created, log);

  log.push("[cron/daily] Done.");
  return log;
}

/**
 * Native push for each new notification: a data-only "notification <id>";
 * the phone fetches the title and body from the API. Best effort — a push
 * that fails is logged, never fails the job.
 */
async function pushCreated(created: string[], log: string[]) {
  if (created.length === 0) return;
  let sent = 0;
  let removed = 0;
  let failed = 0;
  for (const id of created) {
    try {
      const outcome = await pushToAll({ kind: "notification", id });
      if (outcome.off) {
        log.push(`  [push] off (FCM not configured): ${created.length} notification(s) not pushed`);
        return;
      }
      sent += outcome.sent;
      removed += outcome.removed;
      failed += outcome.failed;
      // Nothing got through: FCM or our credentials are down, and every
      // remaining notification would wait out the same timeouts. Stop.
      if (outcome.sent === 0 && outcome.failed > 0) {
        const left = created.length - created.indexOf(id) - 1;
        if (left > 0) log.push(`  [push] stopped after a failed round: ${left} notification(s) not pushed`);
        break;
      }
    } catch (err) {
      failed++;
      console.error("[cron/daily] push:", err instanceof Error ? err.message : err);
    }
  }
  log.push(`  [push] ${created.length} new notification(s): ${sent} sent, ${removed} device(s) gone, ${failed} failed`);
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Creates the notification unless (type, entity_id, event_date) already has
 * one — the job's idempotency. Records the id in `created` only when this call
 * made the row, so a re-run the same day pushes nothing twice.
 */
async function upsertNotification(
  created: string[],
  data: {
    type: NotificationType;
    title: string;
    body: string;
    entity_type: string;
    entity_id: string;
    event_date: Date;
  }
) {
  try {
    const row = await prisma.notification.create({
      data: {
        type: data.type,
        title: data.title,
        body: data.body,
        entity_type: data.entity_type,
        entity_id: data.entity_id,
        event_date: data.event_date,
      },
      select: { id: true },
    });
    created.push(row.id);
  } catch (err) {
    // P2002: already notified today (the unique index). Anything else is real.
    if ((err as { code?: unknown } | null)?.code !== "P2002") throw err;
  }
}

// ─── Subscriptions ────────────────────────────────────────────────────────────

async function runSubscriptions(today: Date, daysBefore: number, log: string[], created: string[]) {
  const subscriptions = await prisma.subscription.findMany({
    where: { status: "active" },
  });

  for (const sub of subscriptions) {
    for (const event of subscriptionEvents(sub, today, daysBefore)) {
      if (event.kind === "auto_upcoming") {
        await upsertNotification(
          created,
          buildSubscriptionNotification({
            type: "subscription_auto_upcoming",
            sub,
            dueDate: event.dueDate,
            eventDate: today,
            daysBefore,
          })
        );
        log.push(
          `  [auto upcoming] ${sub.name} (due ${event.dueDate.toISOString()})`
        );
        continue;
      }

      if (event.kind === "manual_due") {
        await upsertNotification(
          created,
          buildSubscriptionNotification({
            type: "subscription_manual_due",
            sub,
            dueDate: event.dueDate,
            eventDate: today,
            daysBefore,
          })
        );
        log.push(`  [manual upcoming] ${sub.name} in ${daysBefore}d`);
        continue;
      }

      // auto_charge — record the payment, then notify it happened.
      const existing = await prisma.subscriptionPayment.findFirst({
        where: {
          subscription_id: sub.id,
          due_date: event.dueDate,
          deleted_at: null,
        },
      });

      if (!existing) {
        await prisma.subscriptionPayment.create({
          data: {
            subscription_id: sub.id,
            due_date: event.dueDate,
            paid_at: event.dueDate,
            amount_cents_snapshot: sub.amount_cents,
          },
        });
        log.push(
          `  [auto paid] Created payment: ${sub.name} ${event.dueDate.toISOString().slice(0, 7)}`
        );
      }

      await upsertNotification(
        created,
        buildSubscriptionNotification({
          type: "subscription_auto_paid",
          sub,
          dueDate: event.dueDate,
          eventDate: today,
        })
      );
    }
  }
}

// ─── Salaries ─────────────────────────────────────────────────────────────────

async function runSalaries(today: Date, daysBefore: number, log: string[], created: string[]) {
  const people = await prisma.person.findMany({
    where: { status: "active" },
  });

  const when = daysBefore === 0
    ? "today"
    : `in ${daysBefore} day${daysBefore !== 1 ? "s" : ""}`;

  for (const person of people) {
    // Forward-looking: computing the due date from today's month and then
    // subtracting daysBefore silently never fires when payday_day <= daysBefore.
    const { hit, dueDate } = advanceNotice(today, daysBefore, person.payday_day);

    if (hit) {
      await upsertNotification(created, {
        type: "salary_manual_due" as NotificationType,
        title: `Salary due ${when}: ${person.name}`,
        body: `Monthly salary payment for ${person.name} is due ${when} (${dueDate.toISOString().slice(0, 10)}).`,
        entity_type: "person",
        entity_id: person.id,
        event_date: today,
      });
      log.push(`  [salary upcoming] ${person.name} ${when}`);
    }
  }
}

// ─── Salary Increase Reminders ────────────────────────────────────────────────

async function runIncreaseReminders(today: Date, log: string[], created: string[]) {
  const reminders = await prisma.salaryIncreaseReminder.findMany({
    where: {
      status: "scheduled",
      effective_date: { lte: new Date(today.getTime() + 86400000) },
    },
    include: { person: true },
  });

  for (const reminder of reminders) {
    if (isSameDay(today, reminder.effective_date)) {
      await upsertNotification(created, {
        type: "salary_increase_due" as NotificationType,
        title: `Salary increase due: ${reminder.person.name}`,
        body: `Suggested new salary: $${(reminder.suggested_new_base_cents / 100).toFixed(2)}`,
        entity_type: "salary_increase_reminder",
        entity_id: reminder.id,
        event_date: today,
      });
      log.push(
        `  [increase reminder] ${reminder.person.name} - $${(reminder.suggested_new_base_cents / 100).toFixed(2)}`
      );
    }
  }
}

// ─── Invoices ─────────────────────────────────────────────────────────────────

async function runInvoices(today: Date, daysBefore: number, log: string[], created: string[]) {
  const invoices = await prisma.invoice.findMany({
    where: { status: { not: "paid" } },
    include: { client: true },
  });

  for (const invoice of invoices) {
    if (invoice.reminder_date && isSameDay(today, invoice.reminder_date)) {
      await upsertNotification(created, {
        type: "invoice_reminder_due" as NotificationType,
        title: `Invoice reminder: ${invoice.client.name}`,
        body: `Invoice${invoice.invoice_number ? ` #${invoice.invoice_number}` : ""} of $${((invoice.amount_cents + invoice.fee_cents) / 100).toFixed(2)} — reminder date reached.`,
        entity_type: "invoice",
        entity_id: invoice.id,
        event_date: today,
      });
      log.push(`  [invoice reminder] ${invoice.client.name}`);
    }

    const notifyDate = addDaysUTC(invoice.due_date, -daysBefore);
    if (isSameDay(today, notifyDate)) {
      const dueMsg = daysBefore === 0
        ? "is due today."
        : `is due in ${daysBefore} day${daysBefore !== 1 ? "s" : ""}.`;
      await upsertNotification(created, {
        type: "invoice_due" as NotificationType,
        title: `Invoice due: ${invoice.client.name}`,
        body: `Invoice${invoice.invoice_number ? ` #${invoice.invoice_number}` : ""} of $${((invoice.amount_cents + invoice.fee_cents) / 100).toFixed(2)} ${dueMsg}`,
        entity_type: "invoice",
        entity_id: invoice.id,
        event_date: today,
      });
      log.push(`  [invoice due] ${invoice.client.name} (in ${daysBefore}d)`);
    }
  }
}

// ─── Issues ──────────────────────────────────────────────────────────────────

async function runIssues(today: Date, log: string[], created: string[]) {
  const tomorrow = addDaysUTC(today, 1);

  const issues = await prisma.issue.findMany({
    where: {
      category: "task",
      status: { notIn: ["done"] },
      due_date: { not: null },
    },
  });

  for (const issue of issues) {
    if (!issue.due_date) continue;

    // Due tomorrow
    if (isSameDay(tomorrow, issue.due_date)) {
      await upsertNotification(created, {
        type: "issue_due_tomorrow" as NotificationType,
        title: `Task due tomorrow: ${issue.title}`,
        body: `"${issue.title}" is due tomorrow (${issue.due_date.toISOString().slice(0, 10)}).`,
        entity_type: "issue",
        entity_id: issue.id,
        event_date: today,
      });
      log.push(`  [issue due tomorrow] ${issue.title}`);
    }

    // Due today
    if (isSameDay(today, issue.due_date)) {
      await upsertNotification(created, {
        type: "issue_due_today" as NotificationType,
        title: `Task due today: ${issue.title}`,
        body: `"${issue.title}" is due today.`,
        entity_type: "issue",
        entity_id: issue.id,
        event_date: today,
      });
      log.push(`  [issue due today] ${issue.title}`);
    }
  }
}
