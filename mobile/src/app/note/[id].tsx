import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AppState,
  KeyboardAvoidingView,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { DateTimePickerAndroid } from "@react-native-community/datetimepicker";
import {
  Calendar,
  ChevronDown,
  ChevronLeft,
  CloudOff,
  Ellipsis,
  SquareCheck,
  StickyNote,
  Trash2,
  Users,
  Waypoints,
  X,
} from "lucide-react-native";
import { formatCents } from "@shared/currency";
import { ProgressSlider } from "@/components/ProgressSlider";
import { Sheet, SheetOption } from "@/components/Sheet";
import { StateView } from "@/components/StateView";
import { useToast } from "@/components/Toast";
import { RichTextEditor, type MentionInvoice, type MentionPerson } from "@/editor/RichTextEditor";
import { dueLabel, relativeTime } from "@/lib/format";
import { font, statusColor, statusLabel, usePalette } from "@/lib/theme";
import { useClients, useInvoices, useIssue, usePeople } from "@/notes/hooks";
import { deleteIssue, discardIfBlank, editIssue, undoDelete, type IssueEdit } from "@/notes/store";

/** Typing is saved this long after the last keystroke — and at once on leaving. */
const SAVE_DELAY_MS = 300;

const STATUSES = ["pending", "in_progress", "blocked", "done"] as const;

/** YYYY-MM-DD of a picked day, stored as the server stores due dates: UTC midnight. */
function dueFromPicker(d: Date): string {
  const ymd = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  return `${ymd}T00:00:00.000Z`;
}

function editedLabel(iso: string): string {
  const ago = relativeTime(iso, new Date());
  if (ago === "now") return "Edited just now";
  return /^\d/.test(ago) ? `Edited ${ago} ago` : `Edited ${ago}`;
}

function pickerDate(due: string | null): Date {
  if (!due) return new Date();
  const [y, m, d] = due.slice(0, 10).split("-").map(Number);
  return new Date(y, m - 1, d);
}

/**
 * A text note or a task, full screen: title, the rich text, and for a task
 * its state. Everything saves as it is typed, to the phone first; the sync
 * takes it from there.
 */
