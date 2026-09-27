import { describe, it, expect } from "vitest";
import { addDaysUTC, clampDay, monthlyPeriodKey } from "./dates";
import {
  awaitingOf,
  bucketByMonth,
  chartPointsOf,
  corporateOf,
  excludeClients,
  filterMonths,
  isPastDue,
  periodKeyOf,
  recentMonths,
  totalsOf,
  upcomingPaymentsOf,
  workExpensesByItemOf,
  type MonthData,
  type Preset,
} from "./metrics";

// ═══════════════════════════════════════════════════════════════════════════
// REFERENCE: the dashboard as it was before lib/metrics existed, copied from
// app/dashboard/page.tsx, components/dashboard/dashboard-metrics.tsx and
// components/dashboard/corporate-chart.tsx (commit 96bfc29). The module has to
// reproduce these numbers exactly — that is what "the dashboard did not
// change" means.
// ═══════════════════════════════════════════════════════════════════════════

function refToPeriodKey(date: Date): string {
  return monthlyPeriodKey(date.getUTCFullYear(), date.getUTCMonth() + 1);
}

function refGetRecentMonths(today: Date): string[] {
  const year = today.getUTCFullYear();
  const month = today.getUTCMonth();
  return Array.from({ length: 13 }, (_, i) => {
    const d = new Date(Date.UTC(year, month - (12 - i), 1));
    return monthlyPeriodKey(d.getUTCFullYear(), d.getUTCMonth() + 1);
  });
}

type RefInv = { due_date: Date; amount_cents: number; fee_cents: number; client_id: string };
type RefSal = { paid_at: Date; total_cents: number; person_id: string; person: { name: string } };
type RefSub = { paid_at: Date; amount_cents_snapshot: number; subscription: { id: string; name: string; category: string } };
type RefOther = { paid_at: Date; amount_cents: number; category: string; name: string };

function refPage(months: string[], salaryPayments: RefSal[], subPayments: RefSub[], otherExpenses: RefOther[], invoices: RefInv[]) {
  type Bucket = { income: number; salary: number; subscriptions: number; subsPersonal: number; subsWork: number; subsEssential: number; other: number; otherWork: number; otherPersonal: number };
  const emptyBucket = (): Bucket => ({ income: 0, salary: 0, subscriptions: 0, subsPersonal: 0, subsWork: 0, subsEssential: 0, other: 0, otherWork: 0, otherPersonal: 0 });
  const buckets = new Map<string, Bucket>(months.map((m) => [m, emptyBucket()]));

  for (const p of salaryPayments) {
    const b = buckets.get(refToPeriodKey(p.paid_at));
    if (b) b.salary += p.total_cents;
  }
  for (const p of subPayments) {
    const b = buckets.get(refToPeriodKey(p.paid_at));
    if (b) {
      b.subscriptions += p.amount_cents_snapshot;
      if (p.subscription.category === "personal") b.subsPersonal += p.amount_cents_snapshot;
      else if (p.subscription.category === "work") b.subsWork += p.amount_cents_snapshot;
      else if (p.subscription.category === "essential_service") b.subsEssential += p.amount_cents_snapshot;
    }
  }
  for (const p of otherExpenses) {
    const b = buckets.get(refToPeriodKey(p.paid_at));
    if (b) {
      b.other += p.amount_cents;
      if (p.category === "work") b.otherWork += p.amount_cents;
      else if (p.category === "personal") b.otherPersonal += p.amount_cents;
    }
  }
  type WorkRow = { id: string; name: string; monthly: Record<string, number> };
  const ensureWorkRow = (rows: Map<string, WorkRow>, id: string, name: string): WorkRow => {
    let row = rows.get(id);
    if (!row) {
      row = { id, name, monthly: Object.fromEntries(months.map((m) => [m, 0])) };
      rows.set(id, row);
    }
    return row;
  };
  const salariesRows = new Map<string, WorkRow>();
  const workSubsRows = new Map<string, WorkRow>();
  const workOtherRows = new Map<string, WorkRow>();
  for (const p of salaryPayments) {
    const monthKey = refToPeriodKey(p.paid_at);
    if (!buckets.has(monthKey)) continue;
    const row = ensureWorkRow(salariesRows, p.person_id, p.person.name);
    row.monthly[monthKey] = (row.monthly[monthKey] ?? 0) + p.total_cents;
  }
  for (const p of subPayments) {
    if (p.subscription.category !== "work") continue;
    const monthKey = refToPeriodKey(p.paid_at);
    if (!buckets.has(monthKey)) continue;
    const row = ensureWorkRow(workSubsRows, p.subscription.id, p.subscription.name);
    row.monthly[monthKey] = (row.monthly[monthKey] ?? 0) + p.amount_cents_snapshot;
  }
  for (const p of otherExpenses) {
    if (p.category !== "work") continue;
    const monthKey = refToPeriodKey(p.paid_at);
    if (!buckets.has(monthKey)) continue;
    const row = ensureWorkRow(workOtherRows, p.name, p.name);
    row.monthly[monthKey] = (row.monthly[monthKey] ?? 0) + p.amount_cents;
  }
  const workExpensesByItem = {
    salaries: Array.from(salariesRows.values()),
    workSubs: Array.from(workSubsRows.values()),
    workOther: Array.from(workOtherRows.values()),
  };
  const incomeBuckets = new Map<string, Map<string, number>>(months.map((m) => [m, new Map()]));
  for (const inv of invoices) {
    const monthKey = refToPeriodKey(inv.due_date);
    const b = buckets.get(monthKey);
    const total = inv.amount_cents + inv.fee_cents;
    if (b) b.income += total;
    const ib = incomeBuckets.get(monthKey);
    if (ib) ib.set(inv.client_id, (ib.get(inv.client_id) ?? 0) + total);
  }
  const monthlyData = months.map((month) => ({ month, ...buckets.get(month)! }));
  const monthlyIncomeByClient = months.map((month) => ({
    month,
    byClient: Object.fromEntries(incomeBuckets.get(month)!),
  }));
  return { monthlyData, monthlyIncomeByClient, workExpensesByItem };
}

