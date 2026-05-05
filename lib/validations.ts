import { z } from "zod";

// ─── Subscriptions ────────────────────────────────────────────────────────────

export const SubscriptionBaseSchema = z.object({
  name: z.string().min(1, "Name is required"),
  amount_cents: z.number().int().positive("Amount must be positive"),
  frequency: z.enum(["monthly", "annual"]),
  pay_day: z.number().int().min(1).max(31),
  pay_month: z.number().int().min(1).max(12).nullable().optional(),
  category: z.enum(["work", "personal", "essential_service"]),
  payment_mode: z.enum(["auto", "manual"]),
  status: z.enum(["active", "inactive"]).default("active"),
  notes: z.string().nullable().optional(),
  icon_url: z.string().nullable().optional(),
});

export const SubscriptionSchema = SubscriptionBaseSchema.refine(
  (data) => {
    if (data.frequency === "annual") {
      return data.pay_month != null;
    }
    return true;
  },
  { message: "pay_month is required for annual subscriptions", path: ["pay_month"] }
);

export type SubscriptionInput = z.infer<typeof SubscriptionSchema>;

export const SubscriptionPaymentSchema = z.object({
  paid_at: z.string().min(1, "Payment date is required"),
  amount_cents: z.number().int().positive().optional(),
});

export type SubscriptionPaymentInput = z.infer<typeof SubscriptionPaymentSchema>;

// ─── People / Salaries ────────────────────────────────────────────────────────

export const PersonSchema = z.object({
  name: z.string().min(1, "Name is required"),
  payday_day: z.number().int().min(1).max(31),
  status: z.enum(["active", "inactive"]).default("active"),
  role_id: z.string().nullable().optional(),
  notes: z.string().nullable().optional(),
  base_salary_cents: z.number().int().min(0, "Salary must be non-negative"),
});

export type PersonInput = z.infer<typeof PersonSchema>;

export const SalaryPaymentSchema = z.object({
  paid_at: z.string().min(1, "Payment date is required"),
  adjustment_cents: z.number().int().default(0),
  adjustment_note: z.string().nullable().optional(),
});

export type SalaryPaymentInput = z.infer<typeof SalaryPaymentSchema>;

export const SalaryIncreaseReminderSchema = z.object({
  effective_date: z.string().min(1, "Effective date is required"),
  suggested_new_base_cents: z
    .number()
    .int()
    .positive("Suggested salary must be positive"),
});

export type SalaryIncreaseReminderInput = z.infer<
  typeof SalaryIncreaseReminderSchema
>;

// ─── Clients ──────────────────────────────────────────────────────────────────

export const ClientSchema = z.object({
  name: z.string().min(1, "Name is required"),
  color_hex: z
    .string()
    .regex(/^#[0-9A-Fa-f]{6}$/, "Must be a valid hex color")
    .default("#6366f1"),
  default_referrer_id: z.string().nullable().optional(),
});

export type ClientInput = z.infer<typeof ClientSchema>;

// ─── Referrers ───────────────────────────────────────────────────────────────

export const ReferrerSchema = z.object({
  name: z.string().min(1, "Name is required"),
  color_hex: z
    .string()
    .regex(/^#[0-9A-Fa-f]{6}$/, "Must be a valid hex color")
    .default("#6366f1"),
});

export type ReferrerInput = z.infer<typeof ReferrerSchema>;

// ─── Invoices ─────────────────────────────────────────────────────────────────

export const InvoiceSchema = z.object({
  invoice_number: z.string().nullable().optional(),
  client_id: z.string().min(1, "Client is required"),
  referrer_id: z.string().nullable().optional(),
  amount_cents: z.number().int().min(0, "Amount must be non-negative"),
  fee_cents: z.number().int().default(0),
  status: z
    .enum(["pending", "accounting", "sent", "paid"])
    .default("pending"),
  due_date: z.string().min(1, "Due date is required"),
  reminder_date: z.string().nullable().optional(),
  notes: z.string().nullable().optional(),
  file_url: z.string().nullable().optional(),
  file_key: z.string().nullable().optional(),
});

export type InvoiceInput = z.infer<typeof InvoiceSchema>;

// ─── Issues ──────────────────────────────────────────────────────────────────

export const IssueSchema = z.object({
  title: z.string().min(1, "Title is required"),
  client_id: z.string().nullable().optional(),
  category: z.enum(["task", "note"]).default("task"),
  status: z
    .enum(["pending", "in_progress", "blocked", "done"])
    .default("pending"),
  progress: z.number().int().min(0).max(100).default(0),
  due_date: z.string().nullable().optional(),
  description: z.string().default(""),
  sort_order: z.number().int().default(0),
});

export type IssueInput = z.infer<typeof IssueSchema>;
