import { useRef, useState } from "react";
import { Pressable, StyleSheet, Switch, Text, View } from "react-native";
import { Redirect } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import {
  RichTextEditor,
  type MentionInvoice,
  type MentionPerson,
  type RichTextEditorHandle,
} from "@/editor/RichTextEditor";
import { font, usePalette } from "@/lib/theme";

/**
 * Development only: the note editor on its own, with sample people and
 * invoices and no server — `book://dev/editor`. Release builds redirect home.
 */

const PEOPLE: MentionPerson[] = [
  { id: "p-ana", name: "Ana Díaz", role: "Designer", active: true },
  { id: "p-bruno", name: "Bruno Sosa", role: "Developer", active: true },
  { id: "p-carla", name: "Carla Pérez", role: "Accountant", active: true },
  { id: "p-old", name: "Old Timer", role: "Developer", active: false },
];

const INVOICES: MentionInvoice[] = [
  { id: "inv-142", label: "Inv 0142: Acme — $1,200.00", status: "sent" },
  { id: "inv-143", label: "Inv 0143: Globex — $980.50", status: "paid" },
  { id: "inv-144", label: "Inv ?: Initech — $75.00", status: "draft" },
];

const person = (id: string, label: string, deleted = false) =>
  `<span data-type="mention" class="mention" data-id="${id}" data-label="${label}" data-mention-suggestion-char="@"${deleted ? ' data-deleted="true"' : ""} data-mention-id="${id}" data-mention-label="${label}">${label}</span>`;
const invoice = (id: string, label: string) =>
  `<span data-type="invoiceMention" class="invoice-mention" data-id="${id}" data-label="${label}" data-mention-suggestion-char="#" data-invoice-id="${id}" data-invoice-label="${label}">${label}</span>`;

const DOCS: Record<string, string> = {
  "note-a":
    "<h2>Kickoff with Acme</h2>" +
    `<p>Ask ${person("p-ana", "Ana")} about the mockups and check ${invoice("inv-142", "Inv 0142: Acme — $1,000.00")} before Friday.</p>` +
    `<p>${person("p-gone", "Someone Gone")} left the team.</p>` +
    "<ul><li><p>Scope</p></li><li><p>Timeline</p></li></ul>" +
    "<pre><code>const due = 30;</code></pre>",
  "note-b": "<h3>Second note</h3><p>Switching documents keeps the editor and replaces the text.</p>",
};

export default function EditorDemo() {
  const c = usePalette();
  const editor = useRef<RichTextEditorHandle>(null);
  const [docKey, setDocKey] = useState("note-a");
  const [docs, setDocs] = useState(DOCS);
  const [editable, setEditable] = useState(true);
  const [saves, setSaves] = useState(0);
  const [pressed, setPressed] = useState("—");

  if (!__DEV__) return <Redirect href="/" />;

  const html = docs[docKey];

  return (
    <SafeAreaView edges={["top", "bottom"]} style={[styles.screen, { backgroundColor: c.bg }]}>
      <View style={[styles.panel, { borderBottomColor: c.line }]}>
        <View style={styles.row}>
          <DemoButton
            label={docKey === "note-a" ? "Open note B" : "Open note A"}
            onPress={() => setDocKey((k) => (k === "note-a" ? "note-b" : "note-a"))}
          />
          <DemoButton label="Focus" onPress={() => editor.current?.focus()} />
          <DemoButton label="Blur" onPress={() => editor.current?.blur()} />
          <View style={styles.switch}>
            <Text style={[styles.meta, { color: c.muted }]}>Editable</Text>
            <Switch value={editable} onValueChange={setEditable} />
          </View>
        </View>
        <Text style={[styles.meta, { color: c.muted }]} testID="demo-status">
          {docKey} · saves {saves} · pressed {pressed}
        </Text>
        <Text style={[styles.html, { color: c.faint }]} numberOfLines={3} testID="demo-html">
          {html}
        </Text>
      </View>
      <RichTextEditor
        ref={editor}
        docKey={docKey}
        initialHtml={html}
        onChange={(next) => {
          // The exact HTML, for checking it against the web's in Metro's log.
          console.log(`[editor-demo] ${docKey} ${next}`);
          setDocs((d) => ({ ...d, [docKey]: next }));
          setSaves((n) => n + 1);
        }}
        editable={editable}
        placeholder="Start writing…"
        people={PEOPLE}
        invoices={INVOICES}
        onMentionPress={(m) => setPressed(`${m.kind}:${m.id}`)}
      />
    </SafeAreaView>
  );
}

function DemoButton({ label, onPress }: { label: string; onPress: () => void }) {
  const c = usePalette();
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={[styles.button, { borderColor: c.line, backgroundColor: c.surface }]}
    >
      <Text style={[styles.buttonText, { color: c.ink }]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  panel: { paddingHorizontal: 12, paddingVertical: 8, gap: 6, borderBottomWidth: StyleSheet.hairlineWidth },
  row: { flexDirection: "row", alignItems: "center", gap: 8, flexWrap: "wrap" },
  button: { borderWidth: 1, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 6 },
  buttonText: { fontFamily: font.medium, fontSize: 13 },
  switch: { flexDirection: "row", alignItems: "center", gap: 4 },
  meta: { fontFamily: font.medium, fontSize: 12 },
  html: { fontFamily: "monospace", fontSize: 10 },
});
