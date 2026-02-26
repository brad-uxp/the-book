"use client";

import { useEffect, useRef, useState } from "react";
import { Calendar, Check, ChevronsUpDown, ClipboardList, StickyNote } from "lucide-react";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
} from "@/components/ui/command";
import { formatDate } from "@/lib/dates";
import { MiniCalendar } from "@/components/ui/calendar";
import { cn } from "@/lib/utils";

// ── Shared types ─────────────────────────────────────────────────────────────

export interface Client {
  id: string;
  name: string;
  color_hex: string;
}

export const STATUSES = ["pending", "in_progress", "blocked", "done"] as const;
export type IssueStatus = (typeof STATUSES)[number];

export const COLUMNS: { id: IssueStatus; label: string; color: string }[] = [
  { id: "pending", label: "Pending", color: "#94a3b8" },
  { id: "in_progress", label: "In Progress", color: "#3b82f6" },
  { id: "blocked", label: "Blocked", color: "#f97316" },
  { id: "done", label: "Done", color: "#10b981" },
];

export type IssueCategory = "task" | "note";

export interface Issue {
  id: string;
  title: string;
  client_id: string | null;
  client: Client | null;
  category: IssueCategory;
  status: IssueStatus;
  progress: number;
  due_date: string | null;
  description: string;
}

// ── InlineProgress ───────────────────────────────────────────────────────────

export function InlineProgress({
  value,
  color,
  onCommit,
  onClose,
}: {
  value: number;
  color: string;
  onCommit: (v: number) => void;
  onClose?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(String(value));

  const commit = () => {
    const n = Math.min(100, Math.max(0, parseInt(draft) || 0));
    onCommit(n);
    setOpen(false);
  };

  return (
    <Popover
      open={open}
      onOpenChange={(o) => {
        if (o) setDraft(String(value));
        else { commit(); onClose?.(); }
        setOpen(o);
      }}
    >
      <PopoverTrigger asChild onClick={(e) => e.stopPropagation()}>
        <button className="flex items-center gap-2 w-full group/progress cursor-pointer">
          <span className="text-xs font-medium tabular-nums shrink-0 group-hover/progress:text-primary transition-colors">
            {value}%
          </span>
          <div className="h-1 flex-1 rounded-full bg-muted overflow-hidden">
            <div
              className="h-full rounded-full transition-all"
              style={{ width: `${value}%`, backgroundColor: color }}
            />
          </div>
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-auto p-2" align="start" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-1.5">
          <input
            type="number"
            min={0}
            max={100}
            value={draft}
            autoFocus
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") commit();
              if (e.key === "Escape") setOpen(false);
            }}
            className="w-14 rounded border bg-background px-2 py-1 text-sm tabular-nums text-center outline-none focus:ring-1 focus:ring-primary"
          />
          <span className="text-sm text-muted-foreground">%</span>
        </div>
      </PopoverContent>
    </Popover>
  );
}

// ── InlineDate ───────────────────────────────────────────────────────────────

export function InlineDate({
  value,
  status,
  isDueSoon,
  isOverdue,
  onCommit,
  onClose,
}: {
  value: string | null;
  status: IssueStatus;
  isDueSoon: boolean;
  isOverdue: boolean;
  onCommit: (iso: string | null) => void;
  onClose?: () => void;
}) {
  const [open, setOpen] = useState(false);

  return (
    <Popover open={open} onOpenChange={(o) => { setOpen(o); if (!o) onClose?.(); }}>
      <PopoverTrigger asChild onClick={(e) => e.stopPropagation()}>
        <button className="flex items-center gap-1 group/date cursor-pointer">
          <Calendar className="h-3 w-3 shrink-0 text-muted-foreground" />
          {value ? (
            <span
              className={cn(
                "text-xs group-hover/date:text-primary transition-colors",
                status !== "done" && isOverdue
                  ? "text-red-600 font-medium"
                  : status !== "done" && isDueSoon
                  ? "text-orange-600 font-medium"
                  : "text-muted-foreground"
              )}
            >
              {formatDate(value)}
            </span>
          ) : (
            <span className="text-xs text-muted-foreground/50 group-hover/date:text-primary transition-colors">
              No due date
            </span>
          )}
        </button>
      </PopoverTrigger>
      <PopoverContent
        className="w-auto p-3"
        align="start"
        onClick={(e) => e.stopPropagation()}
      >
        <MiniCalendar
          value={value?.slice(0, 10) ?? null}
          onSelect={(dateStr) => {
            onCommit(new Date(dateStr + "T00:00:00Z").toISOString());
            setOpen(false);
          }}
          onClear={() => {
            onCommit(null);
            setOpen(false);
          }}
        />
      </PopoverContent>
    </Popover>
  );
}

// ── InlineClient ─────────────────────────────────────────────────────────────

