import { useMemo } from "react";
import { StyleSheet, Text } from "react-native";
import { FileText, User } from "lucide-react-native";
import { formatCents } from "@shared/currency";
import { formatInvoiceLabel } from "@shared/mentions";
import { Sheet, SheetOption } from "@/components/Sheet";
import type { MentionInvoice, MentionPerson } from "@/editor/RichTextEditor";
import { font, usePalette } from "@/lib/theme";
import { useInvoices, usePeople, type InvoiceRef, type PersonRef } from "@/notes/hooks";

/**
 * People and invoices as the editor offers them for @ and # — from the last
 * sync, so it works offline. An invoice's label is the web's, from the same
 * function.
 */
export function useMentionRefs() {
  const people = usePeople();
  const invoices = useInvoices();
  const mentionPeople = useMemo<MentionPerson[]>(
    () => people.map((p) => ({ id: p.id, name: p.name, role: p.role, active: p.status === "active" })),
    [people]
  );
  const mentionInvoices = useMemo<MentionInvoice[]>(
    () =>
      invoices.map((i) => ({
        id: i.id,
        label: formatInvoiceLabel({ invoice_number: i.invoice_number, client: { name: i.client_name }, amount_cents: i.amount_cents }),
        status: i.status,
      })),
    [invoices]
  );
  return { people, invoices, mentionPeople, mentionInvoices };
}

/**
 * What a tapped @ or # is. People and invoices have no screens on the phone
 * yet (invoices arrive in phase 4), so this says who or which it is, from
 * what the last sync brought.
 */
export function MentionSheet({
  mention,
  people,
  invoices,
  onClose,
}: {
  mention: { kind: "person" | "invoice"; id: string } | null;
  people: PersonRef[];
  invoices: InvoiceRef[];
  onClose: () => void;
}) {
  const c = usePalette();
  const person = mention?.kind === "person" ? people.find((p) => p.id === mention.id) : undefined;
  const invoice = mention?.kind === "invoice" ? invoices.find((i) => i.id === mention.id) : undefined;
  const title = person ? person.name : invoice ? `Invoice ${invoice.invoice_number ?? "without number"}` : mention?.kind === "invoice" ? "Invoice" : "Person";
  return (
    <Sheet visible={mention !== null} title={title} onClose={onClose}>
      {person ? (
        <SheetOption
          testID="mention-person"
          icon={<User size={18} color={c.ink} />}
          label={person.role ?? "No role"}
          detail={person.status === "active" ? "Active · salaries and people are on the web" : "No longer active"}
          onPress={onClose}
        />
      ) : invoice ? (
        <SheetOption
          testID="mention-invoice"
          icon={<FileText size={18} color={c.ink} />}
          label={`${invoice.client_name} · ${formatCents(invoice.amount_cents)}`}
          detail={`${invoice.status.charAt(0).toUpperCase()}${invoice.status.slice(1).replace("_", " ")} · invoices arrive on the phone in phase 4`}
          onPress={onClose}
        />
      ) : (
        <Text testID="mention-missing" style={[styles.missing, { color: c.muted }]}>
          Not on this phone. It may have been deleted — or it is new and the next sync brings it.
        </Text>
      )}
    </Sheet>
  );
}

const styles = StyleSheet.create({
  missing: { fontFamily: font.regular, fontSize: 12.5, margin: 10 },
});
