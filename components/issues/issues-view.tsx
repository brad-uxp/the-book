"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useMediaQuery } from "@/hooks/use-media-query";
import { useRouter, useSearchParams } from "next/navigation";
import {
  Archive,
  ChevronDown,
  Filter,
  LayoutGrid,
  LayoutList,
  Plus,
  Search,
  StickyNote,
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import dynamic from "next/dynamic";

const IssueDetail = dynamic(() => import("./issue-detail").then((m) => m.IssueDetail), { ssr: false });

import { IssuesBoard } from "./issues-board";
import { IssuesList } from "./issues-list";
import {
  type Issue,
  type Client,
  type IssueStatus,
  type IssueCategory,
  BOARD_COLUMNS,
} from "./inline-editors";
import {
  ARCHIVED_STATUS,
  ISSUES_VIEW_COOKIE,
  isArchived,
  type IssuesView as IssuesViewMode,
} from "@/lib/issues";
import { isCanvasNote, type NoteFormat } from "@/lib/notes";

type ViewMode = IssuesViewMode;

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
  /** From the view cookie, read by the page — so the server draws it too. */
  initialView: ViewMode;
}

export function IssuesView({
  clients,
  initialIssues,
  initialView,
}: Props) {
  const [view, setViewState] = useState<ViewMode>(initialView);
  const [issues, setIssues] = useState<Issue[]>(initialIssues);
  const [editIssue, setEditIssue] = useState<Issue | null>(null);
  const [deleteIssue, setDeleteIssue] = useState<Issue | null>(null);
  const [convertIssue, setConvertIssue] = useState<Issue | null>(null);
  const [canvasIssue, setCanvasIssue] = useState<Issue | null>(null);
  const [convertingToCanvas, setConvertingToCanvas] = useState(false);
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
    // The archive filter has no meaning outside the list; leaving it set would
    // land the board on nothing.
    if (v !== "list") {
      setFilterStatus((prev) => (prev === ARCHIVE_FILTER ? "all" : prev));
      setSelectedIds(new Set());
    }
  };

  // Remembered in a cookie the page reads on the server (see lib/issues.ts),
  // after commit, never while rendering: the deep link below switches the
  // view during render — on the server too.
  useEffect(() => {
    document.cookie = `${ISSUES_VIEW_COOKIE}=${view}; path=/; max-age=31536000; samesite=lax`;
  }, [view]);

  // On mobile (<sm), always show list view
  const isMobile = useMediaQuery("(max-width: 639px)");
  const effectiveView = isMobile ? "list" : view;

  // The archive is a list-view mode. Switching to the board while it is on
  // would otherwise show an empty screen, since the board never draws archived
  // work.
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
  // A canvas note has a page of its own, so its link goes there instead —
  // older links (linked issues, notifications) all use ?issue=.
  const deepLinkId = searchParams.get("issue");
  const [deepLinkRoute, setDeepLinkRoute] = useState<string | null>(null);
  if (deepLinkId && deepLinkRoute === null) {
    const issue = issues.find((t) => t.id === deepLinkId);
    if (issue && isCanvasNote(issue)) {
      setDeepLinkRoute(`/issues/${issue.id}`);
    } else {
      setDeepLinkRoute("/issues");
      if (issue) {
        if (issue.category === "note") setView("list");
        setEditIssue(issue);
      }
    }
  }
  useEffect(() => {
    if (deepLinkRoute) router.replace(deepLinkRoute, { scroll: false });
  }, [deepLinkRoute, router]);

  /** A canvas note opens on its own page; everything else in the sheet. */
  const openIssue = (issue: Issue) => {
    if (isCanvasNote(issue)) router.push(`/issues/${issue.id}`);
    else setEditIssue(issue);
  };

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

  const createIssue = async (
    status: IssueStatus = "pending",
    category: IssueCategory = "task",
    noteFormat: NoteFormat = "text"
  ) => {
    const title =
      noteFormat === "canvas"
        ? "New canvas"
        : category === "note"
          ? "New note"
          : "New issue";
    const res = await fetch("/api/issues", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title, status, category, note_format: noteFormat }),
    });
    if (!res.ok) return;
    const created = await res.json();
    if (noteFormat === "canvas") {
      router.push(`/issues/${created.id}`);
      return;
    }
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

  /**
   * A text note (or a task) becomes a canvas. The server moves the
   * description into the first idea, so this waits for it before opening the
   * canvas — and sends the description along, because the last keystrokes may
   * still be sitting in the debounce, and they have to land in the idea, not
   * after the conversion in a description nobody will see again.
   */
  const handleConvertToCanvas = async (issue: Issue) => {
    const latest = issues.find((i) => i.id === issue.id) ?? issue;
    if (debounceRef.current[issue.id]) clearTimeout(debounceRef.current[issue.id]);

    setConvertingToCanvas(true);
    try {
      const res = await fetch(`/api/issues/${issue.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          category: "note",
          note_format: "canvas",
          description: latest.description,
        }),
      });
      if (!res.ok) throw new Error(`convert to canvas ${res.status}`);
      router.push(`/issues/${issue.id}`);
    } catch (err) {
      console.error(err);
      toast.error("Could not convert to a canvas");
      setConvertingToCanvas(false);
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
        view: the board never draws archived work.
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
        {!archiveMode && effectiveView === "board" && (
          <Button
            className="h-8 w-8 shrink-0 sm:w-auto sm:px-3"
            onClick={() => createIssue("pending", "task")}
          >
            <Plus className="h-4 w-4 sm:mr-2" />
            <span className="hidden sm:inline">New Issue</span>
          </Button>
        )}
        {/* The list is where notes live, and a note is one of two things. */}
        {!archiveMode && effectiveView === "list" && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button className="h-8 w-8 shrink-0 sm:w-auto sm:px-3">
                <Plus className="h-4 w-4 sm:mr-2" />
                <span className="hidden sm:inline">New</span>
                <ChevronDown className="hidden h-3.5 w-3.5 opacity-70 sm:ml-1.5 sm:inline" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-52">
              <DropdownMenuItem onClick={() => createIssue("pending", "note")}>
                <StickyNote className="h-4 w-4" />
                <div className="flex flex-col">
                  <span>Note</span>
                  <span className="text-xs text-muted-foreground">
                    One rich-text document
                  </span>
                </div>
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() => createIssue("pending", "note", "canvas")}
              >
                <Waypoints className="h-4 w-4" />
                <div className="flex flex-col">
                  <span>Canvas</span>
                  <span className="text-xs text-muted-foreground">
                    Connected ideas around one
                  </span>
                </div>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>

      {/* Views */}
      {effectiveView === "board" && (
        <IssuesBoard
          issues={filteredIssues}
          clients={clients}
          setIssues={setIssues}
          onUpdateIssue={updateIssue}
          onSelectIssue={openIssue}
          onDeleteIssue={setDeleteIssue}
          onConvertCategory={setConvertIssue}
          onCreateForColumn={(status) => createIssue(status, "task")}
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
            onSelectIssue={openIssue}
            onDeleteIssue={setDeleteIssue}
            onConvertCategory={setConvertIssue}
            onConvertToCanvas={setCanvasIssue}
            selectable={archiveMode}
            selectedIds={selectedIds}
            onToggleSelect={toggleSelect}
            onToggleSelectAll={toggleSelectAll}
          />
        </>
      )}

      {/* Detail sidebar */}
      <IssueDetail
        issue={editIssue}
        onOpenChange={(o) => { if (!o) setEditIssue(null); }}
        clients={clients}
        onUpdate={updateIssue}
        onConvertToCanvas={setCanvasIssue}
      />

      {/* Convert to canvas — its own dialog: it moves words, not just a flag */}
      <Dialog
        open={!!canvasIssue}
        onOpenChange={(o) => {
          if (!o && !convertingToCanvas) setCanvasIssue(null);
        }}
      >
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Convert to canvas</DialogTitle>
            <DialogDescription>
              {`"${canvasIssue?.title}" becomes a canvas of connected ideas. Its description becomes the first idea on it.`}
              {canvasIssue?.category === "task" &&
                " Status and due date will be hidden but preserved."}{" "}
              A canvas cannot be turned back into a text note or a task.
            </DialogDescription>
          </DialogHeader>
          <div className="flex gap-2 justify-end pt-2">
            <Button
              variant="outline"
              disabled={convertingToCanvas}
              onClick={() => setCanvasIssue(null)}
            >
              Cancel
            </Button>
            <Button
              disabled={convertingToCanvas}
              onClick={() => {
                if (canvasIssue) handleConvertToCanvas(canvasIssue);
              }}
            >
              {convertingToCanvas ? "Converting…" : "Convert"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

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
              This permanently removes them and everything on them — description
              and mentions. It cannot be undone.
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
