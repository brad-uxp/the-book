import Image from "next/image";
import { redirect } from "next/navigation";
import { AlertTriangle, Check } from "lucide-react";
import { auth, isAllowedSession } from "@/auth";
import { Button } from "@/components/ui/button";
import { checkAuthorizeRequest } from "@/lib/oauth-service";
import { AUTHORIZE_PATH } from "@/lib/oauth";
import { decide } from "./actions";
import { AllowButton } from "./allow-button";
import { AUTHORIZE_PARAMS } from "./params";

export const metadata = { title: "Connect to book" };
export const dynamic = "force-dynamic";

/** What an MCP connection may do, in the owner's words (lib/issues-service.ts holds it to this). */
const CAN = [
  "Read your tasks: their description and its own note. Not your notes, finances or settings.",
  "Write its note on a task, its log and the task's progress.",
  "Move a task to In Progress, Review or Blocked. Never to Done, and it cannot create or delete anything.",
];

/**
 * The consent screen of theBook's OAuth (lib/oauth-service.ts): an app — one
 * of Claude's — asks to connect to the MCP, and the owner allows it or not.
 * Behind the session (proxy.ts sends a signed-out owner to /login and back).
 * Drawn over the app's shell, since it opens in a popup from Claude.
 */
export default async function AuthorizePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const raw = await searchParams;
  const params: Record<string, string | undefined> = {};
  let repeated = false;
  for (const key of AUTHORIZE_PARAMS) {
    const value = raw[key];
    if (Array.isArray(value)) repeated = true;
    else params[key] = value;
  }

  if (!isAllowedSession(await auth())) {
    const query = new URLSearchParams(params as Record<string, string>).toString();
    redirect(`/login?callbackUrl=${encodeURIComponent(`${AUTHORIZE_PATH}?${query}`)}`);
  }

  // A parameter given twice is refused before anything else (RFC 6749 §3.1).
  const check = repeated
    ? ({ ok: false, description: "A parameter was given more than once.", redirect: null } as const)
    : await checkAuthorizeRequest(params);
  if (!check.ok && check.redirect) redirect(check.redirect);

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto bg-linear-to-br from-orange-50 via-background to-stone-100">
      <div className="flex min-h-full flex-col items-center justify-center px-4 py-12">
        <div className="w-full max-w-md space-y-6">
          <div className="flex justify-center">
            <div className="flex items-center justify-center rounded-2xl border bg-white px-5 py-3.5 shadow-sm">
              <Image src="/logo.svg" alt="book" width={139} height={44} className="h-11 w-auto" />
            </div>
          </div>

          <div className="overflow-hidden rounded-2xl border bg-card shadow-sm">
            <div className="h-1 bg-linear-to-r from-orange-400 to-orange-500" />
            {check.ok ? <Consent request={check.request} params={params} /> : <Refusal description={check.description} />}
          </div>
        </div>
      </div>
    </div>
  );
}

function Consent({
  request,
  params,
}: {
  request: Extract<Awaited<ReturnType<typeof checkAuthorizeRequest>>, { ok: true }>["request"];
  params: Record<string, string | undefined>;
}) {
  const destination = new URL(request.redirect_uri);
  return (
    <div className="space-y-5 px-7 py-7">
      <div className="space-y-1">
        <h1 className="text-lg font-semibold">Connect {request.client_name}</h1>
        <p className="text-sm text-muted-foreground">
          {request.client_name}, from <span className="font-medium text-foreground">claude.ai</span>, wants to work on
          your tasks in book as an agent.
        </p>
      </div>

      <ul className="space-y-2.5 text-sm">
        {CAN.map((line) => (
          <li key={line} className="flex gap-2.5">
            <Check className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" aria-hidden />
            <span>{line}</span>
          </li>
        ))}
      </ul>

      {request.loopback ? (
        <div className="flex gap-2.5 rounded-lg border border-amber-200 bg-amber-50 px-3.5 py-3 text-sm text-amber-900 dark:border-amber-900/50 dark:bg-amber-950/30 dark:text-amber-200">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
          <span>
            This hands access to a program on this computer, at <span className="font-mono">{destination.host}</span>.
            Only allow it if you just started connecting from Claude Code.
          </span>
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">
          Then you go back to <span className="font-medium text-foreground">{destination.host}</span>. Only allow it
          if you just added book as a connector in Claude yourself.
        </p>
      )}

      <form action={decide} className="space-y-3">
        {Object.entries(params).map(([key, value]) =>
          value === undefined ? null : <input key={key} type="hidden" name={key} value={value} />
        )}
        <div className="flex gap-3">
          <Button type="submit" name="decision" value="deny" variant="outline" className="flex-1">
            Cancel
          </Button>
          <AllowButton />
        </div>
        <p className="text-center text-xs text-muted-foreground">You can disconnect it any time in Settings.</p>
      </form>
    </div>
  );
}

function Refusal({ description }: { description: string }) {
  return (
    <div className="space-y-2 px-7 py-7">
      <h1 className="text-lg font-semibold">This connection can&apos;t be made</h1>
      <p className="text-sm text-muted-foreground">{description}</p>
    </div>
  );
}
