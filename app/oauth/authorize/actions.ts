"use server";

import { redirect } from "next/navigation";
import { auth, isAllowedSession } from "@/auth";
import { auditLog } from "@/lib/audit";
import { authorizationResponseUrl, checkAuthorizeRequest, createCode } from "@/lib/oauth-service";
import { AUTHORIZE_PARAMS } from "./params";

/**
 * The owner's answer on the consent screen. Everything is checked again from
 * the form — the page's check proves nothing about what was posted — and the
 * session too: Server Actions are reachable by POST, and Next checks their
 * Origin, but not who is signed in.
 */
export async function decide(formData: FormData) {
  const session = await auth();
  if (!isAllowedSession(session)) redirect("/login");
  const owner = (session as { user?: { email?: string } } | null)?.user?.email ?? null;

  const params: Record<string, string | undefined> = {};
  for (const key of AUTHORIZE_PARAMS) {
    const value = formData.get(key);
    if (typeof value === "string") params[key] = value;
  }
  const check = await checkAuthorizeRequest(params);
  if (!check.ok) {
    if (check.redirect) redirect(check.redirect);
    throw new Error(check.description);
  }

  const { request } = check;
  const allowed = formData.get("decision") === "allow";
  // The owner's decision, by the owner: the exchange that follows is audited
  // as the client's (lib/oauth-service.ts).
  auditLog({
    entity_type: "oauth_consent",
    entity_id: request.code_challenge.slice(0, 16),
    entity_name: request.client_name,
    action: "create",
    actor_email: owner,
    after: { decision: allowed ? "allowed" : "declined", client_id: request.client_id, redirect_uri: request.redirect_uri, scope: request.scope },
  });
  if (!allowed) {
    redirect(
      authorizationResponseUrl(request.redirect_uri, {
        error: "access_denied",
        error_description: "The owner did not allow it",
        state: request.state,
      })
    );
  }
  const code = await createCode(request);
  redirect(authorizationResponseUrl(request.redirect_uri, { code, state: request.state }));
}
