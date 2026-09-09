import { z } from "zod";
import { isInvoiceKey } from "./r2";
import { CANVAS_BOUND } from "./issue-canvas";
import {
  DEFAULT_LABEL_COLOR,
  LABEL_COLOR_KEYS,
  LABEL_MAX_LENGTH,
} from "./canvas-labels";

/**
 * A URL safe to put in an href or an img src. Plain z.string() would accept
 * `javascript:…`, which these fields are rendered into directly.
 */
const SafeUrl = z
  .string()
  .trim()
  .refine(
    (v) => {
      if (v === "") return true;
      try {
        return ["http:", "https:"].includes(new URL(v).protocol);
      } catch {
        return false;
      }
    },
    { message: "Must be an http(s) URL" }
  );

/** Object key for an invoice attachment — must match what buildInvoiceKey emits. */
const InvoiceFileKey = z
  .string()
  .refine(isInvoiceKey, { message: "Invalid file key" });

/**
 * A string `new Date()` can actually parse. Plain z.string() lets garbage
 * through to `new Date(x)`, which yields Invalid Date and surfaces as an
 * opaque 500 from Prisma rather than a 400 from here.
 */
export const DateString = z
  .string()
  .min(1)
  .refine((v) => !Number.isNaN(new Date(v).getTime()), {
    message: "Must be a valid date",
  });

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
  icon_url: SafeUrl.nullable().optional(),
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
  paid_at: DateString,
  amount_cents: z.number().int().positive().optional(),
});

export type SubscriptionPaymentInput = z.infer<typeof SubscriptionPaymentSchema>;

// ─── People / Salaries ────────────────────────────────────────────────────────

// Person columns that map directly to the Person model.
export const PersonInputSchema = z.object({
  name: z.string().min(1, "Name is required"),
  payday_day: z.number().int().min(1).max(31),
  status: z.enum(["active", "inactive"]).default("active"),
  role_id: z.string().nullable().optional(),
  notes: z.string().nullable().optional(),
});

// Composite shape used by the create/edit person form, which also persists
// base_salary_cents into the related SalaryBase row inside a transaction.
export const PersonWithSalarySchema = PersonInputSchema.extend({
  base_salary_cents: z.number().int().min(0, "Salary must be non-negative"),
});

export type PersonInput = z.infer<typeof PersonInputSchema>;
export type PersonWithSalaryInput = z.infer<typeof PersonWithSalarySchema>;

export const SalaryPaymentSchema = z.object({
  paid_at: DateString,
  adjustment_cents: z.number().int().default(0),
  adjustment_note: z.string().nullable().optional(),
});

export type SalaryPaymentInput = z.infer<typeof SalaryPaymentSchema>;

export const SalaryIncreaseReminderSchema = z.object({
  effective_date: DateString,
  suggested_new_base_cents: z
    .number()
    .int()
    .positive("Suggested salary must be positive"),
});

export type SalaryIncreaseReminderInput = z.infer<
  typeof SalaryIncreaseReminderSchema
>;

/**
 * PATCH body for acting on a reminder. `reschedule` is the only action that
 * writes a salary figure, so the two fields it needs are required exactly there
 * instead of being optionally present and unchecked.
 */
export const ReminderActionSchema = z
  .object({
    reminderId: z.string().min(1, "reminderId is required"),
    action: z.enum(["apply", "ignore", "reschedule"]),
    new_effective_date: DateString.optional(),
    new_suggested_base_cents: z.number().int().positive().optional(),
  })
  .refine(
    (d) =>
      d.action !== "reschedule" ||
      (d.new_effective_date != null && d.new_suggested_base_cents != null),
    {
      message:
        "new_effective_date and new_suggested_base_cents are required to reschedule",
      path: ["action"],
    }
  );

export type ReminderActionInput = z.infer<typeof ReminderActionSchema>;

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
  due_date: DateString,
  reminder_date: DateString.nullable().optional(),
  notes: z.string().nullable().optional(),
  file_url: SafeUrl.nullable().optional(),
  file_key: InvoiceFileKey.nullable().optional(),
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
  due_date: DateString.nullable().optional(),
  description: z.string().default(""),
  sort_order: z.number().int().default(0),
});

export type IssueInput = z.infer<typeof IssueSchema>;

/**
 * Ids to remove from the archive. Bounded because this is the one route that
 * deletes many rows at once; an unbounded list is a request that can time out
 * halfway through.
 */
export const BulkDeleteIssuesSchema = z.object({
  ids: z.array(z.string().min(1)).min(1, "Nothing selected").max(500),
});

export type BulkDeleteIssuesInput = z.infer<typeof BulkDeleteIssuesSchema>;

// ─── Issues canvas ───────────────────────────────────────────────────────────

/**
 * A canvas coordinate. Rejects NaN and Infinity — both survive JSON.parse as
 * `null`/a number in some clients and would persist a card the user can never
 * pan back to.
 */
const CanvasCoord = z
  .number()
  .refine(Number.isFinite, { message: "Must be a finite number" })
  .refine((v) => Math.abs(v) <= CANVAS_BOUND, { message: "Out of bounds" });

const NodePosition = z.object({
  id: z.string().min(1),
  x: CanvasCoord,
  y: CanvasCoord,
});

/**
 * Batch position update. Dragging a multi-card selection has to be one
 * request: a PATCH per node would put a dozen writes on the wire for a single
 * gesture.
 *
 * Issues and labels travel together for the same reason — one selection can
 * hold both, and splitting the gesture into two requests would let half of it
 * land.
 */
export const CanvasPositionsSchema = z
  .object({
    nodes: z.array(NodePosition).max(1000).optional(),
    labels: z.array(NodePosition).max(1000).optional(),
  })
  .refine((d) => (d.nodes?.length ?? 0) + (d.labels?.length ?? 0) > 0, {
    message: "No positions to save",
  });

export type CanvasPositionsInput = z.infer<typeof CanvasPositionsSchema>;

// ─── Canvas labels ───────────────────────────────────────────────────────────

const LabelColorKey = z.enum(LABEL_COLOR_KEYS as [string, ...string[]]);

/** A new chip. Text starts empty: it is typed straight into the node. */
export const CanvasLabelSchema = z.object({
  text: z.string().max(LABEL_MAX_LENGTH).default(""),
  color: LabelColorKey.default(DEFAULT_LABEL_COLOR),
  x: CanvasCoord,
  y: CanvasCoord,
});

/**
 * An edit. Every field optional, and the route only writes the keys the
 * client actually sent — same rule the issue PATCH follows, so changing a
 * colour cannot silently blank the text.
 */
export const CanvasLabelPatchSchema = z.object({
  text: z.string().max(LABEL_MAX_LENGTH).optional(),
  color: LabelColorKey.optional(),
  x: CanvasCoord.optional(),
  y: CanvasCoord.optional(),
});

export type CanvasLabelInput = z.infer<typeof CanvasLabelSchema>;

/**
 * An edge between two issues. The self-link check is duplicated in the
 * database as a CHECK constraint — this one produces a readable 400, that one
 * is the backstop.
 */
export const IssueLinkSchema = z
  .object({
    source_id: z.string().min(1),
    target_id: z.string().min(1),
    label: z.string().trim().max(80).nullable().optional(),
  })
  .refine((d) => d.source_id !== d.target_id, {
    message: "An issue cannot link to itself",
    path: ["target_id"],
  });

export type IssueLinkInput = z.infer<typeof IssueLinkSchema>;
