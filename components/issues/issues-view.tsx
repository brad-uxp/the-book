"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useMediaQuery } from "@/hooks/use-media-query";
import { useRouter, useSearchParams } from "next/navigation";
import {
  Archive,
  Filter,
  LayoutGrid,
  LayoutList,
  Plus,
  Search,
  Trash2,
  Waypoints,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import dynamic from "next/dynamic";

const IssueDetail = dynamic(() => import("./issue-detail").then((m) => m.IssueDetail), { ssr: false });

/**
 * React Flow and its stylesheet only load when the canvas is opened — the
 * board and the list are the common case and should not pay for it.
 */
const IssuesCanvas = dynamic(
  () => import("./issues-canvas").then((m) => m.IssuesCanvas),
  {
    ssr: false,
    loading: () => (
      <div className="h-[calc(100vh-15rem)] min-h-96 w-full animate-pulse rounded-xl border bg-muted/30" />
    ),
  }
);
import { IssuesBoard } from "./issues-board";
import { IssuesList } from "./issues-list";
import {
  type Issue,
  type IssueLink,
  type Client,
  type IssueStatus,
  type IssueCategory,
  BOARD_COLUMNS,
} from "./inline-editors";
import type { CanvasPosition } from "@/lib/issue-canvas";
import { ARCHIVED_STATUS, isArchived } from "@/lib/issues";

type ViewMode = "board" | "list" | "canvas";

const VIEW_MODES: ViewMode[] = ["board", "list", "canvas"];

/** How long to gather card movements before writing them as one batch. */
const POSITION_FLUSH_MS = 400;

/**
 * Status-filter value that switches the list into the archive.
 *
 * It is the `done` status itself, so the filter reads as one list of statuses,
 * but it behaves as a mode: picking it shows the archived issues *instead of*
 * the active ones, and it only exists in the list view.
 */
const ARCHIVE_FILTER = ARCHIVED_STATUS;

interface Props {
  clients: Client[];
  initialIssues: Issue[];
  initialLinks: IssueLink[];
}

export function IssuesView({ clients, initialIssues, initialLinks }: Props) {
  const [view, setViewState] = useState<ViewMode>(() => {
    if (typeof window !== "undefined") {
      const saved = localStorage.getItem("issues-view-mode");
      if ((VIEW_MODES as string[]).includes(saved ?? "")) return saved as ViewMode;
    }
    return "board";
  });
  const [issues, setIssues] = useState<Issue[]>(initialIssues);
  const [links, setLinks] = useState<IssueLink[]>(initialLinks);
  const [editIssue, setEditIssue] = useState<Issue | null>(null);
  const [deleteIssue, setDeleteIssue] = useState<Issue | null>(null);
  const [convertIssue, setConvertIssue] = useState<Issue | null>(null);
  const [search, setSearch] = useState("");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [confirmBulkDelete, setConfirmBulkDelete] = useState(false);
  const [bulkDeleting, setBulkDeleting] = useState(false);
  const [filterClient, setFilterClient] = useState<string>("all");
  const [filterStatus, setFilterStatus] = useState<string>("all");
  const debounceRef = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  const router = useRouter();
  const searchParams = useSearchParams();

  // Declared after every useState on purpose: it calls setters defined below
  // it, and a binding used before its declaration stops the React Compiler
  // from recognising them as the stable setters they are — which makes it give
  // up on memoizing the whole component.
  const setView = (v: ViewMode) => {
    setViewState(v);
    localStorage.setItem("issues-view-mode", v);
    // The archive filter has no meaning outside the list; leaving it set would
    // land the board and the canvas on nothing.
    if (v !== "list") {
      setFilterStatus((prev) => (prev === ARCHIVE_FILTER ? "all" : prev));
      setSelectedIds(new Set());
    }
  };

  // On mobile (<sm), always show list view
  const isMobile = useMediaQuery("(max-width: 639px)");
  const effectiveView = isMobile ? "list" : view;

  // The archive is a list-view mode. Switching to the board or the canvas
  // while it is on would otherwise show them an empty screen, since neither
  // draws archived work.
  const archiveMode = effectiveView === "list" && filterStatus === ARCHIVE_FILTER;

  const filteredIssues = useMemo(() => {
    let result = issues;

    // Archived work is out of sight everywhere until it is asked for.
    result = archiveMode
      ? result.filter(isArchived)
      : result.filter((i) => !isArchived(i));

    if (search) {
      const q = search.toLowerCase();
      result = result.filter((i) => i.title.toLowerCase().includes(q));
    }
    if (filterClient !== "all") {
      result = result.filter((i) =>
        filterClient === "none" ? !i.client_id : i.client_id === filterClient
      );
    }
    if (!archiveMode && filterStatus !== "all") {
      result = result.filter((i) => i.status === filterStatus);
    }
    return result;
  }, [issues, search, filterClient, filterStatus, archiveMode]);

  // Deep-link: open issue detail from ?issue=<id>, once.
  // Opening the dialog is a state adjustment, so it happens during render;
  // clearing the query string is navigation, so it stays in an effect.
  const deepLinkId = searchParams.get("issue");
  const [deepLinkHandled, setDeepLinkHandled] = useState(false);
  if (deepLinkId && !deepLinkHandled) {
    setDeepLinkHandled(true);
    const issue = issues.find((t) => t.id === deepLinkId);
    if (issue) {
      if (issue.category === "note") setView("list");
      setEditIssue(issue);
    }
  }
  useEffect(() => {
    if (deepLinkHandled) router.replace("/issues", { scroll: false });
  }, [deepLinkHandled, router]);

  const updateIssue = (id: string, patch: Partial<Issue>) => {
    setIssues((prev) => prev.map((t) => (t.id === id ? { ...t, ...patch } : t)));
    setEditIssue((prev) =>
      prev && prev.id === id ? { ...prev, ...patch } : prev
    );

    const isDescriptionOnly =
      Object.keys(patch).length === 1 && "description" in patch;
    const delay = isDescriptionOnly ? 500 : 0;

    if (debounceRef.current[id]) clearTimeout(debounceRef.current[id]);
    debounceRef.current[id] = setTimeout(() => {
      fetch(`/api/issues/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      }).catch(console.error);
    }, delay);
  };

  // Card positions, gathered and written as one batch.
  //
  // Separate from updateIssue on purpose: a drag is not a change to the issue,
  // it goes to its own endpoint, it is not audited, and one gesture can move a
  // dozen cards at once. Keyed by id so repeated moves of the same card
  // collapse into its latest position instead of queueing.
  const pendingPositions = useRef<Map<string, CanvasPosition>>(new Map());
  const positionTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const flushPositions = useCallback(() => {
    if (positionTimer.current) {
      clearTimeout(positionTimer.current);
      positionTimer.current = null;
    }
    const nodes = [...pendingPositions.current.values()];
    if (nodes.length === 0) return;
    pendingPositions.current.clear();

    fetch("/api/issues/canvas", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ nodes }),
      // The layout has to survive the tab closing right after a drag.
      keepalive: true,
    }).catch(console.error);
  }, []);

  const moveIssues = useCallback(
    (positions: CanvasPosition[]) => {
      if (positions.length === 0) return;

      const byId = new Map(positions.map((p) => [p.id, p]));
      setIssues((prev) =>
        prev.map((issue) => {
          const p = byId.get(issue.id);
          return p ? { ...issue, canvas_x: p.x, canvas_y: p.y } : issue;
        })
      );

      for (const p of positions) pendingPositions.current.set(p.id, p);
      if (positionTimer.current) clearTimeout(positionTimer.current);
      positionTimer.current = setTimeout(flushPositions, POSITION_FLUSH_MS);
    },
    [flushPositions]
  );

  // Leaving the page within the debounce window must not lose the layout.
  useEffect(() => flushPositions, [flushPositions]);

  // Read inside callbacks that must not be rebuilt when a link changes.
  // Assigned after commit, never during render: a render can be discarded.
  const linksRef = useRef(links);
  useEffect(() => {
    linksRef.current = links;
  });

  const connectIssues = useCallback((sourceId: string, targetId: string) => {
    if (sourceId === targetId) return;
    if (
      linksRef.current.some(
        (l) => l.source_id === sourceId && l.target_id === targetId
      )
    ) {
      return;
    }

    // Drawn immediately, under a placeholder id, and reconciled with the real
    // row when the server answers. The line has to appear the instant the drag
    // is released or the canvas feels broken.
    const tempId = `pending:${sourceId}:${targetId}`;
    setLinks((prev) => [
      ...prev,
      {
        id: tempId,
        source_id: sourceId,
        target_id: targetId,
        label: null,
        pending: true,
      },
    ]);

    fetch("/api/issues/links", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ source_id: sourceId, target_id: targetId }),
    })
      .then(async (res) => {
        if (!res.ok) throw new Error(`POST /api/issues/links ${res.status}`);
        const created = (await res.json()) as IssueLink;
        setLinks((prev) =>
          prev.map((l) =>
            l.id === tempId
              ? {
                  id: created.id,
                  source_id: sourceId,
                  target_id: targetId,
                  label: created.label ?? null,
                }
              : l
          )
        );
      })
      .catch((err) => {
        console.error(err);
        setLinks((prev) => prev.filter((l) => l.id !== tempId));
        toast.error("Could not connect these issues");
      });
  }, []);

  const disconnectLinks = useCallback((ids: string[]) => {
    const doomed = new Set(ids);
    // Captured before the optimistic removal so a failed delete can put the
    // connection back exactly as it was.
    const removed = linksRef.current.filter((l) => doomed.has(l.id));
    if (removed.length === 0) return;

    setLinks((prev) => prev.filter((l) => !doomed.has(l.id)));

    Promise.allSettled(
      removed.map((link) =>
        fetch(`/api/issues/links/${link.id}`, { method: "DELETE" }).then(
          (res) => {
            // Already gone is the outcome we wanted.
            if (!res.ok && res.status !== 404) {
              throw new Error(`DELETE ${link.id} ${res.status}`);
            }
          }
        )
      )
    ).then((results) => {
      const failed = removed.filter((_, i) => results[i].status === "rejected");
      if (failed.length === 0) return;
      console.error("[canvas] could not delete links", failed);
      setLinks((prev) => [...prev, ...failed]);
      toast.error(
        failed.length === 1
          ? "Could not remove the connection"
          : `Could not remove ${failed.length} connections`
      );
    });
  }, []);

  const createIssue = async (status: IssueStatus = "pending", category: IssueCategory = "task") => {
    const res = await fetch("/api/issues", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: category === "note" ? "New note" : "New issue", status, category }),
    });
    if (!res.ok) return;
    const created = await res.json();
    const issue: Issue = {
      ...created,
      due_date: created.due_date
        ? typeof created.due_date === "string"
          ? created.due_date
          : new Date(created.due_date).toISOString()
        : null,
      client: created.client ?? null,
    };
    setIssues((prev) => [...prev, issue]);
    setEditIssue(issue);
  };

  const handleDelete = async (id: string) => {
    await fetch(`/api/issues/${id}`, { method: "DELETE" }).catch(console.error);
    setIssues((prev) => prev.filter((t) => t.id !== id));
    setEditIssue(null);
  };

  const toggleSelect = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleSelectAll = (selectAll: boolean) => {
    // Everything currently on screen, not everything archived — the header box
    // has to agree with the rows under it once a search or client filter is on.
    setSelectedIds(
      selectAll ? new Set(filteredIssues.map((i) => i.id)) : new Set()
    );
  };

  const handleBulkDelete = async () => {
    const ids = [...selectedIds];
    if (ids.length === 0) return;

    setBulkDeleting(true);
    try {
      const res = await fetch("/api/issues/bulk-delete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids }),
      });
      if (!res.ok) throw new Error(`bulk-delete ${res.status}`);
      const { deleted, skipped } = (await res.json()) as {
        deleted: number;
        skipped: number;
      };

      // Drop exactly what the endpoint is scoped to remove: the selected rows
      // that are actually archived. Anything it skipped stays on screen.
      setIssues((prev) =>
        prev.filter((i) => !(selectedIds.has(i.id) && isArchived(i)))
      );
      setSelectedIds(new Set());
      setConfirmBulkDelete(false);
      toast.success(
        deleted === 1 ? "1 issue deleted" : `${deleted} issues deleted`
      );
      if (skipped > 0) {
        toast.warning(
          `${skipped} were left alone — they are no longer archived`
        );
      }
    } catch (err) {
      console.error(err);
      toast.error("Could not delete the selected issues");
    } finally {
      setBulkDeleting(false);
    }
  };

  const handleConvertCategory = (issue: Issue) => {
    const newCategory: IssueCategory = issue.category === "task" ? "note" : "task";
    updateIssue(issue.id, { category: newCategory });
    setConvertIssue(null);
  };

  // Built once and rendered into both Selects — the mobile popover and the
  // desktop bar must never drift apart.
  const statusOptions = (
    <>
      <SelectItem value="all">All status</SelectItem>
      {BOARD_COLUMNS.map((col) => (
        <SelectItem key={col.id} value={col.id}>
          <span className="flex items-center gap-2">
            <span
              className="h-2 w-2 rounded-full shrink-0"
              style={{ backgroundColor: col.color }}
            />
            {col.label}
          </span>
        </SelectItem>
      ))}
      {/*
        The archive, set apart because it is not another status to filter by —
        picking it swaps the list for what has been put away. Only in the list
        view: the board and the canvas never draw archived work.
      */}
      {effectiveView === "list" && (
        <>
          <SelectSeparator />
          <SelectItem value={ARCHIVE_FILTER}>
            <span className="flex items-center gap-2">
              <Archive className="h-3.5 w-3.5 text-muted-foreground" />
              Done · archived
            </span>
          </SelectItem>
        </>
      )}
    </>
  );

  return (
    <>
      {/* Header bar */}
      <div className="flex items-center gap-2 justify-between">
        <div className="flex items-center gap-2 flex-1 min-w-0">
        {/* View switch — hidden on mobile (always list) */}
        <div className="hidden sm:flex overflow-hidden rounded-md border">
          <Button
            variant={view === "board" ? "secondary" : "ghost"}
            size="icon"
            className="h-8 w-8 rounded-none"
            onClick={() => setView("board")}
          >
            <LayoutGrid className="h-4 w-4" />
          </Button>
          <Button
            variant={view === "list" ? "secondary" : "ghost"}
            size="icon"
            className="h-8 w-8 rounded-none"
            onClick={() => setView("list")}
          >
            <LayoutList className="h-4 w-4" />
          </Button>
          <Button
            variant={view === "canvas" ? "secondary" : "ghost"}
            size="icon"
            className="h-8 w-8 rounded-none"
            onClick={() => setView("canvas")}
          >
            <Waypoints className="h-4 w-4" />
          </Button>
        </div>

        {/* Search */}
        <div className="relative flex-1 sm:flex-initial">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
          <Input
            placeholder="Search..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="h-8 w-full sm:w-48 pl-8 pr-7 text-sm"
          />
          {search && (
            <button
              onClick={() => setSearch("")}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>

        {/* Filters — popover on mobile, inline on desktop */}
        <Popover>
          <PopoverTrigger asChild>
            <Button
              variant="outline"
              size="icon"
              className="sm:hidden h-8 w-8 shrink-0 relative"
            >
              <Filter className="h-4 w-4" />
              {(filterClient !== "all" || filterStatus !== "all") && (
                <span className="absolute -top-1 -right-1 h-2 w-2 rounded-full bg-primary" />
              )}
            </Button>
          </PopoverTrigger>
          <PopoverContent align="end" className="w-56 space-y-3 sm:hidden">
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">Client</label>
              <Select value={filterClient} onValueChange={setFilterClient}>
                <SelectTrigger className="h-8 text-sm">
                  <SelectValue placeholder="Client" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All clients</SelectItem>
                  <SelectItem value="none">No client</SelectItem>
                  {clients.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      <span className="flex items-center gap-2">
                        <span
                          className="h-2 w-2 rounded-full shrink-0"
                          style={{ backgroundColor: c.color_hex }}
                        />
                        {c.name}
                      </span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">Status</label>
              <Select value={filterStatus} onValueChange={setFilterStatus}>
                <SelectTrigger className="h-8 text-sm">
                  <SelectValue placeholder="Status" />
                </SelectTrigger>
                <SelectContent>{statusOptions}</SelectContent>
              </Select>
            </div>
          </PopoverContent>
        </Popover>

        {/* Desktop inline filters */}
        <Select value={filterClient} onValueChange={setFilterClient}>
          <SelectTrigger className="hidden sm:flex h-8 w-auto min-w-28 text-sm">
            <SelectValue placeholder="Client" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All clients</SelectItem>
            <SelectItem value="none">No client</SelectItem>
            {clients.map((c) => (
              <SelectItem key={c.id} value={c.id}>
                <span className="flex items-center gap-2">
                  <span
                    className="h-2 w-2 rounded-full shrink-0"
                    style={{ backgroundColor: c.color_hex }}
                  />
                  {c.name}
                </span>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select value={filterStatus} onValueChange={setFilterStatus}>
          <SelectTrigger className="hidden sm:flex h-8 w-auto min-w-28 text-sm">
            <SelectValue placeholder="Status" />
          </SelectTrigger>
          <SelectContent>{statusOptions}</SelectContent>
        </Select>

        </div>

        {/* Creating from the archive would make a pending issue that vanishes
            the moment it is created. */}
        {!archiveMode && (
          <Button
            className="h-8 w-8 shrink-0 sm:w-auto sm:px-3"
            onClick={() => createIssue("pending", effectiveView === "list" ? "note" : "task")}
          >
            <Plus className="h-4 w-4 sm:mr-2" />
            <span className="hidden sm:inline">New Issue</span>
          </Button>
        )}
      </div>

      {/* Views */}
      {effectiveView === "board" && (
        <IssuesBoard
          issues={filteredIssues}
          clients={clients}
          setIssues={setIssues}
          onUpdateIssue={updateIssue}
          onSelectIssue={setEditIssue}
          onDeleteIssue={setDeleteIssue}
          onConvertCategory={setConvertIssue}
          onCreateForColumn={createIssue}
        />
      )}

      {effectiveView === "list" && (
        <>
          {archiveMode && (
            <div className="flex items-center gap-3 rounded-lg border bg-muted/30 px-3 py-2">
              <Archive className="h-4 w-4 shrink-0 text-muted-foreground" />
              <p className="text-sm text-muted-foreground">
                {selectedIds.size > 0
                  ? `${selectedIds.size} selected`
                  : `${filteredIssues.length} archived`}
              </p>
              <div className="flex-1" />
              <Button
                variant="destructive"
                size="sm"
                className="h-8"
                disabled={selectedIds.size === 0}
                onClick={() => setConfirmBulkDelete(true)}
              >
                <Trash2 className="h-3.5 w-3.5 sm:mr-2" />
                <span className="hidden sm:inline">Delete</span>
              </Button>
            </div>
          )}

          <IssuesList
            issues={filteredIssues}
            clients={clients}
            onSelectIssue={setEditIssue}
            onDeleteIssue={setDeleteIssue}
            onConvertCategory={setConvertIssue}
            selectable={archiveMode}
            selectedIds={selectedIds}
            onToggleSelect={toggleSelect}
            onToggleSelectAll={toggleSelectAll}
          />
        </>
      )}

      {effectiveView === "canvas" && (
        <IssuesCanvas
          issues={filteredIssues}
          links={links}
          onSelectIssue={setEditIssue}
          onMoveIssues={moveIssues}
          onConnectIssues={connectIssues}
          onDisconnectLinks={disconnectLinks}
          onCreateIssue={() => createIssue("pending", "task")}
        />
      )}

      {/* Detail sidebar */}
      <IssueDetail
        issue={editIssue}
        onOpenChange={(o) => { if (!o) setEditIssue(null); }}
        clients={clients}
        onUpdate={updateIssue}
      />

      {/* Convert confirmation */}
      <Dialog open={!!convertIssue} onOpenChange={(o) => { if (!o) setConvertIssue(null); }}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>
              {convertIssue?.category === "task" ? "Convert to note" : "Convert to task"}
            </DialogTitle>
            <DialogDescription>
              {convertIssue?.category === "task"
                ? `"${convertIssue?.title}" will be moved to list view only. Status and due date will be hidden but preserved.`
                : `"${convertIssue?.title}" will appear on the kanban board with its previous status restored.`}
            </DialogDescription>
          </DialogHeader>
          <div className="flex gap-2 justify-end pt-2">
            <Button variant="outline" onClick={() => setConvertIssue(null)}>
              Cancel
            </Button>
            <Button onClick={() => { if (convertIssue) handleConvertCategory(convertIssue); }}>
              Convert
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Bulk delete confirmation — permanent, so it says the number out loud */}
      <Dialog
        open={confirmBulkDelete}
        onOpenChange={(o) => { if (!o && !bulkDeleting) setConfirmBulkDelete(false); }}
      >
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>
              Delete {selectedIds.size} archived{" "}
              {selectedIds.size === 1 ? "issue" : "issues"}?
            </DialogTitle>
            <DialogDescription>
              This permanently removes them and everything on them — description,
              mentions and canvas connections. It cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <div className="flex justify-end gap-2 pt-2">
            <Button
              variant="outline"
              disabled={bulkDeleting}
              onClick={() => setConfirmBulkDelete(false)}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              disabled={bulkDeleting}
              onClick={handleBulkDelete}
            >
              {bulkDeleting ? "Deleting…" : "Delete permanently"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Delete confirmation */}
      <Dialog open={!!deleteIssue} onOpenChange={(o) => { if (!o) setDeleteIssue(null); }}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Delete issue</DialogTitle>
            <DialogDescription>
              Are you sure you want to delete &quot;{deleteIssue?.title}&quot;? This action cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <div className="flex gap-2 justify-end pt-2">
            <Button variant="outline" onClick={() => setDeleteIssue(null)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={() => { if (deleteIssue) handleDelete(deleteIssue.id); setDeleteIssue(null); }}
            >
              Delete
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
