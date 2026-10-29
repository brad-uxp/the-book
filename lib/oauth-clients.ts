import { z } from "zod";
import { isAllowedClientId } from "./oauth";

/**
 * A client's Client ID Metadata Document (CIMD): its `client_id` is the URL
 * the document is served at, and the document says what the client calls
 * itself and where it may be redirected. theBook fetches it on every
 * authorization request — only from claude.ai (isAllowedClientId), so the
 * fetch can never be aimed anywhere else — with a short deadline, a size cap,
 * no redirects, and a few minutes of cache.
 */

const FETCH_TIMEOUT_MS = 3_000;
const MAX_BYTES = 16 * 1024;
const CACHE_MS = 10 * 60_000;

const ClientMetadataSchema = z.object({
  client_id: z.string(),
  client_name: z.string().max(200).optional(),
  redirect_uris: z.array(z.string().max(2_000)).min(1).max(20),
  token_endpoint_auth_method: z.literal("none").optional(),
});

export interface ClientMetadata {
  client_id: string;
  client_name: string | null;
  redirect_uris: string[];
}

const cache = new Map<string, { value: ClientMetadata; until: number }>();

/** The client's document, or null when it cannot be fetched or is not one theBook accepts. */
export async function fetchClientMetadata(
  clientId: string,
  { fetchImpl = fetch, now = Date.now() }: { fetchImpl?: typeof fetch; now?: number } = {}
): Promise<ClientMetadata | null> {
  if (!isAllowedClientId(clientId)) return null;
  const hit = cache.get(clientId);
  if (hit && hit.until > now) return hit.value;

  try {
    const res = await fetchImpl(clientId, {
      redirect: "error",
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      headers: { accept: "application/json" },
    });
    if (!res.ok || !res.body) return null;
    const text = await readCapped(res.body, MAX_BYTES);
    if (text === null) return null;
    const parsed = ClientMetadataSchema.safeParse(JSON.parse(text));
    // The document must name itself: a document that claims another client_id
    // is not this client's.
    if (!parsed.success || parsed.data.client_id !== clientId) return null;
    const value = {
      client_id: parsed.data.client_id,
      client_name: parsed.data.client_name ?? null,
      redirect_uris: parsed.data.redirect_uris,
    };
    cache.set(clientId, { value, until: now + CACHE_MS });
    return value;
  } catch (err) {
    console.error("[oauth] client metadata:", clientId, (err as Error).message);
    return null;
  }
}

/** For tests. */
export function clearClientMetadataCache() {
  cache.clear();
}

async function readCapped(body: ReadableStream<Uint8Array>, max: number): Promise<string | null> {
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > max) {
      await reader.cancel().catch(() => {});
      return null;
    }
    chunks.push(value);
  }
  return new TextDecoder().decode(Buffer.concat(chunks));
}
