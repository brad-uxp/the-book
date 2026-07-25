import { describe, it, expect } from "vitest";
import {
  getSubscriptionPeriod,
  advanceNotice,
  subscriptionEvents,
  type SubscriptionForCron,
} from "./cron-helpers";

function sub(overrides: Partial<SubscriptionForCron> = {}): SubscriptionForCron {
  return {
    id: "sub-1",
    name: "Test",
    amount_cents: 1000,
    frequency: "monthly",
    pay_day: 15,
    pay_month: null,
    payment_mode: "auto",
    status: "active",
    ...overrides,
  };
}

/** Walks a full year, day by day, counting how many times a flag fires. */
function countOverYear(
  year: number,
  daysBefore: number,
  pick: (today: Date) => boolean
): number {
  let hits = 0;
  const d = new Date(Date.UTC(year, 0, 1));
  while (d.getUTCFullYear() === year) {
    if (pick(new Date(d))) hits++;
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return hits;
}

describe("getSubscriptionPeriod — aviso anticipado", () => {
  // BUG-1: dueDate se calculaba siempre en el mes de hoy, así que notifyDate
  // caía en el mes anterior y nunca coincidía cuando pay_day <= daysBefore.
  it.each([1, 2, 3, 4, 5, 15, 28, 31])(
    "dispara exactamente 12 veces al año con pay_day=%i (daysBefore=2)",
    (payDay) => {
      const hits = countOverYear(2026, 2, (today) =>
        getSubscriptionPeriod(sub({ pay_day: payDay }), today, 2).isDaysBefore
      );
      expect(hits).toBe(12);
    }
  );

  it.each([0, 1, 2, 4, 10, 30])(
    "dispara exactamente 12 veces al año con daysBefore=%i (pay_day=1)",
    (daysBefore) => {
      const hits = countOverYear(2026, daysBefore, (today) =>
        getSubscriptionPeriod(sub({ pay_day: 1 }), today, daysBefore).isDaysBefore
      );
      expect(hits).toBe(12);
    }
  );

  it("el aviso del 30-ene apunta al vencimiento del 1-feb, no al de enero", () => {
    const r = getSubscriptionPeriod(
      sub({ pay_day: 1 }),
      new Date(Date.UTC(2026, 0, 30)),
      2
    );
    expect(r.isDaysBefore).toBe(true);
    expect(r.upcomingDueDate.toISOString()).toBe("2026-02-01T00:00:00.000Z");
  });

  it("respeta el day-clamping: pay_day=31 avisa el 26-feb para el 28-feb", () => {
    const r = getSubscriptionPeriod(
      sub({ pay_day: 31 }),
      new Date(Date.UTC(2026, 1, 26)),
      2
    );
    expect(r.isDaysBefore).toBe(true);
    expect(r.upcomingDueDate.toISOString()).toBe("2026-02-28T00:00:00.000Z");
  });

  it("cruza el fin de año: el 30-dic avisa el vencimiento del 1-ene siguiente", () => {
    const r = getSubscriptionPeriod(
      sub({ pay_day: 1 }),
      new Date(Date.UTC(2026, 11, 30)),
      2
    );
    expect(r.isDaysBefore).toBe(true);
    expect(r.upcomingDueDate.toISOString()).toBe("2027-01-01T00:00:00.000Z");
  });

  it("anual: avisa cruzando el año", () => {
    const r = getSubscriptionPeriod(
      sub({ frequency: "annual", pay_month: 1, pay_day: 1 }),
      new Date(Date.UTC(2026, 11, 30)),
      2
    );
    expect(r.isDaysBefore).toBe(true);
    expect(r.upcomingDueDate.toISOString()).toBe("2027-01-01T00:00:00.000Z");
  });

  it("anual dispara una sola vez al año", () => {
    const hits = countOverYear(2026, 2, (today) =>
      getSubscriptionPeriod(
        sub({ frequency: "annual", pay_month: 6, pay_day: 10 }),
        today,
        2
      ).isDaysBefore
    );
    expect(hits).toBe(1);
  });
});

describe("getSubscriptionPeriod — isToday", () => {
  it("es true solo el día del vencimiento", () => {
    const s = sub({ pay_day: 15 });
    expect(
      getSubscriptionPeriod(s, new Date(Date.UTC(2026, 2, 15)), 2).isToday
    ).toBe(true);
    expect(
      getSubscriptionPeriod(s, new Date(Date.UTC(2026, 2, 14)), 2).isToday
    ).toBe(false);
  });

  it("dispara 12 veces al año", () => {
    const hits = countOverYear(2026, 2, (today) =>
      getSubscriptionPeriod(sub({ pay_day: 31 }), today, 2).isToday
    );
    expect(hits).toBe(12);
  });
});

describe("subscriptionEvents — qué se notifica y cuándo", () => {
  const due = new Date(Date.UTC(2026, 2, 15));

  it("auto con daysBefore=0: un solo evento el día del cobro, no dos", () => {
    const events = subscriptionEvents(sub({ pay_day: 15 }), due, 0);
    expect(events.map((e) => e.kind)).toEqual(["auto_charge"]);
  });

  it("auto con daysBefore=2: aviso 2 días antes y cobro el día", () => {
    expect(
      subscriptionEvents(sub({ pay_day: 15 }), new Date(Date.UTC(2026, 2, 13)), 2)
        .map((e) => e.kind)
    ).toEqual(["auto_upcoming"]);
    expect(
      subscriptionEvents(sub({ pay_day: 15 }), due, 2).map((e) => e.kind)
    ).toEqual(["auto_charge"]);
  });

  it("manual con daysBefore=0 sigue avisando el día del vencimiento", () => {
    const events = subscriptionEvents(
      sub({ pay_day: 15, payment_mode: "manual" }),
      due,
      0
    );
    expect(events.map((e) => e.kind)).toEqual(["manual_due"]);
  });

  it("manual con pay_day=1 avisa (el caso que estaba mudo en prod)", () => {
    const events = subscriptionEvents(
      sub({ pay_day: 1, payment_mode: "manual" }),
      new Date(Date.UTC(2026, 0, 30)),
      2
    );
    expect(events.map((e) => e.kind)).toEqual(["manual_due"]);
    expect(events[0].dueDate.toISOString()).toBe("2026-02-01T00:00:00.000Z");
  });

  it("un auto produce exactamente 24 eventos al año (12 avisos + 12 cobros)", () => {
    let upcoming = 0;
    let charges = 0;
    const d = new Date(Date.UTC(2026, 0, 1));
    while (d.getUTCFullYear() === 2026) {
      for (const e of subscriptionEvents(sub({ pay_day: 1 }), new Date(d), 2)) {
        if (e.kind === "auto_upcoming") upcoming++;
        if (e.kind === "auto_charge") charges++;
      }
      d.setUTCDate(d.getUTCDate() + 1);
    }
    expect({ upcoming, charges }).toEqual({ upcoming: 12, charges: 12 });
  });

  it("una suscripción inactiva no la filtra este helper (lo hace la query)", () => {
    expect(
      subscriptionEvents(sub({ pay_day: 15, status: "inactive" }), due, 2).length
    ).toBe(1);
  });
});

describe("advanceNotice — helper compartido (salarios)", () => {
  it.each([1, 2, 3, 4, 5, 28, 31])(
    "dispara 12 veces al año con payday_day=%i y daysBefore=4",
    (day) => {
      const hits = countOverYear(2026, 4, (today) =>
        advanceNotice(today, 4, day).hit
      );
      expect(hits).toBe(12);
    }
  );

  it("el 28-ene avisa el sueldo del 1-feb con 4 días de anticipación", () => {
    const r = advanceNotice(new Date(Date.UTC(2026, 0, 28)), 4, 1);
    expect(r.hit).toBe(true);
    expect(r.dueDate.toISOString()).toBe("2026-02-01T00:00:00.000Z");
  });

  it("con daysBefore=0 el aviso cae el mismo día del vencimiento", () => {
    const r = advanceNotice(new Date(Date.UTC(2026, 2, 15)), 0, 15);
    expect(r.hit).toBe(true);
    expect(r.dueDate.toISOString()).toBe("2026-03-15T00:00:00.000Z");
  });
});
