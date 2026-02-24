"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { LayoutGrid, LayoutList, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { IssueDetail } from "./issue-detail";
import { IssuesBoard } from "./issues-board";
import { IssuesList } from "./issues-list";
import {
  type Issue,
  type Client,
  type IssueStatus,
  type IssueCategory,
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
  const debounceRef = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  const router = useRouter();
  const searchParams = useSearchParams();

  // Deep-link: open issue detail from ?issue=<id>
  useEffect(() => {
    const issueId = searchParams.get("issue");
    if (issueId) {
      const issue = issues.find((t) => t.id === issueId);
      if (issue) {
        if (issue.category === "note") setView("list");
        setEditIssue(issue);
      }
      router.replace("/issues", { scroll: false });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
      <div className="flex items-center justify-between">
        <div className="flex overflow-hidden rounded-md border">
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

        {view === "list" ? (
          <Button onClick={() => createIssue("pending", "note")}>
            <Plus className="mr-2 h-4 w-4" /> New Issue
          </Button>
        ) : (
          <Button onClick={() => createIssue("pending", "task")}>
            <Plus className="mr-2 h-4 w-4" /> New Issue
          </Button>
        )}
      </div>

      {/* Views */}
      {view === "board" && (
        <IssuesBoard
          issues={issues}
          clients={clients}
          setIssues={setIssues}
          onUpdateIssue={updateIssue}
          onSelectIssue={setEditIssue}
          onDeleteIssue={setDeleteIssue}
          onConvertCategory={setConvertIssue}
          onCreateForColumn={createIssue}
        />
      )}

      {view === "list" && (
        <IssuesList
          issues={issues}
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
