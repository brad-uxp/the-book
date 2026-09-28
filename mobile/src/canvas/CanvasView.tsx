import { memo, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState, type Ref } from "react";
import { Pressable, StyleSheet, Text, View, type LayoutChangeEvent } from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated, {
  runOnJS,
  useAnimatedProps,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
  type SharedValue,
} from "react-native-reanimated";
import Svg, { G, Path } from "react-native-svg";
import { Ban, Check, Palette as PaletteIcon, PencilLine, RotateCcw, Trash2, X } from "lucide-react-native";
import { CANVAS_COLORS, CANVAS_COLOR_KEYS, canvasColor } from "@shared/canvas-palette";
import { snapToGrid } from "@shared/canvas-geometry";
import { font, type Palette } from "@/lib/theme";
import type { CanvasConnectionRow, CanvasIdeaRow } from "@/notes/hooks";
import {
  cardAt,
  distanceToEdge,
  dotAt,
  dotPoints,
  edgePath,
  fitView,
  grabRadius,
  pinchView,
  toWorld,
  type CardBox,
  type EdgePath,
  type Side,
  type View as Viewport,
} from "./geometry";
import { RichTextView } from "./RichTextView";

/** A card's height until it has been measured. */
const UNMEASURED_HEIGHT = 80;
/** How close (screen px) a fingertip must land to a dot to grab it. */
const DOT_RADIUS = 26;
/** How close (screen px) a tap must land to a line to select it. */
const EDGE_TAP_PX = 16;
/** Two taps this close in time, on the same thing, are a double tap. */
const DOUBLE_TAP_MS = 320;
/** Room around the cards for the curves, which bow out past them. */
const EDGE_PAD = 240;

export interface CanvasHandle {
  /** The world point at the middle of what the screen shows — where the + puts a new idea. */
  viewCenter(): { x: number; y: number };
  fit(): void;
  select(id: string | null): void;
}

export interface CanvasViewProps {
  ideas: CanvasIdeaRow[];
  connections: CanvasConnectionRow[];
  c: Palette;
  onEditIdea: (id: string) => void;
  onCreateIdeaAt: (at: { x: number; y: number }) => void;
  onMoveIdea: (id: string, x: number, y: number) => void;
  onConnect: (input: { sourceId: string; sourceSide: Side; targetId: string; targetSide: Side | null }) => void;
  onConnectToEmpty: (input: { sourceId: string; sourceSide: Side; at: { x: number; y: number } }) => void;
  onColor: (id: string, color: string | null) => void;
  onDeleteIdea: (id: string) => void;
  onDeleteConnection: (id: string) => void;
  onResetConnection: (id: string) => void;
  ref?: Ref<CanvasHandle>;
}

type Selection = { kind: "idea"; id: string } | { kind: "edge"; id: string } | null;

/**
 * A canvas note on the phone: the approved prototype's gestures, at 60 fps.
 *
 * One finger on empty space pans; a pinch zooms (and pans, as the fingers
 * move); a two-finger double tap fits everything. A tap selects a card (its
 * four dots and a toolbar appear) or a connection; a double tap opens a card
 * in the editor, or makes an idea on empty space. A selected card drags; a
 * dot drags out a connection — onto another card's dot it pins both sides,
 * onto a card's body that end is left to the canvas, onto empty space it
 * makes a new connected idea.
 *
 * Pan and zoom run on the UI thread (the viewport is three shared values
 * driving one transform). Where a touch starts decides what it does, also on
 * the UI thread (the hit tests in ./geometry are worklets). Moving a card and
 * following a connection go through React at frame rate: the card and the
 * lines on it must move together.
 */
