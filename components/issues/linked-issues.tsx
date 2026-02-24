"use client";

import { useEffect, useState } from "react";
import { Link2, StickyNote } from "lucide-react";

const STATUS_COLORS: Record<string, string> = {
  pending: "#94a3b8",
  in_progress: "#3b82f6",
  blocked: "#f97316",
  done: "#10b981",
};

interface LinkedIssue {
  id: string;
  title: string;
  status: string;
  category: string;
}

interface LinkedIssuesProps {
  personId?: string;
  invoiceId?: string;
}

export function LinkedIssues({ personId, invoiceId }: LinkedIssuesProps) {
  const [issues, setIssues] = useState<LinkedIssue[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const params = new URLSearchParams();
    if (personId) params.set("personId", personId);
    if (invoiceId) params.set("invoiceId", invoiceId);

    fetch(`/api/issues?${params}`)
      .then((r) => r.json())
      .then(setIssues)
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [personId, invoiceId]);

  if (loading) {
    return (
      <div className="space-y-2">
        <div className="h-4 w-24 bg-muted rounded animate-pulse" />
        <div className="h-8 w-full bg-muted rounded animate-pulse" />
      </div>
    );
  }

  if (issues.length === 0) return null;

  return (
    <div>
      <h4 className="mb-2 text-sm font-semibold flex items-center gap-1.5">
        <Link2 className="h-3.5 w-3.5" />
        Linked Issues
      </h4>
      <div className="max-h-32 overflow-y-auto space-y-1">
        {issues.map((issue) => (
          <a
            key={issue.id}
            href={`/issues?issue=${issue.id}`}
            className="flex items-center gap-2 px-2 py-1.5 text-sm rounded hover:bg-muted transition-colors"
          >
            {issue.category === "note" ? (
              <StickyNote className="h-3 w-3 text-muted-foreground shrink-0" />
            ) : (
              <span
                className="h-2 w-2 rounded-full shrink-0"
                style={{ backgroundColor: STATUS_COLORS[issue.status] ?? "#94a3b8" }}
              />
            )}
            <span className="truncate">{issue.title}</span>
          </a>
        ))}
      </div>
    </div>
  );
}
