"use client";

import { useState } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Bell, Loader2 } from "lucide-react";

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
  const [testingPush, setTestingPush] = useState(false);

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
      setError(field, { message: `${label}: número entre 0 y 30` });
      return false;
    }
    return true;
  };

  const validate = (values: FormFields): boolean => {
    let ok = true;
    if (!validateDays(values.days_before_subscription, "days_before_subscription", "Subscripciones")) ok = false;
    if (!validateDays(values.days_before_salary,       "days_before_salary",       "Salarios"))       ok = false;
    if (!validateDays(values.days_before_invoice,      "days_before_invoice",      "Facturas"))       ok = false;
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

  const sendTestPush = async () => {
    setTestingPush(true);
    try {
      const res = await fetch("/api/settings/test-push", { method: "POST" });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error ?? "Failed to send");
      }
      toast.success("Push enviada — revisa tus notificaciones");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to send test push");
    } finally {
      setTestingPush(false);
    }
  };

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-8 max-w-lg">
      {/* Push Notifications */}
      <div className="rounded-md border bg-card p-6 space-y-4">
        <div>
          <h2 className="text-sm font-semibold">Notificaciones push</h2>
          <p className="text-xs text-muted-foreground mt-0.5">
            Envía una notificación push de prueba a todos los dispositivos registrados.
          </p>
        </div>

        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={sendTestPush}
          disabled={testingPush}
        >
          {testingPush ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Bell className="h-4 w-4" />
          )}
          <span className="ml-1.5">Enviar push de prueba</span>
        </Button>
      </div>

      {/* Notification timing */}
      <div className="rounded-md border bg-card p-6 space-y-4">
        <div>
          <h2 className="text-sm font-semibold">Anticipación de notificaciones</h2>
          <p className="text-xs text-muted-foreground mt-0.5">
            Con cuántos días de anticipación enviar cada tipo de alerta.
          </p>
        </div>

        <div className="grid gap-4 sm:grid-cols-3">
          <div className="space-y-1.5">
            <Label htmlFor="days_before_subscription">Subscripciones</Label>
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
            <p className="text-xs text-muted-foreground">días antes</p>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="days_before_salary">Salarios</Label>
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
            <p className="text-xs text-muted-foreground">días antes · agrupados</p>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="days_before_invoice">Facturas</Label>
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
            <p className="text-xs text-muted-foreground">días antes · 0 = hoy</p>
          </div>
        </div>
      </div>

      <Button type="submit" disabled={saving}>
        {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
        Guardar cambios
      </Button>
    </form>
  );
}
