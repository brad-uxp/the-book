/**
 * Seed / reconcile invoices from the 2025 archive document.
 *
 * Behavior:
 *  - 2025 invoices: created if invoice_number not found in DB. Skipped otherwise.
 *  - 2026 invoices: matched by invoice_number. Checks amount_cents + fee_cents.
 *      • Discrepancy → skipped, reported.
 *      • Values match → file_url set (or confirmed if already identical).
 *
 * Run:
 *   npx ts-node --project tsconfig.json -e "require('dotenv/config')" prisma/seed-invoices.ts
 */
import { PrismaClient } from "../app/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL ?? "" });
const prisma = new PrismaClient({ adapter });

// ─── Client color palette ─────────────────────────────────────────────────────

const CLIENT_COLORS: Record<string, string> = {
  ACL:            "#3b82f6",
  APAS:           "#10b981",
  "APAS-Chile":   "#14b8a6",
  DAS:            "#f97316",
  EtyaLab:        "#a855f7",
  CLT:            "#ec4899",
  MaM:            "#eab308",
  CRESTEO:        "#ef4444",
  DavidDevman:    "#6b7280",
  Edumind:        "#6366f1",
  "Avatar-Global":"#06b6d4",
  InversionesACL: "#64748b",
  Xray:           "#84cc16",
};

// ─── 2025 invoices — create if not present ───────────────────────────────────
// amount / fee in USD (multiplied ×100 → cents before write)

const INVOICES_2025: { number: string; client: string; amount: number; fee: number; date: string }[] = [
  { number: "a1",  client: "DavidDevman",   amount: 1450, fee:     0, date: "2025-06-30" },
  { number: "a2",  client: "ACL",           amount: 7000, fee:     0, date: "2025-06-30" },
  { number: "a3",  client: "ACL",           amount: 2500, fee:     0, date: "2025-06-30" },
  { number: "a4",  client: "EtyaLab",       amount:  400, fee:     0, date: "2025-07-28" },
  { number: "a5",  client: "APAS",          amount: 1900, fee:     0, date: "2025-07-29" },
  { number: "a6",  client: "ACL",           amount: 7000, fee:     0, date: "2025-07-29" },
  { number: "a7",  client: "EtyaLab",       amount:  400, fee:     0, date: "2025-08-30" },
  { number: "a8",  client: "ACL",           amount: 7000, fee:     0, date: "2025-08-30" },
  { number: "a9",  client: "EtyaLab",       amount: 1300, fee:     0, date: "2025-09-30" },
  { number: "a10", client: "APAS",          amount: 4500, fee: -1300, date: "2025-09-30" },
  { number: "a11", client: "ACL",           amount: 4677, fee:     0, date: "2025-09-30" },
  { number: "a12", client: "APAS",          amount: 2100, fee:  -700, date: "2025-09-30" },
  { number: "a13", client: "CRESTEO",       amount: 5600, fee:     0, date: "2025-09-30" },
  { number: "a14", client: "CLT",           amount:  600, fee:     0, date: "2025-09-30" },
  { number: "a16", client: "APAS",          amount: 2100, fee:  -700, date: "2025-10-30" },
  { number: "a17", client: "ACL",           amount: 3500, fee:     0, date: "2025-10-30" },
  { number: "a18", client: "CLT",           amount:  600, fee:     0, date: "2025-10-30" },
  { number: "a19", client: "Edumind",       amount:  568, fee:     0, date: "2025-10-30" },
  { number: "a20", client: "EtyaLab",       amount:  850, fee:     0, date: "2025-10-30" },
  { number: "a21", client: "MaM",           amount: 1700, fee:     0, date: "2025-11-28" },
  { number: "a22", client: "DAS",           amount: 4500, fee: -1300, date: "2025-11-28" },
  { number: "a23", client: "DAS",           amount: 2100, fee:  -700, date: "2025-11-28" },
  { number: "a24", client: "APAS",          amount: 2100, fee:  -700, date: "2025-11-28" },
  { number: "a25", client: "MaM",           amount:  600, fee:     0, date: "2025-11-28" },
  { number: "a26", client: "CLT",           amount:  600, fee:     0, date: "2025-11-28" },
  { number: "a27", client: "ACL",           amount: 3500, fee:     0, date: "2025-11-28" },
  { number: "a28", client: "EtyaLab",       amount: 1500, fee:     0, date: "2025-12-30" },
  { number: "a29", client: "MaM",           amount:  400, fee:     0, date: "2025-12-30" },
  { number: "a30", client: "CLT",           amount:  600, fee:     0, date: "2025-12-30" },
  { number: "a31", client: "APAS",          amount: 2100, fee:  -700, date: "2025-12-30" },
  { number: "a32", client: "DAS",           amount: 2100, fee:  -700, date: "2025-12-30" },
  { number: "a33", client: "ACL",           amount: 3560, fee:     0, date: "2025-12-30" },
  { number: "a34", client: "APAS-Chile",    amount: 4500, fee: -1300, date: "2025-12-30" },
  { number: "a43", client: "Avatar-Global", amount: 4600, fee:     0, date: "2025-12-30" },
];

