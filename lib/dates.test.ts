import { describe, it, expect } from "vitest";
import {
  clampDay,
  calcMonthlyDueDate,
  monthlyPeriodKey,
  annualPeriodKey,
  formatPeriodKey,
  lastDayOfMonth,
  isSameDay,
  addDaysUTC,
} from "./dates";

describe("clampDay (day-clamping)", () => {
  it("clamps pay_day 31 to Feb's last day", () => {
    expect(clampDay(2026, 2, 31)).toBe(28); // 2026 no es bisiesto
    expect(clampDay(2024, 2, 31)).toBe(29); // 2024 bisiesto
  });

  it("leaves valid days untouched", () => {
    expect(clampDay(2026, 1, 15)).toBe(15);
    expect(clampDay(2026, 4, 30)).toBe(30);
  });

  it("clamps 31 to 30 in a 30-day month", () => {
    expect(clampDay(2026, 4, 31)).toBe(30); // abril
  });
});

describe("calcMonthlyDueDate", () => {
  it("returns UTC midnight for the clamped day", () => {
    const d = calcMonthlyDueDate(2026, 2, 31);
    expect(d.toISOString()).toBe("2026-02-28T00:00:00.000Z");
  });
});

describe("period keys", () => {
  it("monthly key is zero-padded YYYY-MM", () => {
    expect(monthlyPeriodKey(2026, 3)).toBe("2026-03");
    expect(monthlyPeriodKey(2026, 12)).toBe("2026-12");
  });

  it("annual key is the year", () => {
    expect(annualPeriodKey(2026)).toBe("2026");
  });

  it("formats a monthly period key for display", () => {
    expect(formatPeriodKey("2026-02")).toBe("Feb 2026");
    expect(formatPeriodKey("2026")).toBe("2026"); // anual: solo el año
  });
});

describe("lastDayOfMonth", () => {
  it("returns UTC last day for a YYYY-MM string", () => {
    expect(lastDayOfMonth("2024-02").toISOString()).toBe(
      "2024-02-29T00:00:00.000Z"
    );
  });

  it("ignores the day component of a YYYY-MM-DD string", () => {
    expect(lastDayOfMonth("2026-04-10").toISOString()).toBe(
      "2026-04-30T00:00:00.000Z"
    );
  });
});

describe("UTC date helpers", () => {
  it("isSameDay compares by UTC calendar day", () => {
    const a = new Date("2026-03-01T00:00:00.000Z");
    const b = new Date("2026-03-01T23:59:59.000Z");
    expect(isSameDay(a, b)).toBe(true);
    expect(isSameDay(a, new Date("2026-03-02T00:00:00.000Z"))).toBe(false);
  });

  it("addDaysUTC crosses month boundaries", () => {
    const d = addDaysUTC(new Date("2026-01-31T00:00:00.000Z"), 1);
    expect(d.toISOString()).toBe("2026-02-01T00:00:00.000Z");
  });
});
