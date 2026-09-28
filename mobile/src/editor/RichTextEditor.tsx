import { useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState, type Ref } from "react";
import { AppState, Keyboard, KeyboardAvoidingView, PixelRatio, StyleSheet } from "react-native";
import { WebView, type WebViewMessageEvent } from "react-native-webview";
import { useIsDark, usePalette } from "@/lib/theme";
import { EditorToolbar } from "./EditorToolbar";
import { EDITOR_HTML } from "./editor-html.generated";
import {
  TOOLBAR_ACTIONS,
  parseFromPage,
  type ActiveFormats,
  type MentionKind,
  type MentionLabels,
  type ToPage,
} from "./protocol";
import { SuggestionList, type SuggestionItem } from "./SuggestionList";
import { matchInvoices, matchPeople, type MentionInvoice, type MentionPerson } from "./suggestions";

export type { MentionInvoice, MentionPerson } from "./suggestions";

export interface RichTextEditorProps {
  /** Which document this is. Changing it replaces the content with `initialHtml`. */
  docKey: string;
  /**
   * Read when the editor starts and whenever `docKey` changes — not on every
   * render: the editor's own output coming back must not reset the cursor.
   */
  initialHtml: string;
  /**
   * The document's HTML, debounced (300 ms, and at least every 2 s while
   * typing without pause). Whatever is still pending is delivered when the
   * editor loses focus, the app goes to the background, `docKey` changes or
   * the editor unmounts — to the `onChange` given with that document.
   */
  onChange: (html: string) => void;
  /** Read-only when false; toggling it never reloads the editor. */
  editable?: boolean;
  /** Focus, with the keyboard up, as soon as the editor loads. */
  autoFocus?: boolean;
  placeholder?: string;
  /** For @ suggestions (active people only) and for keeping chips' names current. */
  people: MentionPerson[];
  /** For # suggestions and for keeping chips' labels current. */
  invoices: MentionInvoice[];
  onMentionPress?: (m: { kind: "person" | "invoice"; id: string }) => void;
  /** Called when the text gains or loses focus — a screen can make room while it is typed in. */
  onFocusChange?: (focused: boolean) => void;
  ref?: Ref<RichTextEditorHandle>;
}

export interface RichTextEditorHandle {
  focus(): void;
  blur(): void;
}

const CHANGE_DEBOUNCE_MS = 300;
const CHANGE_MAX_WAIT_MS = 2000;

/** The page is loaded from a string, at this address; it may never go anywhere else. */
const PAGE_URL = "about:blank";

const NOTHING_ACTIVE = Object.fromEntries(TOOLBAR_ACTIONS.map((a) => [a, false])) as ActiveFormats;

const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/**
 * The rich-text editor of a note on the phone: the web's TipTap, with the
 * web's extensions and the web's HTML, running on a page bundled into the app
 * (editor-web/, built by scripts/build-editor.mjs) inside a WebView. Works
 * with no connection — the page loads nothing.
 *
 * Fills its parent and keeps its toolbar above the keyboard, so it belongs at
 * the bottom of a screen, reaching the bottom edge.
 */
