import { useCallback, useMemo, useState } from "react";
import { Alert, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from "react-native";
import { ChevronLeft, ChevronRight, CircleCheck, CloudOff } from "lucide-react-native";
import { formatCents } from "@shared/currency";
import { invalidate, useApiCall, useRemote } from "@/business/cache";
import {
  MONTHS_BACK,
  defaultPaidAt,
  monthReport,
  thisMonth,
  toPeople,
  type PaidLine,
  type PersonItem,
  type UnpaidLine,
} from "@/business/salaries";
import { Freshness } from "@/components/Freshness";
import { RegisterPaymentSheet, type PaymentInput } from "@/components/RegisterPaymentSheet";
import { StateView } from "@/components/StateView";
import { useToast } from "@/components/Toast";
import { dayLabel, monthTitle, montevideoToday, ordinal, shiftMonth } from "@/lib/format";
import { font, usePalette } from "@/lib/theme";

function initials(name: string): string {
  const parts = name.trim().split(/\s+/);
  return ((parts[0]?.[0] ?? "") + (parts.length > 1 ? parts[parts.length - 1][0] : "")).toUpperCase();
}

/**
 * Salaries by month: who hasn't been paid yet — first, with how late — and
 * who has. It opens on this month; the arrows go back as far as the payments
 * the API returns (a year). Register one payment, or everyone still unpaid at
 * once, as the web's Bulk Pay does.
 */
export default function Salaries() {
  const c = usePalette();
  const toast = useToast();
  const call = useApiCall();
  const remote = useRemote("people", "/api/people", toPeople);
  const now = useMemo(() => new Date(), [remote.data, remote.fetchedAt]); // eslint-disable-line react-hooks/exhaustive-deps
  const today = montevideoToday(now);
  const current = thisMonth(now);
  const [month, setMonth] = useState(current);
  const [paying, setPaying] = useState<PersonItem | null>(null);
  const [payingAll, setPayingAll] = useState(false);
  const [pulling, setPulling] = useState(false);

  const report = useMemo(() => monthReport(remote.data ?? [], month, today), [remote.data, month, today]);
  const oldest = shiftMonth(current, -MONTHS_BACK);
  const offline = !remote.online;

  const pull = useCallback(async () => {
    setPulling(true);
    await remote.refresh();
    setPulling(false);
  }, [remote]);

  const post = useCallback(
    (person: PersonItem, input: PaymentInput) =>
      call(`/api/people/${person.id}/payments`, { method: "POST", body: input }),
    [call]
  );

  const saveOne = useCallback(
    async (person: PersonItem, input: PaymentInput) => {
      await post(person, input);
      setPaying(null);
      invalidate("people", "metrics:");
      await remote.refresh();
      toast(`Payment registered for ${person.name}`);
    },
    [post, remote, toast]
  );

  const payAll = useCallback(() => {
    const lines = report.unpaid;
    if (lines.length === 0) return;
    const dated = month === current ? `today (${dayLabel(today, now)})` : `on each person's payday in ${monthTitle(month)}`;
    Alert.alert(
      `Pay all ${lines.length} · ${formatCents(report.unpaidCents)}?`,
      `Registers ${lines.length === 1 ? "a payment" : "one payment each"} at the base salary, dated ${dated}, with no adjustment.`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Pay all",
          onPress: async () => {
            setPayingAll(true);
            const failed: string[] = [];
            // One at a time: a clear answer per person, and no burst on the server.
            for (const line of lines) {
              try {
                await post(line.person, {
                  paid_at: defaultPaidAt(month, today, line.person.payday_day),
                  adjustment_cents: 0,
                  adjustment_note: null,
                });
              } catch (err) {
                failed.push(`${line.person.name}: ${err instanceof Error ? err.message : String(err)}`);
              }
            }
            invalidate("people", "metrics:");
            await remote.refresh();
            setPayingAll(false);
            const done = lines.length - failed.length;
            if (failed.length === 0) toast(`${done === 1 ? "1 payment" : `${done} payments`} registered`);
            else Alert.alert(`${done} of ${lines.length} registered`, failed.join("\n"));
          },
        },
      ]
    );
  }, [report, month, current, today, now, post, remote, toast]);

  if (remote.loading) return <StateView loading />;
  if (!remote.data) {
    if (offline) return <StateView title="You're offline" body="Salaries appear here once the phone has been online with this screen open." />;
    if (remote.error) {
      return <StateView title="Couldn't load salaries" body={remote.error} action={{ label: "Try again", onPress: () => void remote.refresh() }} />;
    }
    return <StateView loading title="Getting salaries…" />;
  }

  const paidShare = report.people ? report.paid.length / report.people : 0;

  return (
    <View style={[styles.screen, { backgroundColor: c.bg }]}>
      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={pulling} onRefresh={pull} tintColor={c.muted} colors={[c.accent]} />}
      >
        <View style={[styles.summary, { backgroundColor: c.surface }]} testID="salaries-summary">
          <View style={styles.monthRow}>
            <Pressable
              onPress={() => setMonth((m) => shiftMonth(m, -1))}
              disabled={month <= oldest}
              hitSlop={10}
              style={[styles.arrow, { opacity: month <= oldest ? 0.3 : 1 }]}
              accessibilityLabel="Previous month"
              testID="salaries-prev"
            >
              <ChevronLeft size={20} color={c.ink} />
            </Pressable>
            <Text style={[styles.monthTitle, { color: c.ink }]} testID="salaries-month">
              {monthTitle(month)}
            </Text>
            <Pressable
              onPress={() => setMonth((m) => shiftMonth(m, 1))}
              disabled={month >= current}
              hitSlop={10}
              style={[styles.arrow, { opacity: month >= current ? 0.3 : 1 }]}
              accessibilityLabel="Next month"
              testID="salaries-next"
            >
              <ChevronRight size={20} color={c.ink} />
            </Pressable>
          </View>
          <Text style={[styles.progressText, { color: c.ink }]}>
            {report.paid.length} of {report.people} paid ·{" "}
            <Text style={{ color: c.muted }}>
              {formatCents(report.paidCents)} of {formatCents(report.paidCents + report.unpaidCents)}
            </Text>
          </Text>
          <View style={[styles.bar, { backgroundColor: c.line }]}>
            <View style={[styles.barFill, { width: `${Math.round(paidShare * 100)}%`, backgroundColor: "#10B981" }]} />
          </View>
        </View>

        <Freshness fetchedAt={remote.fetchedAt} online={remote.online} error={remote.error} now={now} />

        <View style={styles.sectionHead}>
          <Text style={[styles.section, { color: c.ink }]}>
            {month === current ? "Not paid this month" : "Not paid"} · {report.unpaid.length}
          </Text>
          <Text style={[styles.sectionTotal, { color: c.ink }]}>{formatCents(report.unpaidCents)}</Text>
        </View>
        {report.people === 0 ? (
          <Text style={[styles.none, { color: c.faint }]} testID="salaries-nobody">
            No one was on the team in {monthTitle(month)}.
          </Text>
        ) : report.unpaid.length === 0 ? (
          <View style={[styles.allPaid, { backgroundColor: c.surface }]} testID="salaries-all-paid">
            <CircleCheck size={16} color="#10B981" />
            <Text style={[styles.allPaidText, { color: c.ink }]}>Everyone has been paid for {monthTitle(month)}.</Text>
          </View>
        ) : (
          report.unpaid.map((line) => (
            <UnpaidRow key={line.person.id} line={line} disabled={offline || payingAll} onPay={() => setPaying(line.person)} />
          ))
        )}
        {report.unpaid.length > 0 ? (
          <Pressable
            onPress={payAll}
            disabled={offline || payingAll}
            testID="salaries-pay-all"
            accessibilityRole="button"
            style={[styles.payAll, { backgroundColor: c.primary, opacity: offline || payingAll ? 0.45 : 1 }]}
          >
            <Text style={[styles.payAllText, { color: c.onPrimary }]}>
              {payingAll ? "Registering…" : `Pay all ${report.unpaid.length} · ${formatCents(report.unpaidCents)}`}
            </Text>
          </Pressable>
        ) : null}
        {offline ? (
          <View style={styles.offlineHint}>
            <CloudOff size={13} color={c.muted} />
            <Text style={[styles.hint, { color: c.muted }]}>Registering payments needs a connection.</Text>
          </View>
        ) : null}

        <View style={[styles.sectionHead, styles.sectionGap]}>
          <Text style={[styles.section, { color: c.ink }]}>Paid · {report.paid.length}</Text>
          <Text style={[styles.sectionTotal, { color: c.ink }]}>{formatCents(report.paidCents)}</Text>
        </View>
        {report.paid.length === 0 ? (
          <Text style={[styles.none, { color: c.faint }]}>No payments registered for {monthTitle(month)}.</Text>
        ) : (
          report.paid.map((line) => <PaidRow key={line.person.id} line={line} now={now} />)
        )}
      </ScrollView>

      <RegisterPaymentSheet
        key={paying ? `${paying.id}:${month}` : "closed"}
        person={paying}
        defaultDate={paying ? defaultPaidAt(month, today, paying.payday_day) : today}
        onClose={() => setPaying(null)}
        onSave={saveOne}
      />
    </View>
  );
}

