import { useCallback, useEffect, useRef, useState } from "react";
import { AppState, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { ChevronLeft, Ellipsis, Plus, Trash2, Waypoints } from "lucide-react-native";
import { NODE_DEFAULT_WIDTH } from "@shared/note-canvas";
import { snapToGrid } from "@shared/canvas-geometry";
import { ISSUE_TITLE_MAX, RICH_TEXT_MAX } from "@shared/text-limits";
import { MentionSheet, useMentionRefs } from "@/components/MentionSheet";
import { Sheet, SheetOption } from "@/components/Sheet";
import { StateView } from "@/components/StateView";
import { useToast } from "@/components/Toast";
import { CanvasView, type CanvasHandle } from "@/canvas/CanvasView";
import { newIdeaOrigin } from "@/canvas/changes";
import { IdeaSheet } from "@/canvas/IdeaSheet";
import {
  createConnection,
  createIdea,
  deleteConnection,
  deleteIdea,
  discardIdeaIfBlank,
  editIdea,
  moveIdeas,
  restoreConnection,
  restoreIdea,
  setConnectionSides,
} from "@/canvas/store";
import { font, usePalette } from "@/lib/theme";
import { useCanvas, useIssue } from "@/notes/hooks";
import { deleteIssue, discardIfBlank, editIssue, undoDelete } from "@/notes/store";

/** A title is saved this long after the last keystroke — and at once on leaving. */
const SAVE_DELAY_MS = 300;

/**
 * A canvas note: its title, and its ideas and connections on a board you
 * pan, pinch and draw on (src/canvas/CanvasView.tsx). Everything is written
 * to the phone first and synced from there, so it all works offline.
 */
export default function CanvasScreen() {
  const { id, new: isNewParam } = useLocalSearchParams<{ id: string; new?: string }>();
  const isNew = isNewParam === "1";
  const router = useRouter();
  const c = usePalette();
  const insets = useSafeAreaInsets();
  const toast = useToast();
  const issue = useIssue(id);
  const canvas = useCanvas(id);
  const { people, invoices, mentionPeople, mentionInvoices } = useMentionRefs();
  const board = useRef<CanvasHandle>(null);

  const [title, setTitle] = useState<string | null>(null);
  const [editing, setEditing] = useState<{ id: string; html: string; isNew: boolean } | null>(null);
  const [more, setMore] = useState(false);
  const [mention, setMention] = useState<{ kind: "person" | "invoice"; id: string } | null>(null);

  const pendingTitle = useRef<string | null>(null);
  const titleFocused = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const flush = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    const t = pendingTitle.current;
    pendingTitle.current = null;
    if (t === null) return Promise.resolve();
    return editIssue(id, { title: t }).catch((err) => console.warn("[canvas] save title", err));
  }, [id]);

  useEffect(() => {
    if (!issue) return;
    // The stored title flows into the field — on open, and when the sync
    // changes it while nothing is being typed.
    if (title === null || (!titleFocused.current && pendingTitle.current === null && issue.title !== title)) {
      setTitle(issue.title);
    }
  }, [issue, title]);

  // Leaving: save the title, and drop a new canvas left empty.
  useEffect(() => {
    const sub = AppState.addEventListener("change", (s) => {
      if (s !== "active") void flush();
    });
    return () => {
      sub.remove();
      void flush().then(() => (isNew ? discardIfBlank(id) : false));
    };
  }, [flush, id, isNew]);

  const openIdea = useCallback(
    (ideaId: string, fresh = false) => {
      const idea = canvas?.ideas.find((i) => i.id === ideaId);
      setEditing({ id: ideaId, html: idea?.content ?? "", isNew: fresh });
    },
    [canvas]
  );

  const newIdeaAt = useCallback(
    async (point: { x: number; y: number }) => {
      const at = newIdeaOrigin(point, NODE_DEFAULT_WIDTH);
      const ideaId = await createIdea(id, { x: snapToGrid(at.x), y: snapToGrid(at.y) });
      board.current?.select(ideaId);
      setEditing({ id: ideaId, html: "", isNew: true });
      return ideaId;
    },
    [id]
  );

  if (issue === undefined || canvas === undefined || (issue && title === null)) {
    return <View style={[styles.screen, { backgroundColor: c.bg }]} />;
  }
  if (issue === null || issue.deleted_at !== null) {
    return (
      <View style={[styles.screen, { backgroundColor: c.bg, paddingTop: insets.top }]}>
        <StateView title="This canvas is gone" body="It was deleted, here or on the web." action={{ label: "Back", onPress: () => router.back() }} />
      </View>
    );
  }

  const removeCanvas = async () => {
    setMore(false);
    await flush();
    await deleteIssue(id);
    router.back();
    toast("Canvas deleted", { label: "Undo", onPress: () => void undoDelete(id) });
  };

  return (
    <View style={[styles.screen, { backgroundColor: c.bg }]}>
      <View style={[styles.bar, { paddingTop: insets.top + 4, borderColor: c.line }]}>
        <Pressable onPress={() => router.back()} hitSlop={8} style={styles.iconBtn} accessibilityLabel="Back" testID="canvas-back">
          <ChevronLeft size={24} color={c.ink} />
        </Pressable>
        <TextInput
          testID="canvas-title"
          value={title ?? ""}
          onChangeText={(t) => {
            setTitle(t);
            pendingTitle.current = t;
            if (timer.current) clearTimeout(timer.current);
            timer.current = setTimeout(() => void flush(), SAVE_DELAY_MS);
          }}
          onFocus={() => (titleFocused.current = true)}
          onBlur={() => {
            titleFocused.current = false;
            void flush();
          }}
          placeholder="Untitled canvas"
          placeholderTextColor={c.faint}
          maxLength={ISSUE_TITLE_MAX}
          numberOfLines={1}
          style={[styles.title, { color: c.ink }]}
        />
        <View style={[styles.chip, { backgroundColor: c.surface }]} accessibilityLabel="Type: Canvas">
          <Waypoints size={15} color={c.accent} />
          <Text style={[styles.chipText, { color: c.ink }]}>Canvas</Text>
        </View>
        <Pressable onPress={() => setMore(true)} hitSlop={8} style={styles.iconBtn} accessibilityLabel="More" testID="canvas-more">
          <Ellipsis size={22} color={c.ink} />
        </Pressable>
      </View>

      <CanvasView
        ref={board}
        ideas={canvas.ideas}
        connections={canvas.connections}
        c={c}
        onEditIdea={(ideaId) => openIdea(ideaId)}
        onCreateIdeaAt={(at) => void newIdeaAt(at)}
        onMoveIdea={(ideaId, x, y) => void moveIdeas([{ id: ideaId, x, y }])}
        onConnect={(input) =>
          void createConnection({ issueId: id, ...input }).then((made) => {
            if (!made) toast("Those ideas are already connected that way.");
          })
        }
        onConnectToEmpty={async ({ sourceId, sourceSide, at }) => {
          const ideaId = await newIdeaAt(at);
          await createConnection({ issueId: id, sourceId, sourceSide, targetId: ideaId, targetSide: null });
        }}
        onColor={(ideaId, color) => void editIdea(ideaId, { color })}
        onDeleteIdea={async (ideaId) => {
          const snap = await deleteIdea(ideaId);
          if (snap) toast("Idea deleted", { label: "Undo", onPress: () => void restoreIdea(snap) });
        }}
        onDeleteConnection={async (edgeId) => {
          const snap = await deleteConnection(edgeId);
          if (snap) toast("Connection removed", { label: "Undo", onPress: () => void restoreConnection(snap) });
        }}
        onResetConnection={(edgeId) => void setConnectionSides(edgeId, { source_side: null, target_side: null })}
      />

      {canvas.ideas.length === 0 ? (
        <View style={styles.emptyHint} pointerEvents="none">
          <Text style={[styles.emptyText, { color: c.muted }]}>Double-tap anywhere, or tap +, to add the first idea. Pinch to zoom; double-tap with two fingers to see everything.</Text>
        </View>
      ) : null}

      <Pressable
        testID="canvas-add"
        accessibilityRole="button"
        accessibilityLabel="New idea"
        onPress={() => {
          const center = board.current?.viewCenter();
          if (center) void newIdeaAt(center);
        }}
        style={({ pressed }) => [styles.fab, { bottom: insets.bottom + 18, backgroundColor: c.primary, opacity: pressed ? 0.85 : 1 }]}
      >
        <Plus size={22} color={c.onPrimary} strokeWidth={2.2} />
      </Pressable>

      <IdeaSheet
        idea={editing}
        people={mentionPeople}
        invoices={mentionInvoices}
        onMentionPress={setMention}
        onSave={(ideaId, html, previous) => {
          if (html.length > RICH_TEXT_MAX) {
            // The server would refuse it; better to say so while it can still be shortened.
            toast(`Too long to save: keep an idea under ${RICH_TEXT_MAX.toLocaleString("en-US")} characters.`);
            return;
          }
          void editIdea(ideaId, { content: html }, { previousContent: previous });
        }}
        onClose={(ideaId) => {
          setEditing(null);
          // After the editor has handed over its last words (it does, as it
          // unmounts): an idea left empty goes, as on the web.
          setTimeout(() => void discardIdeaIfBlank(ideaId), 0);
        }}
      />

      <Sheet visible={more} title="Canvas" onClose={() => setMore(false)}>
        <SheetOption
          testID="canvas-delete"
          icon={<Trash2 size={18} color={c.danger} />}
          label="Delete"
          detail="The canvas, its ideas and connections. You can undo for a few seconds."
          onPress={removeCanvas}
        />
      </Sheet>
      <MentionSheet mention={mention} people={people} invoices={invoices} onClose={() => setMention(null)} />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  bar: { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 8, paddingBottom: 8, borderBottomWidth: StyleSheet.hairlineWidth },
  iconBtn: { width: 40, height: 40, borderRadius: 10, alignItems: "center", justifyContent: "center" },
  title: { flex: 1, fontFamily: font.semibold, fontSize: 16, padding: 0 },
  chip: { flexDirection: "row", alignItems: "center", gap: 6, height: 30, paddingHorizontal: 10, borderRadius: 9 },
  chipText: { fontFamily: font.semibold, fontSize: 13 },
  emptyHint: { position: "absolute", left: 32, right: 32, top: "45%", alignItems: "center" },
  emptyText: { fontFamily: font.regular, fontSize: 14, lineHeight: 20, textAlign: "center" },
  fab: {
    position: "absolute",
    right: 18,
    width: 52,
    height: 52,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
    elevation: 6,
  },
});
