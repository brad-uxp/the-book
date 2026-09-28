import { useCallback, useMemo, useState } from "react";
import { FlatList, RefreshControl, StyleSheet, TextInput, View } from "react-native";
import { useRouter } from "expo-router";
import { Search, X } from "lucide-react-native";
import { Fab } from "@/components/Fab";
import { UpdateBanner } from "@/update/UpdateBanner";
import { FilterChips } from "@/components/FilterChips";
import { NoteCard } from "@/components/NoteCard";
import { StateView } from "@/components/StateView";
import { kindOf, type Filter } from "@/lib/issues";
import { countByKind, useHasSynced, useNotesList, type NoteListItem } from "@/notes/hooks";
import { createNote } from "@/notes/store";
import { useSync } from "@/sync/SyncProvider";
import { font, usePalette } from "@/lib/theme";

const EMPTY: Record<Filter, string> = {
  all: "No notes yet",
  note: "No text notes",
  canvas: "No canvases",
  task: "No open tasks",
};

/**
 * The home: every note, canvas and open task, most recently edited first —
 * read from the phone, so it opens instantly and works without signal.
 */
export default function Notes() {
  const c = usePalette();
  const router = useRouter();
  const { status, syncNow } = useSync();
  const [filter, setFilter] = useState<Filter>("all");
  const [query, setQuery] = useState("");
  const [refreshing, setRefreshing] = useState(false);
  const items = useNotesList(query);
  const hasSynced = useHasSynced();

  const visible = useMemo(
    () => (items ?? []).filter((i) => filter === "all" || kindOf(i) === filter),
    [items, filter]
  );
  const counts = useMemo(() => countByKind(items ?? []), [items]);
  // What "2h ago" and "due tomorrow" are relative to — refreshed with the list.
  const now = useMemo(() => new Date(), [items]); // eslint-disable-line react-hooks/exhaustive-deps

  const open = useCallback(
    (issue: NoteListItem) => {
      if (kindOf(issue) === "canvas") router.push({ pathname: "/canvas/[id]", params: { id: issue.id } });
      else router.push({ pathname: "/note/[id]", params: { id: issue.id } });
    },
    [router]
  );

  const create = useCallback(
    async (kind: "note" | "task" | "canvas") => {
      const id = await createNote(kind);
      router.push({ pathname: kind === "canvas" ? "/canvas/[id]" : "/note/[id]", params: { id, new: "1" } });
    },
    [router]
  );

  const refresh = useCallback(async () => {
    setRefreshing(true);
    await syncNow();
    setRefreshing(false);
  }, [syncNow]);

  if (items === undefined) return <StateView loading />;

  // First run on this phone: nothing local yet, and the first sync still out.
  if (items.length === 0 && !query && hasSynced === false) {
    return (
      <View style={[styles.screen, { backgroundColor: c.bg }]}>
        {status.online ? (
          <StateView loading title="Getting your notes…" />
        ) : (
          <StateView title="You're offline" body="Your notes will appear here once the phone is back online." />
        )}
        <Fab onCreate={create} />
      </View>
    );
  }

  return (
    <View style={[styles.screen, { backgroundColor: c.bg }]}>
      <UpdateBanner />
      <View style={[styles.search, { backgroundColor: c.surface }]}>
        <Search size={16} color={c.muted} />
        <TextInput
          testID="notes-search"
          value={query}
          onChangeText={setQuery}
          placeholder="Search notes"
          placeholderTextColor={c.faint}
          style={[styles.searchInput, { color: c.ink }]}
          returnKeyType="search"
          autoCorrect={false}
        />
        {query ? <X size={16} color={c.muted} onPress={() => setQuery("")} accessibilityLabel="Clear search" /> : null}
      </View>
      <View style={styles.chips}>
        <FilterChips value={filter} counts={counts} onChange={setFilter} />
      </View>
      <FlatList
        data={visible}
        keyExtractor={(i) => i.id}
        renderItem={({ item }) => <NoteCard issue={item} now={now} onPress={open} />}
        contentContainerStyle={visible.length ? styles.list : styles.emptyList}
        keyboardShouldPersistTaps="handled"
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={c.muted} colors={[c.accent]} />}
        ListEmptyComponent={
          <StateView
            title={query ? "Nothing matches" : EMPTY[filter]}
            body={query ? "Search looks in titles and text." : "Tap + to write one. Hold it for a task."}
          />
        }
      />
      <Fab onCreate={create} />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  search: { flexDirection: "row", alignItems: "center", gap: 8, height: 40, borderRadius: 11, marginHorizontal: 16, marginBottom: 10, paddingHorizontal: 12 },
  searchInput: { flex: 1, fontFamily: font.regular, fontSize: 15, paddingVertical: 0 },
  chips: { flexGrow: 0 },
  list: { paddingHorizontal: 12, paddingBottom: 96, gap: 8 },
  emptyList: { flexGrow: 1 },
});