function UnpaidRow({ line, disabled, onPay }: { line: UnpaidLine; disabled: boolean; onPay: () => void }) {
  const c = usePalette();
  const { person, daysLate } = line;
  return (
    <View style={[styles.row, { borderColor: c.line, backgroundColor: c.raised }]} testID={`unpaid-${person.id}`}>
      <View style={[styles.avatar, { backgroundColor: c.surface }]}>
        <Text style={[styles.avatarText, { color: c.muted }]}>{initials(person.name)}</Text>
      </View>
      <View style={styles.rowBody}>
        <Text numberOfLines={1} style={[styles.name, { color: c.ink }]}>
          {person.name}
        </Text>
        <Text numberOfLines={2} style={[styles.meta, { color: c.muted }]}>
          {person.role ? `${person.role} · ` : ""}Paid on the {ordinal(person.payday_day)}
          {daysLate > 0 ? (
            <Text style={{ color: c.overdue, fontFamily: font.semibold }}>
              {" "}· {daysLate === 1 ? "1 day late" : `${daysLate} days late`}
            </Text>
          ) : null}
        </Text>
      </View>
      <View style={styles.rowEnd}>
        <Text style={[styles.amount, { color: c.ink }]}>{formatCents(line.amount_cents)}</Text>
        <Pressable
          onPress={onPay}
          disabled={disabled}
          hitSlop={6}
          testID={`pay-${person.id}`}
          accessibilityRole="button"
          accessibilityLabel={`Register payment for ${person.name}`}
          style={[styles.payBtn, { borderColor: c.line, opacity: disabled ? 0.45 : 1 }]}
        >
          <Text style={[styles.payBtnText, { color: c.ink }]}>Register</Text>
        </Pressable>
      </View>
    </View>
  );
}

