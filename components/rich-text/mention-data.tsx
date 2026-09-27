"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { InvoiceForm } from "@/components/invoices/invoice-form";
import type { InvoiceInput } from "@/lib/validations";
import type { MentionPerson } from "./mention-list";
import { formatInvoiceLabel, type MentionInvoice } from "./invoice-mention-list";

type InsertMention = (attrs: { id: string; label: string }) => void;

interface MentionData {
  people: MentionPerson[];
  peopleFetched: boolean;
  /** Read by suggestion callbacks, which are built once per editor. */
  peopleRef: RefObject<MentionPerson[]>;
  invoices: MentionInvoice[];
  invoicesFetched: boolean;
  invoicesRef: RefObject<MentionInvoice[]>;
  /**
   * Opens the "new invoice" dialog. When the invoice is saved, `insert` puts a
   * mention of it where the `#` was typed.
   */
  requestCreateInvoice: (insert: InsertMention) => void;
}

const MentionDataContext = createContext<MentionData | null>(null);

export function useMentionData(): MentionData {
  const ctx = useContext(MentionDataContext);
  if (!ctx) {
    throw new Error("useMentionData must be used inside <MentionDataProvider>");
  }
  return ctx;
}

/** `default_referrer_id` pre-fills the referrer on the new-invoice form. */
type Client = {
  id: string;
  name: string;
  color_hex: string;
  default_referrer_id?: string | null;
};

/**
 * People and invoices for @ and # mentions, fetched once for every editor
 * underneath.
 *
 * A canvas can hold dozens of editors — one per idea — and each one fetching
 * its own lists would put dozens of identical requests on the wire. The
 * "new invoice" dialog lives here for the same reason: one per page, not one
 * per editor.
 */
export function MentionDataProvider({
  clients,
  children,
}: {
  clients: Client[];
  children: ReactNode;
}) {
  const [people, setPeople] = useState<MentionPerson[]>([]);
  const [peopleFetched, setPeopleFetched] = useState(false);
  const peopleRef = useRef<MentionPerson[]>([]);

  useEffect(() => {
    fetch("/api/people")
      .then((r) => r.json())
      .then(
        (
          data: Array<{
            id: string;
            name: string;
            status: string;
            role: { id: string; name: string } | null;
          }>
        ) => {
          const mapped: MentionPerson[] = data.map((p) => ({
            id: p.id,
            name: p.name,
            role: p.role,
            status: p.status as "active" | "inactive",
          }));
          setPeople(mapped);
          peopleRef.current = mapped;
          setPeopleFetched(true);
        }
      )
      .catch(console.error);
  }, []);

  const [invoices, setInvoices] = useState<MentionInvoice[]>([]);
  const [invoicesFetched, setInvoicesFetched] = useState(false);
  const invoicesRef = useRef<MentionInvoice[]>([]);

  const fetchInvoices = useCallback(() => {
    fetch("/api/invoices")
      .then((r) => r.json())
      .then((data: MentionInvoice[]) => {
        setInvoices(data);
        invoicesRef.current = data;
        setInvoicesFetched(true);
      })
      .catch(console.error);
  }, []);

  useEffect(() => {
    fetchInvoices();
  }, [fetchInvoices]);

  // "Create new invoice" from a # suggestion
  const [createOpen, setCreateOpen] = useState(false);
  const [createLoading, setCreateLoading] = useState(false);
  const [referrers, setReferrers] = useState<
    Array<{ id: string; name: string; color_hex: string }>
  >([]);
  const pendingInsertRef = useRef<InsertMention | null>(null);

  const requestCreateInvoice = useCallback((insert: InsertMention) => {
    pendingInsertRef.current = insert;
    fetch("/api/referrers")
      .then((r) => r.json())
      .then(setReferrers)
      .catch(() => {});
    setCreateOpen(true);
  }, []);

  const handleCreateSubmit = async (input: InvoiceInput) => {
    setCreateLoading(true);
    try {
      const res = await fetch("/api/invoices", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      });
      if (!res.ok) {
        const err = await res.json();
        alert(err.error ?? "Error creating invoice");
        return;
      }
      const created = await res.json();
      pendingInsertRef.current?.({
        id: created.id,
        label: formatInvoiceLabel(created),
      });
      pendingInsertRef.current = null;
      fetchInvoices();
      setCreateOpen(false);
    } finally {
      setCreateLoading(false);
    }
  };

  const value = useMemo<MentionData>(
    () => ({
      people,
      peopleFetched,
      peopleRef,
      invoices,
      invoicesFetched,
      invoicesRef,
      requestCreateInvoice,
    }),
    [people, peopleFetched, invoices, invoicesFetched, requestCreateInvoice]
  );

  return (
    <MentionDataContext.Provider value={value}>
      {children}

      {/* A portal of its own, opened after whatever holds the editor — so it
          stacks above a sheet as well as above a canvas. */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>New Invoice</DialogTitle>
          </DialogHeader>
          <InvoiceForm
            clients={clients}
            referrers={referrers}
            onSubmit={handleCreateSubmit}
            onCancel={() => {
              setCreateOpen(false);
              pendingInsertRef.current = null;
            }}
            loading={createLoading}
          />
        </DialogContent>
      </Dialog>
    </MentionDataContext.Provider>
  );
}
