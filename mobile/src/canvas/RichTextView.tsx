import { memo, useMemo } from "react";
import { StyleSheet, Text, View, type TextStyle } from "react-native";
import { font, type Palette } from "@/lib/theme";
import { parseRichText, type Block, type Run } from "./richtext";

/** The web's one highlight colour (app/globals.css, mobile/editor-web/page.css). */
const HIGHLIGHT_BG = "#fde68a";
const HIGHLIGHT_INK = "#1c1917";

/** Deleted mention chips, as on the web: an orange tint. */
const DELETED_BG = "rgba(249, 115, 22, 0.15)";
const DELETED_INK = "#c2410c";

const MONO = "monospace";

const SIZES: Record<Block["kind"], { size: number; line: number; family: string }> = {
  p: { size: 13.5, line: 19, family: font.regular },
  h1: { size: 19, line: 24, family: font.bold },
  h2: { size: 17, line: 22, family: font.bold },
  h3: { size: 15.5, line: 21, family: font.semibold },
  h4: { size: 14.5, line: 20, family: font.semibold },
  code: { size: 12.5, line: 17, family: MONO },
  hr: { size: 13.5, line: 19, family: font.regular },
};

function runStyle(run: Run, block: Block, c: Palette): TextStyle {
  const s: TextStyle = {};
  const heading = block.kind !== "p" && block.kind !== "code";
  if (run.bold && !heading) s.fontFamily = font.bold;
  if (run.italic) s.fontStyle = "italic";
  const lines: string[] = [];
  if (run.underline || run.link) lines.push("underline");
  if (run.strike) lines.push("line-through");
  if (lines.length) s.textDecorationLine = lines.join(" ") as TextStyle["textDecorationLine"];
  if (run.code && block.kind !== "code") {
    s.fontFamily = MONO;
    s.fontSize = SIZES[block.kind].size - 1;
    s.backgroundColor = c.surface;
  }
  if (run.highlight) {
    s.backgroundColor = HIGHLIGHT_BG;
    s.color = HIGHLIGHT_INK;
  }
  if (run.mention) {
    s.fontFamily = font.medium;
    if (run.mention.deleted) {
      s.backgroundColor = DELETED_BG;
      s.color = DELETED_INK;
    } else if (run.mention.kind === "person") {
      s.backgroundColor = c.primary;
      s.color = c.onPrimary;
    } else {
      s.backgroundColor = c.surface;
      s.color = c.ink;
    }
  }
  return s;
}

function runText(run: Run): string {
  if (!run.mention) return run.text;
  // Nested <Text> cannot round its corners; the thin spaces give the chip room.
  return ` ${run.mention.kind === "person" ? "@" : "#"}${run.text} `;
}

/**
 * An idea's rich text, drawn natively (src/canvas/richtext.ts reads the HTML):
 * what a card on the canvas shows. Read-only; the editor is the sheet.
 */
export const RichTextView = memo(function RichTextView({
  html,
  c,
  placeholder,
}: {
  html: string;
  c: Palette;
  placeholder?: string;
}) {
  const blocks = useMemo(() => parseRichText(html), [html]);
  const empty = !blocks.some((b) => b.kind === "hr" || b.runs.some((r) => r.text.trim() !== ""));
  if (empty) {
    return <Text style={[styles.placeholder, { color: c.faint }]}>{placeholder ?? "Empty idea"}</Text>;
  }

  return (
    <View style={styles.root}>
      {blocks.map((block, i) => {
        if (block.kind === "hr") return <View key={i} style={[styles.hr, { backgroundColor: c.line }]} />;
        const size = SIZES[block.kind];
        const text = (
          <Text
            style={[
              { fontFamily: size.family, fontSize: size.size, lineHeight: size.line, color: c.ink },
              block.kind === "code" ? [styles.code, { backgroundColor: c.surface }] : null,
            ]}
          >
            {block.runs.length === 0 ? " " : block.runs.map((run, j) => (
              <Text key={j} style={runStyle(run, block, c)}>
                {runText(run)}
              </Text>
            ))}
          </Text>
        );
        const indent = (block.list?.depth ?? 0) * 14 + (block.quote ? 10 : 0);
        return (
          <View
            key={i}
            style={[
              styles.block,
              i === 0 ? styles.first : null,
              block.kind.startsWith("h") ? styles.heading : null,
              { paddingLeft: indent },
              block.quote ? [styles.quote, { borderColor: c.line }] : null,
            ]}
          >
            {block.list ? (
              <View style={styles.item}>
                <Text style={[styles.marker, { color: c.muted, fontSize: size.size, lineHeight: size.line }]}>
                  {block.list.marker ?? ""}
                </Text>
                <View style={styles.itemBody}>{text}</View>
              </View>
            ) : (
              text
            )}
          </View>
        );
      })}
    </View>
  );
});

const styles = StyleSheet.create({
  root: { gap: 0 },
  block: { marginTop: 4 },
  first: { marginTop: 0 },
  heading: { marginTop: 6 },
  quote: { borderLeftWidth: 3 },
  item: { flexDirection: "row" },
  marker: { width: 16, fontFamily: font.medium },
  itemBody: { flex: 1 },
  code: { paddingHorizontal: 6, paddingVertical: 4, borderRadius: 6 },
  hr: { height: StyleSheet.hairlineWidth * 2, marginVertical: 6 },
  placeholder: { fontFamily: font.regular, fontSize: 13.5, fontStyle: "italic" },
});