// ─── 2026 invoices — file_url reconciliation only ────────────────────────────

const INVOICES_2026: { number: string; client: string; amount: number; fee: number; file_url: string }[] = [
  { number: "a35", client: "APAS",           amount: 2100, fee:  -700, file_url: "https://drive.google.com/file/d/1zPIkJ5h28DIItscugOsKSj2yGA6_2vYh/view?usp=drive_link" },
  { number: "a36", client: "APAS-Chile",     amount: 2100, fee:  -700, file_url: "https://drive.google.com/file/d/1I4c0L6MjE2aNhkUbAd6fNcnBZ8-GPv7A/view?usp=drive_link" },
  { number: "a37", client: "DAS",            amount: 2100, fee:  -700, file_url: "https://drive.google.com/file/d/1zwIBswTEknApmcF362ZtTts2oXd8gbfV/view?usp=drive_link" },
  { number: "a38", client: "CLT",            amount:  600, fee:     0, file_url: "https://drive.google.com/file/d/15hE5EJLzKda24U2RkoEzvNotq9IpSroX/view?usp=drive_link" },
  { number: "a39", client: "MaM",            amount:  400, fee:     0, file_url: "https://drive.google.com/file/d/1mWT_gR1IeiEdZnGPcT17VTzCCIoQ2ERU/view?usp=drive_link" },
  { number: "a40", client: "ACL",            amount: 3500, fee:     0, file_url: "https://drive.google.com/file/d/1jpaFUi99_BRgJmULGXEYLc6DL0mJYTPT/view?usp=drive_link" },
  { number: "a41", client: "Edumind",        amount:  400, fee:     0, file_url: "https://drive.google.com/file/d/1oUIfkiw9rpMWywU3VdmlIRKVOEw4rbam/view?usp=drive_link" },
  { number: "a42", client: "InversionesACL", amount: 1300, fee:     0, file_url: "https://drive.google.com/file/d/1ZQd2jHuDcLVtrFHEqO-P61_rENV9vQde/view?usp=drive_link" },
  { number: "a44", client: "Xray",           amount: 1400, fee:     0, file_url: "https://drive.google.com/file/d/1OL-0bERbP75rfrCniA0oUwPVfZ-qE2Vk/view?usp=drive_link" },
  { number: "a45", client: "APAS",           amount: 2100, fee:  -700, file_url: "https://drive.google.com/file/d/1zQRc-Us-0le7lPASuz3O2O0Wlbho8msT/view?usp=drive_link" },
  { number: "a46", client: "DAS",            amount: 2100, fee:  -700, file_url: "https://drive.google.com/file/d/1n2_fQ4nNNv3XxxazXN9uL-yW1nsWwk93/view?usp=drive_link" },
  { number: "a47", client: "ACL",            amount: 3500, fee:     0, file_url: "https://drive.google.com/file/d/104pjgKFzDXHSNrA4ohI8clLLRp4eTTQ-/view?usp=drive_link" },
  { number: "a48", client: "InversionesACL", amount: 1300, fee:     0, file_url: "https://drive.google.com/file/d/1-yQ2QN4gyiCEm0CnnQl4pWcCRoLX-9GS/view?usp=drive_link" },
  { number: "a49", client: "CLT",            amount:  600, fee:     0, file_url: "https://drive.google.com/file/d/1ftNgoE9VPd0eSfDQwnfHCFh_dwF2FPzD/view?usp=drive_link" },
  { number: "a50", client: "MaM",            amount:  400, fee:     0, file_url: "https://drive.google.com/file/d/1dC33k7ELMkyMd5vvKhHBIB7n627r4CgL/view?usp=drive_link" },
  { number: "a51", client: "EtyaLab",        amount:  550, fee:     0, file_url: "https://drive.google.com/file/d/1Jfy9Kcyowa0f5KsWV47GwWtE2Grz82c9/view?usp=drive_link" },
  { number: "a52", client: "Edumind",        amount:  400, fee:     0, file_url: "https://drive.google.com/file/d/18OydQyo6JY2kHD6BO9AErAF82EFC_YIB/view?usp=drive_link" },
  { number: "a53", client: "APAS-Chile",     amount: 2100, fee:  -700, file_url: "https://drive.google.com/file/d/1AvpvESQrBVTtewvxwkBLXeqdRrd58exu/view?usp=drive_link" },
];

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log("🌱  Invoice seed / reconcile\n");

  // Build client map (name → id), creating missing clients
  const allNames = [...new Set([
    ...INVOICES_2025.map((i) => i.client),
    ...INVOICES_2026.map((i) => i.client),
  ])];

  const existing = await prisma.client.findMany({ where: { name: { in: allNames } } });
  const clientMap: Record<string, string> = {};
  for (const c of existing) clientMap[c.name] = c.id;

  for (const name of allNames.filter((n) => !clientMap[n])) {
    const c = await prisma.client.create({
      data: { name, color_hex: CLIENT_COLORS[name] ?? "#6366f1" },
    });
    clientMap[name] = c.id;
    console.log(`  + New client: ${name}`);
  }

  // ── 2025: create if not present ──────────────────────────────────────────

  console.log("\n── 2025 invoices ──────────────────────────────────────────────");
  let created2025 = 0;
  let skipped2025 = 0;

  for (const inv of INVOICES_2025) {
    const found = await prisma.invoice.findFirst({ where: { invoice_number: inv.number } });
    if (found) {
      console.log(`  SKIP   ${inv.number}  (already exists)`);
      skipped2025++;
      continue;
    }
    await prisma.invoice.create({
      data: {
        invoice_number: inv.number,
        client_id:      clientMap[inv.client],
        amount_cents:   inv.amount * 100,
        fee_cents:      inv.fee    * 100,
        status:         "paid",
        due_date:       new Date(`${inv.date}T00:00:00.000Z`),
      },
    });
    console.log(`  ✓      ${inv.number}  ${inv.client.padEnd(14)}  $${inv.amount}`);
    created2025++;
  }

  console.log(`\n  Created: ${created2025}  ·  Skipped: ${skipped2025}`);

  // ── 2026: match + validate + set file_url ────────────────────────────────

  console.log("\n── 2026 invoices — file_url reconciliation ────────────────────");
  const discrepancies: string[] = [];
  let updated2026  = 0;
  let already2026  = 0;
  let missing2026  = 0;

  for (const inv of INVOICES_2026) {
    const found = await prisma.invoice.findFirst({ where: { invoice_number: inv.number } });

    if (!found) {
      const msg = `  MISSING  ${inv.number} (${inv.client}) — not found in DB`;
      console.log(msg);
      discrepancies.push(msg);
      missing2026++;
      continue;
    }

    const expectedAmount = inv.amount * 100;
    const expectedFee    = inv.fee    * 100;
    const diffs: string[] = [];

    if (found.amount_cents !== expectedAmount)
      diffs.push(`amount: DB $${found.amount_cents / 100} ≠ MD $${inv.amount}`);
    if (found.fee_cents !== expectedFee)
      diffs.push(`fee: DB $${found.fee_cents / 100} ≠ MD $${inv.fee}`);

    if (diffs.length > 0) {
      const msg = `  DISCREPANCY  ${inv.number} (${inv.client}): ${diffs.join("  |  ")}`;
      console.log(msg);
      discrepancies.push(msg);
      continue;
    }

    if (found.file_url === inv.file_url) {
      console.log(`  SKIP   ${inv.number}  file_url already set`);
      already2026++;
      continue;
    }

    await prisma.invoice.update({
      where: { id: found.id },
      data:  { file_url: inv.file_url },
    });
    console.log(`  ✓      ${inv.number}  ${inv.client.padEnd(14)}  file_url updated`);
    updated2026++;
  }

  console.log(`\n  Updated: ${updated2026}  ·  Already set: ${already2026}  ·  Missing: ${missing2026}`);

  // ── Summary ───────────────────────────────────────────────────────────────

  if (discrepancies.length > 0) {
    console.log("\n⚠️  DISCREPANCIES — requires manual review:");
    discrepancies.forEach((d) => console.log(d));
  } else {
    console.log("\n✅  No discrepancies.");
  }

  console.log("\n✅  Done.");
}

main()
  .catch((e) => { console.error("❌", e); process.exit(1); })
  .finally(() => prisma.$disconnect());