function refFilter(monthlyData: MonthData[], preset: Preset, now: Date) {
  const currentMonth = refToPeriodKey(now);
  if (preset === "ytd") {
    const yearStart = `${now.getUTCFullYear()}-01`;
    return monthlyData.filter((d) => d.month >= yearStart && d.month <= currentMonth);
  }
  if (preset === "last12") {
    const from = refToPeriodKey(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 11, 1)));
    return monthlyData.filter((d) => d.month >= from && d.month <= currentMonth);
  }
  const hasData = (d: MonthData) => d.income > 0 || d.salary > 0 || d.subscriptions > 0 || d.other > 0;
  const firstIdx = monthlyData.findIndex(hasData);
  const lastIdx = monthlyData.reduce((acc, d, i) => (hasData(d) ? i : acc), -1);
  return firstIdx === -1 ? [] : monthlyData.slice(firstIdx, lastIdx + 1);
}

function refTotals(filtered: MonthData[]) {
  const salary = filtered.reduce((s, d) => s + d.salary, 0);
  const subscriptions = filtered.reduce((s, d) => s + d.subscriptions, 0);
  const subsPersonal = filtered.reduce((s, d) => s + d.subsPersonal, 0);
  const subsWork = filtered.reduce((s, d) => s + d.subsWork, 0);
  const subsEssential = filtered.reduce((s, d) => s + d.subsEssential, 0);
  const income = filtered.reduce((s, d) => s + d.income, 0);
  const expenses = filtered.reduce((s, d) => s + d.salary + d.subscriptions + d.other, 0);
  const net = income - expenses;
  const n = filtered.length || 1;
  return {
    salary, subscriptions, net,
    avgSalary: salary / n,
    avgSubsPersonal: subsPersonal / n,
    avgSubsWork: subsWork / n,
    avgSubsEssential: subsEssential / n,
    avgNet: net / n,
    avgExpenses: expenses / n,
  };
}