export function CanvasView({
  ideas,
  connections,
  c,
  onEditIdea,
  onCreateIdeaAt,
  onMoveIdea,
  onConnect,
  onConnectToEmpty,
  onColor,
  onDeleteIdea,
  onDeleteConnection,
  onResetConnection,
  ref,
}: CanvasViewProps) {
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [heights, setHeights] = useState<Record<string, number>>({});
  const [selection, setSelection] = useState<Selection>(null);
  const [drag, setDrag] = useState<{ id: string; dx: number; dy: number } | null>(null);
  /** Where a moved card was dropped, until the store has it — no jump back meanwhile. */
  const [landed, setLanded] = useState<Record<string, { x: number; y: number }>>({});
  const [hoverId, setHoverId] = useState<string | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [palette, setPalette] = useState(false);

  // ── Viewport ───────────────────────────────────────────────────────────────
  const vx = useSharedValue(0);
  const vy = useSharedValue(0);
  const vz = useSharedValue(1);
  const fitted = useRef(false);

  const currentView = useCallback((): Viewport => ({ x: vx.get(), y: vy.get(), z: vz.get() }), [vx, vy, vz]);

  // ── Boxes: what is drawn, and what the hit tests see ──────────────────────
  const boxes = useMemo<CardBox[]>(
    () =>
      ideas.map((idea) => {
        const at = landed[idea.id] ?? { x: idea.x, y: idea.y };
        const moving = drag && drag.id === idea.id;
        return {
          id: idea.id,
          x: moving ? snapToGrid(at.x + drag.dx) : at.x,
          y: moving ? snapToGrid(at.y + drag.dy) : at.y,
          w: idea.width,
          h: heights[idea.id] ?? UNMEASURED_HEIGHT,
        };
      }),
    [ideas, landed, drag, heights]
  );
  const boxById = useMemo(() => new Map(boxes.map((b) => [b.id, b])), [boxes]);

  // A dropped card's position is kept until the store reports it.
  useEffect(() => {
    // Syncing with the store the drop wrote to: the override goes once it landed.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLanded((prev) => {
      let changed = false;
      const next = { ...prev };
      for (const [id, p] of Object.entries(prev)) {
        const idea = ideas.find((i) => i.id === id);
        if (!idea || (idea.x === p.x && idea.y === p.y)) {
          delete next[id];
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, [ideas]);

  // A selection whose card or line is gone is no selection.
  const selected = selection?.kind === "idea" ? (boxById.get(selection.id) ?? null) : null;
  const selectedEdge = selection?.kind === "edge" ? (connections.find((e) => e.id === selection.id) ?? null) : null;
  useEffect(() => {
    if (selection && !selected && !selectedEdge) setSelection(null); // eslint-disable-line react-hooks/set-state-in-effect
  }, [selection, selected, selectedEdge]);

  const paths = useMemo(() => {
    const out: { id: string; path: EdgePath }[] = [];
    for (const e of connections) {
      const a = boxById.get(e.source_id);
      const b = boxById.get(e.target_id);
      if (!a || !b) continue;
      out.push({
        id: e.id,
        path: edgePath({ x: a.x, y: a.y, width: a.w, height: a.h }, { x: b.x, y: b.y, width: b.w, height: b.h }, e.source_side, e.target_side),
      });
    }
    return out;
  }, [connections, boxById]);

  const boxesSV = useSharedValue<CardBox[]>([]);
  const selectedIdx = useSharedValue(-1);
  useEffect(() => {
    boxesSV.set(boxes);
    selectedIdx.set(selected ? boxes.findIndex((b) => b.id === selected.id) : -1);
  }, [boxes, selected, boxesSV, selectedIdx]);

  // ── Framing ────────────────────────────────────────────────────────────────
  const fit = useCallback(
    (animated: boolean) => {
      const v = fitView(boxes, size.w, size.h);
      const t = { duration: 260 };
      vx.set(animated ? withTiming(v.x, t) : v.x);
      vy.set(animated ? withTiming(v.y, t) : v.y);
      vz.set(animated ? withTiming(v.z, t) : v.z);
    },
    [boxes, size, vx, vy, vz]
  );

  useEffect(() => {
    if (fitted.current || size.w === 0) return;
    fitted.current = true;
    fit(false);
  }, [fit, size.w]);

  useImperativeHandle(
    ref,
    () => ({
      viewCenter: () => toWorld(currentView(), size.w / 2, size.h / 2.4),
      fit: () => fit(true),
      select: (id) => setSelection(id ? { kind: "idea", id } : null),
    }),
    [currentView, fit, size]
  );

  // ── What gestures do (on the JS thread) ────────────────────────────────────
  const lastTap = useRef<{ target: string; t: number }>({ target: "", t: 0 });

  const handlers = {
    tap: (sx: number, sy: number) => {
      setPalette(false);
      const v = currentView();
      const w = toWorld(v, sx, sy);
      const idx = cardAt(boxes, w.x, w.y);
      const now = Date.now();
      const target = idx >= 0 ? `card:${boxes[idx].id}` : "empty";
      const double = lastTap.current.target === target && now - lastTap.current.t < DOUBLE_TAP_MS;
      lastTap.current = { target: double ? "" : target, t: now };

      if (idx >= 0) {
        const id = boxes[idx].id;
        setSelection({ kind: "idea", id });
        if (double) onEditIdea(id);
        return;
      }
      let nearest: { id: string; d: number } | null = null;
      for (const p of paths) {
        const d = distanceToEdge(w, p.path);
        if (d * v.z <= EDGE_TAP_PX && (!nearest || d < nearest.d)) nearest = { id: p.id, d };
      }
      if (nearest) {
        setSelection({ kind: "edge", id: nearest.id });
        return;
      }
      if (double) onCreateIdeaAt(w);
      else setSelection(null);
    },
    move: (dx: number, dy: number) => {
      if (selected) setDrag({ id: selected.id, dx, dy });
    },
    moveEnd: (dx: number, dy: number) => {
      if (!selected) return;
      const idea = ideas.find((i) => i.id === selected.id);
      setDrag(null);
      if (!idea || (dx === 0 && dy === 0)) return;
      const from = landed[idea.id] ?? { x: idea.x, y: idea.y };
      const x = snapToGrid(from.x + dx);
      const y = snapToGrid(from.y + dy);
      if (x === idea.x && y === idea.y) return;
      setLanded((prev) => ({ ...prev, [idea.id]: { x, y } }));
      onMoveIdea(idea.id, x, y);
    },
    connectStart: () => {
      setConnecting(true);
      setPalette(false);
    },
    hover: (sx: number, sy: number) => {
      const w = toWorld(currentView(), sx, sy);
      const idx = cardAt(boxes, w.x, w.y);
      const id = idx >= 0 && boxes[idx].id !== selected?.id ? boxes[idx].id : null;
      setHoverId((prev) => (prev === id ? prev : id));
    },
    connectEnd: (sx: number, sy: number, sideIndex: number) => {
      setConnecting(false);
      setHoverId(null);
      if (!selected) return;
      const sourceSide = (["top", "right", "bottom", "left"] as const)[sideIndex];
      const v = currentView();
      const w = toWorld(v, sx, sy);
      const idx = cardAt(boxes, w.x, w.y);
      if (idx >= 0) {
        const target = boxes[idx];
        if (target.id === selected.id) return;
        onConnect({
          sourceId: selected.id,
          sourceSide,
          targetId: target.id,
          targetSide: dotAt(target, v, sx, sy, grabRadius(target, v, w.x, w.y, DOT_RADIUS)),
        });
        return;
      }
      onConnectToEmpty({ sourceId: selected.id, sourceSide, at: w });
    },
    connectCancel: () => {
      setConnecting(false);
      setHoverId(null);
    },
    fit: () => fit(true),
  };
  const handlersRef = useRef(handlers);
  useEffect(() => {
    handlersRef.current = handlers;
  });
  const dispatch = useCallback((type: keyof typeof handlers, a: number, b: number, c3: number) => {
    const h = handlersRef.current[type] as (a: number, b: number, c: number) => void;
    h(a, b, c3);
  }, []);

  // ── Gestures (worklets) ────────────────────────────────────────────────────
  const mode = useSharedValue(0); // 0 none · 1 pan · 2 move · 3 connect
  const active = useSharedValue(false);
  const sx0 = useSharedValue(0);
  const sy0 = useSharedValue(0);
  const sz0 = useSharedValue(1);
  const sideIdx = useSharedValue(0);
  const moveX = useSharedValue(0);
  const moveY = useSharedValue(0);
  const lineX0 = useSharedValue(0);
  const lineY0 = useSharedValue(0);
  const lineX1 = useSharedValue(0);
  const lineY1 = useSharedValue(0);
  const lineOn = useSharedValue(0);
  const pz0 = useSharedValue(1);
  const px0 = useSharedValue(0);
  const py0 = useSharedValue(0);
  const fx0 = useSharedValue(0);
  const fy0 = useSharedValue(0);

  /* eslint-disable react-hooks/refs -- The callbacks below are worklets the
     gesture system runs on the UI thread, never during render; `dispatch`
     reaches the latest handlers through a ref for exactly that reason. */
  const gesture = useMemo(() => {
    const pan = Gesture.Pan()
      .maxPointers(1)
      .minDistance(10)
      .onBegin((e) => {
        const v = { x: vx.get(), y: vy.get(), z: vz.get() };
        sx0.set(v.x);
        sy0.set(v.y);
        sz0.set(v.z);
        active.set(false);
        mode.set(1);
        const idx = selectedIdx.get();
        const all = boxesSV.get();
        if (idx >= 0 && idx < all.length) {
          const b = all[idx];
          const w0 = toWorld(v, e.x, e.y);
          const side = dotAt(b, v, e.x, e.y, grabRadius(b, v, w0.x, w0.y, DOT_RADIUS));
          if (side) {
            mode.set(3);
            const sides = ["top", "right", "bottom", "left"];
            sideIdx.set(sides.indexOf(side));
            const px = side === "left" ? b.x : side === "right" ? b.x + b.w : b.x + b.w / 2;
            const py = side === "top" ? b.y : side === "bottom" ? b.y + b.h : b.y + b.h / 2;
            lineX0.set(px * v.z + v.x);
            lineY0.set(py * v.z + v.y);
            lineX1.set(lineX0.get());
            lineY1.set(lineY0.get());
          } else {
            const w = toWorld(v, e.x, e.y);
            if (w.x >= b.x && w.x <= b.x + b.w && w.y >= b.y && w.y <= b.y + b.h) mode.set(2);
          }
        }
      })
      .onStart(() => {
        active.set(true);
        if (mode.get() === 3) {
          lineOn.set(1);
          runOnJS(dispatch)("connectStart", 0, 0, 0);
        }
      })
      .onUpdate((e) => {
        if (mode.get() === 1) {
          vx.set(sx0.get() + e.translationX);
          vy.set(sy0.get() + e.translationY);
        } else if (mode.get() === 2) {
          moveX.set(e.translationX / sz0.get());
          moveY.set(e.translationY / sz0.get());
          runOnJS(dispatch)("move", moveX.get(), moveY.get(), 0);
        } else if (mode.get() === 3) {
          lineX1.set(e.x);
          lineY1.set(e.y);
          runOnJS(dispatch)("hover", e.x, e.y, 0);
        }
      })
      .onEnd((e) => {
        if (mode.get() === 2) runOnJS(dispatch)("moveEnd", moveX.get(), moveY.get(), 0);
        else if (mode.get() === 3) runOnJS(dispatch)("connectEnd", e.x, e.y, sideIdx.get());
        mode.set(0);
      })
      .onFinalize(() => {
        // Cut short (a second finger, the system): a move keeps where it got
        // to, a connection is dropped.
        if (active.get() && mode.get() === 2) runOnJS(dispatch)("moveEnd", moveX.get(), moveY.get(), 0);
        if (active.get() && mode.get() === 3) runOnJS(dispatch)("connectCancel", 0, 0, 0);
        mode.set(0);
        active.set(false);
        lineOn.set(0);
        moveX.set(0);
        moveY.set(0);
      });

    const pinch = Gesture.Pinch()
      .onStart((e) => {
        pz0.set(vz.get());
        px0.set(vx.get());
        py0.set(vy.get());
        fx0.set(e.focalX);
        fy0.set(e.focalY);
      })
      .onUpdate((e) => {
        const v = pinchView({ x: px0.get(), y: py0.get(), z: pz0.get() }, { x: fx0.get(), y: fy0.get() }, { x: e.focalX, y: e.focalY }, e.scale);
        vx.set(v.x);
        vy.set(v.y);
        vz.set(v.z);
      });

    const tap = Gesture.Tap()
      .maxDistance(8)
      .onEnd((e, success) => {
        if (success && e.numberOfPointers === 1) runOnJS(dispatch)("tap", e.x, e.y, 0);
      });

    const fitTap = Gesture.Tap()
      .numberOfTaps(2)
      .minPointers(2)
      .onEnd((_e, success) => {
        if (success) runOnJS(dispatch)("fit", 0, 0, 0);
      });

    return Gesture.Simultaneous(pan, pinch, tap, fitTap);
  }, [
    dispatch,
    vx,
    vy,
    vz,
    sx0,
    sy0,
    sz0,
    active,
    mode,
    selectedIdx,
    boxesSV,
    sideIdx,
    lineX0,
    lineY0,
    lineX1,
    lineY1,
    lineOn,
    moveX,
    moveY,
    pz0,
    px0,
    py0,
    fx0,
    fy0,
  ]);
  /* eslint-enable react-hooks/refs */

  // ── Drawing ────────────────────────────────────────────────────────────────
  const worldStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: vx.get() }, { translateY: vy.get() }, { scale: vz.get() }],
  }));

  const lineProps = useAnimatedProps(() => ({
    d: `M${lineX0.get()},${lineY0.get()} L${lineX1.get()},${lineY1.get()}`,
    strokeOpacity: lineOn.get(),
  }));

  const onLayout = (e: LayoutChangeEvent) => {
    const { width, height } = e.nativeEvent.layout;
    setSize((s) => (s.w === width && s.h === height ? s : { w: width, h: height }));
  };

  const onHeight = useCallback((id: string, h: number) => {
    setHeights((prev) => (Math.abs((prev[id] ?? -1) - h) < 0.5 ? prev : { ...prev, [id]: h }));
  }, []);

  const edgeBounds = useMemo(() => {
    if (boxes.length === 0) return null;
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const b of boxes) {
      minX = Math.min(minX, b.x);
      minY = Math.min(minY, b.y);
      maxX = Math.max(maxX, b.x + b.w);
      maxY = Math.max(maxY, b.y + b.h);
    }
    return { x: minX - EDGE_PAD, y: minY - EDGE_PAD, w: maxX - minX + EDGE_PAD * 2, h: maxY - minY + EDGE_PAD * 2 };
  }, [boxes]);

  const hover = hoverId ? (boxById.get(hoverId) ?? null) : null;

  return (
    <View style={styles.root}>
      <GestureDetector gesture={gesture}>
        <View style={[styles.area, { backgroundColor: c.bg }]} onLayout={onLayout} collapsable={false} testID="canvas-area">
          <Animated.View style={[styles.world, { width: size.w, height: size.h }, worldStyle]} pointerEvents="none">
            {edgeBounds ? (
              <Svg
                style={{ position: "absolute", left: edgeBounds.x, top: edgeBounds.y }}
                width={edgeBounds.w}
                height={edgeBounds.h}
              >
                <G transform={`translate(${-edgeBounds.x}, ${-edgeBounds.y})`}>
                  {paths.map(({ id, path }) => {
                    const on = selectedEdge?.id === id;
                    const stroke = on ? c.accent : c.faint;
                    return (
                      <G key={id}>
                        <Path d={path.d} stroke={stroke} strokeWidth={on ? 2.6 : 1.8} fill="none" />
                        <Path d={path.arrow} fill={stroke} />
                      </G>
                    );
                  })}
                </G>
              </Svg>
            ) : null}
            {ideas.map((idea) => {
              const b = boxById.get(idea.id)!;
              return (
                <IdeaCard
                  key={idea.id}
                  id={idea.id}
                  content={idea.content}
                  color={idea.color}
                  x={b.x}
                  y={b.y}
                  width={b.w}
                  selected={selected?.id === idea.id}
                  target={hoverId === idea.id}
                  c={c}
                  onHeight={onHeight}
                />
              );
            })}
          </Animated.View>
          <Svg style={StyleSheet.absoluteFill} pointerEvents="none">
            <AnimatedPath animatedProps={lineProps} stroke={c.accent} strokeWidth={2} strokeDasharray="6 5" fill="none" />
          </Svg>
        </View>
      </GestureDetector>

      {/* Screen-space controls, over the canvas and outside its gestures. */}
      <View style={StyleSheet.absoluteFill} pointerEvents="box-none">
        {selected ? <Dots box={selected} color={c.accent} ring={c.bg} vx={vx} vy={vy} vz={vz} /> : null}
        {connecting && hover ? <Dots box={hover} color={c.accent} ring={c.bg} vx={vx} vy={vy} vz={vz} faint /> : null}
        {selected && !connecting && !drag ? (
          <Toolbar
            box={selected}
            vx={vx}
            vy={vy}
            vz={vz}
            c={c}
            color={ideas.find((i) => i.id === selected.id)?.color ?? null}
            palette={palette}
            onPalette={() => setPalette((p) => !p)}
            onEdit={() => onEditIdea(selected.id)}
            onColor={(color) => {
              onColor(selected.id, color);
              setPalette(false);
            }}
            onDelete={() => {
              setSelection(null);
              onDeleteIdea(selected.id);
            }}
          />
        ) : null}
        {selectedEdge ? (
          <EdgeButtons
            at={paths.find((p) => p.id === selectedEdge.id)?.path.mid ?? null}
            pinned={!!(selectedEdge.source_side || selectedEdge.target_side)}
            vx={vx}
            vy={vy}
            vz={vz}
            c={c}
            onDelete={() => {
              setSelection(null);
              onDeleteConnection(selectedEdge.id);
            }}
            onReset={() => onResetConnection(selectedEdge.id)}
          />
        ) : null}
      </View>
    </View>
  );
}

