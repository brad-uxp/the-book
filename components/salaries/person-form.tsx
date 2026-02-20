"use client";

import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import type { PersonInput } from "@/lib/validations";
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

// Avoid z.default() — provide defaults via useForm defaultValues instead
const FormSchema = z.object({
  name: z.string().min(1, "Name is required"),
  payday_day: z.number().int().min(1).max(31),
  status: z.enum(["active", "inactive"]),
  notes: z.string().optional(),
  base_salary_dollars: z.string().min(1, "Salary is required"),
});

type FormValues = z.infer<typeof FormSchema>;

interface PersonFormProps {
  defaultValues?: Partial<PersonInput>;
  onSubmit: (data: PersonInput) => Promise<void>;
  onCancel: () => void;
  loading?: boolean;
}

export function PersonForm({
  defaultValues,
  onSubmit,
  onCancel,
  loading,
}: PersonFormProps) {
  const form = useForm<FormValues>({
    resolver: zodResolver(FormSchema),
    defaultValues: {
      name: defaultValues?.name ?? "",
      payday_day: defaultValues?.payday_day ?? 1,
      status: defaultValues?.status ?? "active",
      notes: defaultValues?.notes ?? "",
      base_salary_dollars: defaultValues?.base_salary_cents
        ? centsToDecimalString(defaultValues.base_salary_cents)
        : "",
    },
  });

  const handleSubmit = async (data: FormValues) => {
    await onSubmit({
      name: data.name,
      payday_day: data.payday_day,
      status: data.status,
      notes: data.notes || null,
      base_salary_cents: parseToCents(data.base_salary_dollars),
    });
  };

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(handleSubmit)} className="space-y-4">
        <FormField
          control={form.control}
          name="name"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Name</FormLabel>
              <FormControl>
                <Input placeholder="e.g. John Doe" {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <div className="grid grid-cols-2 gap-4">
          <FormField
            control={form.control}
            name="base_salary_dollars"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Base Salary (USD/month)</FormLabel>
                <FormControl>
                  <Input
                    type="number"
                    step="0.01"
                    min="0"
                    placeholder="0.00"
                    {...field}
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name="payday_day"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Pay Day (1–31)</FormLabel>
                <FormControl>
                  <Input
                    type="number"
                    min="1"
                    max="31"
                    {...field}
                    onChange={(e) => field.onChange(parseInt(e.target.value))}
                  />
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
                  <SelectItem value="active">Active</SelectItem>
                  <SelectItem value="inactive">Inactive</SelectItem>
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
                <Textarea placeholder="Any notes..." {...field} />
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
