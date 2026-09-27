import { useMemo, useState } from "react";
import { FlatList, RefreshControl, StyleSheet, Text, View } from "react-native";
import { FilterChips } from "@/components/FilterChips";
import { NoteCard } from "@/components/NoteCard";
import { StateView } from "@/components/StateView";
import { kindOf, useIssues, type Filter } from "@/lib/issues";
import { font, usePalette } from "@/lib/theme";

const EMPTY: Record<Filter, string> = {
  all: "No notes yet",
  note: "No text notes",
  canvas: "No canvases",
  task: "No open tasks",
};

export default function Notes() {
  const c = usePalette();
  const { issues, error, refreshing, refresh, retry, counts, loadedAt } = useIssues();
  const [filter, setFilter] = useState<Filter>("all");

  const visible = useMemo(
    () => (issues ?? []).filter((i) => filter === "all" || kindOf(i) === filter),
    [issues, filter]
  );

  if (!issues && !error) return <StateView loading />;
  if (!issues) {
    return <StateView title="Couldn't load your notes" body={error ?? undefined} action={{ label: "Try again", onPress: retry }} />;
  }

  return (
    <View style={[styles.screen, { backgroundColor: c.bg }]}>
      <View style={styles.chips}>
        <FilterChips value={filter} counts={counts} onChange={setFilter} />
      </View>
      {/* A failed refresh keeps the list it had and says so. */}
      {error ? <Text style={[styles.stale, { color: c.soon }]}>{error}</Text> : null}
      <FlatList
        data={visible}
        keyExtractor={(i) => i.id}
        renderItem={({ item }) => <NoteCard issue={item} now={loadedAt} />}
        contentContainerStyle={visible.length ? styles.list : styles.emptyList}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={c.muted} colors={[c.accent]} />}
        ListEmptyComponent={
          <StateView
            title={EMPTY[filter]}
            body="What you create on the web shows up here. Writing from the phone arrives with the next version."
          />
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  chips: { flexGrow: 0 },
  list: { paddingHorizontal: 12, paddingBottom: 24, gap: 8 },
  emptyList: { flexGrow: 1 },
  stale: { fontFamily: font.medium, fontSize: 13, paddingHorizontal: 16, paddingBottom: 8 },
});