export default function NoteScreen() {
  const { id, new: isNewParam } = useLocalSearchParams<{ id: string; new?: string }>();
  const isNew = isNewParam === "1";
  const router = useRouter();
  const c = usePalette();
  const insets = useSafeAreaInsets();
  const toast = useToast();
  const issue = useIssue(id);
  const clients = useClients();
  const people = usePeople();
  const invoices = useInvoices();

  const [title, setTitle] = useState<string | null>(null);
  const [doc, setDoc] = useState<{ key: number; html: string } | null>(null);
  const [sheet, setSheet] = useState<"type" | "more" | "client" | null>(null);

  // What the editor holds that is not saved yet, and the text it last saved:
  // the next save's `previousDescription` (see editIssue).
  const pendingBody = useRef<string | null>(null);
  const savedBody = useRef<string>("");
  const pendingTitle = useRef<string | null>(null);
  const titleFocused = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const flush = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    const edit: IssueEdit = {};
    if (pendingTitle.current !== null) edit.title = pendingTitle.current;
    let previous: string | undefined;
    if (pendingBody.current !== null) {
      edit.description = pendingBody.current;
      previous = savedBody.current;
      savedBody.current = pendingBody.current;
    }
    pendingTitle.current = null;
    pendingBody.current = null;
    if (Object.keys(edit).length === 0) return Promise.resolve();
    return editIssue(id, edit, { previousDescription: previous }).catch((err) => console.warn("[note] save", err));
  }, [id]);

  const scheduleSave = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => void flush(), SAVE_DELAY_MS);
  }, [flush]);

  // First load, and what the sync brings while the note is open.
  useEffect(() => {
    if (!issue) return;
    // The editor is uncontrolled (it owns what is being typed); this effect is
    // what pushes the stored note into it — on open, and when the sync
    // changes it. That is a sync with an external store, so setState here is
    // the point, not an accident.
    if (doc === null) {
      savedBody.current = issue.description;
      setDoc({ key: 0, html: issue.description }); // eslint-disable-line react-hooks/set-state-in-effect
    } else if (issue.description !== savedBody.current && pendingBody.current === null) {
      // Changed elsewhere and nothing unsaved here: show the new text. With
      // unsaved typing it waits — the save then goes up as a conflict, and
      // the server keeps both.
      savedBody.current = issue.description;
      setDoc((d) => ({ key: (d?.key ?? 0) + 1, html: issue.description }));
    }
    if (title === null || (!titleFocused.current && pendingTitle.current === null && issue.title !== title)) {
      setTitle(issue.title);
    }
  }, [issue, doc, title]);

  // Leaving: save what is pending, and drop a new note left empty.
  useEffect(() => {
    const sub = AppState.addEventListener("change", (s) => {
      if (s !== "active") void flush();
    });
    return () => {
      sub.remove();
      void flush().then(() => (isNew ? discardIfBlank(id) : false));
    };
  }, [flush, id, isNew]);

  // A canvas opens in its own screen.
  useEffect(() => {
    if (issue?.note_format === "canvas") router.replace({ pathname: "/canvas/[id]", params: { id } });
  }, [issue?.note_format, id, router]);

  const mentionPeople = useMemo<MentionPerson[]>(
    () => people.map((p) => ({ id: p.id, name: p.name, role: p.role, active: p.status === "active" })),
    [people]
  );
  // The same label the web writes into a #mention (components/rich-text/invoice-mention-list.tsx).
  const mentionInvoices = useMemo<MentionInvoice[]>(
    () =>
      invoices.map((i) => ({
        id: i.id,
        label: `Inv ${i.invoice_number ?? "?"}: ${i.client_name} — ${formatCents(i.amount_cents)}`,
        status: i.status,
      })),
    [invoices]
  );

  if (issue === undefined || (issue && (doc === null || title === null))) {
    return <View style={[styles.screen, { backgroundColor: c.bg }]} />;
  }
  if (issue === null || issue.deleted_at !== null) {
    return (
      <View style={[styles.screen, { backgroundColor: c.bg, paddingTop: insets.top }]}>
        <StateView title="This note is gone" body="It was deleted, here or on the web." action={{ label: "Back", onPress: () => router.back() }} />
      </View>
    );
  }

  const isTask = issue.category === "task";
  const client = clients.find((cl) => cl.id === issue.client_id) ?? null;
  const due = issue.due_date ? dueLabel(issue.due_date, new Date()) : null;
  const dueColor = due?.tone === "overdue" ? c.overdue : due?.tone === "soon" ? c.soon : c.ink;

  const save = (edit: IssueEdit) => {
    void flush().then(() => editIssue(id, edit));
  };

  const remove = async () => {
    setSheet(null);
    await flush();
    await deleteIssue(id);
    router.back();
    toast(isTask ? "Task deleted" : "Note deleted", { label: "Undo", onPress: () => void undoDelete(id) });
  };

  return (
    <KeyboardAvoidingView behavior="padding" style={[styles.screen, { backgroundColor: c.bg }]}>
      <View style={[styles.bar, { paddingTop: insets.top + 4 }]}>
        <Pressable onPress={() => router.back()} hitSlop={8} style={styles.iconBtn} accessibilityLabel="Back" testID="note-back">
          <ChevronLeft size={24} color={c.ink} />
        </Pressable>
        <View style={styles.spacer} />
        <Pressable
          onPress={() => setSheet("type")}
          style={[styles.typeChip, { backgroundColor: c.surface }]}
          accessibilityRole="button"
          accessibilityLabel={`Type: ${isTask ? "Task" : "Note"}`}
          testID="type-chip"
        >
          {isTask ? <SquareCheck size={15} color={c.ink} /> : <StickyNote size={15} color={c.ink} />}
          <Text style={[styles.typeText, { color: c.ink }]}>{isTask ? "Task" : "Note"}</Text>
          <ChevronDown size={15} color={c.muted} />
        </Pressable>
        <Pressable onPress={() => setSheet("more")} hitSlop={8} style={styles.iconBtn} accessibilityLabel="More" testID="note-more">
          <Ellipsis size={22} color={c.ink} />
        </Pressable>
      </View>

      <ScrollView contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 120 }]} keyboardShouldPersistTaps="handled">
        <TextInput
          testID="note-title"
          value={title ?? ""}
          onChangeText={(t) => {
            setTitle(t);
            pendingTitle.current = t;
            scheduleSave();
          }}
          onFocus={() => (titleFocused.current = true)}
          onBlur={() => {
            titleFocused.current = false;
            void flush();
          }}
          placeholder="Title"
          placeholderTextColor={c.faint}
          multiline
          autoFocus={isNew}
          style={[styles.title, { color: c.ink }]}
        />

        <View style={styles.props}>
          {client ? (
            <Pressable onPress={() => setSheet("client")} style={[styles.pill, { backgroundColor: c.surface }]} testID="client-pill">
              <View style={[styles.dot, { backgroundColor: client.color_hex }]} />
              <Text style={[styles.pillText, { color: c.ink }]}>{client.name}</Text>
            </Pressable>
          ) : null}
          <Text style={[styles.meta, { color: c.faint }]}>{issue.announced ? editedLabel(issue.updated_at) : "New"}</Text>
        </View>

        {issue.sync_error ? (
          <View style={[styles.warning, { borderColor: c.danger }]}>
            <CloudOff size={16} color={c.danger} />
            <Text style={[styles.warningText, { color: c.danger }]}>
              {`The server didn't take the last change (${issue.sync_error}). It's kept on this phone.`}
            </Text>
          </View>
        ) : null}

        {isTask ? (
          <View style={[styles.rows, { borderColor: c.line }]}>
            <View style={[styles.row, { borderColor: c.line }]}>
              <Text style={[styles.rowLabel, { color: c.muted }]}>Status</Text>
              <View style={styles.seg}>
                {STATUSES.map((s) => {
                  const on = issue.status === s;
                  return (
                    <Pressable
                      key={s}
                      testID={`status-${s}`}
                      onPress={() => {
                        save({ status: s });
                        if (s === "done") toast("Done — archived. It stays on the web's archive.", { label: "Undo", onPress: () => void editIssue(id, { status: issue.status }) });
                      }}
                      accessibilityRole="button"
                      accessibilityState={{ selected: on }}
                      style={[styles.segBtn, { borderColor: on ? c.ink : c.line, backgroundColor: on ? c.surface : "transparent" }]}
                    >
                      <View style={[styles.dot, { backgroundColor: statusColor[s] }]} />
                      <Text style={[styles.segText, { color: c.ink }]}>{statusLabel[s]}</Text>
                    </Pressable>
                  );
                })}
              </View>
            </View>

            <View style={[styles.row, { borderColor: c.line }]}>
              <Text style={[styles.rowLabel, { color: c.muted }]}>Due</Text>
              <Pressable
                testID="due-date"
                style={styles.rowValue}
                onPress={() =>
                  DateTimePickerAndroid.open({
                    value: pickerDate(issue.due_date),
                    mode: "date",
                    onChange: (event, date) => {
                      if (event.type === "set" && date) save({ due_date: dueFromPicker(date) });
                    },
                  })
                }
              >
                <Calendar size={15} color={due ? dueColor : c.muted} />
                <Text style={[styles.rowText, { color: due ? dueColor : c.faint }]}>{due ? due.text : "No due date"}</Text>
              </Pressable>
              {issue.due_date ? (
                <Pressable onPress={() => save({ due_date: null })} hitSlop={10} accessibilityLabel="Clear due date">
                  <X size={16} color={c.muted} />
                </Pressable>
              ) : null}
            </View>

            <View style={[styles.row, { borderColor: c.line }]}>
              <Text style={[styles.rowLabel, { color: c.muted }]}>Progress</Text>
              <ProgressSlider value={issue.progress} onChange={(v) => save({ progress: v })} />
            </View>

            <Pressable style={[styles.row, { borderColor: c.line }]} onPress={() => setSheet("client")} testID="task-client">
              <Text style={[styles.rowLabel, { color: c.muted }]}>Client</Text>
              <View style={styles.rowValue}>
                {client ? <View style={[styles.cdot, { backgroundColor: client.color_hex }]} /> : null}
                <Text style={[styles.rowText, { color: client ? c.ink : c.faint }]}>{client ? client.name : "No client"}</Text>
              </View>
            </Pressable>
          </View>
        ) : null}

        {doc ? (
          <RichTextEditor
            docKey={`${id}:${doc.key}`}
            initialHtml={doc.html}
            onChange={(html) => {
              pendingBody.current = html;
              scheduleSave();
            }}
            placeholder={isTask ? "Details" : "Write something…"}
            people={mentionPeople}
            invoices={mentionInvoices}
          />
        ) : null}
      </ScrollView>

      <Sheet visible={sheet === "type"} title="Type" onClose={() => setSheet(null)}>
        <SheetOption
          testID="type-note"
          icon={<StickyNote size={18} color={c.ink} />}
          label="Note"
          detail="One rich-text document"
          selected={!isTask}
          onPress={() => {
            setSheet(null);
            if (isTask) save({ category: "note" });
          }}
        />
        <SheetOption
          icon={<Waypoints size={18} color={c.muted} />}
          label="Canvas"
          detail="Connected ideas around this one. Turning a note into a canvas on the phone arrives soon — do it on the web for now."
          disabled
          onPress={() => undefined}
        />
        <SheetOption
          testID="type-task"
          icon={<SquareCheck size={18} color={c.ink} />}
          label="Task"
          detail="Adds status, due date and progress. Shows on the web board."
          selected={isTask}
          onPress={() => {
            setSheet(null);
            if (!isTask) save({ category: "task" });
          }}
        />
      </Sheet>

      <Sheet visible={sheet === "more"} title={isTask ? "Task" : "Note"} onClose={() => setSheet(null)}>
        <SheetOption
          testID="more-client"
          icon={<Users size={18} color={c.ink} />}
          label="Client"
          detail={client ? client.name : "None"}
          onPress={() => setSheet("client")}
        />
        <SheetOption testID="more-delete" icon={<Trash2 size={18} color={c.danger} />} label="Delete" detail="You can undo for a few seconds." onPress={remove} />
      </Sheet>

      <Sheet visible={sheet === "client"} title="Client" onClose={() => setSheet(null)}>
        <ScrollView style={styles.clientList}>
          <SheetOption
            label="No client"
            selected={!issue.client_id}
            onPress={() => {
              setSheet(null);
              save({ client_id: null });
            }}
          />
          {clients.map((cl) => (
            <SheetOption
              key={cl.id}
              icon={<View style={[styles.cdot, { backgroundColor: cl.color_hex }]} />}
              label={cl.name}
              selected={issue.client_id === cl.id}
              onPress={() => {
                setSheet(null);
                save({ client_id: cl.id });
              }}
            />
          ))}
          {clients.length === 0 ? <Text style={[styles.meta, { color: c.muted, margin: 10 }]}>Clients appear here after the first sync.</Text> : null}
        </ScrollView>
      </Sheet>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  bar: { flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 8, paddingBottom: 6 },
  iconBtn: { width: 40, height: 40, borderRadius: 10, alignItems: "center", justifyContent: "center" },
  spacer: { flex: 1 },
  typeChip: { flexDirection: "row", alignItems: "center", gap: 6, height: 32, paddingHorizontal: 10, borderRadius: 9 },
  typeText: { fontFamily: font.semibold, fontSize: 13 },
  content: { paddingHorizontal: 20 },
  title: { fontFamily: font.bold, fontSize: 24, lineHeight: 30, letterSpacing: -0.4, padding: 0, marginTop: 4, marginBottom: 6 },
  props: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 8, marginBottom: 14 },
  pill: { flexDirection: "row", alignItems: "center", gap: 6, height: 24, paddingHorizontal: 9, borderRadius: 12 },
  pillText: { fontFamily: font.semibold, fontSize: 12 },
  meta: { fontFamily: font.regular, fontSize: 12.5 },
  dot: { width: 7, height: 7, borderRadius: 4 },
  cdot: { width: 10, height: 10, borderRadius: 3 },
  warning: { flexDirection: "row", gap: 8, alignItems: "flex-start", borderWidth: 1, borderRadius: 10, padding: 10, marginBottom: 14 },
  warningText: { flex: 1, fontFamily: font.medium, fontSize: 13, lineHeight: 18 },
  rows: { borderTopWidth: StyleSheet.hairlineWidth, marginBottom: 16 },
  row: { flexDirection: "row", alignItems: "center", minHeight: 48, borderBottomWidth: StyleSheet.hairlineWidth, gap: 8 },
  rowLabel: { width: 76, fontFamily: font.regular, fontSize: 13 },
  rowValue: { flex: 1, flexDirection: "row", alignItems: "center", gap: 8, minHeight: 40 },
  rowText: { fontFamily: font.semibold, fontSize: 14 },
  seg: { flex: 1, flexDirection: "row", flexWrap: "wrap", gap: 6, paddingVertical: 8 },
  segBtn: { flexDirection: "row", alignItems: "center", gap: 6, height: 30, paddingHorizontal: 10, borderRadius: 8, borderWidth: 1 },
  segText: { fontFamily: font.semibold, fontSize: 12.5 },
  clientList: { maxHeight: 420 },
});