function refChartData(filtered: MonthData[]) {
  return filtered.map((d) => {
    const expenses = d.salary + d.subscriptions + d.other;
    const workExpenses = d.salary + d.subsWork + d.otherWork;
    return {
      month: d.month,
      income: d.income,
      expenses,
      workExpenses,
      personalExpenses: d.subsPersonal + d.otherPersonal,
      essentialExpenses: d.subsEssential,
      salary: d.salary,
      workSubs: d.subsWork,
      net: d.income - expenses,
      corporateNet: d.income - workExpenses,
    };
  });
}

function refCorporate(
  data: ReturnType<typeof refChartData>,
  incomeByClient: { month: string; byClient: Record<string, number> }[],
  excluded: Set<string>
) {
  const incomeByMonth = new Map<string, Record<string, number>>();
  for (const m of incomeByClient) incomeByMonth.set(m.month, m.byClient);
  const chartData = data.map((d) => {
    let excludedAmount = 0;
    if (excluded.size > 0) {
      const byClient = incomeByMonth.get(d.month);
      if (byClient) for (const id of excluded) excludedAmount += byClient[id] ?? 0;
    }
    const adjustedIncome = d.income - excludedAmount;
    return { ...d, income: adjustedIncome, corporateNet: adjustedIncome - d.workExpenses };
  });
  const cumulative = chartData.reduce((sum, d) => sum + d.corporateNet, 0);
  return {
    chartData,
    cumulative,
    a: Math.round(cumulative * 0.6),
    b: Math.round(cumulative * 0.4),
  };
}

type RefSubUp = { id: string; name: string; amount_cents: number; frequency: string; pay_day: number; pay_month: number | null; payments: { due_date: Date }[] };
type RefPersonUp = { id: string; name: string; payday_day: number; salary_base: { base_salary_cents: number } | null; salary_payments: { due_date: Date }[] };

function refUpcoming(today: Date, activeSubscriptions: RefSubUp[], activePeople: RefPersonUp[]) {
  const upcomingSubPayments = activeSubscriptions.flatMap((sub) => {
    const paidDueDates = new Set(sub.payments.map((p) => p.due_date.toISOString()));
    for (let i = 0; i <= 5; i++) {
      const checkDate = addDaysUTC(today, i);
      const y = checkDate.getUTCFullYear();
      const m = checkDate.getUTCMonth() + 1;
      const d = checkDate.getUTCDate();
      let isDue = false;
      let dueDate: Date | null = null;
      if (sub.frequency === "monthly") {
        isDue = clampDay(y, m, sub.pay_day) === d;
        if (isDue) dueDate = new Date(Date.UTC(y, m - 1, clampDay(y, m, sub.pay_day)));
      } else {
        isDue = sub.pay_month === m && clampDay(y, m, sub.pay_day) === d;
        if (isDue) dueDate = new Date(Date.UTC(y, m - 1, clampDay(y, m, sub.pay_day)));
      }
      if (isDue && dueDate) {
        if (!paidDueDates.has(dueDate.toISOString())) {
          return [{ id: sub.id, type: "subscription" as const, name: sub.name, amount_cents: sub.amount_cents, due_date: checkDate.toISOString() }];
        }
        break;
      }
    }
    return [];
  });
  const upcomingSalaryPayments = activePeople.flatMap((person) => {
    const paidDueDates = new Set(person.salary_payments.map((p) => p.due_date.toISOString()));
    for (let i = 0; i <= 5; i++) {
      const checkDate = addDaysUTC(today, i);
      const y = checkDate.getUTCFullYear();
      const m = checkDate.getUTCMonth() + 1;
      const d = checkDate.getUTCDate();
      if (clampDay(y, m, person.payday_day) === d) {
        const dueDate = new Date(Date.UTC(y, m - 1, clampDay(y, m, person.payday_day)));
        if (!paidDueDates.has(dueDate.toISOString())) {
          return [{ id: person.id, type: "salary" as const, name: person.name, amount_cents: person.salary_base?.base_salary_cents ?? 0, due_date: checkDate.toISOString() }];
        }
        break;
      }
    }
    return [];
  });
  return [...upcomingSubPayments, ...upcomingSalaryPayments].sort((a, b) => a.due_date.localeCompare(b.due_date));
}

