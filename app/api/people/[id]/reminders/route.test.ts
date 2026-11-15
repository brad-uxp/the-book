import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Aplicar un recordatorio cambia el sueldo base de la persona. Es el mismo
 * cambio que PATCH /api/people/{id}, así que deja la misma huella en el log:
 * una actualización de la persona con el sueldo de antes y de después, con la
 * etiqueta de quien llamó. Antes no dejaba ninguna, y un token con alcance de
 * dueño podía cambiar un sueldo sin rastro.
 */

const db = vi.hoisted(() => {
  const state = { base: 100_000 as number | null };
  const tx = {
    salaryBase: {
      findUnique: vi.fn(async () => (state.base === null ? null : { base_salary_cents: state.base })),
      upsert: vi.fn(async () => ({})),
    },
    salaryIncreaseReminder: {
      findFirst: vi.fn(),
      update: vi.fn(async () => ({})),
      create: vi.fn(async () => ({})),
    },
    person: { findUnique: vi.fn(async () => ({ name: "Ana" })) },
  };
  return { state, tx };
});

vi.mock("@/lib/db", () => ({
  prisma: { ...db.tx, $transaction: async (fn: (tx: typeof db.tx) => unknown) => fn(db.tx) },
}));
vi.mock("@/lib/audit", () => ({
  auditLog: vi.fn(),
  getActorEmail: vi.fn(async () => "token:automation:script (tb_AbCd1234)"),
}));
vi.mock("@/lib/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api")>()),
  requireSession: vi.fn(async () => null),
}));
vi.mock("@/auth", () => ({ auth: vi.fn(), isAllowedSession: () => false }));

import { NextRequest } from "next/server";
import { PATCH } from "./route";
import { auditLog } from "@/lib/audit";

const PERSON = "00000000-0000-4000-8000-000000000001";
const REMINDER = "00000000-0000-4000-8000-000000000002";

const patch = (body: unknown) =>
  PATCH(
    new NextRequest(`http://localhost/api/people/${PERSON}/reminders`, {
      method: "PATCH",
      body: JSON.stringify(body),
      headers: { "content-type": "application/json" },
    }),
    { params: Promise.resolve({ id: PERSON }) }
  );

beforeEach(() => {
  vi.clearAllMocks();
  db.state.base = 100_000;
  db.tx.salaryIncreaseReminder.findFirst.mockResolvedValue({
    id: REMINDER,
    person_id: PERSON,
    suggested_new_base_cents: 120_000,
    status: "pending",
  });
});

describe("PATCH /api/people/{id}/reminders — apply", () => {
  it("cambia el sueldo base y lo deja en el log como un cambio de la persona", async () => {
    const res = await patch({ reminderId: REMINDER, action: "apply" });
    expect(res.status).toBe(200);
    expect(db.tx.salaryBase.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ update: { base_salary_cents: 120_000 } })
    );
    expect(auditLog).toHaveBeenCalledTimes(1);
    expect(vi.mocked(auditLog).mock.calls[0][0]).toEqual({
      entity_type: "person",
      entity_id: PERSON,
      entity_name: "Ana",
      action: "update",
      actor_email: "token:automation:script (tb_AbCd1234)",
      before: { base_salary_cents: 100_000 },
      after: { base_salary_cents: 120_000, applied_reminder_id: REMINDER },
    });
  });

  it("sin sueldo base previo, el antes queda en null", async () => {
    db.state.base = null;
    expect((await patch({ reminderId: REMINDER, action: "apply" })).status).toBe(200);
    expect(vi.mocked(auditLog).mock.calls[0][0].before).toEqual({ base_salary_cents: null });
  });

  it("ignorar o reprogramar no tocan el sueldo y no se auditan, como el resto de los recordatorios", async () => {
    expect((await patch({ reminderId: REMINDER, action: "ignore" })).status).toBe(200);
    const res = await patch({
      reminderId: REMINDER,
      action: "reschedule",
      new_effective_date: "2026-12-01",
      new_suggested_base_cents: 130_000,
    });
    expect(res.status).toBe(200);
    expect(db.tx.salaryBase.upsert).not.toHaveBeenCalled();
    expect(auditLog).not.toHaveBeenCalled();
  });
});
