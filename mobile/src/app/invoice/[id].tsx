import { useCallback, useMemo, useState } from "react";
import { ActivityIndicator, Alert, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { ChevronLeft, CircleCheck, CloudOff, Paperclip, Share2, SquareCheck, StickyNote, Waypoints } from "lucide-react-native";
import { formatCents } from "@shared/currency";
import { invalidate, useApiCall, useRemote } from "@/business/cache";
import {
  INVOICE_STATUS_COLOR,
  INVOICE_STATUS_LABEL,
  invoicePastDue,
  invoiceTitle,
  toInvoiceItems,
  type InvoiceStatus,
} from "@/business/invoices";
import { useLinkedIssues, type LinkedIssue } from "@/business/linked";
import { shareInvoicePdf } from "@/business/share";
import { Freshness } from "@/components/Freshness";
import { StateView } from "@/components/StateView";
import { useToast } from "@/components/Toast";
import { dayLabel, monthTitle } from "@/lib/format";
import { kindOf } from "@/lib/issues";
import { effectiveTitle } from "@/notes/text";
import { font, usePalette } from "@/lib/theme";

const KIND_ICON = { note: StickyNote, canvas: Waypoints, task: SquareCheck } as const;

/**
 * One invoice: what it brings in and how that is made up, its PDF, the notes
 * that mention it — and the two things to do with it on the move: mark it
 * paid (status Paid, as the web's status selector does) and share its PDF.
 */
export default function InvoiceScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const c = usePalette();
  const insets = useSafeAreaInsets();
  const toast = useToast();
  const call = useApiCall();
  const remote = useRemote("invoices", "/api/invoices", toInvoiceItems);
  const linked = useLinkedIssues(id);
  const [busy, setBusy] = useState<"paid" | "share" | null>(null);
  const [pulling, setPulling] = useState(false);

  const invoice = useMemo(() => remote.data?.find((i) => i.id === id), [remote.data, id]);
  const now = useMemo(() => new Date(), [remote.data, remote.fetchedAt]); // eslint-disable-line react-hooks/exhaustive-deps

  const setStatus = useCallback(
    async (status: InvoiceStatus) => {
      await call(`/api/invoices/${id}`, { method: "PATCH", body: { status } });
      invalidate("invoices", "metrics:");
      await remote.refresh();
    },
    [call, id, remote]
  );

  const markPaid = useCallback(async () => {
    if (!invoice) return;
    const previous = invoice.status;
    setBusy("paid");
    try {
      await setStatus("paid");
      toast(`${invoiceTitle(invoice)} marked as paid`, {
        label: "Undo",
        onPress: () =>
          void setStatus(previous).catch((err) =>
            Alert.alert("Couldn't undo", err instanceof Error ? err.message : String(err))
          ),
      });
    } catch (err) {
      Alert.alert("Couldn't mark it as paid", err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  }, [invoice, setStatus, toast]);

  const share = useCallback(async () => {
    if (!invoice) return;
    setBusy("share");
    try {
      await shareInvoicePdf(invoice, call);
    } catch (err) {
      Alert.alert("Couldn't share the PDF", err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  }, [invoice, call]);

  const openIssue = useCallback(
    (issue: LinkedIssue) => {
      if (kindOf(issue) === "canvas") router.push({ pathname: "/canvas/[id]", params: { id: issue.id } });
      else router.push({ pathname: "/note/[id]", params: { id: issue.id } });
    },
    [router]
  );

  const pull = useCallback(async () => {
    setPulling(true);
    await remote.refresh();
    setPulling(false);
  }, [remote]);

  const back = (
    <View style={[styles.bar, { paddingTop: insets.top + 4 }]}>
      <Pressable onPress={() => router.back()} hitSlop={10} style={styles.iconBtn} accessibilityLabel="Back" testID="invoice-back">
        <ChevronLeft size={24} color={c.ink} />
      </Pressable>
      <Text numberOfLines={1} style={[styles.barTitle, { color: c.ink }]}>
        {invoice ? invoiceTitle(invoice) : "Invoice"}
      </Text>
    </View>
  );

  if (remote.loading) return <View style={[styles.screen, { backgroundColor: c.bg }]}>{back}<StateView loading /></View>;
  if (!invoice) {
    return (
      <View style={[styles.screen, { backgroundColor: c.bg }]}>
        {back}
        <StateView title="Not on this phone" body="It may have been deleted, or it is new and the next refresh brings it." />
      </View>
    );
  }

  const pastDue = invoicePastDue(invoice, now);
  const offline = !remote.online;

  return (
    <View style={[styles.screen, { backgroundColor: c.bg }]}>
      {back}
      <ScrollView
        contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 24 }]}
        refreshControl={<RefreshControl refreshing={pulling} onRefresh={pull} tintColor={c.muted} colors={[c.accent]} />}
      >
        <Freshness fetchedAt={remote.fetchedAt} online={remote.online} error={remote.error} now={now} />

        <View style={styles.hero}>
          <Text style={[styles.heroLabel, { color: c.muted }]}>Net</Text>
          <Text style={[styles.heroAmount, { color: c.ink }]} testID="invoice-net">
            {formatCents(invoice.net_cents)}
          </Text>
          <View style={styles.heroMeta}>
            <View style={[styles.dot, { backgroundColor: invoice.client.color_hex }]} />
            <Text style={[styles.heroClient, { color: c.ink }]}>{invoice.client.name}</Text>
          </View>
          <View style={styles.pills}>
            <View style={[styles.pill, { backgroundColor: c.surface }]} testID="invoice-status">
              <View style={[styles.dot, { backgroundColor: INVOICE_STATUS_COLOR[invoice.status] }]} />
              <Text style={[styles.pillText, { color: c.ink }]}>{INVOICE_STATUS_LABEL[invoice.status]}</Text>
            </View>
            {pastDue ? (
              <View style={[styles.pill, { backgroundColor: c.surface }]}>
                <Text style={[styles.pillText, { color: c.overdue }]}>Past due</Text>
              </View>
            ) : null}
            <Text style={[styles.month, { color: c.muted }]}>
              {monthTitle(invoice.due_date.slice(0, 7))} · due {dayLabel(invoice.due_date, now)}
            </Text>
          </View>
        </View>

        <View style={[styles.card, { borderColor: c.line, backgroundColor: c.raised }]}>
          <Row label="Amount" value={formatCents(invoice.amount_cents)} />
          <Row
            label={invoice.referrer ? `Referrer fee · ${invoice.referrer.name}` : "Referrer fee"}
            value={invoice.fee_cents === 0 ? "—" : formatCents(invoice.fee_cents)}
          />
          <View style={[styles.rule, { backgroundColor: c.line }]} />
          <Row label="Net" value={formatCents(invoice.net_cents)} strong />
        </View>

        {invoice.notes ? (
          <View style={[styles.card, { borderColor: c.line, backgroundColor: c.raised }]}>
            <Text style={[styles.section, { color: c.muted }]}>Notes</Text>
            <Text style={[styles.notes, { color: c.ink }]}>{invoice.notes}</Text>
          </View>
        ) : null}

        <View style={[styles.card, styles.fileRow, { borderColor: c.line, backgroundColor: c.raised }]}>
          <Paperclip size={16} color={invoice.has_file ? c.ink : c.faint} />
          <Text style={[styles.fileText, { color: invoice.has_file ? c.ink : c.muted }]}>
            {invoice.has_file ? "PDF attached" : "No PDF attached — upload one on the web"}
          </Text>
        </View>

        <Text style={[styles.section, styles.sectionOut, { color: c.muted }]}>Linked notes</Text>
        {linked && linked.length > 0 ? (
          linked.map((issue) => {
            const Icon = KIND_ICON[kindOf(issue)];
            return (
              <Pressable
                key={issue.id}
                onPress={() => openIssue(issue)}
                style={({ pressed }) => [styles.linked, { borderColor: c.line, backgroundColor: pressed ? c.surface : c.raised }]}
                testID={`invoice-linked-${issue.id}`}
              >
                <Icon size={15} color={c.muted} />
                <Text numberOfLines={1} style={[styles.linkedText, { color: c.ink }]}>
                  {effectiveTitle(issue.title, issue.description)}
                </Text>
              </Pressable>
            );
          })
        ) : (
          <Text style={[styles.none, { color: c.faint }]}>No note mentions it with #.</Text>
        )}

        <View style={styles.actions}>
          {invoice.status !== "paid" ? (
            <Pressable
              onPress={markPaid}
              disabled={offline || busy !== null}
              testID="invoice-mark-paid"
              accessibilityRole="button"
              style={[styles.primary, { backgroundColor: c.primary, opacity: offline || busy !== null ? 0.45 : 1 }]}
            >
              {busy === "paid" ? <ActivityIndicator color={c.onPrimary} /> : <CircleCheck size={18} color={c.onPrimary} />}
              <Text style={[styles.primaryText, { color: c.onPrimary }]}>Mark as paid</Text>
            </Pressable>
          ) : (
            <View style={[styles.paidNote, { backgroundColor: c.surface }]}>
              <CircleCheck size={16} color={INVOICE_STATUS_COLOR.paid} />
              <Text style={[styles.paidText, { color: c.ink }]}>Paid. Its status can be changed on the web.</Text>
            </View>
          )}
          {invoice.has_file ? (
            <Pressable
              onPress={share}
              disabled={offline || busy !== null}
              testID="invoice-share"
              accessibilityRole="button"
              style={[styles.secondary, { borderColor: c.line, opacity: offline || busy !== null ? 0.45 : 1 }]}
            >
              {busy === "share" ? <ActivityIndicator color={c.ink} /> : <Share2 size={17} color={c.ink} />}
              <Text style={[styles.secondaryText, { color: c.ink }]}>Share PDF</Text>
            </Pressable>
          ) : null}
          {offline ? (
            <View style={styles.offlineHint} testID="invoice-offline-hint">
              <CloudOff size={13} color={c.muted} />
              <Text style={[styles.hint, { color: c.muted }]}>Actions need a connection.</Text>
            </View>
          ) : null}
        </View>
      </ScrollView>
    </View>
  );

}

function Row({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  const c = usePalette();
  return (
    <View style={styles.row}>
      <Text numberOfLines={1} style={[styles.rowLabel, { color: strong ? c.ink : c.muted, fontFamily: strong ? font.semibold : font.regular }]}>
        {label}
      </Text>
      <Text style={[styles.rowValue, { color: c.ink, fontFamily: strong ? font.bold : font.medium }]}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  bar: { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 8, paddingBottom: 6 },
  iconBtn: { width: 40, height: 40, borderRadius: 10, alignItems: "center", justifyContent: "center" },
  barTitle: { flex: 1, fontFamily: font.semibold, fontSize: 17 },
  content: { paddingHorizontal: 16, gap: 12 },
  hero: { gap: 4, paddingHorizontal: 2, paddingBottom: 4 },
  heroLabel: { fontFamily: font.medium, fontSize: 12.5 },
  heroAmount: { fontFamily: font.bold, fontSize: 34, fontVariant: ["tabular-nums"] },
  heroMeta: { flexDirection: "row", alignItems: "center", gap: 7 },
  heroClient: { fontFamily: font.semibold, fontSize: 16 },
  pills: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 6, marginTop: 6 },
  pill: { flexDirection: "row", alignItems: "center", gap: 5, height: 22, paddingHorizontal: 9, borderRadius: 11 },
  pillText: { fontFamily: font.semibold, fontSize: 11.5 },
  month: { fontFamily: font.regular, fontSize: 12.5, marginLeft: 2 },
  dot: { width: 8, height: 8, borderRadius: 4 },
  card: { borderWidth: StyleSheet.hairlineWidth, borderRadius: 14, padding: 14, gap: 10 },
  row: { flexDirection: "row", alignItems: "center", gap: 12 },
  rowLabel: { flex: 1, fontSize: 14 },
  rowValue: { fontSize: 14, fontVariant: ["tabular-nums"] },
  rule: { height: StyleSheet.hairlineWidth },
  section: { fontFamily: font.semibold, fontSize: 12, textTransform: "uppercase", letterSpacing: 0.6 },
  sectionOut: { marginTop: 4, marginLeft: 2 },
  notes: { fontFamily: font.regular, fontSize: 14, lineHeight: 20 },
  fileRow: { flexDirection: "row", alignItems: "center" },
  fileText: { flex: 1, fontFamily: font.medium, fontSize: 14 },
  linked: { flexDirection: "row", alignItems: "center", gap: 10, borderWidth: StyleSheet.hairlineWidth, borderRadius: 12, paddingHorizontal: 12, height: 46 },
  linkedText: { flex: 1, fontFamily: font.medium, fontSize: 14 },
  none: { fontFamily: font.regular, fontSize: 13, marginLeft: 2 },
  actions: { gap: 10, marginTop: 10 },
  primary: { height: 50, borderRadius: 14, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8 },
  primaryText: { fontFamily: font.semibold, fontSize: 15.5 },
  secondary: { height: 48, borderRadius: 14, borderWidth: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8 },
  secondaryText: { fontFamily: font.semibold, fontSize: 15 },
  paidNote: { flexDirection: "row", alignItems: "center", gap: 8, padding: 12, borderRadius: 12 },
  paidText: { flex: 1, fontFamily: font.medium, fontSize: 13.5 },
  offlineHint: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6 },
  hint: { fontFamily: font.medium, fontSize: 12.5 },
});