// ═══════════════════════════════════════════════════════════════════════════
// Random datasets, seeded so a failure reproduces.
// ═══════════════════════════════════════════════════════════════════════════

function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

function dataset(seed: number) {
  const r = rng(seed);
  const int = (lo: number, hi: number) => lo + Math.floor(r() * (hi - lo + 1));
  const pick = <T,>(xs: readonly T[]) => xs[int(0, xs.length - 1)];
  // Today somewhere in 2025–2027, including month ends and Jan 1st.
  const today = new Date(Date.UTC(int(2025, 2027), int(0, 11), pick([1, 2, 15, 28, 29, 30, 31] as const)));
  const todayUTC = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()));
  // Dates from 16 months back to 2 months ahead, so some fall outside the window.
  const anyDate = () =>
    new Date(Date.UTC(todayUTC.getUTCFullYear(), todayUTC.getUTCMonth() - int(-2, 16), int(1, 31)));
  const clients = ["c1", "c2", "c3", "c4"];
  const invoices = Array.from({ length: int(0, 30) }, () => ({
    due_date: anyDate(),
    amount_cents: int(0, 900_000),
    fee_cents: -int(0, 90_000),
    client_id: pick(clients),
  }));
  const salaries = Array.from({ length: int(0, 25) }, () => {
    const id = pick(["p1", "p2", "p3"]);
    return { paid_at: anyDate(), total_cents: int(1, 500_000), person_id: id, person_name: "Person " + id };
  });
  const subscriptions = Array.from({ length: int(0, 25) }, () => {
    const id = pick(["s1", "s2", "s3", "s4"]);
    return {
      paid_at: anyDate(),
      amount_cents_snapshot: int(1, 50_000),
      category: pick(["personal", "work", "essential_service"] as const),
      subscription_id: id,
      subscription_name: "Sub " + id,
    };
  });
  const others = Array.from({ length: int(0, 20) }, () => ({
    paid_at: anyDate(),
    amount_cents: int(1, 200_000),
    category: pick(["personal", "work"] as const),
    name: pick(["Rent", "Hardware", "Travel"]),
  }));
  const excluded = new Set(clients.filter(() => r() < 0.3));
  return { today: todayUTC, invoices, salaries, subscriptions, others, excluded, int, pick };
}

describe("lib/metrics reproduces the dashboard exactly (400 seeded datasets)", () => {
  for (let seed = 1; seed <= 400; seed++) {
    it(`seed ${seed}`, () => {
      const d = dataset(seed);
      const months = recentMonths(d.today);
      expect(months).toEqual(refGetRecentMonths(d.today));

      const ref = refPage(
        months,
        d.salaries.map((s) => ({ paid_at: s.paid_at, total_cents: s.total_cents, person_id: s.person_id, person: { name: s.person_name } })),
        d.subscriptions.map((s) => ({ paid_at: s.paid_at, amount_cents_snapshot: s.amount_cents_snapshot, subscription: { id: s.subscription_id, name: s.subscription_name, category: s.category } })),
        d.others,
        d.invoices
      );
      const got = bucketByMonth(months, d);
      expect(got.monthly).toEqual(ref.monthlyData);
      expect(got.incomeByClient).toEqual(ref.monthlyIncomeByClient);
      expect(workExpensesByItemOf(months, d)).toEqual(ref.workExpensesByItem);

      for (const preset of ["ytd", "last12", "all"] as const) {
        const filtered = filterMonths(got.monthly, preset, d.today);
        expect(filtered).toEqual(refFilter(ref.monthlyData, preset, d.today));

        const t = totalsOf(filtered);
        const rt = refTotals(filtered);
        expect({
          salary: t.salary, subscriptions: t.subscriptions, net: t.net,
          avgSalary: t.avgSalary, avgSubsPersonal: t.avgSubsPersonal, avgSubsWork: t.avgSubsWork,
          avgSubsEssential: t.avgSubsEssential, avgNet: t.avgNet, avgExpenses: t.avgExpenses,
        }).toEqual(rt);

        const points = chartPointsOf(filtered);
        expect(points).toEqual(refChartData(filtered));

        const visibleMonths = new Set(filtered.map((m) => m.month));
        const incomeFiltered = got.incomeByClient.filter((m) => visibleMonths.has(m.month));
        const rc = refCorporate(points, incomeFiltered, d.excluded);
        const excludedPoints = excludeClients(points, incomeFiltered, d.excluded);
        expect(excludedPoints.map(({ excludedIncome: _e, ...p }) => p)).toEqual(rc.chartData);

        const c = corporateOf(filtered, incomeFiltered, d.excluded);
        expect(c.net).toBe(rc.cumulative);
        expect(c.partnerA).toBe(rc.a);
        expect(c.partnerB).toBe(rc.b);
        expect(c.income + c.excludedIncome).toBe(t.income);
        expect(c.net).toBe(c.income - c.workExpenses);
      }
    });
  }
});

