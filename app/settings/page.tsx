import { prisma } from "@/lib/db";
import { SettingsForm } from "@/components/settings/settings-form";
import { ApiTokens } from "@/components/settings/api-tokens";
import { CorporateExclusions } from "@/components/settings/corporate-exclusions";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const [settings, clients] = await Promise.all([
    prisma.settings.findUnique({ where: { id: "singleton" } }),
    prisma.client.findMany({
      orderBy: { name: "asc" },
      select: { id: true, name: true, color_hex: true },
    }),
  ]);

  const initial = {
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
      <CorporateExclusions
        clients={clients}
        initial={settings?.corporate_excluded_client_ids ?? []}
      />
      <ApiTokens />
    </div>
  );
}