const AnimatedPath = Animated.createAnimatedComponent(Path);

// ── Cards ────────────────────────────────────────────────────────────────────

const IdeaCard = memo(function IdeaCard({
  id,
  content,
  color,
  x,
  y,
  width,
  selected,
  target,
  c,
  onHeight,
}: {
  id: string;
  content: string;
  color: string | null;
  x: number;
  y: number;
  width: number;
  selected: boolean;
  target: boolean;
  c: Palette;
  onHeight: (id: string, h: number) => void;
}) {
  const hex = color ? canvasColor(color).hex : null;
  const ring = selected || target;
  return (
    <View
      testID={`idea-${id}`}
      onLayout={(e) => onHeight(id, e.nativeEvent.layout.height)}
      style={[
        styles.card,
        {
          left: x,
          top: y,
          width,
          backgroundColor: c.raised,
          borderColor: ring ? c.accent : hex ? `${hex}88` : c.line,
          borderWidth: ring ? 2 : 1,
        },
      ]}
    >
      {hex ? <View style={[StyleSheet.absoluteFill, { backgroundColor: `${hex}1f` }]} /> : null}
      {hex ? <View style={[styles.stripe, { backgroundColor: hex }]} /> : null}
      <View style={[styles.cardBody, ring ? styles.cardBodyRing : null]}>
        <RichTextView html={content} c={c} />
      </View>
    </View>
  );
});

