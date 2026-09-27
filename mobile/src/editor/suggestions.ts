/**
 * What the @ and # lists offer for what has been typed after the trigger —
 * the web's rules (components/rich-text/mention-list.tsx and
 * invoice-mention-list.tsx). Pure, so it runs under `node --test`.
 */

export interface MentionPerson {
  id: string;
  name: string;
  role?: string | null;
  /** Inactive people are never offered, but their existing mentions stay live. */
  active: boolean;
}

export interface MentionInvoice {
  id: string;
  /**
   * The label a mention of it carries — formatInvoiceLabel from
   * @shared/mentions, exactly, or opening a note would rewrite its chips.
   */
  label: string;
  status: string;
}

/** As many as the web's lists show. */
export const SUGGESTION_LIMIT = 8;

/** Active people whose name or role contains the query. */
export function matchPeople(people: readonly MentionPerson[], query: string): MentionPerson[] {
  const active = people.filter((p) => p.active);
  const q = query.toLowerCase();
  const found = q
    ? active.filter((p) => p.name.toLowerCase().includes(q) || (p.role ?? "").toLowerCase().includes(q))
    : active;
  return found.slice(0, SUGGESTION_LIMIT);
}

/** Invoices whose label — number, client and amount — contains the query. */
export function matchInvoices(invoices: readonly MentionInvoice[], query: string): MentionInvoice[] {
  const q = query.toLowerCase();
  const found = q ? invoices.filter((i) => i.label.toLowerCase().includes(q)) : invoices;
  return found.slice(0, SUGGESTION_LIMIT);
}
