/**
 * Folding a fresh copy of the issues into the one on screen.
 *
 * The issues view polls (components/issues/issues-view.tsx) so an agent's
 * move — a task taken, a task handed to Review — shows without a reload. What
 * is on screen wins wherever the owner is mid-change: an issue with a save
 * pending or just made keeps its local copy, since the fetched one may predate
 * it. Everything else takes the server's.
 *
 * The local order stays: the board reorders a column on screen without saving
 * the order, and a refresh must not undo that. An issue new to this screen
 * (made on the phone, say) goes at the end.
 */

export interface RefreshableIssue {
  id: string;
  /** Moves with every write; equal on both sides means nothing changed. */
  updated_at?: string;
}

export interface MergeOptions {
  /** The owner changed this issue and the server may not have it yet. */
  isPending: (id: string) => boolean;
  /** Deleted here; a fetch that started before the delete still has it. */
  removed: ReadonlySet<string>;
}

/** Returns `local` itself when nothing changed, so React skips the render. */
export function mergeRefreshedIssues<T extends RefreshableIssue>(
  local: T[],
  server: T[],
  { isPending, removed }: MergeOptions
): T[] {
  const fresh = new Map(server.map((i) => [i.id, i]));
  let changed = false;
  const next: T[] = [];

  for (const item of local) {
    if (isPending(item.id)) {
      next.push(item);
      continue;
    }
    const theirs = fresh.get(item.id);
    if (!theirs) {
      changed = true; // deleted somewhere else
      continue;
    }
    if (theirs.updated_at !== undefined && theirs.updated_at === item.updated_at) {
      next.push(item);
      continue;
    }
    next.push(theirs);
    changed = true;
  }

  const onScreen = new Set(local.map((i) => i.id));
  for (const theirs of server) {
    if (onScreen.has(theirs.id) || removed.has(theirs.id)) continue;
    next.push(theirs);
    changed = true;
  }

  return changed ? next : local;
}
