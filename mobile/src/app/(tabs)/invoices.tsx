import { useCallback, useMemo, useState } from "react";
import { FlatList, RefreshControl, StyleSheet, Text, View } from "react-native";
import { useRouter } from "expo-router";
import { formatCents } from "@shared/currency";
import { useRemote } from "@/business/cache";
import {
  SEGMENTS,
  awaitingSummary,
  invoicePastDue,
  invoicesIn,
  segmentCounts,
  toInvoiceItems,
  type InvoiceItem,
  type Segment,
} from "@/business/invoices";
import { Freshness } from "@/components/Freshness";
import { InvoiceCard } from "@/components/InvoiceCard";
import { Segments } from "@/components/Segments";
import { StateView } from "@/components/StateView";
import { font, usePalette } from "@/lib/theme";

const EMPTY: Record<Segment, string> = {
  awaiting: "Nothing awaiting payment",
  prep: "Nothing in preparation",
  paid: "No paid invoices yet",
  all: "No invoices yet",
};

/**
 * Invoices, what is still to be collected first: it opens on Awaiting (status
 * Sent), with the dashboard's "awaiting payment" total on top. Read from the
 * last snapshot, so it opens without signal too.
 */
export default function Invoices() {
  const c = usePalette();
  const router = useRouter();
  const remote = useRemote("invoices", "/api/invoices", toInvoiceItems);
  const [segment, setSegment] = useState<Segment>("awaiting");
  const [pulling, setPulling] = useState(false);

  const items = useMemo(() => remote.data ?? [], [remote.data]);
  // "Past due" and "Updated 5m ago" are relative to when the list was read.
  const now = useMemo(() => new Date(), [remote.data, remote.fetchedAt]); // eslint-disable-line react-hooks/exhaustive-deps
  const counts = useMemo(() => segmentCounts(items), [items]);
  const rows = useMemo(() => invoicesIn(items, segment, now), [items, segment, now]);
  const awaiting = useMemo(() => awaitingSummary(items, now), [items, now]);

  const open = useCallback(
    (inv: InvoiceItem) => router.push({ pathname: "/invoice/[id]", params: { id: inv.id } }),
    [router]
  );

  const pull = useCallback(async () => {
    setPulling(true);
    await remote.refresh();
    setPulling(false);
  }, [remote]);

  if (remote.loading) return <StateView loading />;

  if (!remote.data) {
    if (!remote.online) {
      return <StateView title="You're offline" body="Invoices appear here once the phone has been online with this screen open." />;
    }
    if (remote.error) {
      return <StateView title="Couldn't load invoices" body={remote.error} action={{ label: "Try again", onPress: () => void remote.refresh() }} />;
    }
    return <StateView loading title="Getting your invoices…" />;
  }

  return (
    <View style={[styles.screen, { backgroundColor: c.bg }]}>
      <FlatList
        data={rows}
        keyExtractor={(i) => i.id}
        renderItem={({ item }) => <InvoiceCard invoice={item} pastDue={invoicePastDue(item, now)} now={now} onPress={open} />}
        contentContainerStyle={rows.length ? styles.list : styles.emptyList}
        refreshControl={<RefreshControl refreshing={pulling} onRefresh={pull} tintColor={c.muted} colors={[c.accent]} />}
        ListHeaderComponent={
          <View>
            <View style={[styles.summary, { backgroundColor: c.surface }]} testID="invoices-summary">
              <Text style={[styles.summaryLabel, { color: c.muted }]}>Awaiting payment · status Sent</Text>
              <Text style={[styles.summaryAmount, { color: c.ink }]}>{formatCents(awaiting.netCents)}</Text>
              <Text style={[styles.summaryMeta, { color: c.muted }]}>
                {awaiting.count === 1 ? "1 invoice" : `${awaiting.count} invoices`}
                {awaiting.pastDueCount > 0 ? (
                  <Text style={{ color: c.overdue, fontFamily: font.semibold }}> · {awaiting.pastDueCount} past due</Text>
                ) : null}
              </Text>
            </View>
            <Segments
              options={SEGMENTS.map((s) => ({ ...s, count: counts[s.key] }))}
              value={segment}
              onChange={setSegment}
              testIDPrefix="invoice-segment"
            />
            <Freshness fetchedAt={remote.fetchedAt} online={remote.online} error={remote.error} now={now} />
          </View>
        }
        ListEmptyComponent={<StateView title={EMPTY[segment]} />}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  summary: { marginHorizontal: 16, marginBottom: 12, padding: 16, borderRadius: 16, gap: 2 },
  summaryLabel: { fontFamily: font.medium, fontSize: 12.5 },
  summaryAmount: { fontFamily: font.bold, fontSize: 28, fontVariant: ["tabular-nums"] },
  summaryMeta: { fontFamily: font.regular, fontSize: 13 },
  list: { paddingHorizontal: 12, paddingBottom: 32, gap: 8 },
  emptyList: { flexGrow: 1 },
});
