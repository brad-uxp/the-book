import { useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { DateTimePickerAndroid } from "@react-native-community/datetimepicker";
import { Calendar } from "lucide-react-native";
import { formatCents, parseToCents } from "@shared/currency";
import type { PersonItem } from "@/business/salaries";
import { Sheet } from "@/components/Sheet";
import { dayLabel, monthTitle } from "@/lib/format";
import { font, usePalette } from "@/lib/theme";

export interface PaymentInput {
  /** YYYY-MM-DD. */
  paid_at: string;
  adjustment_cents: number;
  adjustment_note: string | null;
}

function toYmd(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function fromYmd(ymd: string): Date {
  const [y, m, d] = ymd.split("-").map(Number);
  return new Date(y, m - 1, d);
}

/**
 * Registers one salary payment — the web's dialog: the day it was paid, an
 * adjustment on top of the base (a bonus, or a deduction), and a note. The
 * server files it under the month of that day, which the sheet says.
 *
 * Mount it with a `key` per person: each person gets a fresh form.
 */
export function RegisterPaymentSheet({
  person,
  defaultDate,
  onClose,
  onSave,
}: {
  person: PersonItem | null;
  defaultDate: string;
  onClose: () => void;
  onSave: (person: PersonItem, input: PaymentInput) => Promise<void>;
}) {
  const c = usePalette();
  const [date, setDate] = useState(defaultDate);
  const [amount, setAmount] = useState("");
  const [negative, setNegative] = useState(false);
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!person) return <Sheet visible={false} title="" onClose={onClose}>{null}</Sheet>;

  // The sign is the toggle's; a typed minus does not flip it back.
  const adjustment = (negative ? -1 : 1) * Math.abs(parseToCents(amount || "0"));
  const total = person.base_salary_cents + adjustment;

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      await onSave(person, { paid_at: date, adjustment_cents: adjustment, adjustment_note: note.trim() || null });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setSaving(false);
    }
  };

  return (
    <Sheet visible title={`Pay ${person.name}`} onClose={onClose}>
      <View style={styles.form}>
        <Pressable
          style={[styles.field, { borderColor: c.line }]}
          testID="payment-date"
          onPress={() =>
            DateTimePickerAndroid.open({
              value: fromYmd(date),
              mode: "date",
              onChange: (event, picked) => {
                if (event.type === "set" && picked) setDate(toYmd(picked));
              },
            })
          }
        >
          <Calendar size={16} color={c.muted} />
          <Text style={[styles.fieldLabel, { color: c.muted }]}>Paid on</Text>
          <Text style={[styles.fieldValue, { color: c.ink }]}>{dayLabel(date, new Date())}</Text>
        </Pressable>
        <Text style={[styles.help, { color: c.muted }]}>Counts as {monthTitle(date.slice(0, 7))}&apos;s salary.</Text>

        <View style={[styles.field, { borderColor: c.line }]}>
          <Text style={[styles.fieldLabel, { color: c.muted }]}>Adjustment</Text>
          <Pressable
            onPress={() => setNegative((n) => !n)}
            testID="payment-sign"
            accessibilityLabel={negative ? "Deduction — tap for a bonus" : "Bonus — tap for a deduction"}
            style={[styles.sign, { backgroundColor: c.surface }]}
          >
            <Text style={[styles.signText, { color: negative ? c.danger : c.ink }]}>{negative ? "−" : "+"}</Text>
          </Pressable>
          <TextInput
            testID="payment-adjustment"
            value={amount}
            onChangeText={setAmount}
            placeholder="0.00"
            placeholderTextColor={c.faint}
            keyboardType="decimal-pad"
            style={[styles.input, { color: c.ink }]}
          />
        </View>

        <View style={[styles.field, { borderColor: c.line }]}>
          <TextInput
            testID="payment-note"
            value={note}
            onChangeText={setNote}
            placeholder="Note (optional)"
            placeholderTextColor={c.faint}
            style={[styles.input, styles.note, { color: c.ink }]}
            maxLength={500}
          />
        </View>

        <View style={styles.totalRow}>
          <Text style={[styles.totalLabel, { color: c.muted }]}>
            Base {formatCents(person.base_salary_cents)}
            {adjustment !== 0 ? ` ${adjustment > 0 ? "+" : "−"} ${formatCents(Math.abs(adjustment))}` : ""}
          </Text>
          <Text style={[styles.total, { color: c.ink }]} testID="payment-total">
            {formatCents(total)}
          </Text>
        </View>

        {error ? (
          <Text style={[styles.error, { color: c.danger }]} testID="payment-error">
            {error}
          </Text>
        ) : null}

        <Pressable
          onPress={save}
          disabled={saving}
          testID="payment-save"
          accessibilityRole="button"
          style={[styles.save, { backgroundColor: c.primary, opacity: saving ? 0.6 : 1 }]}
        >
          {saving ? <ActivityIndicator color={c.onPrimary} /> : null}
          <Text style={[styles.saveText, { color: c.onPrimary }]}>Register payment</Text>
        </Pressable>
      </View>
    </Sheet>
  );
}

const styles = StyleSheet.create({
  form: { gap: 10, paddingHorizontal: 6, paddingBottom: 4 },
  field: { flexDirection: "row", alignItems: "center", gap: 10, height: 50, borderWidth: 1, borderRadius: 12, paddingHorizontal: 12 },
  fieldLabel: { fontFamily: font.medium, fontSize: 14 },
  fieldValue: { flex: 1, textAlign: "right", fontFamily: font.semibold, fontSize: 15 },
  help: { fontFamily: font.regular, fontSize: 12.5, marginTop: -4, marginLeft: 4 },
  sign: { width: 34, height: 30, borderRadius: 8, alignItems: "center", justifyContent: "center", marginLeft: "auto" },
  signText: { fontFamily: font.bold, fontSize: 18 },
  input: { flex: 1, fontFamily: font.semibold, fontSize: 15, textAlign: "right", paddingVertical: 0 },
  note: { textAlign: "left", fontFamily: font.regular },
  totalRow: { flexDirection: "row", alignItems: "baseline", gap: 10, paddingHorizontal: 4, marginTop: 2 },
  totalLabel: { flex: 1, fontFamily: font.regular, fontSize: 13 },
  total: { fontFamily: font.bold, fontSize: 20, fontVariant: ["tabular-nums"] },
  error: { fontFamily: font.medium, fontSize: 13, paddingHorizontal: 4 },
  save: { height: 50, borderRadius: 14, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, marginTop: 4 },
  saveText: { fontFamily: font.semibold, fontSize: 15.5 },
});
