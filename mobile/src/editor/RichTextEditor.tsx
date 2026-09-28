/**
 * ⚠️ TEMPORARY STUB — REPLACE THIS FILE with the real editor (TipTap in a
 * WebView, phase 2 worker "2B"). Keep the exported interface exactly as it is:
 * the note screen (src/app/note/[id].tsx) is written against it.
 *
 * What the stub does: edits notes made only of plain paragraphs as a
 * multiline TextInput, converting text ↔ `<p>` HTML (src/editor/plain.ts,
 * which goes away with it). A note with ANY richer formatting — bold, lists,
 * headings, @ or # mentions — is shown read-only with a notice, because
 * editing it as plain text would flatten what was written on the web.
 * `people`, `invoices` and `onMentionPress` are accepted and unused.
 */
import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState } from "react";
import { StyleSheet, Text, TextInput, View } from "react-native";
import { font, usePalette } from "@/lib/theme";
import { htmlToPlain, isPlainHtml, plainToHtml } from "./plain";
import { textLines } from "@/notes/text";

export interface MentionPerson {
  id: string;
  name: string;
  role?: string | null;
  active: boolean;
}
export interface MentionInvoice {
  id: string;
  label: string;
  status: string;
}
export interface RichTextEditorProps {
  docKey: string; // changing it reloads initialHtml
  initialHtml: string;
  onChange: (html: string) => void;
  editable?: boolean; // default true
  autoFocus?: boolean;
  placeholder?: string;
  people: MentionPerson[];
  invoices: MentionInvoice[];
  onMentionPress?: (m: { kind: "person" | "invoice"; id: string }) => void;
}
export interface RichTextEditorHandle {
  focus(): void;
  blur(): void;
}

export const RichTextEditor = forwardRef<RichTextEditorHandle, RichTextEditorProps>(function RichTextEditor(
  { docKey, initialHtml, onChange, editable = true, autoFocus, placeholder },
  ref
) {
  const c = usePalette();
  const input = useRef<TextInput>(null);
  // Loaded once per docKey, like the real editor: later renders with a new
  // initialHtml do not reset what is being typed.
  const [loaded, setLoaded] = useState({ key: docKey, html: initialHtml });
  const [text, setText] = useState(() => htmlToPlain(initialHtml));

  useEffect(() => {
    if (docKey !== loaded.key) {
      setLoaded({ key: docKey, html: initialHtml });
      setText(htmlToPlain(initialHtml));
    }
  }, [docKey, initialHtml, loaded.key]);

  useImperativeHandle(ref, () => ({ focus: () => input.current?.focus(), blur: () => input.current?.blur() }), []);

  const plain = useMemo(() => isPlainHtml(loaded.html), [loaded.html]);

  if (!plain) {
    return (
      <View style={styles.readOnly}>
        <Text style={[styles.notice, { color: c.soon }]}>
          This note has formatting. Editing it on the phone arrives with the new editor; for now it opens read-only.
        </Text>
        {textLines(loaded.html).map((line, i) => (
          <Text key={i} style={[styles.body, { color: c.ink }]}>
            {line}
          </Text>
        ))}
      </View>
    );
  }

  return (
    <TextInput
      ref={input}
      testID="note-body"
      value={text}
      onChangeText={(t) => {
        setText(t);
        onChange(plainToHtml(t));
      }}
      editable={editable}
      autoFocus={autoFocus}
      multiline
      scrollEnabled={false}
      placeholder={placeholder}
      placeholderTextColor={c.faint}
      textAlignVertical="top"
      style={[styles.body, styles.input, { color: c.ink }]}
    />
  );
});

const styles = StyleSheet.create({
  body: { fontFamily: font.regular, fontSize: 16, lineHeight: 25 },
  input: { minHeight: 240, padding: 0 },
  readOnly: { gap: 8 },
  notice: { fontFamily: font.medium, fontSize: 13, lineHeight: 18, marginBottom: 4 },
});
