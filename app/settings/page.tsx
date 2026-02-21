import { prisma } from "@/lib/db";
import { SettingsForm } from "@/components/settings/settings-form";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const settings = await prisma.settings.findUnique({ where: { id: "singleton" } });

  const initial = {
    email_recipient:          settings?.email_recipient ?? null,
    days_before_subscription: settings?.days_before_subscription ?? 2,
    days_before_salary:       settings?.days_before_salary ?? 4,
    days_before_invoice:      settings?.days_before_invoice ?? 0,
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Settings</h1>
        <p className="text-muted-foreground text-sm mt-1">
          Configuración de notificaciones y correo electrónico.
        </p>
      </div>
      <SettingsForm initial={initial} />
    </div>
  );
}
