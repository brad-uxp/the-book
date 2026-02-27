"use client";

import { useState, useEffect } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import type { InvoiceInput } from "@/lib/validations";
import { parseToCents, centsToDecimalString } from "@/lib/currency";
import { cn } from "@/lib/utils";
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
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Check, ChevronsUpDown, Trash2 } from "lucide-react";

interface Client {
  id: string;
  name: string;
  default_referrer_id?: string | null;
}

interface Referrer {
  id: string;
  name: string;
  color_hex: string;
}

// UI form schema — all string fields for form inputs
const FormSchema = z.object({
  invoice_number: z.string().optional(),
  client_id: z.string().min(1, "Client is required"),
  referrer_id: z.string().optional(),
  amount_dollars: z.string().min(1, "Amount is required"),
  fee_dollars: z.string(),
  status: z.enum(["pending", "accounting", "sent", "paid"]),
  due_date: z.string().min(1, "Due date is required"),
  reminder_date: z.string().optional(),
  notes: z.string().optional(),
  file_url: z.string().optional(),
});

type FormValues = z.infer<typeof FormSchema>;

interface InvoiceFormProps {
  clients: Client[];
  referrers: Referrer[];
  defaultValues?: Partial<InvoiceInput>;
  onSubmit: (data: InvoiceInput) => Promise<void>;
  onCancel: () => void;
  onDelete?: () => Promise<void>;
  loading?: boolean;
}

