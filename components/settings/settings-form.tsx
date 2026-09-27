"use client";

import { useState } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Loader2 } from "lucide-react";

interface FormFields {
  days_before_subscription: string;
  days_before_salary:       string;
  days_before_invoice:      string;
}

interface Props {
  initial: {
    days_before_subscription: number;
    days_before_salary:       number;
    days_before_invoice:      number;
  };
}

export function SettingsForm({ initial }: Props) {
  const [saving, setSaving] = useState(false);

  const {
    register,
    handleSubmit,
    formState: { errors },
    setError,
  } = useForm<FormFields>({
    defaultValues: {
      days_before_subscription: String(initial.days_before_subscription),
      days_before_salary:       String(initial.days_before_salary),
      days_before_invoice:      String(initial.days_before_invoice),
    },
  });

  const validateDays = (val: string, field: keyof FormFields, label: string): boolean => {
    const n = parseInt(val, 10);
    if (isNaN(n) || n < 0 || n > 30) {
      setError(field, { message: `${label}: a number from 0 to 30` });
      return false;
    }
    return true;
  };

  const validate = (values: FormFields): boolean => {
    let ok = true;
    if (!validateDays(values.days_before_subscription, "days_before_subscription", "Subscriptions")) ok = false;
    if (!validateDays(values.days_before_salary,       "days_before_salary",       "Salaries"))       ok = false;
    if (!validateDays(values.days_before_invoice,      "days_before_invoice",      "Invoices"))       ok = false;
    return ok;
  };

  const onSubmit = async (values: FormFields) => {
    if (!validate(values)) return;
    setSaving(true);
    try {
      const res = await fetch("/api/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          days_before_subscription: parseInt(values.days_before_subscription, 10),
          days_before_salary:       parseInt(values.days_before_salary, 10),
          days_before_invoice:      parseInt(values.days_before_invoice, 10),
        }),
      });
      if (!res.ok) throw new Error("Failed to save");
      toast.success("Settings saved");
    } catch {
      toast.error("Failed to save settings");
    } finally {
      setSaving(false);
    }
  };

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-8 max-w-lg">
      {/* Notification timing */}
      <div className="rounded-md border bg-card p-6 space-y-4">
        <div>
          <h2 className="text-sm font-semibold">Notification timing</h2>
          <p className="text-xs text-muted-foreground mt-0.5">
            How many days ahead to send each kind of alert.
          </p>
        </div>

        <div className="grid gap-4 sm:grid-cols-3">
          <div className="space-y-1.5">
            <Label htmlFor="days_before_subscription">Subscriptions</Label>
            <Input
              id="days_before_subscription"
              type="number"
              min={0}
              max={30}
              {...register("days_before_subscription")}
            />
            {errors.days_before_subscription && (
              <p className="text-xs text-destructive">
                {errors.days_before_subscription.message}
              </p>
            )}
            <p className="text-xs text-muted-foreground">days before</p>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="days_before_salary">Salaries</Label>
            <Input
              id="days_before_salary"
              type="number"
              min={0}
              max={30}
              {...register("days_before_salary")}
            />
            {errors.days_before_salary && (
              <p className="text-xs text-destructive">
                {errors.days_before_salary.message}
              </p>
            )}
            <p className="text-xs text-muted-foreground">days before · grouped</p>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="days_before_invoice">Invoices</Label>
            <Input
              id="days_before_invoice"
              type="number"
              min={0}
              max={30}
              {...register("days_before_invoice")}
            />
            {errors.days_before_invoice && (
              <p className="text-xs text-destructive">
                {errors.days_before_invoice.message}
              </p>
            )}
            <p className="text-xs text-muted-foreground">days before · 0 = same day</p>
          </div>
        </div>
      </div>

      <Button type="submit" disabled={saving}>
        {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
        Save changes
      </Button>
    </form>
  );
}
