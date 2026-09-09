/**
 * What "archived" means, in one place.
 *
 * `done` stopped being a column you look at and became the archive: the board
 * does not show it, the canvas does not draw it, and the list hides it until
 * you ask for it. The rule is duplicated nowhere — the UI filters with the
 * predicate and the API queries with the where-clause, and both are here.
 */

export const ARCHIVED_STATUS = "done" as const;

/**
 * Only tasks archive. A note's status is carried but never shown — the convert
 * dialog says as much — so a note that happens to sit at `done` (converted
 * from a finished task, say) is still a note and still belongs in the list.
 * Hiding it would make text disappear with no way to find it again.
 */
export const ARCHIVED_CATEGORY = "task" as const;

/** Prisma where-clause for the archived set. */
export const ARCHIVED_WHERE = {
  status: ARCHIVED_STATUS,
  category: ARCHIVED_CATEGORY,
} as const;

export interface ArchivableIssue {
  category: string;
  status: string;
}

export function isArchived(issue: ArchivableIssue): boolean {
  return (
    issue.category === ARCHIVED_CATEGORY && issue.status === ARCHIVED_STATUS
  );
}