describe("los datasets aleatorios ejercitan los casos que importan", () => {
  it("muchos tienen clientes excluidos con ingreso, y meses fuera de la ventana", () => {
    let withExcludedIncome = 0;
    let withRowsOutside = 0;
    for (let seed = 1; seed <= 400; seed++) {
      const d = dataset(seed);
      const months = recentMonths(d.today);
      const { monthly, incomeByClient } = bucketByMonth(months, d);
      if (corporateOf(monthly, incomeByClient, d.excluded).excludedIncome > 0) withExcludedIncome++;
      if (d.invoices.some((i) => !months.includes(periodKeyOf(i.due_date)))) withRowsOutside++;
    }
    expect(withExcludedIncome).toBeGreaterThan(100);
    expect(withRowsOutside).toBeGreaterThan(100);
  });
});

describe("upcoming payments reproduce the dashboard exactly (300 seeded datasets)", () => {
  for (let seed = 1; seed <= 300; seed++) {
    it(`seed ${seed}`, () => {
      const d = dataset(seed * 7919);
      const subs: RefSubUp[] = Array.from({ length: d.int(0, 8) }, (_, i) => {
        const frequency = d.pick(["monthly", "annual"] as const);
        const pay_day = d.int(1, 31);
        const pay_month = frequency === "annual" ? d.int(1, 12) : null;
        const payments = Array.from({ length: d.int(0, 2) }, () => ({
          due_date: new Date(Date.UTC(d.today.getUTCFullYear(), d.today.getUTCMonth() + d.int(0, 1), clampDay(d.today.getUTCFullYear(), d.today.getUTCMonth() + 1, pay_day))),
        }));
        return { id: "s" + i, name: "Sub " + i, amount_cents: d.int(100, 9000), frequency, pay_day, pay_month, payments };
      });
      const people: RefPersonUp[] = Array.from({ length: d.int(0, 8) }, (_, i) => {
        const payday_day = d.int(1, 31);
        return {
          id: "p" + i,
          name: "Person " + i,
          payday_day,
          salary_base: d.int(0, 4) === 0 ? null : { base_salary_cents: d.int(100_000, 900_000) },
          salary_payments: Array.from({ length: d.int(0, 1) }, () => ({
            due_date: new Date(Date.UTC(d.today.getUTCFullYear(), d.today.getUTCMonth(), clampDay(d.today.getUTCFullYear(), d.today.getUTCMonth() + 1, payday_day))),
          })),
        };
      });
      const got = upcomingPaymentsOf(
        subs.map((s) => ({ ...s, paidDueDates: s.payments.map((p) => p.due_date) })),
        people.map((p) => ({
          id: p.id, name: p.name, payday_day: p.payday_day,
          base_salary_cents: p.salary_base?.base_salary_cents ?? 0,
          paidDueDates: p.salary_payments.map((x) => x.due_date),
        })),
        d.today
      );
      expect(got).toEqual(refUpcoming(d.today, subs, people));
    });
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// The rules themselves, one at a time.
// ═══════════════════════════════════════════════════════════════════════════

const day = (y: number, m: number, d: number) => new Date(Date.UTC(y, m - 1, d));

describe("reglas de los números", () => {
  const months = ["2026-08", "2026-09"];
  const empty = { invoices: [], salaries: [], subscriptions: [], others: [] };

  it("el ingreso incluye el fee (negativo) del referidor", () => {
    const { monthly } = bucketByMonth(months, {
      ...empty,
      invoices: [{ due_date: day(2026, 9, 30), amount_cents: 100_000, fee_cents: -10_000, client_id: "c" }],
    });
    expect(monthly[1].income).toBe(90_000);
  });

  it("las facturas van al mes de su vencimiento; los pagos, al de su fecha de pago", () => {
    const { monthly } = bucketByMonth(months, {
      invoices: [{ due_date: day(2026, 8, 31), amount_cents: 5, fee_cents: 0, client_id: "c" }],
      salaries: [{ paid_at: day(2026, 9, 1), total_cents: 7 }],
      subscriptions: [],
      others: [],
    });
    expect(monthly[0].income).toBe(5);
    expect(monthly[1].salary).toBe(7);
  });

  it("el día 1 a medianoche UTC cae en su propio mes, no en el anterior", () => {
    expect(periodKeyOf(day(2026, 9, 1))).toBe("2026-09");
  });

  it("separa suscripciones y otros gastos en trabajo, personal y esenciales", () => {
    const { monthly } = bucketByMonth(months, {
      ...empty,
      subscriptions: [
        { paid_at: day(2026, 9, 3), amount_cents_snapshot: 1, category: "work" },
        { paid_at: day(2026, 9, 3), amount_cents_snapshot: 10, category: "personal" },
        { paid_at: day(2026, 9, 3), amount_cents_snapshot: 100, category: "essential_service" },
      ],
      others: [
        { paid_at: day(2026, 9, 3), amount_cents: 1000, category: "work" },
        { paid_at: day(2026, 9, 3), amount_cents: 10_000, category: "personal" },
      ],
    });
    expect(monthly[1]).toMatchObject({
      subscriptions: 111, subsWork: 1, subsPersonal: 10, subsEssential: 100,
      other: 11_000, otherWork: 1000, otherPersonal: 10_000,
    });
  });

  it("net income = ingresos − (salarios + suscripciones + otros gastos)", () => {
    const t = totalsOf([{ month: "2026-09", income: 1000, salary: 300, subscriptions: 100, subsPersonal: 0, subsWork: 100, subsEssential: 0, other: 50, otherWork: 50, otherPersonal: 0 }]);
    expect(t.net).toBe(550);
  });

  it("sin meses, los promedios son 0 y no dividen por cero", () => {
    const t = totalsOf([]);
    expect(t.avgNet).toBe(0);
    expect(Number.isFinite(t.avgSalary)).toBe(true);
  });

  it("la rentabilidad corporativa excluye el ingreso de los clientes elegidos, no sus gastos", () => {
    const m: MonthData[] = [{ month: "2026-09", income: 1000, salary: 300, subscriptions: 100, subsPersonal: 50, subsWork: 50, subsEssential: 0, other: 0, otherWork: 0, otherPersonal: 0 }];
    const c = corporateOf(m, [{ month: "2026-09", byClient: { acl: 400, other: 600 } }], ["acl"]);
    expect(c).toEqual({ income: 600, excludedIncome: 400, workExpenses: 350, net: 250, partnerA: 150, partnerB: 100 });
  });

  it("el reparto es 60/40 redondeado a centavos, como lo muestra el dashboard", () => {
    const m: MonthData[] = [{ month: "2026-09", income: 1001, salary: 0, subscriptions: 0, subsPersonal: 0, subsWork: 0, subsEssential: 0, other: 0, otherWork: 0, otherPersonal: 0 }];
    const c = corporateOf(m, [], []);
    expect([c.partnerA, c.partnerB]).toEqual([601, 400]);
  });

  it("'This year' arranca en enero aunque haya meses cargados del año anterior", () => {
    const monthly = recentMonths(day(2026, 3, 15)).map((month) => ({ month, income: 1, salary: 0, subscriptions: 0, subsPersonal: 0, subsWork: 0, subsEssential: 0, other: 0, otherWork: 0, otherPersonal: 0 }));
    expect(filterMonths(monthly, "ytd", day(2026, 3, 15)).map((m) => m.month)).toEqual(["2026-01", "2026-02", "2026-03"]);
    expect(filterMonths(monthly, "last12", day(2026, 3, 15))).toHaveLength(12);
  });
});

describe("isPastDue", () => {
  const sep1 = day(2026, 9, 1);
  it("una Sent que venció el mes pasado está vencida", () => {
    expect(isPastDue({ status: "sent", due_date: day(2026, 8, 31) }, sep1)).toBe(true);
  });
  it("el día del vencimiento todavía no está vencida", () => {
    expect(isPastDue({ status: "sent", due_date: day(2026, 8, 31) }, day(2026, 8, 31))).toBe(false);
  });
  it("solo las Sent: pendientes, en contabilidad o pagadas nunca están vencidas", () => {
    for (const status of ["pending", "accounting", "paid"]) {
      expect(isPastDue({ status, due_date: day(2026, 1, 31) }, sep1)).toBe(false);
    }
  });
  it("acepta la fecha como string ISO, como llega al navegador", () => {
    expect(isPastDue({ status: "sent", due_date: "2026-08-31T00:00:00.000Z" }, sep1)).toBe(true);
  });
});

describe("awaitingOf", () => {
  it("cuenta las Sent, suma su neto y cuántas están vencidas", () => {
    const a = awaitingOf(
      [
        { status: "sent", amount_cents: 1000, fee_cents: -100, due_date: day(2026, 8, 31) },
        { status: "sent", amount_cents: 500, fee_cents: 0, due_date: day(2026, 9, 30) },
        { status: "paid", amount_cents: 9999, fee_cents: 0, due_date: day(2026, 8, 31) },
      ],
      day(2026, 9, 10)
    );
    expect(a).toEqual({ count: 2, netCents: 1400, pastDueCount: 1 });
  });
});

describe("próximos pagos", () => {
  it("un pay_day 31 vence el último día de un mes corto", () => {
    const got = upcomingPaymentsOf(
      [{ id: "s", name: "S", amount_cents: 1, frequency: "monthly", pay_day: 31, pay_month: null, paidDueDates: [] }],
      [],
      day(2026, 2, 26)
    );
    expect(got.map((p) => p.due_date.slice(0, 10))).toEqual(["2026-02-28"]);
  });
  it("un vencimiento ya pagado no aparece", () => {
    const got = upcomingPaymentsOf(
      [],
      [{ id: "p", name: "P", payday_day: 30, base_salary_cents: 1, paidDueDates: [day(2026, 9, 30)] }],
      day(2026, 9, 27)
    );
    expect(got).toEqual([]);
  });
  it("una anual solo aparece en su mes", () => {
    const sub = { id: "s", name: "S", amount_cents: 1, frequency: "annual", pay_day: 2, pay_month: 10, paidDueDates: [] };
    expect(upcomingPaymentsOf([sub], [], day(2026, 9, 28))).toHaveLength(1);
    expect(upcomingPaymentsOf([{ ...sub, pay_month: 11 }], [], day(2026, 9, 28))).toHaveLength(0);
  });
});

describe("los datasets de próximos pagos no son triviales", () => {
  it("una buena parte tiene algo que mostrar", () => {
    let nonEmpty = 0;
    for (let seed = 1; seed <= 300; seed++) {
      const d = dataset(seed * 7919);
      const subs = Array.from({ length: 8 }, (_, i) => ({
        id: "s" + i, name: "S", amount_cents: 1, frequency: "monthly", pay_day: d.int(1, 31), pay_month: null, paidDueDates: [],
      }));
      if (upcomingPaymentsOf(subs, [], d.today).length > 0) nonEmpty++;
    }
    expect(nonEmpty).toBeGreaterThan(150);
  });
});
