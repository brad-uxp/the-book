"use client";

import { useEffect, useState } from "react";
import { X, Maximize2, Minimize2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { cn } from "@/lib/utils";
import {
  type Issue,
  type Client,
  COLUMNS,
  InlineTitle,
  InlineStatus,
  InlineClient,
  InlineProgress,
  InlineDate,
  InlineCategory,
} from "./inline-editors";
import { MentionDataProvider } from "@/components/rich-text/mention-data";
import { RichTextEditor } from "@/components/rich-text/rich-text-editor";
import { useNow } from "@/hooks/use-now";

// ── IssueDetail ──────────────────────────────────────────────────────────────

interface IssueDetailProps {
  issue: Issue | null;
  onOpenChange: (open: boolean) => void;
  clients: Client[];
  onUpdate: (id: string, patch: Partial<Issue>) => void;
}

export function IssueDetail({
  issue,
  onOpenChange,
  clients,
  onUpdate,
}: IssueDetailProps) {
  const col = issue ? COLUMNS.find((c) => c.id === issue.status) : null;
  const [expanded, setExpanded] = useState(() => {
    if (typeof window !== "undefined") {
      return localStorage.getItem("issues-detail-expanded") === "true";
    }
    return false;
  });

  useEffect(() => {
    localStorage.setItem("issues-detail-expanded", String(expanded));
  }, [expanded]);

  const now = useNow();

  const isDueSoon = (dateStr: string | null) => {
    if (!dateStr || !now) return false;
    const diff = new Date(dateStr).getTime() - now;
    return diff > 0 && diff < 3 * 24 * 60 * 60 * 1000;
  };

  const isOverdue = (dateStr: string | null) => {
    if (!dateStr || !now) return false;
    return new Date(dateStr).getTime() < now;
  };

  return (
    <MentionDataProvider clients={clients}>
    <Sheet open={!!issue} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        showCloseButton={false}
        fadeOnly={expanded}
        className={cn(
          "w-full sm:max-w-none p-0 flex flex-col transition-all duration-300",
          expanded
            ? "sm:w-[80%] sm:h-[90vh] sm:inset-0 sm:m-auto sm:rounded-xl sm:border"
            : "sm:w-1/2"
        )}
        onOpenAutoFocus={(e) => e.preventDefault()}
      >
        <SheetHeader className="sr-only">
          <SheetTitle>{issue?.title ?? "Issue"}</SheetTitle>
        </SheetHeader>

        {issue && (
          <>
            <div className="flex-1 overflow-y-auto">
              {/* Properties header */}
              <div className="px-8 py-6 space-y-4 border-b">
                <div className="flex items-center gap-2">
                  <div className="flex-1 min-w-0">
                    <InlineTitle
                      value={issue.title}
                      onCommit={(title) => onUpdate(issue.id, { title })}
                    />
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7 text-muted-foreground"
                      onClick={() => setExpanded(!expanded)}
                    >
                      {expanded ? (
                        <Minimize2 className="h-4 w-4" />
                      ) : (
                        <Maximize2 className="h-4 w-4" />
                      )}
                    </Button>
                    <div className="w-px h-4 bg-border" />
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7 text-muted-foreground"
                      onClick={() => onOpenChange(false)}
                    >
                      <X className="h-4 w-4" />
                    </Button>
                  </div>
                </div>

                <div className="space-y-2.5">
                  <div className="flex items-center gap-3">
                    <span className="text-xs text-muted-foreground w-20 shrink-0">
                      Type
                    </span>
                    <InlineCategory
                      value={issue.category}
                      onCommit={(category) => onUpdate(issue.id, { category })}
                    />
                  </div>

                  {issue.category === "task" && (
                    <div className="flex items-center gap-3">
                      <span className="text-xs text-muted-foreground w-20 shrink-0">
                        Status
                      </span>
                      <InlineStatus
                        value={issue.status}
                        onCommit={(status) => onUpdate(issue.id, { status })}
                      />
                    </div>
                  )}

                  <div className="flex items-center gap-3">
                    <span className="text-xs text-muted-foreground w-20 shrink-0">
                      Client
                    </span>
                    <InlineClient
                      issue={issue}
                      clients={clients}
                      onCommit={(clientId) => {
                        const c = clientId
                          ? clients.find((cl) => cl.id === clientId) ?? null
                          : null;
                        onUpdate(issue.id, {
                          client_id: clientId,
                          client: c
                            ? {
                                id: c.id,
                                name: c.name,
                                color_hex: c.color_hex,
                              }
                            : null,
                        });
                      }}
                    />
                  </div>

                  {issue.category === "task" && (
                    <div className="flex items-center gap-3">
                      <span className="text-xs text-muted-foreground w-20 shrink-0">
                        Progress
                      </span>
                      <div className="w-28">
                        <InlineProgress
                          value={issue.progress}
                          color={col?.color ?? "#94a3b8"}
                          onCommit={(v) => onUpdate(issue.id, { progress: v })}
                        />
                      </div>
                    </div>
                  )}

                  {issue.category === "task" && (
                    <div className="flex items-center gap-3">
                      <span className="text-xs text-muted-foreground w-20 shrink-0">
                        Due date
                      </span>
                      <InlineDate
                        value={issue.due_date}
                        status={issue.status}
                        isDueSoon={isDueSoon(issue.due_date)}
                        isOverdue={isOverdue(issue.due_date)}
                        onCommit={(iso) => onUpdate(issue.id, { due_date: iso })}
                      />
                    </div>
                  )}
                </div>

              </div>

              {/* Description editor */}
              <div className="px-12 py-6">
                <RichTextEditor
                  docKey={issue.id}
                  value={issue.description}
                  onChange={(html) => onUpdate(issue.id, { description: html })}
                  toolbar
                  className="min-h-[200px] text-sm"
                />
              </div>
            </div>
          </>
        )}
      </SheetContent>

    </Sheet>
    </MentionDataProvider>
  );
}