export function InvoiceForm({
  clients,
  referrers,
  defaultValues,
  onSubmit,
  onCancel,
  onDelete,
  loading,
}: InvoiceFormProps) {
  const [clientOpen, setClientOpen] = useState(false);
  const [referrerOpen, setReferrerOpen] = useState(false);

  const form = useForm<FormValues>({
    resolver: zodResolver(FormSchema),
    defaultValues: {
      invoice_number: defaultValues?.invoice_number ?? "",
      client_id: defaultValues?.client_id ?? "",
      referrer_id: defaultValues?.referrer_id ?? "",
      amount_dollars: defaultValues?.amount_cents != null
        ? centsToDecimalString(defaultValues.amount_cents)
        : "",
      fee_dollars: defaultValues?.fee_cents != null
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
      file_url: defaultValues?.file_url ?? "",
    },
  });

  // Auto-select referrer when client changes (only if referrer is currently empty)
  const watchedClientId = form.watch("client_id");
  useEffect(() => {
    if (!watchedClientId) return;
    const client = clients.find((c) => c.id === watchedClientId);
    if (!client?.default_referrer_id) return;
    const currentReferrer = form.getValues("referrer_id");
    if (!currentReferrer) {
      form.setValue("referrer_id", client.default_referrer_id);
    }
  }, [watchedClientId, clients, form]);

  const handleSubmit = async (data: FormValues) => {
    await onSubmit({
      invoice_number: data.invoice_number || null,
      client_id: data.client_id,
      referrer_id: data.referrer_id || null,
      amount_cents: parseToCents(data.amount_dollars),
      fee_cents: parseToCents(data.fee_dollars || "0"),
      status: data.status,
      due_date: data.due_date,
      reminder_date: data.reminder_date || null,
      notes: data.notes || null,
      file_url: data.file_url || null,
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
              <FormItem className="flex flex-col">
                <FormLabel>Client</FormLabel>
                <Popover open={clientOpen} onOpenChange={setClientOpen}>
                  <PopoverTrigger asChild>
                    <FormControl>
                      <Button
                        variant="outline"
                        role="combobox"
                        className={cn(
                          "w-full justify-between font-normal",
                          !field.value && "text-muted-foreground"
                        )}
                      >
                        {field.value
                          ? clients.find((c) => c.id === field.value)?.name
                          : "Select client"}
                        <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                      </Button>
                    </FormControl>
                  </PopoverTrigger>
                  <PopoverContent className="p-0" align="start">
                    <Command>
                      <CommandInput placeholder="Search client..." />
                      <CommandList>
                        <CommandEmpty>No client found.</CommandEmpty>
                        <CommandGroup>
                          {clients.map((c) => (
                            <CommandItem
                              key={c.id}
                              value={c.name}
                              onSelect={() => {
                                field.onChange(c.id);
                                setClientOpen(false);
                              }}
                            >
                              <Check
                                className={cn(
                                  "mr-2 h-4 w-4",
                                  c.id === field.value ? "opacity-100" : "opacity-0"
                                )}
                              />
                              {c.name}
                            </CommandItem>
                          ))}
                        </CommandGroup>
                      </CommandList>
                    </Command>
                  </PopoverContent>
                </Popover>
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

        <FormField
          control={form.control}
          name="referrer_id"
          render={({ field }) => (
            <FormItem className="flex flex-col">
              <FormLabel>Referrer (optional)</FormLabel>
              <Popover open={referrerOpen} onOpenChange={setReferrerOpen}>
                <PopoverTrigger asChild>
                  <FormControl>
                    <Button
                      variant="outline"
                      role="combobox"
                      className={cn(
                        "w-full justify-between font-normal",
                        !field.value && "text-muted-foreground"
                      )}
                    >
                      {field.value
                        ? referrers.find((r) => r.id === field.value)?.name
                        : "No referrer"}
                      <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                    </Button>
                  </FormControl>
                </PopoverTrigger>
                <PopoverContent className="p-0" align="start">
                  <Command>
                    <CommandInput placeholder="Search referrer..." />
                    <CommandList>
                      <CommandEmpty>No referrer found.</CommandEmpty>
                      <CommandGroup>
                        <CommandItem
                          value="__none__"
                          onSelect={() => {
                            field.onChange("");
                            setReferrerOpen(false);
                          }}
                        >
                          <Check
                            className={cn(
                              "mr-2 h-4 w-4",
                              !field.value ? "opacity-100" : "opacity-0"
                            )}
                          />
                          <span className="text-muted-foreground">None</span>
                        </CommandItem>
                        {referrers.map((r) => (
                          <CommandItem
                            key={r.id}
                            value={r.name}
                            onSelect={() => {
                              field.onChange(r.id);
                              setReferrerOpen(false);
                            }}
                          >
                            <Check
                              className={cn(
                                "mr-2 h-4 w-4",
                                r.id === field.value ? "opacity-100" : "opacity-0"
                              )}
                            />
                            <span
                              className="mr-2 inline-block h-2.5 w-2.5 rounded-full shrink-0"
                              style={{ backgroundColor: r.color_hex }}
                            />
                            {r.name}
                          </CommandItem>
                        ))}
                      </CommandGroup>
                    </CommandList>
                  </Command>
                </PopoverContent>
              </Popover>
              <FormMessage />
            </FormItem>
          )}
        />

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

        <FormField
          control={form.control}
          name="file_url"
          render={({ field }) => (
            <FormItem>
              <FormLabel>File link (optional)</FormLabel>
              <FormControl>
                <Input type="url" placeholder="https://..." {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <div className="flex items-center justify-between pt-2">
          {onDelete ? (
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button type="button" variant="ghost" size="sm" className="text-destructive hover:text-destructive hover:bg-destructive/10" disabled={loading}>
                  <Trash2 className="mr-2 h-4 w-4" />
                  Delete
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Delete invoice?</AlertDialogTitle>
                  <AlertDialogDescription>
                    This will permanently delete the invoice. This action cannot be undone.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                  <AlertDialogAction
                    className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                    onClick={onDelete}
                  >
                    Delete
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          ) : (
            <span />
          )}
          <div className="flex gap-2">
            <Button type="button" variant="outline" onClick={onCancel}>
              Cancel
            </Button>
            <Button type="submit" disabled={loading}>
              {loading ? "Saving..." : "Save"}
            </Button>
          </div>
        </div>
      </form>
    </Form>
  );
}
