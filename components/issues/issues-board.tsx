"use client";

import { useRef } from "react";
import {
  DragDropContext,
  Droppable,
  Draggable,
  type DropResult,
} from "@hello-pangea/dnd";
import { MoreHorizontal, Plus } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  type Issue,
  type Client,
  type IssueStatus,
  COLUMNS,
  InlineProgress,
  InlineDate,
  InlineClient,
} from "./inline-editors";

// Re-export for external use
export type { Issue };

interface Props {
  issues: Issue[];
  clients: Client[];
  setIssues: React.Dispatch<React.SetStateAction<Issue[]>>;
  onUpdateIssue: (id: string, patch: Partial<Issue>) => void;
  onSelectIssue: (issue: Issue) => void;
  onDeleteIssue: (issue: Issue) => void;
  onConvertCategory: (issue: Issue) => void;
  onCreateForColumn: (status: IssueStatus) => void;
}

export function IssuesBoard({
  issues,
  clients,
  setIssues,
  onUpdateIssue,
  onSelectIssue,
  onDeleteIssue,
  onConvertCategory,
  onCreateForColumn,
}: Props) {
  const popoverCloseTime = useRef(0);

  const markPopoverClose = () => {
    popoverCloseTime.current = Date.now();
  };

  const columnIssues = (status: IssueStatus) =>
    issues.filter((t) => t.category === "task" && t.status === status);

  const isDueSoon = (dateStr: string | null) => {
    if (!dateStr) return false;
    const diff = new Date(dateStr).getTime() - Date.now();
    return diff > 0 && diff < 3 * 24 * 60 * 60 * 1000;
  };

  const isOverdue = (dateStr: string | null) => {
    if (!dateStr) return false;
    return new Date(dateStr).getTime() < Date.now();
  };

  const handleDragEnd = (result: DropResult) => {
    const { source, destination, draggableId } = result;
    if (!destination) return;
    if (
      source.droppableId === destination.droppableId &&
      source.index === destination.index
    )
      return;

    setIssues((prev) => {
      const updated = [...prev];
      const idx = updated.findIndex((t) => t.id === draggableId);
      if (idx === -1) return prev;

      const issue = { ...updated[idx] };
      issue.status = destination.droppableId as IssueStatus;

      updated.splice(idx, 1);

      const destIssues = updated.filter(
        (t) => t.category === "task" && t.status === destination.droppableId
      );
      const insertAfter =
        destination.index > 0 ? destIssues[destination.index - 1] : null;
      const insertIdx = insertAfter
        ? updated.indexOf(insertAfter) + 1
        : updated.findIndex(
            (t) => t.category === "task" && t.status === destination.droppableId
          );

      updated.splice(
        insertIdx === -1 ? updated.length : insertIdx,
        0,
        issue
      );
      return updated;
    });

    // Persist status change
    fetch(`/api/issues/${draggableId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        status: destination.droppableId,
      }),
    }).catch(console.error);
  };

  return (
    <DragDropContext onDragEnd={handleDragEnd}>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {COLUMNS.map((col) => {
          const colIssues = columnIssues(col.id);
          return (
            <div
              key={col.id}
              className="flex flex-col rounded-xl group/col transition-colors"
              style={{ backgroundColor: `${col.color}08` }}
            >
              {/* Column header */}
              <div className="flex items-center gap-2 px-3 py-2.5">
                <span
                  className="h-2.5 w-2.5 rounded-full shrink-0"
                  style={{ backgroundColor: col.color }}
                />
                <span className="text-sm font-semibold">
                  {col.label}
                </span>
                <Badge
                  variant="outline"
                  className="h-5 min-w-5 justify-center px-1.5 text-xs tabular-nums"
                >
                  {colIssues.length}
                </Badge>
                <div className="flex-1" />
                <button
                  className="p-0.5 rounded opacity-0 group-hover/col:opacity-100 text-muted-foreground hover:text-primary hover:bg-primary/10 transition-all"
                  onClick={() => onCreateForColumn(col.id)}
                >
                  <Plus className="h-3.5 w-3.5" />
                </button>
              </div>

              {/* Droppable area */}
              <Droppable droppableId={col.id}>
                {(provided, snapshot) => (
                  <div
                    ref={provided.innerRef}
                    {...provided.droppableProps}
                    className="flex-1 p-2 space-y-2 min-h-32 rounded-b-xl transition-colors"
                    style={snapshot.isDraggingOver ? { backgroundColor: `${col.color}15` } : undefined}
                  >
                    {colIssues.map((issue, idx) => (
                      <Draggable
                        key={issue.id}
                        draggableId={issue.id}
                        index={idx}
                      >
                        {(prov, snap) => (
                          <div
                            ref={prov.innerRef}
                            {...prov.draggableProps}
                            {...prov.dragHandleProps}
                            style={{ ...prov.draggableProps.style, cursor: "pointer" }}
                            className={`rounded-lg border bg-card px-3 py-2 space-y-1 overflow-hidden transition-shadow group/card relative ${
                              snap.isDragging ? "shadow-lg ring-1 ring-primary/20" : "shadow-sm hover:shadow-md hover:border-primary/20"
                            }`}
                            onClick={() => {
                              if (!snap.isDragging && Date.now() - popoverCloseTime.current > 200) onSelectIssue(issue);
                            }}
                          >
                            {/* 3-dot menu — hover only */}
                            <DropdownMenu onOpenChange={(o) => { if (!o) markPopoverClose(); }}>
                              <DropdownMenuTrigger asChild>
                                <button
                                  className="absolute top-2 right-2 p-1 rounded opacity-0 group-hover/card:opacity-100 text-muted-foreground hover:text-foreground hover:bg-accent transition-all"
                                  onClick={(e) => e.stopPropagation()}
                                >
                                  <MoreHorizontal className="h-3.5 w-3.5" />
                                </button>
                              </DropdownMenuTrigger>
                              <DropdownMenuContent align="end" onClick={(e) => e.stopPropagation()}>
                                <DropdownMenuItem onClick={() => onConvertCategory(issue)}>
                                  Convert to note
                                </DropdownMenuItem>
                                <DropdownMenuSeparator />
                                <DropdownMenuItem variant="destructive" onClick={() => onDeleteIssue(issue)}>
                                  Delete
                                </DropdownMenuItem>
                              </DropdownMenuContent>
                            </DropdownMenu>

                            {/* Title */}
                            <p className="text-sm font-medium pr-6 wrap-break-word overflow-hidden">
                              {issue.title}
                            </p>

                            {/* Client + Due date + Progress — compact row */}
                            <div className="grid items-center gap-1.5 overflow-hidden" style={{ gridTemplateColumns: '1fr .75fr auto' }}>
                              <div className="min-w-0 overflow-hidden">
                                <InlineClient
                                  issue={issue}
                                  clients={clients}
                                  onCommit={(clientId) => {
                                    const c = clientId
                                      ? clients.find((cl) => cl.id === clientId) ?? null
                                      : null;
                                    onUpdateIssue(issue.id, {
                                      client_id: clientId,
                                      client: c
                                        ? { id: c.id, name: c.name, color_hex: c.color_hex }
                                        : null,
                                    });
                                  }}
                                  onClose={markPopoverClose}
                                />
                              </div>
                              <div className="min-w-0 overflow-hidden">
                                <InlineDate
                                  value={issue.due_date}
                                  status={issue.status}
                                  isDueSoon={isDueSoon(issue.due_date)}
                                  isOverdue={isOverdue(issue.due_date)}
                                  onCommit={(iso) => onUpdateIssue(issue.id, { due_date: iso })}
                                  onClose={markPopoverClose}
                                />
                              </div>
                              <InlineProgress
                                value={issue.progress}
                                color={col.color}
                                onCommit={(v) => onUpdateIssue(issue.id, { progress: v })}
                                onClose={markPopoverClose}
                              />
                            </div>
                          </div>
                        )}
                      </Draggable>
                    ))}
                    {provided.placeholder}
                    {colIssues.length === 0 && !snapshot.isDraggingOver && (
                      <p className="text-xs text-muted-foreground/50 text-center py-8">
                        No issues
                      </p>
                    )}
                    {/* Add issue — hover only */}
                    <button
                      className="w-full flex items-center justify-center gap-1.5 py-2 text-xs text-muted-foreground/60 opacity-0 group-hover/col:opacity-100 hover:text-primary hover:bg-primary/5 rounded-lg transition-all"
                      onClick={() => onCreateForColumn(col.id)}
                    >
                      <Plus className="h-3 w-3" />
                      Add issue
                    </button>
                  </div>
                )}
              </Droppable>
            </div>
          );
        })}
      </div>
    </DragDropContext>
  );
}
