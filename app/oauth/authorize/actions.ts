"use server";

import { redirect } from "next/navigation";
import { auth, isAllowedSession } from "@/auth";
import { authorizationResponseUrl, checkAuthorizeRequest, createCode } from "@/lib/oauth-service";
import { AUTHORIZE_PARAMS } from "./params";

/**
 * The owner's answer on the consent screen. Everything is checked again from
 * the form — the page's check proves nothing about what was posted — and the
 * session too: Server Actions are reachable by POST, and Next checks their
 * Origin, but not who is signed in.
 */
export async function decide(formData: FormData) {
  if (!isAllowedSession(await auth())) redirect("/login");

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
  if (formData.get("decision") !== "allow") {
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
