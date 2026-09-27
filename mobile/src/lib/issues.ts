import { useCallback, useEffect, useMemo, useState } from "react";
// Shared with the web, so both apps agree on what "archived" and "canvas" mean.
import { isArchived } from "@shared/issues";
import { isCanvasNote } from "@shared/notes";
import { plainTextSnippet } from "@shared/mentions";
import { ApiError, apiRequest } from "./api";
import { useAuth } from "./auth";

/** An issue as GET /api/issues returns it (only what the app reads). */
export interface Issue {
  id: string;
  title: string;
  category: "task" | "note";
  note_format: "text" | "canvas";
  status: "pending" | "in_progress" | "blocked" | "done";
  progress: number;
  due_date: string | null;
  description: string;
  updated_at: string;
  client: { name: string; color_hex: string } | null;
}

export type Kind = "note" | "canvas" | "task";
export type Filter = "all" | Kind;

export function kindOf(issue: Pick<Issue, "category" | "note_format">): Kind {
  if (issue.category === "task") return "task";
  return isCanvasNote(issue) ? "canvas" : "note";
}

export function snippetOf(issue: Issue): string {
  return plainTextSnippet(issue.description, 140);
}

/**
 * The notes list: everything not archived, most recently edited first — the
 * home of a notes app. Archived tasks (done) stay on the web, by the same
 * rule the web's list uses.
 */
export function useIssues() {
  const { state, expire } = useAuth();
  const token = state.status === "signed-in" ? state.token : null;
  const [issues, setIssues] = useState<Issue[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  // When the list was fetched: what "2h ago" and "due tomorrow" are relative
  // to, so cards don't re-render on a ticking clock.
  const [loadedAt, setLoadedAt] = useState(() => new Date());

  const apply = useCallback((all: Issue[]) => {
    setIssues(
      all
        .filter((i) => !isArchived(i))
        .sort((a, b) => Date.parse(b.updated_at) - Date.parse(a.updated_at))
    );
    setError(null);
    setLoadedAt(new Date());
  }, []);

  const fail = useCallback(
    async (err: unknown) => {
      if (err instanceof ApiError && err.status === 401) {
        await expire(); // Revoked or expired: back to sign-in.
        return;
      }
      setError(err instanceof Error ? err.message : "Couldn't load your notes.");
    },
    [expire]
  );

  /** For pull-to-refresh and "Try again". */
  const load = useCallback(async () => {
    if (!token) return;
    await apiRequest<Issue[]>("/api/issues", { token }).then(apply, fail);
  }, [token, apply, fail]);

  // First load. State changes only in the request's callbacks, and a response
  // arriving after sign-out (or a new token) is dropped.
  useEffect(() => {
    if (!token) return;
    let active = true;
    apiRequest<Issue[]>("/api/issues", { token }).then(
      (all) => {
        if (active) apply(all);
      },
      (err) => {
        if (active) fail(err);
      }
    );
    return () => {
      active = false;
    };
  }, [token, apply, fail]);

  const refresh = useCallback(async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }, [load]);

  const counts = useMemo(() => {
    const c = { all: 0, note: 0, canvas: 0, task: 0 };
    for (const i of issues ?? []) {
      c.all += 1;
      c[kindOf(i)] += 1;
    }
    return c;
  }, [issues]);

  return { issues, error, refreshing, refresh, retry: load, counts, loadedAt };
}
