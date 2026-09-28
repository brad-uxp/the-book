import { z } from "zod";
import { isInvoiceKey } from "./r2";
import { CANVAS_BOUND } from "./canvas-geometry";
import { CANVAS_COLOR_KEYS } from "./canvas-palette";
import { NOTE_FORMATS } from "./notes";
import { SYNC_PUSH_MAX } from "./sync-protocol";
import { ISSUE_TITLE_MAX, RICH_TEXT_MAX } from "./text-limits";
import {
  LAYOUT_BATCH_MAX,
  NODE_CONTENT_MAX,
  NODE_MAX_SIZE,
  NODE_MIN_HEIGHT,
  NODE_MIN_WIDTH,
} from "./note-canvas";

/**
 * Text Postgres can store. A text column refuses the NUL character (\u0000)
 * with an error the API would otherwise answer as a 500 — and a sync push
 * would stop at, again and again, on every retry of the phone's queue.
 */
const NoNul = (s: string) => !s.includes("\u0000");
const NUL_MESSAGE = "Contains a NUL character";
const Text = () => z.string().refine(NoNul, NUL_MESSAGE);

/** A Postgres `integer`: past these, the write fails in the database instead of here. */
const Int32 = z.number().int().min(-2_147_483_648).max(2_147_483_647);

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
  title: Text()
    .min(1, "Title is required")
    .max(ISSUE_TITLE_MAX, `At most ${ISSUE_TITLE_MAX} characters`),
  client_id: Text().nullable().optional(),
  category: z.enum(["task", "note"]).default("task"),
  /** Only meaningful for a note; a canvas task is refused by the route. */
  note_format: z.enum(NOTE_FORMATS).default("text"),
  status: z
    .enum(["pending", "in_progress", "blocked", "done"])
    .default("pending"),
  progress: z.number().int().min(0).max(100).default(0),
  due_date: DateString.nullable().optional(),
  description: Text().max(RICH_TEXT_MAX, "Too long").default(""),
  sort_order: Int32.default(0),
});

export type IssueInput = z.infer<typeof IssueSchema>;

/**
 * A new issue. The id may come from the client: the phone creates notes
 * offline and has to know their id before the server does. A UUID, so a
 * client cannot pick one that collides by accident — a duplicate is a 409,
 * never an overwrite.
 */
export const IssueCreateSchema = IssueSchema.extend({ id: z.uuid().optional() });

/**
 * Ids to remove from the archive. Bounded because this is the one route that
 * deletes many rows at once; an unbounded list is a request that can time out
 * halfway through.
 */
export const BulkDeleteIssuesSchema = z.object({
  ids: z.array(Text().min(1)).min(1, "Nothing selected").max(500),
});

export type BulkDeleteIssuesInput = z.infer<typeof BulkDeleteIssuesSchema>;

// ─── Canvas notes ────────────────────────────────────────────────────────────

/**
 * A canvas coordinate. Rejects NaN and Infinity — both survive JSON.parse as
 * `null`/a number in some clients and would persist a card the user can never
 * pan back to.
 */
const CanvasCoord = z
  .number()
  .refine(Number.isFinite, { message: "Must be a finite number" })
  .refine((v) => Math.abs(v) <= CANVAS_BOUND, { message: "Out of bounds" });

const NodeWidth = z.number().min(NODE_MIN_WIDTH).max(NODE_MAX_SIZE);
const NodeHeight = z.number().min(NODE_MIN_HEIGHT).max(NODE_MAX_SIZE);

/**
 * A palette key, never a hex: the palette is retuned for both themes without
 * touching rows. `null` is the neutral card.
 */
const CanvasColorKey = z.enum(CANVAS_COLOR_KEYS as [string, ...string[]]);

const NodeContent = Text().max(NODE_CONTENT_MAX);

/**
 * A new idea. The id may come from the client: a node is drawn and typed into
 * before the server answers, and an id that changed on the way back would
 * remount it under the cursor. A UUID, so a client cannot pick one that
 * collides by accident — a duplicate is a 409, not an overwrite.
 */
export const CanvasNodeSchema = z.object({
  id: z.uuid().optional(),
  x: CanvasCoord,
  y: CanvasCoord,
  width: NodeWidth.optional(),
  height: NodeHeight.optional(),
  content: NodeContent.default(""),
  color: CanvasColorKey.nullable().optional(),
});

/**
 * An edit to what an idea says or how it looks. Where it sits goes through
 * the layout batch instead. The route writes only the keys that were sent, so
 * recolouring cannot blank the text.
 */
export const CanvasNodePatchSchema = z.object({
  content: NodeContent.optional(),
  color: CanvasColorKey.nullable().optional(),
});

/**
 * Where ideas sit and how big they are. One gesture — dragging a selection,
 * resizing a card — is one request, however many cards it moved.
 */
export const CanvasLayoutSchema = z.object({
  nodes: z
    .array(
      z.object({
        id: Text().min(1),
        x: CanvasCoord,
        y: CanvasCoord,
        width: NodeWidth.optional(),
        height: NodeHeight.optional(),
      })
    )
    .min(1, "No positions to save")
    .max(LAYOUT_BATCH_MAX),
});

/**
 * A connection between two ideas. The self-link check is duplicated in the
 * database as a CHECK — this one produces a readable 400, that one is the
 * backstop. That both ends belong to the same canvas is enforced by the
 * compound foreign keys alone.
 */
