import nodemailer from "nodemailer";

const transporter = nodemailer.createTransport({
  service: "gmail",
  auth: {
    user: process.env.GMAIL_USER,
    pass: process.env.GMAIL_APP_PASSWORD,
  },
});

export async function sendEmail(
  to: string,
  subject: string,
  html: string
): Promise<void> {
  await transporter.sendMail({
    from: `"TheBook" <${process.env.GMAIL_USER}>`,
    to,
    subject,
    html,
  });
}

function wrap(body: string): string {
  return `
    <div style="font-family: sans-serif; max-width: 520px; margin: 0 auto; color: #111;">
      <div style="background: #f8f8f8; border-bottom: 1px solid #e5e7eb; padding: 16px 24px;">
        <span style="font-weight: 700; font-size: 16px; letter-spacing: -0.3px;">TheBook</span>
      </div>
      <div style="padding: 24px;">
        ${body}
      </div>
      <div style="padding: 12px 24px; border-top: 1px solid #e5e7eb; font-size: 12px; color: #9ca3af;">
        Este es un mensaje automático generado por TheBook.
      </div>
    </div>
  `;
}

// ─── Email builders ────────────────────────────────────────────────────────────

export function buildSubscriptionUpcomingEmail(params: {
  name: string;
  amountCents: number;
  dueDate: string;
  daysBefore: number;
}): { subject: string; html: string } {
  const { name, amountCents, dueDate, daysBefore } = params;
  const amount = `$${(amountCents / 100).toFixed(2)}`;
  const subject = `[TheBook] Pago próximo en ${daysBefore} día${daysBefore !== 1 ? "s" : ""}: ${name}`;
  const html = wrap(`
    <h2 style="margin: 0 0 12px; font-size: 18px;">Pago próximo: <strong>${name}</strong></h2>
    <p style="margin: 0 0 8px; color: #374151;">
      En <strong>${daysBefore} día${daysBefore !== 1 ? "s" : ""}</strong> se vence el pago de
      <strong>${name}</strong> por <strong>${amount}</strong>.
    </p>
    <p style="margin: 8px 0 0; color: #6b7280; font-size: 14px;">Fecha de vencimiento: ${dueDate}</p>
  `);
  return { subject, html };
}

export function buildSalaryGroupEmail(params: {
  people: string[];
  dueDate: string;
  daysBefore: number;
}): { subject: string; html: string } {
  const { people, dueDate, daysBefore } = params;
  const subject = `[TheBook] Pago de salarios en ${daysBefore} día${daysBefore !== 1 ? "s" : ""}`;
  const list = people.map((n) => `<li style="margin: 4px 0;">${n}</li>`).join("");
  const html = wrap(`
    <h2 style="margin: 0 0 12px; font-size: 18px;">Pago de salarios próximo</h2>
    <p style="margin: 0 0 12px; color: #374151;">
      En <strong>${daysBefore} día${daysBefore !== 1 ? "s" : ""}</strong> deberás efectuar el pago de salarios de:
    </p>
    <ul style="margin: 0 0 12px; padding-left: 20px; color: #374151;">${list}</ul>
    <p style="margin: 8px 0 0; color: #6b7280; font-size: 14px;">Fecha de pago: ${dueDate}</p>
  `);
  return { subject, html };
}

export function buildInvoiceDueEmail(params: {
  clientName: string;
  invoiceNumber: string | null;
  amountCents: number;
  feeCents: number;
  dueDate: string;
}): { subject: string; html: string } {
  const { clientName, invoiceNumber, amountCents, feeCents, dueDate } = params;
  const amount = `$${((amountCents + feeCents) / 100).toFixed(2)}`;
  const inv = invoiceNumber ? ` #${invoiceNumber}` : "";
  const subject = `[TheBook] Factura vence hoy: ${clientName}`;
  const html = wrap(`
    <h2 style="margin: 0 0 12px; font-size: 18px;">Factura vence hoy</h2>
    <p style="margin: 0 0 8px; color: #374151;">
      La factura<strong>${inv}</strong> de <strong>${clientName}</strong> por <strong>${amount}</strong> vence hoy.
    </p>
    <p style="margin: 8px 0 0; color: #6b7280; font-size: 14px;">Fecha de vencimiento: ${dueDate}</p>
  `);
  return { subject, html };
}

export function buildInvoiceReminderEmail(params: {
  clientName: string;
  invoiceNumber: string | null;
  amountCents: number;
  feeCents: number;
  dueDate: string;
}): { subject: string; html: string } {
  const { clientName, invoiceNumber, amountCents, feeCents, dueDate } = params;
  const amount = `$${((amountCents + feeCents) / 100).toFixed(2)}`;
  const inv = invoiceNumber ? ` #${invoiceNumber}` : "";
  const subject = `[TheBook] Recordatorio: Factura ${clientName}`;
  const html = wrap(`
    <h2 style="margin: 0 0 12px; font-size: 18px;">Recordatorio de factura</h2>
    <p style="margin: 0 0 8px; color: #374151;">
      Recordatorio para la factura<strong>${inv}</strong> de <strong>${clientName}</strong> por <strong>${amount}</strong>.
    </p>
    <p style="margin: 8px 0 0; color: #6b7280; font-size: 14px;">Fecha de vencimiento: ${dueDate}</p>
  `);
  return { subject, html };
}

export function buildSalaryIncreaseEmail(params: {
  personName: string;
  suggestedCents: number;
  effectiveDate: string;
}): { subject: string; html: string } {
  const { personName, suggestedCents, effectiveDate } = params;
  const amount = `$${(suggestedCents / 100).toFixed(2)}`;
  const subject = `[TheBook] Ajuste salarial: ${personName}`;
  const html = wrap(`
    <h2 style="margin: 0 0 12px; font-size: 18px;">Recordatorio de ajuste salarial</h2>
    <p style="margin: 0 0 8px; color: #374151;">
      Es momento de aplicar el ajuste salarial de <strong>${personName}</strong>.
    </p>
    <p style="margin: 0 0 8px; color: #374151;">
      Nuevo salario sugerido: <strong>${amount}</strong>
    </p>
    <p style="margin: 8px 0 0; color: #6b7280; font-size: 14px;">Fecha efectiva: ${effectiveDate}</p>
  `);
  return { subject, html };
}
