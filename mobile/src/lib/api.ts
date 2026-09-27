import { API_URL } from "./config";

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string
  ) {
    super(message);
  }
}

/** What the server says went wrong, readable; never a stack or raw HTML. */
async function errorMessage(res: Response): Promise<string> {
  try {
    const body = (await res.json()) as { error?: unknown };
    if (typeof body.error === "string") return body.error;
  } catch {
    // Not JSON (a proxy error page, say): fall through to the status.
  }
  return `The server answered ${res.status}`;
}

/**
 * One request to book.'s API. Throws ApiError for any non-2xx answer and a
 * plain Error when the server cannot be reached at all.
 */
export async function apiRequest<T>(
  path: string,
  { token, method = "GET", body }: { token?: string | null; method?: string; body?: unknown } = {}
): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${API_URL}${path}`, {
      method,
      headers: {
        Accept: "application/json",
        ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new Error("Can't reach book. Check your connection and try again.");
  }
  if (!res.ok) throw new ApiError(res.status, await errorMessage(res));
  return (await res.json()) as T;
}