export const CanvasEdgeSchema = z
  .object({
    id: z.uuid().optional(),
    source_id: Text().min(1),
    target_id: Text().min(1),
  })
  .refine((d) => d.source_id !== d.target_id, {
    message: "An idea cannot connect to itself",
    path: ["target_id"],
  });

export type CanvasNodeInput = z.infer<typeof CanvasNodeSchema>;
export type CanvasLayoutInput = z.infer<typeof CanvasLayoutSchema>;
export type CanvasEdgeInput = z.infer<typeof CanvasEdgeSchema>;

// ─── Phone sync ──────────────────────────────────────────────────────────────

/**
 * A push, checked only as deep as it must be to answer per change: each
 * mutation is validated on its own (SyncMutationSchema), so one malformed
 * change is rejected by itself instead of blocking every change queued behind
 * it on the phone.
 */
export const SyncPushSchema = z.object({
  mutations: z
    .array(z.looseObject({ mutation_id: z.uuid() }))
    .min(1, "Nothing to push")
    .max(SYNC_PUSH_MAX),
});

/** More keys than any entity has fields: an issue has 9. */
const SYNC_FIELDS_MAX = 16;

export const SyncMutationSchema = z.object({
  mutation_id: z.uuid(),
  entity: z.enum(["issue", "canvas_node", "canvas_edge"]),
  op: z.enum(["upsert", "delete"]),
  id: Text().min(1).max(64),
  base_updated_at: Text().max(40).nullable().optional(),
  base_hash: z
    .string()
    .regex(/^[0-9a-f]{64}$/, "Must be a sha256 in hex")
    .nullable()
    .optional(),
  title_hint: Text().max(ISSUE_TITLE_MAX).optional(),
  // Flat: every field a change can set is a string, number, boolean or null
  // (the entity schemas below say which). Nothing nested gets past here, so
  // no later step — hashing a change, applying it — walks a structure a
  // client made arbitrarily deep.
  fields: z
    .record(z.string().max(64), z.union([z.string(), z.number(), z.boolean(), z.null()]))
    .refine((f) => Object.keys(f).length <= SYNC_FIELDS_MAX, "Too many fields")
    .optional(),
});

/** An issue's changed fields. Unknown keys are refused: they would be a phone bug, silently dropped. */
export const SyncIssueFieldsSchema = IssueSchema.partial().strict();

export const SyncNodeFieldsSchema = z
  .object({
    issue_id: Text().min(1).max(64),
    content: NodeContent,
    color: CanvasColorKey.nullable(),
    x: CanvasCoord,
    y: CanvasCoord,
    width: NodeWidth,
    height: NodeHeight,
  })
  .partial()
  .strict();

export const SyncEdgeFieldsSchema = z
  .object({
    issue_id: Text().min(1).max(64),
    source_id: Text().min(1).max(64),
    target_id: Text().min(1).max(64),
  })
  .strict()
  .refine((d) => d.source_id !== d.target_id, {
    message: "An idea cannot connect to itself",
    path: ["target_id"],
  });

// ─── Settings ────────────────────────────────────────────────────────────────

/**
 * A partial update of the Settings singleton. Every field optional; the route
 * writes only what was sent.
 *
 * `corporate_excluded_client_ids` is replaced as a whole, deduplicated. Ids
 * are checked against existing clients in the route: a typo'd id would
 * exclude nothing while the report claims a client is left out.
 */
export const SettingsPatchSchema = z.object({
  days_before_subscription: z.number().int().min(0).max(30).optional(),
  days_before_salary: z.number().int().min(0).max(30).optional(),
  days_before_invoice: z.number().int().min(0).max(30).optional(),
  corporate_excluded_client_ids: z
    .array(z.string().min(1))
    .max(200)
    .transform((ids) => [...new Set(ids)])
    .optional(),
});

export type SettingsPatchInput = z.infer<typeof SettingsPatchSchema>;

// ─── Metrics ─────────────────────────────────────────────────────────────────

/**
 * GET /api/metrics query. Either a preset `period` (default this_year) or one
 * explicit `month` — not both: a request carrying both would be ambiguous
 * about which one the numbers answer.
 */
export const MetricsQuerySchema = z
  .object({
    period: z.enum(["this_year", "last_12_months"]).optional(),
    month: z
      .string()
      .regex(/^(19|20)\d{2}-(0[1-9]|1[0-2])$/, "Use YYYY-MM")
      .optional(),
  })
  .refine((q) => !(q.period && q.month), {
    message: "Send either period or month, not both",
    path: ["month"],
  });

export type MetricsQuery = z.infer<typeof MetricsQuerySchema>;

// ─── Mobile sign-in ──────────────────────────────────────────────────────────

/**
 * POST /api/mobile/sign-in. The ID token is Google's; the nonce travels inside
 * it, signed, so it is not a separate field. Bounded so a junk body cannot
 * reach the JWT parser as megabytes.
 */
export const MobileSignInSchema = z.object({
  id_token: z.string().min(1).max(4096),
  // Only a label for Settings. Tidied rather than refused: a long or empty
  // device name is not a reason to fail a sign-in.
  device_name: z
    .string()
    .optional()
    .transform((s) => (s ?? "").replace(/\s+/g, " ").trim().slice(0, 40) || "Android"),
});

export type MobileSignInInput = z.infer<typeof MobileSignInSchema>;
