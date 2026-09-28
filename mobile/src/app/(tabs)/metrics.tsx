import { useCallback, useMemo, useState, type ReactNode } from "react";
import { Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from "react-native";
import { useRouter } from "expo-router";
import { ChevronLeft, ChevronRight } from "lucide-react-native";
import { formatCents } from "@shared/currency";
import { useRemote } from "@/business/cache";
import {
  metricsCacheKey,
  metricsPath,
  percent,
  periodPhrase,
  stepMonth,
  toMetricsReport,
  type MetricsView,
} from "@/business/metrics";
import { MONTHS_BACK, thisMonth } from "@/business/salaries";
import { Freshness } from "@/components/Freshness";
import { Segments } from "@/components/Segments";
import { StateView } from "@/components/StateView";
import { dayLabel, monthShort, monthTitle, shiftMonth } from "@/lib/format";
import { font, usePalette } from "@/lib/theme";

type Preset = MetricsView["kind"];

const PRESETS: { key: Preset; label: string }[] = [
  { key: "this_year", label: "This year" },
  { key: "last_12_months", label: "12 months" },
  { key: "month", label: "Month" },
];

/**
 * The dashboard's big picture. Every figure is GET /api/metrics' — computed
 * by the same code as the web dashboard — shown as it comes; the phone adds
 * nothing up. Each period's last answer is kept, so it reads offline too.
 */
export default function Metrics() {
  const c = usePalette();
  const router = useRouter();
  // The month the screen opened in: stable while it is open.
  const [current] = useState(() => thisMonth(new Date()));
  const [view, setView] = useState<MetricsView>({ kind: "this_year" });
  const remote = useRemote(metricsCacheKey(view), metricsPath(view), toMetricsReport);
  const [pulling, setPulling] = useState(false);
  const now = useMemo(() => new Date(), [remote.data, remote.fetchedAt]); // eslint-disable-line react-hooks/exhaustive-deps
  const oldest = shiftMonth(current, -MONTHS_BACK);

  const choose = useCallback(
    (kind: Preset) => setView(kind === "month" ? { kind: "month", month: current } : { kind }),
    [current]
  );

  const pull = useCallback(async () => {
    setPulling(true);
    await remote.refresh();
    setPulling(false);
  }, [remote]);

  const m = remote.data;

  let body: ReactNode;
  if (!m) {
    if (remote.loading) body = <StateView loading />;
    else if (!remote.online) body = <StateView title="You're offline" body="This period hasn't been loaded on this phone yet." />;
    else if (remote.error) body = <StateView title="Couldn't load metrics" body={remote.error} action={{ label: "Try again", onPress: () => void remote.refresh() }} />;
    else body = <StateView loading title="Getting the numbers…" />;
  } else {
    const excluded = m.corporate.excluded_clients.map((x) => x.name);
    const phrase = periodPhrase(view, monthShort);
    body = (
      <>
        <Freshness fetchedAt={remote.fetchedAt} online={remote.online} error={remote.error} now={now} />

        <Card testID="metric-awaiting" onPress={() => router.navigate("/invoices")}>
          <Label>Invoices awaiting payment</Label>
          <Big>{formatCents(m.awaiting_payment.net_cents)}</Big>
          <Text style={[styles.sub, { color: c.muted }]}>
            {m.awaiting_payment.count === 1 ? "1 invoice" : `${m.awaiting_payment.count} invoices`}
            {m.awaiting_payment.past_due_count > 0 ? (
              <Text style={{ color: c.overdue, fontFamily: font.semibold }}> · {m.awaiting_payment.past_due_count} past due</Text>
            ) : null}
          </Text>
        </Card>

        <Card testID="metric-net">
          <Label>Net income · {phrase}</Label>
          <Big tone={m.net_income_cents < 0 ? c.overdue : undefined}>{formatCents(m.net_income_cents)}</Big>
          <Text style={[styles.sub, { color: c.muted }]}>
            Income {formatCents(m.income_cents)} · expenses {formatCents(m.expenses.total_cents)}
          </Text>
          {m.monthly_averages.months > 1 ? (
            <Text style={[styles.sub, { color: c.muted }]}>avg {formatCents(m.monthly_averages.net_income_cents)} / month</Text>
          ) : null}
        </Card>

        <Card testID="metric-corporate">
          <Label>Corporate profitability{excluded.length ? ` · excl. ${excluded.join(", ")}` : ""}</Label>
          <Big tone={m.corporate.net_cents < 0 ? c.overdue : undefined}>{formatCents(m.corporate.net_cents)}</Big>
          <View style={styles.partners}>
            <View style={[styles.partner, { backgroundColor: c.surface }]} testID="metric-partner-a">
              <Text style={[styles.partnerLabel, { color: c.muted }]}>Partner A · {percent(m.corporate.split.partner_a)}</Text>
              <Text style={[styles.partnerValue, { color: c.ink }]}>{formatCents(m.corporate.partner_a_cents)}</Text>
            </View>
            <View style={[styles.partner, { backgroundColor: c.surface }]} testID="metric-partner-b">
              <Text style={[styles.partnerLabel, { color: c.muted }]}>Partner B · {percent(m.corporate.split.partner_b)}</Text>
              <Text style={[styles.partnerValue, { color: c.ink }]}>{formatCents(m.corporate.partner_b_cents)}</Text>
            </View>
          </View>
        </Card>

        <Card testID="metric-upcoming-payments">
          <Label>Upcoming payments · next {m.upcoming.days} days</Label>
          {m.upcoming.payments.length === 0 ? (
            <Text style={[styles.none, { color: c.faint }]}>Nothing due.</Text>
          ) : (
            m.upcoming.payments.map((p) => (
              <Line
                key={`${p.type}-${p.id}-${p.due_date}`}
                left={p.name}
                detail={`${p.type === "salary" ? "Salary" : "Subscription"} · ${dayLabel(p.due_date, now)}`}
                right={formatCents(p.amount_cents)}
              />
            ))
          )}
        </Card>

        <Card testID="metric-upcoming-invoices">
          <Label>Upcoming invoices · next {m.upcoming.days} days</Label>
          {m.upcoming.invoices.length === 0 ? (
            <Text style={[styles.none, { color: c.faint }]}>Nothing due.</Text>
          ) : (
            m.upcoming.invoices.map((inv) => (
              <Line
                key={inv.id}
                dot={inv.client.color_hex}
                left={inv.client.name}
                detail={`${inv.invoice_number ? `#${inv.invoice_number}` : "No number"} · due ${dayLabel(inv.due_date, now)}`}
                right={formatCents(inv.net_cents)}
                onPress={() => router.push({ pathname: "/invoice/[id]", params: { id: inv.id } })}
              />
            ))
          )}
        </Card>
      </>
    );
  }

  return (
    <View style={[styles.screen, { backgroundColor: c.bg }]}>
      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={pulling} onRefresh={pull} tintColor={c.muted} colors={[c.accent]} />}
      >
        <View style={styles.periods}>
          <Segments options={PRESETS} value={view.kind} onChange={choose} testIDPrefix="metrics-period" />
        </View>
        {view.kind === "month" ? (
          <View style={styles.monthRow}>
            <Pressable
              onPress={() => setView(stepMonth(view, -1, current))}
              disabled={view.month <= oldest}
              hitSlop={10}
              style={[styles.arrow, { opacity: view.month <= oldest ? 0.3 : 1 }]}
              accessibilityLabel="Previous month"
              testID="metrics-prev"
            >
              <ChevronLeft size={20} color={c.ink} />
            </Pressable>
            <Text style={[styles.monthTitle, { color: c.ink }]}>{monthTitle(view.month)}</Text>
            <Pressable
              onPress={() => setView(stepMonth(view, 1, current))}
              disabled={view.month >= current}
              hitSlop={10}
              style={[styles.arrow, { opacity: view.month >= current ? 0.3 : 1 }]}
              accessibilityLabel="Next month"
              testID="metrics-next"
            >
              <ChevronRight size={20} color={c.ink} />
            </Pressable>
          </View>
        ) : null}
        {body}
      </ScrollView>
    </View>
  );
}

function Card({ children, onPress, testID }: { children: ReactNode; onPress?: () => void; testID?: string }) {
  const c = usePalette();
  return (
    <Pressable
      onPress={onPress}
      disabled={!onPress}
      testID={testID}
      style={({ pressed }) => [styles.card, { borderColor: c.line, backgroundColor: pressed && onPress ? c.surface : c.raised }]}
    >
      {children}
    </Pressable>
  );
}

function Label({ children }: { children: ReactNode }) {
  const c = usePalette();
  return (
    <Text numberOfLines={2} style={[styles.label, { color: c.muted }]}>
      {children}
    </Text>
  );
}

function Big({ children, tone }: { children: ReactNode; tone?: string }) {
  const c = usePalette();
  return <Text style={[styles.big, { color: tone ?? c.ink }]}>{children}</Text>;
}

function Line({
  left,
  detail,
  right,
  dot,
  onPress,
}: {
  left: string;
  detail: string;
  right: string;
  dot?: string;
  onPress?: () => void;
}) {
  const c = usePalette();
  return (
    <Pressable onPress={onPress} disabled={!onPress} style={styles.line}>
      {dot ? <View style={[styles.dot, { backgroundColor: dot }]} /> : null}
      <View style={styles.lineBody}>
        <Text numberOfLines={1} style={[styles.lineLeft, { color: c.ink }]}>
          {left}
        </Text>
        <Text numberOfLines={1} style={[styles.lineDetail, { color: c.muted }]}>
          {detail}
        </Text>
      </View>
      <Text style={[styles.lineRight, { color: c.ink }]}>{right}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  content: { paddingHorizontal: 12, paddingBottom: 40, gap: 10, flexGrow: 1 },
  periods: { marginHorizontal: -12 },
  monthRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 8, marginTop: -4 },
  arrow: { width: 32, height: 32, alignItems: "center", justifyContent: "center" },
  monthTitle: { fontFamily: font.bold, fontSize: 16 },
  card: { borderWidth: StyleSheet.hairlineWidth, borderRadius: 16, padding: 14, gap: 4 },
  label: { fontFamily: font.medium, fontSize: 12.5 },
  big: { fontFamily: font.bold, fontSize: 26, fontVariant: ["tabular-nums"] },
  sub: { fontFamily: font.regular, fontSize: 13 },
  partners: { flexDirection: "row", gap: 8, marginTop: 6 },
  partner: { flex: 1, borderRadius: 12, padding: 10, gap: 2 },
  partnerLabel: { fontFamily: font.medium, fontSize: 12 },
  partnerValue: { fontFamily: font.bold, fontSize: 16, fontVariant: ["tabular-nums"] },
  none: { fontFamily: font.regular, fontSize: 13, marginTop: 2 },
  line: { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 7 },
  lineBody: { flex: 1, minWidth: 0 },
  lineLeft: { fontFamily: font.semibold, fontSize: 14 },
  lineDetail: { fontFamily: font.regular, fontSize: 12.5 },
  lineRight: { fontFamily: font.bold, fontSize: 14, fontVariant: ["tabular-nums"] },
  dot: { width: 8, height: 8, borderRadius: 4 },
});
