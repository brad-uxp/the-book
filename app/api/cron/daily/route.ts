import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getTodayInTZ, isSameDay, addDaysUTC, clampDay, formatDate } from "@/lib/dates";
import {
  getSubscriptionPeriod,
  buildSubscriptionNotification,
} from "@/lib/cron-helpers";
import {
  sendEmail,
  buildSubscriptionUpcomingEmail,
  buildSalaryGroupEmail,
  buildInvoiceDueEmail,
  buildInvoiceReminderEmail,
  buildSalaryIncreaseEmail,
} from "@/lib/email";
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
  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
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
    const recipient   = settings?.email_recipient ?? null;

    log.push(`  [settings] daysSub=${daysSub}, daysSalary=${daysSalary}, daysInvoice=${daysInvoice}, recipient=${recipient ?? "none"}`);

    // Purge notifications older than 7 days
    const sevenDaysAgo = new Date(today.getTime() - 7 * 24 * 60 * 60 * 1000);
    const purged = await prisma.notification.deleteMany({
      where: { created_at: { lt: sevenDaysAgo } },
    });
    log.push(`  [cleanup] Deleted ${purged.count} notifications older than 7 days`);

    await runSubscriptions(today, daysSub, log);
    await runSalaries(today, daysSalary, log);
    await runIncreaseReminders(today, log);
    await runInvoices(today, daysInvoice, log);

    // Send emails for any notifications created today that haven't been emailed yet
    if (recipient) {
      await sendPendingEmails(today, recipient, daysSub, daysSalary, log);
    } else {
      log.push("  [email] Skipped — no recipient configured in Settings.");
    }

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
    const { periodKey, dueDate, isToday, isDaysBefore } =
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
            period_key: periodKey,
            deleted_at: null,
          },
        });

        if (!existing) {
          await prisma.subscriptionPayment.create({
            data: {
              subscription_id: sub.id,
              period_key: periodKey,
              due_date: dueDate,
              paid_at: dueDate,
              amount_cents_snapshot: sub.amount_cents,
            },
          });
          log.push(`  [auto paid] Created payment: ${sub.name} ${periodKey}`);
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

// ─── Email sending ────────────────────────────────────────────────────────────

async function sendPendingEmails(
  today: Date,
  recipient: string,
  daysSub: number,
  daysSalary: number,
  log: string[]
) {
  // Find all notifications created today that haven't been emailed yet.
  // "Today" for created_at purposes: from UTC midnight of today.
  const unsent = await prisma.notification.findMany({
    where: {
      email_sent_at: null,
      created_at: { gte: today },
    },
  });

  if (unsent.length === 0) {
    log.push("  [email] No new notifications to send.");
    return;
  }

  const sentIds: string[] = [];

  // Group salary notifications into a single email
  const salaryNotifs = unsent.filter((n) => n.type === "salary_manual_due");
  const otherNotifs  = unsent.filter((n) => n.type !== "salary_manual_due");

  if (salaryNotifs.length > 0) {
    // Resolve person names from entity_id
    const people = await prisma.person.findMany({
      where: { id: { in: salaryNotifs.map((n) => n.entity_id) } },
      select: { id: true, name: true, payday_day: true },
    });
    const nameMap = Object.fromEntries(people.map((p) => [p.id, p.name]));
    const names = salaryNotifs.map((n) => nameMap[n.entity_id] ?? n.entity_id);

    // Compute the pay date (today + daysSalary)
    const payDate = addDaysUTC(today, daysSalary);

    try {
      const { subject, html } = buildSalaryGroupEmail({
        people: names,
        dueDate: formatDate(payDate),
        daysBefore: daysSalary,
      });
      await sendEmail(recipient, subject, html);
      sentIds.push(...salaryNotifs.map((n) => n.id));
      log.push(`  [email sent] salary group (${names.join(", ")})`);
    } catch (err) {
      log.push(`  [email error] salary group: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  // Send individual emails for the rest
  for (const notif of otherNotifs) {
    try {
      const { subject, html } = await buildEmailForNotification(notif, daysSub, daysSalary);
      if (!subject) continue; // auto_paid notifications don't get an email
      await sendEmail(recipient, subject, html);
      sentIds.push(notif.id);
      log.push(`  [email sent] ${notif.type}: ${notif.title}`);
    } catch (err) {
      log.push(`  [email error] ${notif.type}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  // Mark all successfully sent notifications
  if (sentIds.length > 0) {
    await prisma.notification.updateMany({
      where: { id: { in: sentIds } },
      data: { email_sent_at: new Date() },
    });
  }
}

async function buildEmailForNotification(
  notif: { type: string; entity_id: string; entity_type: string },
  daysSub: number,
  _daysSalary: number
): Promise<{ subject: string; html: string } | { subject: null; html: null }> {
  const skip = { subject: null as null, html: null as null };

  if (notif.type === "subscription_auto_upcoming") {
    const sub = await prisma.subscription.findUnique({ where: { id: notif.entity_id } });
    if (!sub) return skip;
    return buildSubscriptionUpcomingEmail({
      name: sub.name,
      amountCents: sub.amount_cents,
      dueDate: formatDate(addDaysUTC(new Date(), daysSub)),
      daysBefore: daysSub,
    });
  }

  if (notif.type === "subscription_manual_due") {
    const sub = await prisma.subscription.findUnique({ where: { id: notif.entity_id } });
    if (!sub) return skip;
    return buildSubscriptionUpcomingEmail({
      name: sub.name,
      amountCents: sub.amount_cents,
      dueDate: formatDate(addDaysUTC(new Date(), daysSub)),
      daysBefore: daysSub,
    });
  }

  if (notif.type === "subscription_auto_paid") {
    // No email for auto-paid confirmations
    return skip;
  }

  if (notif.type === "invoice_due") {
    const invoice = await prisma.invoice.findUnique({
      where: { id: notif.entity_id },
      include: { client: true },
    });
    if (!invoice) return skip;
    return buildInvoiceDueEmail({
      clientName: invoice.client.name,
      invoiceNumber: invoice.invoice_number,
      amountCents: invoice.amount_cents,
      feeCents: invoice.fee_cents,
      dueDate: formatDate(invoice.due_date),
    });
  }

  if (notif.type === "invoice_reminder_due") {
    const invoice = await prisma.invoice.findUnique({
      where: { id: notif.entity_id },
      include: { client: true },
    });
    if (!invoice) return skip;
    return buildInvoiceReminderEmail({
      clientName: invoice.client.name,
      invoiceNumber: invoice.invoice_number,
      amountCents: invoice.amount_cents,
      feeCents: invoice.fee_cents,
      dueDate: formatDate(invoice.due_date),
    });
  }

  if (notif.type === "salary_increase_due") {
    const reminder = await prisma.salaryIncreaseReminder.findUnique({
      where: { id: notif.entity_id },
      include: { person: true },
    });
    if (!reminder) return skip;
    return buildSalaryIncreaseEmail({
      personName: reminder.person.name,
      suggestedCents: reminder.suggested_new_base_cents,
      effectiveDate: formatDate(reminder.effective_date),
    });
  }

  return skip;
}
