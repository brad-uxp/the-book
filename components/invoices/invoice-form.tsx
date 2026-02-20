"use client";

import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import type { InvoiceInput } from "@/lib/validations";
import { parseToCents, centsToDecimalString } from "@/lib/currency";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";

interface Client {
  id: string;
  name: string;
}

// UI form schema — all string fields for form inputs
const FormSchema = z.object({
  invoice_number: z.string().optional(),
  client_id: z.string().min(1, "Client is required"),
  amount_dollars: z.string().min(1, "Amount is required"),
  fee_dollars: z.string(),
  status: z.enum(["pending", "accounting", "sent", "paid"]),
  due_date: z.string().min(1, "Due date is required"),
  reminder_date: z.string().optional(),
  notes: z.string().optional(),
});

type FormValues = z.infer<typeof FormSchema>;

interface InvoiceFormProps {
  clients: Client[];
  defaultValues?: Partial<InvoiceInput>;
  onSubmit: (data: InvoiceInput) => Promise<void>;
  onCancel: () => void;
  loading?: boolean;
}

export function InvoiceForm({
  clients,
  defaultValues,
  onSubmit,
  onCancel,
  loading,
}: InvoiceFormProps) {
  const form = useForm<FormValues>({
    resolver: zodResolver(FormSchema),
    defaultValues: {
      invoice_number: defaultValues?.invoice_number ?? "",
      client_id: defaultValues?.client_id ?? "",
      amount_dollars: defaultValues?.amount_cents
        ? centsToDecimalString(defaultValues.amount_cents)
        : "",
      fee_dollars: defaultValues?.fee_cents
        ? centsToDecimalString(defaultValues.fee_cents)
        : "0",
      status: defaultValues?.status ?? "pending",
      due_date: defaultValues?.due_date
        ? new Date(defaultValues.due_date).toISOString().slice(0, 10)
        : "",
      reminder_date: defaultValues?.reminder_date
        ? new Date(defaultValues.reminder_date).toISOString().slice(0, 10)
        : "",
      notes: defaultValues?.notes ?? "",
    },
  });

  const handleSubmit = async (data: FormValues) => {
    await onSubmit({
      invoice_number: data.invoice_number || null,
      client_id: data.client_id,
      amount_cents: parseToCents(data.amount_dollars),
      fee_cents: parseToCents(data.fee_dollars || "0"),
      status: data.status,
      due_date: data.due_date,
      reminder_date: data.reminder_date || null,
      notes: data.notes || null,
    });
  };

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(handleSubmit)} className="space-y-4">
        <div className="grid grid-cols-2 gap-4">
          <FormField
            control={form.control}
            name="client_id"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Client</FormLabel>
                <Select onValueChange={field.onChange} defaultValue={field.value}>
                  <FormControl>
                    <SelectTrigger>
                      <SelectValue placeholder="Select client" />
                    </SelectTrigger>
                  </FormControl>
                  <SelectContent>
                    {clients.map((c) => (
                      <SelectItem key={c.id} value={c.id}>
                        {c.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <FormMessage />
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name="invoice_number"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Invoice # (optional)</FormLabel>
                <FormControl>
                  <Input placeholder="INV-001" {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        </div>

        <div className="grid grid-cols-2 gap-4">
          <FormField
            control={form.control}
            name="amount_dollars"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Amount (USD)</FormLabel>
                <FormControl>
                  <Input type="number" step="0.01" min="0" placeholder="0.00" {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name="fee_dollars"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Fee (USD, can be negative)</FormLabel>
                <FormControl>
                  <Input type="number" step="0.01" placeholder="0.00" {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        </div>

        <div className="grid grid-cols-2 gap-4">
          <FormField
            control={form.control}
            name="due_date"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Due Date</FormLabel>
                <FormControl>
                  <Input type="date" {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name="reminder_date"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Reminder Date (optional)</FormLabel>
                <FormControl>
                  <Input type="date" {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        </div>

        <FormField
          control={form.control}
          name="status"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Status</FormLabel>
              <Select onValueChange={field.onChange} defaultValue={field.value}>
                <FormControl>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                </FormControl>
                <SelectContent>
                  <SelectItem value="pending">Pending</SelectItem>
                  <SelectItem value="accounting">Accounting</SelectItem>
                  <SelectItem value="sent">Sent</SelectItem>
                  <SelectItem value="paid">Paid</SelectItem>
                </SelectContent>
              </Select>
              <FormMessage />
            </FormItem>
          )}
        />

        <FormField
          control={form.control}
          name="notes"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Notes (optional)</FormLabel>
              <FormControl>
                <Textarea placeholder="Additional notes..." {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="outline" onClick={onCancel}>
            Cancel
          </Button>
          <Button type="submit" disabled={loading}>
            {loading ? "Saving..." : "Save"}
          </Button>
        </div>
      </form>
    </Form>
  );
}
