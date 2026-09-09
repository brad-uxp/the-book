"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTheme } from "next-themes";
import {
  Background,
  BackgroundVariant,
  Controls,
  MarkerType,
  MiniMap,
  ReactFlow,
  useNodesState,
  type ColorMode,
  type Edge,
  type OnNodeDrag,
  type Viewport,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
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
import { COLUMNS, type Issue, type IssueLink } from "./inline-editors";

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

interface Props {
  issues: Issue[];
  links: IssueLink[];
  onSelectIssue: (issue: Issue) => void;
  /** Persists positions. Must be referentially stable — it drives an effect. */
  onMoveIssues: (positions: CanvasPosition[]) => void;
}

export function IssuesCanvas({
  issues,
  links,
  onSelectIssue,
  onMoveIssues,
}: Props) {
  const { theme = "system" } = useTheme();
  const now = useNow();

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

  const edges = useMemo<Edge[]>(() => {
    // An edge to a card the filters hid would render as a line into nowhere.
    const visible = new Set(issues.map((i) => i.id));
    return links
      .filter((l) => visible.has(l.source_id) && visible.has(l.target_id))
      .map((l) => ({
        id: l.id,
        source: l.source_id,
        target: l.target_id,
        type: "floating",
        label: l.label ?? undefined,
        markerEnd: ARROW,
      }));
  }, [issues, links]);

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
    <div className="relative h-[calc(100vh-15rem)] min-h-96 w-full overflow-hidden rounded-xl border">
      <CanvasNowContext.Provider value={now}>
        <ReactFlow
          nodes={nodes}
          edges={edges}
          onNodesChange={onNodesChange}
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
          // Connecting and deleting arrive with the next step. Until the
          // handlers exist, letting React Flow mutate its own state would drift
          // from the database with nothing writing the change back.
          nodesConnectable={false}
          deleteKeyCode={null}
          // Trackpad-first: two fingers pan, pinch zooms, shift+drag boxes a
          // selection. Wheel-to-zoom fights every gesture on a laptop.
          panOnScroll
        >
          <Background variant={BackgroundVariant.Dots} gap={GRID_SIZE * 3} size={1} />
          <MiniMap
            pannable
            zoomable
            nodeColor={(n) => {
              const issue = (n.data as { issue?: Issue }).issue;
              if (!issue) return "#94a3b8";
              if (issue.category === "note") return "#a78bfa";
              return COLUMNS.find((c) => c.id === issue.status)?.color ?? "#94a3b8";
            }}
            className="!bottom-3 !right-3 !bg-card"
          />
          {/* Zoom in/out and fit-view come built in. */}
          <Controls showInteractive={false} className="!bottom-3 !left-3" />
        </ReactFlow>
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
