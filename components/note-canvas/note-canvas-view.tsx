"use client";

import { useState } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { ArrowLeft, Waypoints } from "lucide-react";
import { toast } from "sonner";
import {
  InlineClient,
  InlineTitle,
  type Client,
  type Issue,
} from "@/components/issues/inline-editors";
import { MentionDataProvider } from "@/components/rich-text/mention-data";
import type { CanvasConnection, CanvasIdea } from "@/lib/note-canvas";

/**
 * The page's padding, the header row and the gap, taken off the viewport —
 * plus the top bar below lg. Must match the canvas's own height, or the
 * placeholder jumps when the canvas arrives.
 */
const CANVAS_HEIGHT =
  "h-[calc(100dvh-8.5rem)] min-h-96 lg:h-[calc(100dvh-6rem)]";

/**
 * React Flow and its stylesheet load with the canvas page only — the issues
 * board and list, the common case, never download them.
 */
const NoteCanvas = dynamic(
  () => import("./note-canvas").then((m) => m.NoteCanvas),
  {
    ssr: false,
    loading: () => (
      <div
        className={`${CANVAS_HEIGHT} w-full animate-pulse rounded-xl border bg-muted/30`}
      />
    ),
  }
);

interface Props {
  issue: Issue;
  clients: Client[];
  ideas: CanvasIdea[];
  connections: CanvasConnection[];
}

/**
 * A canvas note, full page: the parent idea's title and client on top, its
 * ideas below.
 */
export function NoteCanvasView({ issue: initial, clients, ideas, connections }: Props) {
  const [issue, setIssue] = useState(initial);

  /** Optimistic, with the previous values put back if the save fails. */
  const update = (patch: Partial<Issue>, body: Record<string, unknown>) => {
    const before = issue;
    setIssue((prev) => ({ ...prev, ...patch }));
    fetch(`/api/issues/${issue.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    })
      .then((res) => {
        if (!res.ok) throw new Error(`PATCH issue ${res.status}`);
      })
      .catch((err) => {
        console.error(err);
        setIssue(before);
        toast.error("Could not save the change");
      });
  };

  return (
    <MentionDataProvider clients={clients}>
      <div className="space-y-3">
        <div className="flex items-center gap-2 sm:gap-3">
          <Link
            href="/issues"
            aria-label="Back to issues"
            title="Back to issues"
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          >
            <ArrowLeft className="h-4 w-4" />
          </Link>
          <Waypoints className="h-4 w-4 shrink-0 text-muted-foreground" />
          <div className="min-w-0 flex-1">
            <InlineTitle
              value={issue.title}
              onCommit={(title) => update({ title }, { title })}
            />
          </div>
          <div className="shrink-0">
            <InlineClient
              issue={issue}
              clients={clients}
              onCommit={(clientId) => {
                const c = clientId
                  ? (clients.find((cl) => cl.id === clientId) ?? null)
                  : null;
                update(
                  {
                    client_id: clientId,
                    client: c
                      ? { id: c.id, name: c.name, color_hex: c.color_hex }
                      : null,
                  },
                  { client_id: clientId }
                );
              }}
            />
          </div>
        </div>

        <NoteCanvas
          issueId={issue.id}
          initialIdeas={ideas}
          initialConnections={connections}
        />
      </div>
    </MentionDataProvider>
  );
}