// ── Overlays ─────────────────────────────────────────────────────────────────

function Dots({
  box,
  color,
  ring,
  vx,
  vy,
  vz,
  faint,
}: {
  box: CardBox;
  color: string;
  ring: string;
  vx: SharedValue<number>;
  vy: SharedValue<number>;
  vz: SharedValue<number>;
  faint?: boolean;
}) {
  return (
    <>
      {dotPoints(box).map((p) => (
        <Dot key={p.side} x={p.x} y={p.y} color={color} ring={ring} vx={vx} vy={vy} vz={vz} faint={faint} />
      ))}
    </>
  );
}

function Dot({
  x,
  y,
  color,
  ring,
  vx,
  vy,
  vz,
  faint,
}: {
  x: number;
  y: number;
  color: string;
  ring: string;
  vx: SharedValue<number>;
  vy: SharedValue<number>;
  vz: SharedValue<number>;
  faint?: boolean;
}) {
  const style = useAnimatedStyle(() => ({
    transform: [{ translateX: x * vz.get() + vx.get() - 9 }, { translateY: y * vz.get() + vy.get() - 9 }],
  }));
  return (
    <Animated.View
      pointerEvents="none"
      style={[styles.dot, { backgroundColor: color, borderColor: ring, opacity: faint ? 0.7 : 1 }, style]}
    />
  );
}

