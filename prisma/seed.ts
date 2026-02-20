import { PrismaClient } from "../app/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

const adapter = new PrismaPg({
  connectionString: process.env.DATABASE_URL ?? "",
});
const prisma = new PrismaClient({ adapter });

async function main() {
  console.log("🌱 Seeding database...");

  // ─── Clients ──────────────────────────────────────────────────────────────

  const clientA = await prisma.client.upsert({
    where: { id: "00000000-0000-0000-0000-000000000001" },
    update: {},
    create: {
      id: "00000000-0000-0000-0000-000000000001",
      name: "Acme Corp",
      color_hex: "#6366f1",
    },
  });

  const clientB = await prisma.client.upsert({
    where: { id: "00000000-0000-0000-0000-000000000002" },
    update: {},
    create: {
      id: "00000000-0000-0000-0000-000000000002",
      name: "Globex Inc",
      color_hex: "#f59e0b",
    },
  });

  console.log(`  ✓ Clients: ${clientA.name}, ${clientB.name}`);

  // ─── Subscriptions ────────────────────────────────────────────────────────

  const sub1 = await prisma.subscription.upsert({
    where: { id: "00000000-0000-0000-0001-000000000001" },
    update: {},
    create: {
      id: "00000000-0000-0000-0001-000000000001",
      name: "GitHub Pro",
      amount_cents: 400, // $4.00
      frequency: "monthly",
      pay_day: 15,
      category: "work",
      payment_mode: "auto",
      status: "active",
    },
  });

  const sub2 = await prisma.subscription.upsert({
    where: { id: "00000000-0000-0000-0001-000000000002" },
    update: {},
    create: {
      id: "00000000-0000-0000-0001-000000000002",
      name: "Netflix",
      amount_cents: 1799, // $17.99
      frequency: "monthly",
      pay_day: 1,
      category: "personal",
      payment_mode: "manual",
      status: "active",
    },
  });

  const sub3 = await prisma.subscription.upsert({
    where: { id: "00000000-0000-0000-0001-000000000003" },
    update: {},
    create: {
      id: "00000000-0000-0000-0001-000000000003",
      name: "AWS Annual",
      amount_cents: 100000, // $1000.00
      frequency: "annual",
      pay_day: 1,
      pay_month: 3, // March
      category: "work",
      payment_mode: "auto",
      status: "active",
    },
  });

  console.log(
    `  ✓ Subscriptions: ${sub1.name}, ${sub2.name}, ${sub3.name}`
  );

  // ─── People & Salaries ────────────────────────────────────────────────────

  const person1 = await prisma.person.upsert({
    where: { id: "00000000-0000-0000-0002-000000000001" },
    update: {},
    create: {
      id: "00000000-0000-0000-0002-000000000001",
      name: "Alice Doe",
      payday_day: 28,
      status: "active",
    },
  });

  await prisma.salaryBase.upsert({
    where: { person_id: person1.id },
    update: {},
    create: {
      person_id: person1.id,
      base_salary_cents: 300000, // $3000.00
    },
  });

  const person2 = await prisma.person.upsert({
    where: { id: "00000000-0000-0000-0002-000000000002" },
    update: {},
    create: {
      id: "00000000-0000-0000-0002-000000000002",
      name: "Bob Smith",
      payday_day: 30,
      status: "active",
    },
  });

  await prisma.salaryBase.upsert({
    where: { person_id: person2.id },
    update: {},
    create: {
      person_id: person2.id,
      base_salary_cents: 250000, // $2500.00
    },
  });

  console.log(`  ✓ People: ${person1.name}, ${person2.name}`);

  // ─── Invoices ─────────────────────────────────────────────────────────────

  const inv1 = await prisma.invoice.upsert({
    where: { id: "00000000-0000-0000-0003-000000000001" },
    update: {},
    create: {
      id: "00000000-0000-0000-0003-000000000001",
      invoice_number: "INV-001",
      client_id: clientA.id,
      amount_cents: 500000, // $5000.00
      fee_cents: -5000, // -$50.00 fee
      status: "sent",
      due_date: new Date("2026-03-01"),
      reminder_date: new Date("2026-02-25"),
      notes: "Q1 2026 services",
    },
  });

  const inv2 = await prisma.invoice.upsert({
    where: { id: "00000000-0000-0000-0003-000000000002" },
    update: {},
    create: {
      id: "00000000-0000-0000-0003-000000000002",
      invoice_number: "INV-002",
      client_id: clientB.id,
      amount_cents: 200000, // $2000.00
      fee_cents: 0,
      status: "pending",
      due_date: new Date("2026-04-15"),
    },
  });

  console.log(`  ✓ Invoices: ${inv1.invoice_number}, ${inv2.invoice_number}`);

  console.log("✅ Seed complete!");
}

main()
  .catch((e) => {
    console.error("❌ Seed error:", e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
