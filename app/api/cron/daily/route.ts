import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getTodayInTZ, isSameDay, addDaysUTC, clampDay } from "@/lib/dates";
import {
  getSubscriptionPeriod,
  buildSubscriptionNotification,
} from "@/lib/cron-helpers";
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
    await runSubscriptions(today, log);
    await runSalaries(today, log);
    await runIncreaseReminders(today, log);
    await runInvoices(today, log);

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

async function runSubscriptions(today: Date, log: string[]) {
  const subscriptions = await prisma.subscription.findMany({
    where: { status: "active" },
  });

  for (const sub of subscriptions) {
    const { periodKey, dueDate, isToday, isTwoDaysBefore } =
      getSubscriptionPeriod(sub, today);

    if (sub.payment_mode === "auto") {
      // 2 days before: upcoming notification
      if (isTwoDaysBefore) {
        await upsertNotification(
          buildSubscriptionNotification({
            type: "subscription_auto_upcoming",
            sub,
            dueDate,
            eventDate: addDaysUTC(dueDate, -2),
          })
        );
        log.push(
          `  [auto upcoming] ${sub.name} (due ${dueDate.toISOString()})`
        );
      }

      // On due date: create payment + paid notification
      if (isToday) {
        // Check for existing non-deleted payment
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
      // Manual: notify on due date
      if (isToday) {
        await upsertNotification(
          buildSubscriptionNotification({
            type: "subscription_manual_due",
            sub,
            dueDate,
            eventDate: today,
          })
        );
        log.push(`  [manual due] ${sub.name} ${periodKey}`);
      }
    }
  }
}

// ─── Salaries ─────────────────────────────────────────────────────────────────

async function runSalaries(today: Date, log: string[]) {
  const people = await prisma.person.findMany({
    where: { status: "active" },
  });

  const year = today.getUTCFullYear();
  const month = today.getUTCMonth() + 1;

  for (const person of people) {
    const day = clampDay(year, month, person.payday_day);
    const dueDate = new Date(Date.UTC(year, month - 1, day));

    if (isSameDay(today, dueDate)) {
      await upsertNotification({
        type: "salary_manual_due" as NotificationType,
        title: `Salary due: ${person.name}`,
        body: `Monthly salary payment for ${person.name} is due today.`,
        entity_type: "person",
        entity_id: person.id,
        event_date: today,
      });
      log.push(`  [salary due] ${person.name}`);
    }
  }
}

// ─── Salary Increase Reminders ────────────────────────────────────────────────

async function runIncreaseReminders(today: Date, log: string[]) {
  const reminders = await prisma.salaryIncreaseReminder.findMany({
    where: {
      status: "scheduled",
      effective_date: { lte: new Date(today.getTime() + 86400000) }, // today or past
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

async function runInvoices(today: Date, log: string[]) {
  const invoices = await prisma.invoice.findMany({
    where: { status: { not: "paid" } },
    include: { client: true },
  });

  for (const invoice of invoices) {
    if (
      invoice.reminder_date &&
      isSameDay(today, invoice.reminder_date)
    ) {
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

    if (isSameDay(today, invoice.due_date)) {
      await upsertNotification({
        type: "invoice_due" as NotificationType,
        title: `Invoice due: ${invoice.client.name}`,
        body: `Invoice${invoice.invoice_number ? ` #${invoice.invoice_number}` : ""} of $${((invoice.amount_cents + invoice.fee_cents) / 100).toFixed(2)} is due today.`,
        entity_type: "invoice",
        entity_id: invoice.id,
        event_date: today,
      });
      log.push(`  [invoice due] ${invoice.client.name}`);
    }
  }
}