function PaidRow({ line, now }: { line: PaidLine; now: Date }) {
  const c = usePalette();
  const { person, payment } = line;
  return (
    <View style={[styles.row, { borderColor: c.line, backgroundColor: c.raised }]} testID={`paid-${person.id}`}>
      <View style={[styles.avatar, { backgroundColor: c.surface }]}>
        <Text style={[styles.avatarText, { color: c.muted }]}>{initials(person.name)}</Text>
      </View>
      <View style={styles.rowBody}>
        <Text numberOfLines={1} style={[styles.name, { color: c.ink }]}>
          {person.name}
        </Text>
        <Text numberOfLines={1} style={[styles.meta, { color: c.muted }]}>
          {person.role ? `${person.role} · ` : ""}Paid {dayLabel(payment.paid_at, now)}
          {payment.adjustment_cents !== 0
            ? ` · ${payment.adjustment_cents > 0 ? "+" : "−"}${formatCents(Math.abs(payment.adjustment_cents))}${payment.adjustment_note ? ` ${payment.adjustment_note}` : ""}`
            : ""}
        </Text>
      </View>
      <View style={styles.rowEnd}>
        <Text style={[styles.amount, { color: c.ink }]}>{formatCents(payment.total_cents)}</Text>
        <CircleCheck size={15} color="#10B981" />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  content: { paddingHorizontal: 12, paddingBottom: 40, gap: 8 },
  summary: { marginHorizontal: 4, marginBottom: 4, padding: 14, borderRadius: 16, gap: 8 },
  monthRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  arrow: { width: 32, height: 32, alignItems: "center", justifyContent: "center" },
  monthTitle: { fontFamily: font.bold, fontSize: 18 },
  progressText: { fontFamily: font.semibold, fontSize: 14, textAlign: "center" },
  bar: { height: 6, borderRadius: 3, overflow: "hidden" },
  barFill: { height: "100%", borderRadius: 3 },
  sectionHead: { flexDirection: "row", alignItems: "baseline", justifyContent: "space-between", paddingHorizontal: 6, marginTop: 2 },
  sectionGap: { marginTop: 16 },
  section: { fontFamily: font.semibold, fontSize: 15 },
  sectionTotal: { fontFamily: font.semibold, fontSize: 15, fontVariant: ["tabular-nums"] },
  row: { flexDirection: "row", alignItems: "center", gap: 10, borderWidth: StyleSheet.hairlineWidth, borderRadius: 14, padding: 12 },
  avatar: { width: 36, height: 36, borderRadius: 18, alignItems: "center", justifyContent: "center" },
  avatarText: { fontFamily: font.semibold, fontSize: 13 },
  rowBody: { flex: 1, minWidth: 0, gap: 2 },
  name: { fontFamily: font.semibold, fontSize: 15 },
  meta: { fontFamily: font.regular, fontSize: 12.5 },
  rowEnd: { alignItems: "flex-end", gap: 6 },
  amount: { fontFamily: font.bold, fontSize: 14.5, fontVariant: ["tabular-nums"] },
  payBtn: { height: 28, paddingHorizontal: 10, borderRadius: 8, borderWidth: 1, justifyContent: "center" },
  payBtnText: { fontFamily: font.semibold, fontSize: 12.5 },
  payAll: { height: 48, borderRadius: 14, alignItems: "center", justifyContent: "center", marginTop: 4 },
  payAllText: { fontFamily: font.semibold, fontSize: 15 },
  allPaid: { flexDirection: "row", alignItems: "center", gap: 8, padding: 12, borderRadius: 12 },
  allPaidText: { flex: 1, fontFamily: font.medium, fontSize: 13.5 },
  offlineHint: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6 },
  hint: { fontFamily: font.medium, fontSize: 12.5 },
  none: { fontFamily: font.regular, fontSize: 13, marginLeft: 6 },
});
