import { memo } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { formatCents } from "@shared/currency";
import { INVOICE_STATUS_COLOR, INVOICE_STATUS_LABEL, type InvoiceItem } from "@/business/invoices";
import { dayLabel } from "@/lib/format";
import { font, usePalette } from "@/lib/theme";

/**
 * One invoice in the list: whose it is, what it brings in (net: amount plus
 * the referrer's fee), its number, when it is due and where it stands.
 */
export const InvoiceCard = memo(function InvoiceCard({
  invoice,
  pastDue,
  now,
  onPress,
}: {
  invoice: InvoiceItem;
  pastDue: boolean;
  now: Date;
  onPress: (invoice: InvoiceItem) => void;
}) {
  const c = usePalette();
  return (
    <Pressable
      onPress={() => onPress(invoice)}
      accessibilityRole="button"
      testID={`invoice-card-${invoice.id}`}
      style={({ pressed }) => [styles.card, { backgroundColor: pressed ? c.surface : c.raised, borderColor: c.line }]}
    >
      <View style={[styles.stripe, { backgroundColor: invoice.client.color_hex }]} />
      <View style={styles.body}>
        <View style={styles.top}>
          <Text numberOfLines={1} style={[styles.client, { color: c.ink }]}>
            {invoice.client.name}
          </Text>
          <Text style={[styles.amount, { color: c.ink }]}>{formatCents(invoice.net_cents)}</Text>
        </View>
        <View style={styles.meta}>
          <Text style={[styles.metaText, { color: c.muted }]}>
            {invoice.invoice_number ? `#${invoice.invoice_number}` : "No number"} · Due {dayLabel(invoice.due_date, now)}
          </Text>
          <View style={styles.pills}>
            {pastDue ? (
              <View style={[styles.pill, { backgroundColor: c.surface }]}>
                <Text style={[styles.pillText, { color: c.overdue }]}>Past due</Text>
              </View>
            ) : null}
            <View style={[styles.pill, { backgroundColor: c.surface }]}>
              <View style={[styles.dot, { backgroundColor: INVOICE_STATUS_COLOR[invoice.status] }]} />
              <Text style={[styles.pillText, { color: c.ink }]}>{INVOICE_STATUS_LABEL[invoice.status]}</Text>
            </View>
          </View>
        </View>
      </View>
    </Pressable>
  );
});

const styles = StyleSheet.create({
  card: { flexDirection: "row", borderRadius: 14, borderWidth: StyleSheet.hairlineWidth, overflow: "hidden" },
  stripe: { width: 4 },
  body: { flex: 1, paddingVertical: 12, paddingHorizontal: 12, gap: 6 },
  top: { flexDirection: "row", alignItems: "center", gap: 10 },
  client: { flex: 1, fontFamily: font.semibold, fontSize: 15 },
  amount: { fontFamily: font.bold, fontSize: 15, fontVariant: ["tabular-nums"] },
  meta: { flexDirection: "row", alignItems: "center", gap: 8 },
  metaText: { flex: 1, fontFamily: font.regular, fontSize: 12.5 },
  pills: { flexDirection: "row", gap: 6 },
  pill: { flexDirection: "row", alignItems: "center", gap: 5, height: 20, paddingHorizontal: 8, borderRadius: 10 },
  pillText: { fontFamily: font.semibold, fontSize: 11 },
  dot: { width: 7, height: 7, borderRadius: 4 },
});