export function InlineClient({
  issue,
  clients,
  onCommit,
  onClose,
}: {
  issue: Issue;
  clients: Client[];
  onCommit: (clientId: string | null) => void;
  onClose?: () => void;
}) {
  const [open, setOpen] = useState(false);

  return (
    <Popover open={open} onOpenChange={(o) => { setOpen(o); if (!o) onClose?.(); }}>
      <PopoverTrigger asChild onClick={(e) => e.stopPropagation()}>
        {issue.client ? (
          <button
            className="inline-flex items-center self-start rounded px-1.5 py-0.5 text-xs font-medium truncate hover:opacity-80 transition-opacity"
            style={{
              backgroundColor: issue.client.color_hex + "18",
              color: issue.client.color_hex,
              border: `1px solid ${issue.client.color_hex}30`,
            }}
          >
            {issue.client.name}
            <ChevronsUpDown className="ml-1 h-3 w-3 opacity-50" />
          </button>
        ) : (
          <button className="text-xs text-muted-foreground/50 hover:text-muted-foreground transition-colors flex items-center gap-0.5">
            No client
            <ChevronsUpDown className="h-3 w-3 opacity-50" />
          </button>
        )}
      </PopoverTrigger>
      <PopoverContent className="w-52 p-0" align="start" onClick={(e) => e.stopPropagation()}>
        <Command>
          <CommandInput placeholder="Search client..." />
          <CommandEmpty>No client found.</CommandEmpty>
          <CommandGroup className="max-h-48 overflow-y-auto">
            <CommandItem
              value="__none__"
              onSelect={() => { onCommit(null); setOpen(false); }}
            >
              <span className="text-muted-foreground">No client</span>
              {!issue.client_id && <Check className="ml-auto h-3.5 w-3.5" />}
            </CommandItem>
            {clients.map((c) => (
              <CommandItem
                key={c.id}
                value={c.name}
                onSelect={() => { onCommit(c.id); setOpen(false); }}
              >
                <span
                  className="h-2 w-2 rounded-full shrink-0 mr-2"
                  style={{ backgroundColor: c.color_hex }}
                />
                {c.name}
                {issue.client_id === c.id && <Check className="ml-auto h-3.5 w-3.5" />}
              </CommandItem>
            ))}
          </CommandGroup>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

// ── InlineStatus ─────────────────────────────────────────────────────────────

export function InlineStatus({
  value,
  onCommit,
  onClose,
}: {
  value: IssueStatus;
  onCommit: (status: IssueStatus) => void;
  onClose?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const col = COLUMNS.find((c) => c.id === value);

  return (
    <Popover open={open} onOpenChange={(o) => { setOpen(o); if (!o) onClose?.(); }}>
      <PopoverTrigger asChild onClick={(e) => e.stopPropagation()}>
        <button className="flex items-center gap-1.5 text-sm hover:text-primary transition-colors cursor-pointer">
          <span
            className="h-2 w-2 rounded-full shrink-0"
            style={{ backgroundColor: col?.color }}
          />
          {col?.label}
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-40 p-1" align="start" onClick={(e) => e.stopPropagation()}>
        {COLUMNS.map((c) => (
          <button
            key={c.id}
            className="flex items-center gap-2 w-full px-2 py-1.5 text-sm rounded hover:bg-accent transition-colors"
            onClick={() => { onCommit(c.id); setOpen(false); }}
          >
            <span
              className="h-2 w-2 rounded-full shrink-0"
              style={{ backgroundColor: c.color }}
            />
            {c.label}
            {c.id === value && <Check className="ml-auto h-3.5 w-3.5" />}
          </button>
        ))}
      </PopoverContent>
    </Popover>
  );
}

// ── InlineCategory ────────────────────────────────────────────────────────────

const CATEGORY_OPTIONS: { id: IssueCategory; label: string; icon: typeof ClipboardList }[] = [
  { id: "task", label: "Task", icon: ClipboardList },
  { id: "note", label: "Note", icon: StickyNote },
];

export function InlineCategory({
  value,
  onCommit,
  onClose,
}: {
  value: IssueCategory;
  onCommit: (category: IssueCategory) => void;
  onClose?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const current = CATEGORY_OPTIONS.find((o) => o.id === value);

  return (
    <Popover open={open} onOpenChange={(o) => { setOpen(o); if (!o) onClose?.(); }}>
      <PopoverTrigger asChild onClick={(e) => e.stopPropagation()}>
        <button className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-xs font-medium bg-muted text-muted-foreground hover:bg-muted/80 transition-colors cursor-pointer">
          {current?.label}
          <ChevronsUpDown className="h-3 w-3 opacity-50" />
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-36 p-1" align="start" onClick={(e) => e.stopPropagation()}>
        {CATEGORY_OPTIONS.map((opt) => (
          <button
            key={opt.id}
            className="flex items-center gap-2 w-full px-2 py-1.5 text-sm rounded hover:bg-accent transition-colors"
            onClick={() => { onCommit(opt.id); setOpen(false); }}
          >
            {opt.label}
            {opt.id === value && <Check className="ml-auto h-3.5 w-3.5" />}
          </button>
        ))}
      </PopoverContent>
    </Popover>
  );
}

// ── InlineTitle ──────────────────────────────────────────────────────────────

export function InlineTitle({
  value,
  onCommit,
}: {
  value: string;
  onCommit: (title: string) => void;
}) {
  const [draft, setDraft] = useState(value);
  const ref = useRef<HTMLTextAreaElement>(null);

  useEffect(() => setDraft(value), [value]);

  // Auto-resize textarea to fit content
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, [draft]);

  const commit = () => {
    const trimmed = draft.trim();
    if (trimmed && trimmed !== value) onCommit(trimmed);
    else setDraft(value);
  };

  return (
    <textarea
      ref={ref}
      value={draft}
      rows={1}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          commit();
          (e.target as HTMLTextAreaElement).blur();
        }
        if (e.key === "Escape") {
          setDraft(value);
          (e.target as HTMLTextAreaElement).blur();
        }
      }}
      className="w-full text-lg font-semibold bg-transparent border-none outline-none focus:ring-0 px-0 py-0 hover:text-primary/80 transition-colors placeholder:text-muted-foreground/50 resize-none overflow-hidden wrap-break-word"
      placeholder="Untitled issue"
    />
  );
}