function Toolbar({
  box,
  vx,
  vy,
  vz,
  c,
  color,
  palette,
  onPalette,
  onEdit,
  onColor,
  onDelete,
}: {
  box: CardBox;
  vx: SharedValue<number>;
  vy: SharedValue<number>;
  vz: SharedValue<number>;
  c: Palette;
  color: string | null;
  palette: boolean;
  onPalette: () => void;
  onEdit: () => void;
  onColor: (color: string | null) => void;
  onDelete: () => void;
}) {
  const [width, setWidth] = useState(0);
  const style = useAnimatedStyle(() => {
    const cx = (box.x + box.w / 2) * vz.get() + vx.get();
    const top = box.y * vz.get() + vy.get() - 58;
    return { transform: [{ translateX: cx - width / 2 }, { translateY: Math.max(8, top) }] };
  });
  return (
    <Animated.View
      style={[styles.toolbar, { backgroundColor: c.raised, borderColor: c.line, opacity: width ? 1 : 0 }, style]}
      onLayout={(e) => setWidth(e.nativeEvent.layout.width)}
      testID="idea-toolbar"
    >
      {palette ? (
        <View style={styles.colors}>
          <Pressable onPress={() => onColor(null)} style={[styles.swatch, { borderColor: color === null ? c.ink : c.line, backgroundColor: c.raised }]} accessibilityLabel="No colour" testID="color-none">
            <Ban size={12} color={c.muted} />
          </Pressable>
          {CANVAS_COLOR_KEYS.map((key) => (
            <Pressable
              key={key}
              onPress={() => onColor(key)}
              style={[styles.swatch, { backgroundColor: CANVAS_COLORS[key].hex, borderColor: color === key ? c.ink : "transparent" }]}
              accessibilityLabel={CANVAS_COLORS[key].label}
              testID={`color-${key}`}
            >
              {color === key ? <Check size={12} color="#18181b" /> : null}
            </Pressable>
          ))}
        </View>
      ) : (
        <>
          <ToolButton icon={<PencilLine size={16} color={c.ink} />} label="Edit" c={c} onPress={onEdit} testID="idea-edit" />
          <ToolButton icon={<PaletteIcon size={16} color={c.ink} />} label="Color" c={c} onPress={onPalette} testID="idea-color" />
          <ToolButton icon={<Trash2 size={16} color={c.danger} />} c={c} onPress={onDelete} testID="idea-delete" label="" />
        </>
      )}
    </Animated.View>
  );
}

