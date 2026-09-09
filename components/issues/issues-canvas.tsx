"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTheme } from "next-themes";
import {
  Background,
  BackgroundVariant,
  ConnectionMode,
  MarkerType,
  ReactFlow,
  useEdgesState,
  useNodesState,
  type ColorMode,
  type Connection,
  type Edge,
  type OnNodeDrag,
  type Viewport,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { Maximize2, Minimize2, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useNow } from "@/hooks/use-now";
import {
  GRID_SIZE,
  isPlaced,
  layoutUnplaced,
  type CanvasPosition,
} from "@/lib/issue-canvas";
import {
  CanvasIssueNode,
  CanvasNowContext,
  FloatingEdge,
  type IssueNode,
} from "./canvas-node";
import { type Issue, type IssueLink } from "./inline-editors";

/**
 * Defined once at module scope. React Flow warns loudly and re-mounts every
 * node if these objects change identity between renders.
 */
const nodeTypes = { issue: CanvasIssueNode };
const edgeTypes = { floating: FloatingEdge };

/**
 * Where the user last panned to. Per-viewer UI state, not data: it belongs in
 * this browser, not in a column every client would have to agree on.
 */
const VIEWPORT_KEY = "issues-canvas-viewport";

function readViewport(): Viewport | null {
  try {
    const raw = localStorage.getItem(VIEWPORT_KEY);
    if (!raw) return null;
    const v = JSON.parse(raw) as Partial<Viewport>;
    if (
      typeof v.x === "number" &&
      typeof v.y === "number" &&
      typeof v.zoom === "number" &&
      Number.isFinite(v.x) &&
      Number.isFinite(v.y) &&
      v.zoom > 0
    ) {
      return { x: v.x, y: v.y, zoom: v.zoom };
    }
  } catch {
    // Private mode, cleared storage, hand-edited value — fit the view instead.
  }
  return null;
}

/** Arrow head. A literal colour: a CSS var does not resolve inside <marker>. */
const ARROW = {
  type: MarkerType.ArrowClosed,
  width: 16,
  height: 16,
  color: "#94a3b8",
} as const;

/** Ordered pair, the same key the database enforces as unique. */
function linkKey(source: string, target: string): string {
  return `${source}->${target}`;
}

interface Props {
  issues: Issue[];
  links: IssueLink[];
  onSelectIssue: (issue: Issue) => void;
  /** Persists positions. Must be referentially stable — it drives an effect. */
  onMoveIssues: (positions: CanvasPosition[]) => void;
  onConnectIssues: (sourceId: string, targetId: string) => void;
  onDisconnectLinks: (linkIds: string[]) => void;
  onCreateIssue: () => void;
}

export function IssuesCanvas({
  issues,
  links,
  onSelectIssue,
  onMoveIssues,
  onConnectIssues,
  onDisconnectLinks,
  onCreateIssue,
}: Props) {
  const { theme = "system" } = useTheme();
  const now = useNow();
  const [expanded, setExpanded] = useState(false);

  // Escape leaves the expanded canvas — but not while the detail layer is
  // open, where Escape belongs to it. The detail is a sheet at one size and a
  // dialog at the other, so the guard looks for the role both render rather
  // than for either component.
  useEffect(() => {
    if (!expanded) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (document.querySelector("[role='dialog'][data-state='open']")) return;
      setExpanded(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [expanded]);

  const [nodes, setNodes, onNodesChange] = useNodesState<IssueNode>([]);

  // Distinguishes "let go of a card" from "clicked a card". React Flow fires a
  // click at the end of a drag too, and opening the detail sheet every time
  // someone moves something would make the canvas unusable.
  const draggedAt = useRef(0);

  // State, not a ref: this is read during render to configure React Flow, and
  // reading a ref there is exactly what the compiler forbids. A lazy
  // initialiser runs once, which is all this needs — the component only mounts
  // client-side.
  const [initialViewport] = useState<Viewport | null>(readViewport);

  useEffect(() => {
    // Issues that have never been placed get a spot below everything already
    // on the canvas, and that spot is written back so the next visit is
    // identical. Nothing already positioned is touched.
    const placements = new Map(layoutUnplaced(issues).map((p) => [p.id, p]));

    setNodes((prev) => {
      const live = new Map(prev.map((n) => [n.id, n.position]));
      return issues.map((issue) => {
        const fresh = placements.get(issue.id);
        return {
          id: issue.id,
          type: "issue" as const,
          // A position already on screen wins: a card being dragged while the
          // parent re-renders must not snap back to its stored coordinates.
          position:
            live.get(issue.id) ??
            (isPlaced(issue)
              ? { x: issue.canvas_x as number, y: issue.canvas_y as number }
              : { x: fresh?.x ?? 0, y: fresh?.y ?? 0 }),
          data: { issue },
        };
      });
    });

    if (placements.size > 0) onMoveIssues([...placements.values()]);
  }, [issues, setNodes, onMoveIssues]);

  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);

  const deleteLink = useCallback(
    (id: string) => onDisconnectLinks([id]),
    [onDisconnectLinks]
  );

  useEffect(() => {
    // An edge to a card the filters hid would render as a line into nowhere.
    const visible = new Set(issues.map((i) => i.id));

    setEdges((prev) => {
      // Rebuilding from props would otherwise drop the selection mid-click,
      // and the × lives on the selected edge.
      const selected = new Set(prev.filter((e) => e.selected).map((e) => e.id));

      return links
        .filter((l) => visible.has(l.source_id) && visible.has(l.target_id))
        .map((l) => ({
          id: l.id,
          source: l.source_id,
          target: l.target_id,
          type: "floating",
          label: l.label ?? undefined,
          markerEnd: ARROW,
          selected: selected.has(l.id),
          // An edge still being written cannot be deleted: there is no row to
          // delete yet, and its temporary id would 404.
          deletable: !l.pending,
          selectable: !l.pending,
          data: { onDelete: deleteLink },
        }));
    });
  }, [issues, links, setEdges, deleteLink]);

  /** Ordered pairs that already exist, so a duplicate never leaves the client. */
  const existingKeys = useMemo(
    () => new Set(links.map((l) => linkKey(l.source_id, l.target_id))),
    [links]
  );

  const isValidConnection = useCallback(
    (c: Connection | Edge) => {
      const source = "source" in c ? c.source : null;
      const target = "target" in c ? c.target : null;
      if (!source || !target) return false;
      // Both are also enforced in the database — a CHECK and a unique index.
      if (source === target) return false;
      return !existingKeys.has(linkKey(source, target));
    },
    [existingKeys]
  );

  const handleConnect = useCallback(
    (c: Connection) => {
      if (!c.source || !c.target || c.source === c.target) return;
      onConnectIssues(c.source, c.target);
    },
    [onConnectIssues]
  );

  /**
   * Delete removes connections, never cards.
   *
   * React Flow's delete key takes selected nodes with it by default, and a
   * node here IS an issue — a stray keystroke would erase work through a path
   * with no confirmation dialog. Deleting an issue stays where it already is:
   * the three-dot menu, behind a confirmation.
   */
  const handleBeforeDelete = useCallback(
    async ({ edges: doomed }: { nodes: IssueNode[]; edges: Edge[] }) => ({
      nodes: [],
      edges: doomed,
    }),
    []
  );

  const handleEdgesDelete = useCallback(
    (deleted: Edge[]) => {
      const ids = deleted.map((e) => e.id);
      if (ids.length > 0) onDisconnectLinks(ids);
    },
    [onDisconnectLinks]
  );

  const handleDragStop = useCallback<OnNodeDrag<IssueNode>>(
    (_event, _node, dragged) => {
      draggedAt.current = Date.now();
      onMoveIssues(
        dragged.map((n) => ({ id: n.id, x: n.position.x, y: n.position.y }))
      );
    },
    [onMoveIssues]
  );

  const handleNodeClick = useCallback(
    (_event: React.MouseEvent, node: IssueNode) => {
      if (Date.now() - draggedAt.current < 150) return;
      onSelectIssue(node.data.issue);
    },
    [onSelectIssue]
  );

  const handleMoveEnd = useCallback((_event: unknown, viewport: Viewport) => {
    try {
      localStorage.setItem(VIEWPORT_KEY, JSON.stringify(viewport));
    } catch {
      // Not being able to remember the viewport is not worth an error.
    }
  }, []);

  return (
    <div
      className={cn(
        "relative w-full overflow-hidden border",
        expanded
          ? // Above the sidebar (also z-50, but earlier in the DOM) and below
            // the detail sheet, whose portal is appended last to <body> — so
            // editing keeps working with the canvas filling the screen.
            "fixed inset-0 z-50 rounded-none bg-background"
          : "h-[calc(100vh-15rem)] min-h-96 rounded-xl"
      )}
    >
      <CanvasNowContext.Provider value={now}>
        <ReactFlow
          nodes={nodes}
          edges={edges}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          nodeTypes={nodeTypes}
          edgeTypes={edgeTypes}
          colorMode={theme as ColorMode}
          onNodeDragStop={handleDragStop}
          onNodeClick={handleNodeClick}
          onMoveEnd={handleMoveEnd}
          defaultViewport={initialViewport ?? undefined}
          fitView={initialViewport === null}
          fitViewOptions={{ padding: 0.2, maxZoom: 1 }}
          snapToGrid
          snapGrid={[GRID_SIZE, GRID_SIZE]}
          minZoom={0.2}
          maxZoom={2}
          onConnect={handleConnect}
          isValidConnection={isValidConnection}
          onBeforeDelete={handleBeforeDelete}
          onEdgesDelete={handleEdgesDelete}
          // Loose: a connection can be dropped on any handle, not only on one
          // declared as a target. All four dots on a card are sources.
          connectionMode={ConnectionMode.Loose}
          // Generous, so dropping near a card counts as dropping on it.
          connectionRadius={40}
          connectionLineStyle={{ strokeWidth: 2, stroke: "#94a3b8" }}
          deleteKeyCode={["Backspace", "Delete"]}
          proOptions={{ hideAttribution: true }}
          // Trackpad-first: two fingers pan, pinch zooms, shift+drag boxes a
          // selection. Wheel-to-zoom fights every gesture on a laptop.
          panOnScroll
        >
          <Background variant={BackgroundVariant.Dots} gap={GRID_SIZE * 3} size={1} />
        </ReactFlow>

        <div className="absolute top-3 right-3 z-10 flex items-center gap-2">
          {/* Expanded covers the page header, so the only way to add an issue
              would otherwise be to collapse first. */}
          {expanded && (
            <Button
              size="icon"
              className="h-8 w-8 shadow-sm"
              title="New issue"
              aria-label="New issue"
              onClick={onCreateIssue}
            >
              <Plus className="h-4 w-4" />
            </Button>
          )}
          <Button
            variant="outline"
            size="icon"
            className="h-8 w-8 bg-card shadow-sm"
            title={expanded ? "Collapse canvas" : "Expand canvas"}
            aria-label={expanded ? "Collapse canvas" : "Expand canvas"}
            onClick={() => setExpanded((v) => !v)}
          >
            {expanded ? (
              <Minimize2 className="h-4 w-4" />
            ) : (
              <Maximize2 className="h-4 w-4" />
            )}
          </Button>
        </div>
      </CanvasNowContext.Provider>

      {issues.length === 0 && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <p className="text-sm text-muted-foreground/60">
            No issues to show on the canvas.
          </p>
        </div>
      )}
    </div>
  );
}