export function RichTextEditor({
  docKey,
  initialHtml,
  onChange,
  editable = true,
  autoFocus = false,
  placeholder = "Start writing…",
  people,
  invoices,
  onMentionPress,
  onFocusChange,
  ref,
}: RichTextEditorProps) {
  const c = usePalette();
  const dark = useIsDark();
  const webRef = useRef<WebView>(null);

  /** Bumped to rebuild the WebView if Android kills its renderer. */
  const [webKey, setWebKey] = useState(0);
  /** Hidden until the editor exists, so the page never flashes in the wrong theme. */
  const [shown, setShown] = useState(false);
  const [focused, setFocused] = useState(false);
  const [active, setActive] = useState<ActiveFormats>(NOTHING_ACTIVE);
  const [suggestion, setSuggestion] = useState<{ kind: MentionKind; query: string } | null>(null);
  const [keyboardUp, setKeyboardUp] = useState(false);

  const labels = useMemo(
    () => ({
      people: people.map((p): [string, string] => [p.id, p.name]) as MentionLabels,
      invoices: invoices.map((i): [string, string] => [i.id, i.label]) as MentionLabels,
    }),
    [people, invoices]
  );
  const labelsKey = useMemo(() => JSON.stringify(labels), [labels]);

  const readyRef = useRef(false);
  /** The document on screen, and the onChange that saves it. */
  const docRef = useRef({ docKey, onChange });
  /** The one before, for a change that was already on its way when the document switched. */
  const prevDocRef = useRef<{ docKey: string; onChange: (html: string) => void } | null>(null);
  /** The latest HTML of the document on screen — what a rebuilt page starts from. */
  const htmlRef = useRef(initialHtml);
  const autoFocusRef = useRef(autoFocus);
  const liveRef = useRef({ editable, placeholder, dark, labels });
  const onMentionPressRef = useRef(onMentionPress);
  const onFocusChangeRef = useRef(onFocusChange);
  const focusedRef = useRef(false);
  const pendingRef = useRef<{ docKey: string; html: string; since: number } | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const post = useCallback((message: ToPage) => {
    if (readyRef.current) webRef.current?.postMessage(JSON.stringify(message));
  }, []);

  const flush = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    const pending = pendingRef.current;
    if (!pending) return;
    pendingRef.current = null;
    const doc =
      pending.docKey === docRef.current.docKey
        ? docRef.current
        : pending.docKey === prevDocRef.current?.docKey
          ? prevDocRef.current
          : null;
    doc?.onChange(pending.html);
  }, []);

  const onMessage = useCallback(
    (event: WebViewMessageEvent) => {
      const message = parseFromPage(event.nativeEvent.data);
      if (!message) return;
      switch (message.type) {
        case "ready": {
          readyRef.current = true;
          const live = liveRef.current;
          post({
            type: "init",
            docKey: docRef.current.docKey,
            html: htmlRef.current,
            editable: live.editable,
            placeholder: live.placeholder,
            autoFocus: autoFocusRef.current,
            dark: live.dark,
            people: live.labels.people,
            invoices: live.labels.invoices,
          });
          // The keyboard only comes up for a view that has native focus.
          if (autoFocusRef.current) webRef.current?.requestFocus();
          // Once: a page rebuilt after a crash does not grab focus again.
          autoFocusRef.current = false;
          break;
        }
        case "state":
          setShown(true);
          setFocused(message.focused);
          if (message.focused !== focusedRef.current) {
            focusedRef.current = message.focused;
            onFocusChangeRef.current?.(message.focused);
          }
          setActive(message.active);
          if (!message.focused) {
            setSuggestion(null);
            flush();
          }
          break;
        case "change": {
          if (message.docKey !== docRef.current.docKey) {
            // Typed just before the document switched, and arrived after.
            if (message.docKey === prevDocRef.current?.docKey) prevDocRef.current.onChange(message.html);
            break;
          }
          htmlRef.current = message.html;
          const now = Date.now();
          const since = pendingRef.current?.since ?? now;
          pendingRef.current = { docKey: message.docKey, html: message.html, since };
          if (timerRef.current) clearTimeout(timerRef.current);
          if (now - since >= CHANGE_MAX_WAIT_MS) flush();
          else timerRef.current = setTimeout(flush, CHANGE_DEBOUNCE_MS);
          break;
        }
        case "suggestion":
          setSuggestion({ kind: message.kind, query: message.query });
          break;
        case "suggestionEnd":
          setSuggestion(null);
          break;
        case "mentionPress":
          onMentionPressRef.current?.({ kind: message.kind, id: message.id });
          break;
      }
    },
    [flush, post]
  );

  // A new document: deliver what is pending for the old one to the old
  // onChange, then swap the content — without it coming back as an edit.
  useEffect(() => {
    if (docRef.current.docKey === docKey) {
      docRef.current.onChange = onChange;
      return;
    }
    flush();
    prevDocRef.current = docRef.current;
    docRef.current = { docKey, onChange };
    htmlRef.current = initialHtml;
    setSuggestion(null);
    post({ type: "load", docKey, html: initialHtml });
    // initialHtml is only read when the document changes — see its doc.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [docKey, onChange, flush, post]);

  useEffect(() => {
    liveRef.current.editable = editable;
    post({ type: "editable", editable });
  }, [editable, post]);

  useEffect(() => {
    liveRef.current.placeholder = placeholder;
    post({ type: "placeholder", placeholder });
  }, [placeholder, post]);

  useEffect(() => {
    liveRef.current.dark = dark;
    post({ type: "theme", dark });
  }, [dark, post]);

  useEffect(() => {
    liveRef.current.labels = labels;
    post({ type: "mentionLabels", people: labels.people, invoices: labels.invoices });
    // labelsKey: new arrays with the same entries are not a change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [labelsKey, post]);

  useEffect(() => {
    onMentionPressRef.current = onMentionPress;
    onFocusChangeRef.current = onFocusChange;
  }, [onMentionPress, onFocusChange]);

  useEffect(() => {
    const shown = Keyboard.addListener("keyboardDidShow", () => setKeyboardUp(true));
    const hidden = Keyboard.addListener("keyboardDidHide", () => setKeyboardUp(false));
    return () => {
      shown.remove();
      hidden.remove();
    };
  }, []);

  // The app may be killed in the background: save what is pending first.
  useEffect(() => {
    const sub = AppState.addEventListener("change", (state) => {
      if (state !== "active") flush();
    });
    return () => sub.remove();
  }, [flush]);

  useEffect(() => () => flush(), [flush]);

  useImperativeHandle(
    ref,
    () => ({
      focus: () => {
        webRef.current?.requestFocus();
        post({ type: "focus" });
      },
      blur: () => {
        post({ type: "blur" });
        Keyboard.dismiss();
      },
    }),
    [post]
  );

  const rebuild = useCallback(() => {
    readyRef.current = false;
    setShown(false);
    setFocused(false);
    if (focusedRef.current) {
      focusedRef.current = false;
      onFocusChangeRef.current?.(false);
    }
    setSuggestion(null);
    setWebKey((k) => k + 1);
  }, []);

  const items: SuggestionItem[] | null = suggestion
    ? suggestion.kind === "person"
      ? matchPeople(people, suggestion.query).map((p) => ({ id: p.id, label: p.name, detail: p.role }))
      : matchInvoices(invoices, suggestion.query).map((i) => ({
          id: i.id,
          label: i.label,
          detail: capitalize(i.status),
        }))
    : null;

  const showBar = editable && focused && keyboardUp;

  return (
    <KeyboardAvoidingView behavior="padding" style={[styles.root, { backgroundColor: c.bg }]}>
      <WebView
        key={webKey}
        ref={webRef}
        source={{ html: EDITOR_HTML, baseUrl: PAGE_URL }}
        onMessage={onMessage}
        // Every navigation is refused. "*" makes each one reach the callback;
        // one outside the whitelist the library would hand to the browser.
        originWhitelist={["*"]}
        onShouldStartLoadWithRequest={(request) => request.url === PAGE_URL}
        onRenderProcessGone={rebuild}
        onContentProcessDidTerminate={rebuild}
        // Nothing to store, nothing to fetch, no files, no windows.
        javaScriptEnabled
        domStorageEnabled={false}
        cacheEnabled={false}
        cacheMode="LOAD_NO_CACHE"
        allowFileAccess={false}
        allowFileAccessFromFileURLs={false}
        allowUniversalAccessFromFileURLs={false}
        mixedContentMode="never"
        thirdPartyCookiesEnabled={false}
        geolocationEnabled={false}
        javaScriptCanOpenWindowsAutomatically={false}
        setSupportMultipleWindows={false}
        saveFormDataDisabled
        mediaPlaybackRequiresUserAction
        allowsLinkPreview={false}
        dataDetectorTypes={["none"]}
        setBuiltInZoomControls={false}
        setDisplayZoomControls={false}
        overScrollMode="never"
        hideKeyboardAccessoryView
        keyboardDisplayRequiresUserAction={false}
        // The system font size, as the rest of the app follows it.
        textZoom={Math.round(PixelRatio.getFontScale() * 100)}
        webviewDebuggingEnabled={__DEV__}
        style={[styles.web, { backgroundColor: c.bg, opacity: shown ? 1 : 0 }]}
        containerStyle={{ backgroundColor: c.bg }}
      />
      {showBar && items ? (
        <SuggestionList
          kind={suggestion!.kind}
          items={items}
          onPick={(item) => {
            post({ type: "pick", kind: suggestion!.kind, id: item.id, label: item.label });
            setSuggestion(null);
          }}
        />
      ) : null}
      {showBar ? (
        <EditorToolbar
          active={active}
          onFormat={(action) => post({ type: "format", action })}
          onMention={(kind) => post({ type: "trigger", kind })}
          onHideKeyboard={() => {
            post({ type: "blur" });
            Keyboard.dismiss();
          }}
        />
      ) : null}
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  web: { flex: 1 },
});
