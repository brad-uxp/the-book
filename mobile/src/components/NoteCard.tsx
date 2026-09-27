import { memo } from "react";
import { StyleSheet, Text, View } from "react-native";
import { Calendar, SquareCheck, StickyNote, Waypoints } from "lucide-react-native";
import { dueLabel, relativeTime } from "@/lib/format";
import { kindOf, snippetOf, type Issue } from "@/lib/issues";
import { font, statusColor, statusLabel, usePalette } from "@/lib/theme";

const KIND_ICON = { note: StickyNote, canvas: Waypoints, task: SquareCheck } as const;

/**
 * One issue in the notes list, compact: enough to recognise it, nothing more.
 * Read-only in this version — opening and editing arrive with the editor.
 */
export const NoteCard = memo(function NoteCard({ issue, now }: { issue: Issue; now: Date }) {
  const c = usePalette();
  const kind = kindOf(issue);
  const Icon = KIND_ICON[kind];
  const snippet = kind === "note" ? snippetOf(issue) : "";
  const due = kind === "task" && issue.due_date ? dueLabel(issue.due_date, now) : null;
  const dueColor = due?.tone === "overdue" ? c.overdue : due?.tone === "soon" ? c.soon : c.muted;

  return (
    <View style={[styles.card, { backgroundColor: c.raised, borderColor: c.line }]}>
      <View style={[styles.kind, { backgroundColor: c.surface }]}>
        <Icon size={16} color={kind === "canvas" ? c.accent : c.muted} strokeWidth={2} />
      </View>
      <View style={styles.body}>
        <Text numberOfLines={1} style={[styles.title, { color: c.ink }]}>
          {issue.title}
        </Text>
        {snippet ? (
          <Text numberOfLines={2} style={[styles.snippet, { color: c.muted }]}>
            {snippet}
          </Text>
        ) : null}
        {kind === "canvas" ? (
          <Text style={[styles.snippet, { color: c.muted }]}>Canvas · connected ideas</Text>
        ) : null}

        <View style={styles.meta}>
          {kind === "task" ? (
            <View style={[styles.pill, { backgroundColor: c.surface }]}>
              <View style={[styles.dot, { backgroundColor: statusColor[issue.status] }]} />
              <Text style={[styles.pillText, { color: c.ink }]}>{statusLabel[issue.status]}</Text>
            </View>
          ) : null}
          {due ? (
            <View style={styles.inline}>
              <Calendar size={12} color={dueColor} />
              <Text style={[styles.metaText, { color: dueColor, fontFamily: due.tone === "normal" ? font.regular : font.semibold }]}>
                {due.text}
              </Text>
            </View>
          ) : null}
          {issue.client ? (
            <View style={styles.inline}>
              <View style={[styles.dot, { backgroundColor: issue.client.color_hex }]} />
              <Text numberOfLines={1} style={[styles.metaText, { color: c.muted }]}>
                {issue.client.name}
              </Text>
            </View>
          ) : null}
          <Text style={[styles.metaText, styles.when, { color: c.faint }]}>{relativeTime(issue.updated_at, now)}</Text>
        </View>

        {kind === "task" && issue.progress > 0 ? (
          <View style={[styles.bar, { backgroundColor: c.surface }]}>
            <View style={[styles.barFill, { width: `${Math.min(100, issue.progress)}%` }]} />
          </View>
        ) : null}
      </View>
    </View>
  );
});

const styles = StyleSheet.create({
  card: { flexDirection: "row", gap: 10, padding: 12, borderRadius: 14, borderWidth: StyleSheet.hairlineWidth },
  kind: { width: 28, height: 28, borderRadius: 8, alignItems: "center", justifyContent: "center" },
  body: { flex: 1, minWidth: 0 },
  title: { fontFamily: font.semibold, fontSize: 15, lineHeight: 20 },
  snippet: { fontFamily: font.regular, fontSize: 13, lineHeight: 18, marginTop: 2 },
  meta: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", columnGap: 10, rowGap: 4, marginTop: 7 },
  inline: { flexDirection: "row", alignItems: "center", gap: 4, maxWidth: 160 },
  metaText: { fontFamily: font.regular, fontSize: 12 },
  when: { marginLeft: "auto" },
  pill: { flexDirection: "row", alignItems: "center", gap: 5, height: 20, paddingHorizontal: 8, borderRadius: 10 },
  pillText: { fontFamily: font.semibold, fontSize: 11 },
  dot: { width: 7, height: 7, borderRadius: 4 },
  bar: { height: 3, borderRadius: 2, marginTop: 8, overflow: "hidden" },
  barFill: { height: "100%", backgroundColor: statusColor.in_progress },
});
