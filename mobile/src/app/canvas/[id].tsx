import { FlatList, Pressable, StyleSheet, Text, View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { ChevronLeft, Link2, Waypoints } from "lucide-react-native";
import { canvasColor } from "@shared/canvas-palette";
import { StateView } from "@/components/StateView";
import { font, usePalette } from "@/lib/theme";
import { useIdeas, useIssue } from "@/notes/hooks";
import { effectiveTitle, textLines } from "@/notes/text";

/**
 * A canvas note, read-only for now: its ideas as a list, top to bottom as
 * they sit on the board. Drawing and editing a canvas on the phone arrives
 * with the canvas itself; until then the web is where it changes.
 */
export default function CanvasScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const c = usePalette();
  const insets = useSafeAreaInsets();
  const issue = useIssue(id);
  const ideas = useIdeas(id);

  if (issue === undefined || ideas === undefined) return <View style={[styles.screen, { backgroundColor: c.bg }]} />;

  return (
    <View style={[styles.screen, { backgroundColor: c.bg }]}>
      <View style={[styles.bar, { paddingTop: insets.top + 4, borderColor: c.line }]}>
        <Pressable onPress={() => router.back()} hitSlop={8} style={styles.iconBtn} accessibilityLabel="Back">
          <ChevronLeft size={24} color={c.ink} />
        </Pressable>
        <Text numberOfLines={1} style={[styles.title, { color: c.ink }]}>
          {issue ? effectiveTitle(issue.title, "") : "Canvas"}
        </Text>
        <View style={[styles.chip, { backgroundColor: c.surface }]}>
          <Waypoints size={15} color={c.accent} />
          <Text style={[styles.chipText, { color: c.ink }]}>Canvas</Text>
        </View>
      </View>

      {issue === null ? (
        <StateView title="This canvas is gone" body="It was deleted on the web." action={{ label: "Back", onPress: () => router.back() }} />
      ) : (
        <FlatList
          data={ideas}
          keyExtractor={(i) => i.id}
          contentContainerStyle={[styles.list, { paddingBottom: insets.bottom + 24 }]}
          ListHeaderComponent={
            <Text style={[styles.notice, { color: c.muted }]}>
              Read-only on the phone for now. Drawing and editing canvases here arrives soon; use the web meanwhile.
            </Text>
          }
          ListEmptyComponent={<StateView title="No ideas yet" body="Add them on the web." />}
          renderItem={({ item }) => {
            const lines = textLines(item.content);
            return (
              <View style={[styles.card, { backgroundColor: c.raised, borderColor: c.line }]}>
                {item.color ? <View style={[styles.stripe, { backgroundColor: canvasColor(item.color).hex }]} /> : null}
                {lines.length ? (
                  lines.map((line, i) => (
                    <Text key={i} style={[i === 0 ? styles.lead : styles.line, { color: i === 0 ? c.ink : c.muted }]}>
                      {line}
                    </Text>
                  ))
                ) : (
                  <Text style={[styles.line, { color: c.faint, fontStyle: "italic" }]}>Empty idea</Text>
                )}
                {item.links > 0 ? (
                  <View style={styles.links}>
                    <Link2 size={12} color={c.faint} />
                    <Text style={[styles.linksText, { color: c.faint }]}>
                      {item.links === 1 ? "1 connection" : `${item.links} connections`}
                    </Text>
                  </View>
                ) : null}
              </View>
            );
          }}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  bar: { flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 8, paddingBottom: 8, borderBottomWidth: StyleSheet.hairlineWidth },
  iconBtn: { width: 40, height: 40, borderRadius: 10, alignItems: "center", justifyContent: "center" },
  title: { flex: 1, fontFamily: font.semibold, fontSize: 16 },
  chip: { flexDirection: "row", alignItems: "center", gap: 6, height: 30, paddingHorizontal: 10, borderRadius: 9 },
  chipText: { fontFamily: font.semibold, fontSize: 13 },
  list: { padding: 12, gap: 8 },
  notice: { fontFamily: font.regular, fontSize: 13, lineHeight: 18, marginBottom: 8, marginHorizontal: 4 },
  card: { borderWidth: StyleSheet.hairlineWidth, borderRadius: 12, padding: 12, paddingTop: 13, overflow: "hidden", gap: 2 },
  stripe: { position: "absolute", left: 0, right: 0, top: 0, height: 3 },
  lead: { fontFamily: font.semibold, fontSize: 14.5, lineHeight: 20 },
  line: { fontFamily: font.regular, fontSize: 13.5, lineHeight: 19 },
  links: { flexDirection: "row", alignItems: "center", gap: 4, marginTop: 6 },
  linksText: { fontFamily: font.regular, fontSize: 12 },
});
