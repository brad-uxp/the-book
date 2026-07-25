"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useMediaQuery } from "@/hooks/use-media-query";
import { useRouter, useSearchParams } from "next/navigation";
import { Filter, LayoutGrid, LayoutList, Plus, Search, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
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
import { IssuesBoard } from "./issues-board";
import { IssuesList } from "./issues-list";
import {
  type Issue,
  type Client,
  type IssueStatus,
  type IssueCategory,
  COLUMNS,
} from "./inline-editors";

interface Props {
  clients: Client[];
  initialIssues: Issue[];
}

export function IssuesView({ clients, initialIssues }: Props) {
  const [view, setViewState] = useState<"board" | "list">(() => {
    if (typeof window !== "undefined") {
      const saved = localStorage.getItem("issues-view-mode");
      if (saved === "board" || saved === "list") return saved;
    }
    return "board";
  });
  const setView = (v: "board" | "list") => {
    setViewState(v);
    localStorage.setItem("issues-view-mode", v);
  };
  const [issues, setIssues] = useState<Issue[]>(initialIssues);
  const [editIssue, setEditIssue] = useState<Issue | null>(null);
  const [deleteIssue, setDeleteIssue] = useState<Issue | null>(null);
  const [convertIssue, setConvertIssue] = useState<Issue | null>(null);
  const [search, setSearch] = useState("");
  const [filterClient, setFilterClient] = useState<string>("all");
  const [filterStatus, setFilterStatus] = useState<string>("all");
  const debounceRef = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  const router = useRouter();
  const searchParams = useSearchParams();

  // On mobile (<sm), always show list view
  const isMobile = useMediaQuery("(max-width: 639px)");
  const effectiveView = isMobile ? "list" : view;

  const filteredIssues = useMemo(() => {
    let result = issues;
    if (search) {
      const q = search.toLowerCase();
      result = result.filter((i) => i.title.toLowerCase().includes(q));
    }
    if (filterClient !== "all") {
      result = result.filter((i) =>
        filterClient === "none" ? !i.client_id : i.client_id === filterClient
      );
    }
    if (filterStatus !== "all") {
      result = result.filter((i) => i.status === filterStatus);
    }
    return result;
  }, [issues, search, filterClient, filterStatus]);

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

  const handleConvertCategory = (issue: Issue) => {
    const newCategory: IssueCategory = issue.category === "task" ? "note" : "task";
    updateIssue(issue.id, { category: newCategory });
    setConvertIssue(null);
  };

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
                <SelectContent>
                  <SelectItem value="all">All status</SelectItem>
                  {COLUMNS.map((col) => (
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
                </SelectContent>
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
          <SelectContent>
            <SelectItem value="all">All status</SelectItem>
            {COLUMNS.map((col) => (
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
          </SelectContent>
        </Select>

        </div>

        <Button
          className="h-8 w-8 shrink-0 sm:w-auto sm:px-3"
          onClick={() => createIssue("pending", effectiveView === "list" ? "note" : "task")}
        >
          <Plus className="h-4 w-4 sm:mr-2" />
          <span className="hidden sm:inline">New Issue</span>
        </Button>
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
        <IssuesList
          issues={filteredIssues}
          clients={clients}
          onSelectIssue={setEditIssue}
          onDeleteIssue={setDeleteIssue}
          onConvertCategory={setConvertIssue}
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
