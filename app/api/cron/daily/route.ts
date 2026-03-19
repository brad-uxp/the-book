import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getTodayInTZ, isSameDay, addDaysUTC, clampDay } from "@/lib/dates";
import {
  getSubscriptionPeriod,
  buildSubscriptionNotification,
} from "@/lib/cron-helpers";
import { sendWebPushToAll } from "@/lib/web-push";
import type { NotificationType } from "@/app/generated/prisma/client";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * GET /api/cron/daily
 * Protected by CRON_SECRET (Vercel Cron authorization header).
 */
export async function GET(req: NextRequest) {
  const authHeader = req.headers.get("authorization");
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const today = getTodayInTZ();
  const log: string[] = [`[cron/daily] Running for ${today.toISOString()}`];

  try {
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

    await runSubscriptions(today, daysSub, log);
    await runSalaries(today, daysSalary, log);
    await runIncreaseReminders(today, log);
    await runInvoices(today, daysInvoice, log);

    // Send web push for notifications created today
    await sendPendingPush(today, log);

    log.push("[cron/daily] Done.");
    console.log(log.join("\n"));
    return NextResponse.json({ ok: true, log });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log.push(`[cron/daily] ERROR: ${msg}`);
    console.error(log.join("\n"));
    return NextResponse.json({ ok: false, log, error: msg }, { status: 500 });
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function upsertNotification(data: {
  type: NotificationType;
  title: string;
  body: string;
  entity_type: string;
  entity_id: string;
  event_date: Date;
}) {
  await prisma.notification.upsert({
    where: {
      type_entity_id_event_date: {
        type: data.type,
        entity_id: data.entity_id,
        event_date: data.event_date,
      },
    },
    update: {},
    create: {
      type: data.type,
      title: data.title,
      body: data.body,
      entity_type: data.entity_type,
      entity_id: data.entity_id,
      event_date: data.event_date,
    },
  });
}

// ─── Subscriptions ────────────────────────────────────────────────────────────

async function runSubscriptions(today: Date, daysBefore: number, log: string[]) {
  const subscriptions = await prisma.subscription.findMany({
    where: { status: "active" },
  });

  for (const sub of subscriptions) {
    const { dueDate, isToday, isDaysBefore } =
      getSubscriptionPeriod(sub, today, daysBefore);

    if (sub.payment_mode === "auto") {
      // N days before: upcoming notification
      if (isDaysBefore) {
        await upsertNotification(
          buildSubscriptionNotification({
            type: "subscription_auto_upcoming",
            sub,
            dueDate,
            eventDate: addDaysUTC(dueDate, -daysBefore),
            daysBefore,
          })
        );
        log.push(
          `  [auto upcoming] ${sub.name} (due ${dueDate.toISOString()})`
        );
      }

      // On due date: create payment + paid notification
      if (isToday) {
        const existing = await prisma.subscriptionPayment.findFirst({
          where: {
            subscription_id: sub.id,
            due_date: dueDate,
            deleted_at: null,
          },
        });

        if (!existing) {
          await prisma.subscriptionPayment.create({
            data: {
              subscription_id: sub.id,
              due_date: dueDate,
              paid_at: dueDate,
              amount_cents_snapshot: sub.amount_cents,
            },
          });
          log.push(`  [auto paid] Created payment: ${sub.name} ${dueDate.toISOString().slice(0, 7)}`);
        }

        await upsertNotification(
          buildSubscriptionNotification({
            type: "subscription_auto_paid",
            sub,
            dueDate,
            eventDate: today,
          })
        );
      }
    } else {
      // Manual: notify N days before
      if (isDaysBefore) {
        await upsertNotification(
          buildSubscriptionNotification({
            type: "subscription_manual_due",
            sub,
            dueDate,
            eventDate: addDaysUTC(dueDate, -daysBefore),
            daysBefore,
          })
        );
        log.push(`  [manual upcoming] ${sub.name} in ${daysBefore}d`);
      }
    }
  }
}

// ─── Salaries ─────────────────────────────────────────────────────────────────

async function runSalaries(today: Date, daysBefore: number, log: string[]) {
  const people = await prisma.person.findMany({
    where: { status: "active" },
  });

  const year  = today.getUTCFullYear();
  const month = today.getUTCMonth() + 1;

  for (const person of people) {
    const day     = clampDay(year, month, person.payday_day);
    const dueDate = new Date(Date.UTC(year, month - 1, day));
    const notifyDate = addDaysUTC(dueDate, -daysBefore);

    if (isSameDay(today, notifyDate)) {
      await upsertNotification({
        type: "salary_manual_due" as NotificationType,
        title: `Salary due in ${daysBefore} day${daysBefore !== 1 ? "s" : ""}: ${person.name}`,
        body: `Monthly salary payment for ${person.name} is due in ${daysBefore} day${daysBefore !== 1 ? "s" : ""} (${dueDate.toISOString().slice(0, 10)}).`,
        entity_type: "person",
        entity_id: person.id,
        event_date: today,
      });
      log.push(`  [salary upcoming] ${person.name} in ${daysBefore}d`);
    }
  }
}

// ─── Salary Increase Reminders ────────────────────────────────────────────────

async function runIncreaseReminders(today: Date, log: string[]) {
  const reminders = await prisma.salaryIncreaseReminder.findMany({
    where: {
      status: "scheduled",
      effective_date: { lte: new Date(today.getTime() + 86400000) },
    },
    include: { person: true },
  });

  for (const reminder of reminders) {
    if (isSameDay(today, reminder.effective_date)) {
      await upsertNotification({
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

async function runInvoices(today: Date, daysBefore: number, log: string[]) {
  const invoices = await prisma.invoice.findMany({
    where: { status: { not: "paid" } },
    include: { client: true },
  });

  for (const invoice of invoices) {
    if (invoice.reminder_date && isSameDay(today, invoice.reminder_date)) {
      await upsertNotification({
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
      await upsertNotification({
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

// ─── Web Push ────────────────────────────────────────────────────────────────

async function sendPendingPush(today: Date, log: string[]) {
  const unsent = await prisma.notification.findMany({
    where: {
      created_at: { gte: today },
    },
  });

  if (unsent.length === 0) {
    log.push("  [push] No new notifications to push.");
    return;
  }

  // Send a single aggregated push if multiple, or individual if just one
  try {
    if (unsent.length === 1) {
      await sendWebPushToAll({
        title: unsent[0].title,
        body: unsent[0].body,
        data: {
          entity_type: unsent[0].entity_type,
          entity_id: unsent[0].entity_id,
          url: `/${unsent[0].entity_type}s`,
        },
      });
    } else {
      await sendWebPushToAll({
        title: `${unsent.length} nuevas notificaciones`,
        body: unsent.map((n) => n.title).slice(0, 3).join(", ") +
          (unsent.length > 3 ? "…" : ""),
        data: { url: "/notifications" },
      });
    }
    log.push(`  [push] Sent web push for ${unsent.length} notification(s).`);
  } catch (err) {
    log.push(`  [push error] ${err instanceof Error ? err.message : String(err)}`);
  }
}