function ToolButton({ icon, label, c, onPress, testID }: { icon: React.ReactNode; label: string; c: Palette; onPress: () => void; testID: string }) {
  return (
    <Pressable
      onPress={onPress}
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={label || "Delete idea"}
      style={({ pressed }) => [styles.toolBtn, { backgroundColor: pressed ? c.surface : "transparent" }]}
    >
      {icon}
      {label ? <Text style={[styles.toolText, { color: c.ink }]}>{label}</Text> : null}
    </Pressable>
  );
}

function EdgeButtons({
  at,
  pinned,
  vx,
  vy,
  vz,
  c,
  onDelete,
  onReset,
}: {
  at: { x: number; y: number } | null;
  pinned: boolean;
  vx: SharedValue<number>;
  vy: SharedValue<number>;
  vz: SharedValue<number>;
  c: Palette;
  onDelete: () => void;
  onReset: () => void;
}) {
  const [width, setWidth] = useState(0);
  const px = at?.x ?? 0;
  const py = at?.y ?? 0;
  const style = useAnimatedStyle(() => ({
    transform: [{ translateX: px * vz.get() + vx.get() - width / 2 }, { translateY: py * vz.get() + vy.get() - 18 }],
  }));
  if (!at) return null;
  return (
    <Animated.View style={[styles.edgeButtons, { opacity: width ? 1 : 0 }, style]} onLayout={(e) => setWidth(e.nativeEvent.layout.width)}>
      {pinned ? (
        <Pressable
          onPress={onReset}
          style={[styles.round, { backgroundColor: c.raised, borderColor: c.line }]}
          accessibilityLabel="Let the canvas choose the sides"
          testID="edge-reset"
        >
          <RotateCcw size={15} color={c.ink} />
        </Pressable>
      ) : null}
      <Pressable
        onPress={onDelete}
        style={[styles.round, { backgroundColor: c.raised, borderColor: c.line }]}
        accessibilityLabel="Remove connection"
        testID="edge-delete"
      >
        <X size={16} color={c.danger} />
      </Pressable>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  area: { flex: 1, overflow: "hidden" },
  world: { position: "absolute", left: 0, top: 0, transformOrigin: "0 0" },
  card: { position: "absolute", borderRadius: 12, overflow: "hidden" },
  cardBody: { paddingHorizontal: 12, paddingVertical: 10 },
  // The thicker border of a selected card must not shift its text.
  cardBodyRing: { paddingHorizontal: 11, paddingVertical: 9 },
  stripe: { position: "absolute", left: 0, right: 0, top: 0, height: 3 },
  dot: { position: "absolute", left: 0, top: 0, width: 18, height: 18, borderRadius: 9, borderWidth: 3 },
  toolbar: {
    position: "absolute",
    left: 0,
    top: 0,
    flexDirection: "row",
    alignItems: "center",
    gap: 2,
    padding: 4,
    borderRadius: 12,
    borderWidth: 1,
    elevation: 6,
  },
  toolBtn: { flexDirection: "row", alignItems: "center", gap: 5, height: 36, paddingHorizontal: 10, borderRadius: 8 },
  toolText: { fontFamily: font.semibold, fontSize: 13 },
  colors: { flexDirection: "row", alignItems: "center", gap: 7, paddingHorizontal: 6, height: 36 },
  swatch: { width: 24, height: 24, borderRadius: 12, borderWidth: 2, alignItems: "center", justifyContent: "center" },
  edgeButtons: { position: "absolute", left: 0, top: 0, flexDirection: "row", gap: 8 },
  round: { width: 36, height: 36, borderRadius: 18, borderWidth: 1, alignItems: "center", justifyContent: "center", elevation: 4 },
});
