"use client";

import { AutoFocusPlugin } from "@lexical/react/LexicalAutoFocusPlugin";
import { ClearEditorPlugin } from "@lexical/react/LexicalClearEditorPlugin";
import {
  type InitialConfigType,
  LexicalComposer,
} from "@lexical/react/LexicalComposer";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import { ContentEditable } from "@lexical/react/LexicalContentEditable";
import { LexicalErrorBoundary } from "@lexical/react/LexicalErrorBoundary";
import { HistoryPlugin } from "@lexical/react/LexicalHistoryPlugin";
import { LinkPlugin } from "@lexical/react/LexicalLinkPlugin";
import { ListPlugin } from "@lexical/react/LexicalListPlugin";
import { RichTextPlugin } from "@lexical/react/LexicalRichTextPlugin";
import {
  $getRoot,
  $isElementNode,
  CLEAR_EDITOR_COMMAND,
  CLEAR_HISTORY_COMMAND,
  createEditor,
  type ElementNode,
  type LexicalEditor,
  mergeRegister,
  ParagraphNode,
  RootNode,
  SKIP_DOM_SELECTION_TAG,
  TabNode,
  TextNode,
} from "lexical";
import { useTranslations } from "next-intl";
import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  $exportBb,
  $replaceWithBb,
  BB_NODES,
  TEXT_NODES,
} from "@/components/forum/bb-lexical";
import {
  EDITOR_BOX,
  EDITOR_TEXT,
  editorMinHeight,
  editorPadding,
} from "@/components/forum/composer-box";
import {
  attachTag,
  insertAtCaret,
  offerFiles,
  onComposerRequest,
  takePastedFiles,
  withoutAttachTag,
} from "@/components/forum/composer-insert";
import { $placeSelection } from "@/components/forum/editor-caret";
import {
  $insertText,
  $removeAttachTags,
  registerRemoveFormattingShortcut,
} from "@/components/forum/editor-commands";
import { EmojiPlugin } from "@/components/forum/editor-emoji";
import {
  InsertPlugin,
  type MemberHit,
  MentionPlugin,
  SourceContext,
  type SourceMode,
} from "@/components/forum/editor-extras";
import { prepareFiles, registerPaste } from "@/components/forum/editor-paste";
import { Toolbar } from "@/components/forum/editor-toolbar";
import { sentText } from "@/components/forum/editor-value";
import { FormError } from "@/components/forum/form-error";
import {
  $insertImage,
  attachOf,
  finishUpload,
  forgetUploads,
  placeUploads,
  settleUpload,
} from "@/components/forum/image-node";
import { prose } from "@/components/forum/prose";
import { cn } from "@/lib/utils";

const CONFIG: InitialConfigType = {
  namespace: "forum-editor",
  nodes: BB_NODES,
  theme: {
    heading: { h1: prose.h1, h2: prose.h2, h3: prose.h3 },
    quote: prose.blockquote,
    list: {
      ul: prose.ul,
      ol: prose.ol,
      listitem: prose.li,
      nested: { listitem: prose.nestedLi },
    },
    link: prose.a,
    code: prose.pre,
    text: {
      bold: prose.strong,
      italic: prose.em,
      underline: prose.u,
      strikethrough: prose.del,
      underlineStrikethrough: prose.uDel,
      code: prose.code,
    },
  },
  onError(error) {
    throw error;
  },
};

function registerStyleTransforms(editor: LexicalEditor) {
  // Transforms run before reconciliation. Register concrete classes because
  // TextNode transforms do not cover TabNode or CodeHighlightNode subclasses.
  return mergeRegister(
    ...[RootNode, ParagraphNode, TextNode, TabNode, ...TEXT_NODES].map((node) =>
      editor.registerNodeTransform<TextNode | ElementNode>(node, (node) => {
        if (node.getStyle()) node.setStyle("");
        // Empty blocks can carry styles into later typing and list markers.
        if ($isElementNode(node) && node.getTextStyle()) node.setTextStyle("");
      }),
    ),
  );
}

function ContentSafetyPlugin({
  onFiles,
}: {
  // Called with the files a paste or a drop brings, and the form the editor is in.
  onFiles: (
    files: File[],
    form: HTMLFormElement | null,
    pasted: boolean,
  ) => void;
}) {
  const [editor] = useLexicalComposerContext();
  // The latest, so a new one does not register everything again.
  const latest = useRef(onFiles);
  latest.current = onFiles;

  useLayoutEffect(
    () =>
      mergeRegister(
        registerStyleTransforms(editor),
        registerPaste(editor, (files, pasted) =>
          latest.current(
            files,
            editor.getRootElement()?.closest("form") ?? null,
            pasted,
          ),
        ),
      ),
    [editor],
  );

  return null;
}

// A function `editorState` is applied by an update that only commits in a
// microtask, so on the server the placeholder check still sees an empty editor
// while the first client render sees the content. A serialized state is applied
// synchronously, so both sides agree.
function initialEditorState(bb: string): string | undefined {
  const scratch = createEditor({ nodes: BB_NODES });
  const unregister = registerStyleTransforms(scratch);
  scratch.update(() => $replaceWithBb(bb), { discrete: true });
  const state = scratch.getEditorState();
  unregister();
  return state.isEmpty() ? undefined : JSON.stringify(state);
}

// Takes the focus with the selection where the plain box it replaces had its own.
function FocusAt({
  source,
  start,
  end,
}: {
  source: string;
  start: number;
  end: number;
}) {
  const [editor] = useLexicalComposerContext();
  useEffect(() => {
    editor.update(() => $placeSelection(source, start, end), {
      discrete: true,
    });
    editor.focus();
  }, [editor, source, start, end]);
  return null;
}

function RemoveFormattingShortcut() {
  const [editor] = useLexicalComposerContext();
  useEffect(() => registerRemoveFormattingShortcut(editor), [editor]);
  return null;
}

// Keeps what the form sends: the BB code of the rich text while it shows, the text of the source
// field while that shows. What the member did not touch is sent as it was given (the editor
// writes BB code its own way: the first thing it reports is how it writes the text it opened with,
// and only a different text after that is a change).
function FormField({
  name,
  resetKey,
  required,
  defaultValue,
  value,
  commit,
  onInsertReady,
  onFiles,
  setInvalid,
  source,
  editorRef,
}: Pick<
  EditorProps,
  "name" | "resetKey" | "required" | "defaultValue" | "onInsertReady"
> & {
  value: string;
  commit: (text: string) => void;
  // Takes the files dropped on the composer outside the editor's text.
  onFiles: (
    files: File[],
    form: HTMLFormElement | null,
    pasted: boolean,
  ) => void;
  setInvalid: (invalid: boolean) => void;
  source: SourceMode;
  editorRef: React.RefObject<LexicalEditor | null>;
}) {
  const [editor] = useLexicalComposerContext();
  const inputRef = useRef<HTMLInputElement>(null);
  const validationRef = useRef<HTMLInputElement>(null);
  const lastResetKey = useRef(resetKey);
  const written = useRef<string>(undefined);
  const original = useRef(defaultValue);
  const shown = useRef(source);
  shown.current = source;
  editorRef.current = editor;

  useEffect(() => {
    const sync = (read: () => string) => {
      // The rich text is not what is sent while the source shows.
      if (shown.current.active) return;
      const next = read();
      written.current ??= next;
      commit(sentText(next, written.current, original.current));
    };
    // The initial state is set before this listener exists, so read it once.
    sync(() => editor.getEditorState().read($exportBb));
    return editor.registerUpdateListener(({ editorState }) =>
      sync(() => editorState.read($exportBb)),
    );
  }, [editor, commit]);

  useEffect(() => {
    if (validationRef.current) {
      validationRef.current.value = value.trim() ? "filled" : "";
    }
    if (value.trim()) setInvalid(false);
  }, [value, setInvalid]);

  // Text asked for from elsewhere in the composer (an attachment's tag) goes in at the caret.
  useEffect(() => {
    const form = inputRef.current?.form;
    return onComposerRequest(form, (request) => {
      const box = shown.current.active ? shown.current.field.current : null;
      if ("drop" in request) {
        onFiles(request.drop, form ?? null, request.pasted ?? false);
      } else if ("uploaded" in request) {
        // A picture shown while it uploaded: in the source its tag goes in at the caret, as it
        // would have before.
        if (!box) {
          finishUpload(editor, request.uploaded, request.id);
        } else {
          settleUpload(request.uploaded, request.id);
          if (request.id) {
            insertAtCaret(box, attachTag(request.id, "full"), true, false);
            commit(box.value);
          }
        }
      } else if (box) {
        if ("insert" in request) {
          insertAtCaret(box, request.insert, true, !request.background);
        } else box.value = withoutAttachTag(box.value, request.remove);
        commit(box.value);
      } else if ("insert" in request) {
        // Setting the browser's selection in the text would take the focus, so a member who is
        // elsewhere keeps it, and the text goes in at the selection the editor holds.
        const away =
          request.background &&
          !editor.getRootElement()?.contains(document.activeElement);
        // A tag of the attachment list goes in as its picture.
        const picture = attachOf(request.insert);
        editor.update(
          () => (picture ? $insertImage(picture) : $insertText(request.insert)),
          { tag: away ? SKIP_DOM_SELECTION_TAG : undefined },
        );
        if (!request.background) editor.focus();
      } else {
        editor.update(() => $removeAttachTags(request.remove));
      }
    });
  }, [editor, commit, onFiles]);

  // An editor that is gone lets go of the pictures it uploaded.
  useEffect(() => () => forgetUploads(editor), [editor]);

  // Says that requests are now taken here, for a composer that queued some on the way.
  useEffect(() => onInsertReady?.(), [onInsertReady]);

  const clear = useCallback(() => {
    setInvalid(false);
    // What is written after a clear is not the text the editor opened with.
    original.current = undefined;
    editor.dispatchCommand(CLEAR_EDITOR_COMMAND, undefined);
    // The pictures it uploaded are in the post that was sent.
    forgetUploads(editor);
    commit("");
  }, [editor, commit, setInvalid]);

  useEffect(() => {
    const form = inputRef.current?.form;
    if (!form) return;
    form.addEventListener("reset", clear);
    return () => form.removeEventListener("reset", clear);
  }, [clear]);

  useEffect(() => {
    if (resetKey === lastResetKey.current) return;
    lastResetKey.current = resetKey;
    clear();
  }, [resetKey, clear]);

  return (
    <>
      <input ref={inputRef} type="hidden" name={name} value={value} />
      {/* Hidden inputs cannot participate in native constraint validation. */}
      {required && (
        <input
          ref={validationRef}
          type="text"
          required
          defaultValue={defaultValue?.trim() ? "filled" : undefined}
          tabIndex={-1}
          aria-hidden="true"
          className="sr-only"
          onInvalid={(event) => {
            event.preventDefault();
            setInvalid(true);
            if (
              event.currentTarget.form?.querySelector(":invalid") ===
              event.currentTarget
            ) {
              if (shown.current.active) shown.current.field.current?.focus();
              else editor.focus();
            }
          }}
        />
      )}
    </>
  );
}

export type EditorProps = {
  id?: string;
  "aria-labelledby"?: string;
  "aria-invalid"?: boolean;
  "aria-describedby"?: string;
  required?: boolean;
  name?: string;
  placeholder?: string;
  defaultValue?: string;
  minHeight?: number;
  compact?: boolean;
  // The formatting bar. A compact editor has none unless it is asked for.
  toolbar?: boolean;
  // Takes the focus once it is on the page, with the caret after what it holds.
  autoFocus?: boolean;
  // With `autoFocus`: where the focus goes in `defaultValue`, as the offsets of the selection of the
  // box the editor takes the place of (the caret lands after as many characters of the text).
  selection?: { start: number; end: number };
  // The BB code as it is sent.
  onChange?: (bbCode: string) => void;
  resetKey?: string | number;
  className?: string;
  // Typing an "@" then offers the members this finds.
  findMembers?: (prefix: string) => Promise<MemberHit[]>;
  // The name of a window event whose detail is BB code to add at the end of the editor.
  insertEvent?: string;
  // Called once the editor takes requests from the rest of its composer (see `LazyEditor`).
  onInsertReady?: () => void;
};

export function Editor({
  id,
  "aria-labelledby": labelledBy,
  "aria-invalid": ariaInvalid,
  "aria-describedby": describedBy,
  required,
  name,
  placeholder: placeholderProp,
  defaultValue,
  minHeight,
  compact = false,
  toolbar = !compact,
  autoFocus,
  selection,
  onChange,
  resetKey,
  className,
  findMembers,
  insertEvent,
  onInsertReady,
}: EditorProps) {
  const t = useTranslations("editor.editor");
  const placeholder =
    placeholderProp === undefined ? t("placeholder") : placeholderProp;
  const [invalid, setInvalid] = useState(false);
  // Why a pasted or dropped file was not taken, until the text changes.
  const [notice, setNotice] = useState<string>();
  // Files go to the upload the composer around the editor has, by the same way its attach button
  // sends them; an editor with none refuses them and says so.
  const named = useRef(new Set<string>());
  const editorRef = useRef<LexicalEditor>(null);
  // Whether the source shows instead of the rich text.
  const sourceRef = useRef(false);
  const takeFiles = useCallback(
    async (files: File[], form: HTMLFormElement | null, pasted: boolean) => {
      const sent = await prepareFiles(files, {
        prefix: t("pastedName"),
        now: new Date(),
        pasted,
        used: named.current,
      });
      // A refusal stays on show while more files are being taken, until the text changes.
      if (!offerFiles(form, sent)) {
        setNotice(t("errors.noUpload"));
        return;
      }
      // The pictures show in the text at once, while they upload (in the source, their tags go in
      // once they are stored).
      const editor = editorRef.current;
      if (editor && !sourceRef.current) placeUploads(editor, sent);
    },
    [t],
  );
  const errorId = useId();
  const noticeId = useId();
  const describedByIds =
    [describedBy, invalid ? errorId : undefined, notice ? noticeId : undefined]
      .filter(Boolean)
      .join(" ") || undefined;
  const padding = editorPadding(compact);
  const [initialConfig] = useState<InitialConfigType>(() => {
    const editorState = defaultValue && initialEditorState(defaultValue);
    return editorState ? { ...CONFIG, editorState } : CONFIG;
  });

  // The BB code as it is sent, and the field that shows it as text.
  const [value, setValue] = useState(defaultValue ?? "");
  const [sourceShown, setSourceShown] = useState(false);
  const valueRef = useRef(value);
  valueRef.current = value;
  const field = useRef<HTMLTextAreaElement>(null);
  const changed = useRef(onChange);
  changed.current = onChange;
  const lastValue = useRef<string>(undefined);
  const commit = useCallback((text: string) => {
    if (text === lastValue.current) return;
    lastValue.current = text;
    setValue(text);
    setNotice(undefined);
    changed.current?.(text);
  }, []);
  // Between the rich text and the source, in both directions without losing a character: the
  // source is what the rich text is written as, and the rich text is read from the source. A
  // source left as it was found leaves the rich text alone (its caret and its history stay); a
  // changed one replaces it, and the history of what it replaced goes, as Undo would otherwise
  // bring back text the member took out in the source.
  const enteredWith = useRef("");
  const toggle = useCallback(() => {
    const editor = editorRef.current;
    if (!editor) return;
    if (sourceRef.current) {
      sourceRef.current = false;
      if (valueRef.current !== enteredWith.current) {
        editor.update(
          () => {
            $replaceWithBb(valueRef.current);
            $getRoot().selectEnd();
          },
          { discrete: true },
        );
        editor.dispatchCommand(CLEAR_HISTORY_COMMAND, undefined);
      }
      setSourceShown(false);
    } else {
      sourceRef.current = true;
      enteredWith.current = valueRef.current;
      setSourceShown(true);
    }
  }, []);
  const sourceMode = useMemo<SourceMode>(
    () => ({ active: sourceShown, field, commit, toggle }),
    [sourceShown, commit, toggle],
  );
  // The field takes the focus when it appears, and the rich text when it comes back.
  const wasShown = useRef(sourceShown);
  useEffect(() => {
    if (wasShown.current === sourceShown) return;
    wasShown.current = sourceShown;
    if (sourceShown) {
      const box = field.current;
      box?.focus();
      box?.setSelectionRange(box.value.length, box.value.length);
    } else {
      editorRef.current?.focus();
    }
  }, [sourceShown]);

  const fieldLabel = labelledBy ? undefined : placeholder;
  return (
    <SourceContext.Provider value={sourceMode}>
      <LexicalComposer initialConfig={initialConfig}>
        <ContentSafetyPlugin onFiles={takeFiles} />
        <div className={cn("group/editor", EDITOR_BOX, className)}>
          {toolbar && <Toolbar />}
          <div className="relative" hidden={sourceShown}>
            <RichTextPlugin
              contentEditable={
                <ContentEditable
                  id={sourceShown ? undefined : id}
                  aria-label={fieldLabel}
                  aria-labelledby={labelledBy}
                  aria-required={required}
                  aria-invalid={invalid || ariaInvalid || undefined}
                  aria-describedby={describedByIds}
                  aria-placeholder={placeholder}
                  placeholder={
                    <div
                      className={cn(
                        "pointer-events-none absolute inset-0 truncate text-foreground/40",
                        EDITOR_TEXT,
                        padding,
                      )}
                    >
                      {placeholder}
                    </div>
                  }
                  className={cn(
                    prose.root,
                    EDITOR_TEXT,
                    "outline-none",
                    padding,
                  )}
                  style={{ minHeight: minHeight ?? editorMinHeight(compact) }}
                />
              }
              ErrorBoundary={LexicalErrorBoundary}
            />
            {findMembers && <MentionPlugin find={findMembers} />}
            <EmojiPlugin />
          </div>
          {sourceShown && (
            <textarea
              ref={field}
              id={id}
              value={value}
              onChange={(event) => commit(event.target.value)}
              onPaste={takePastedFiles}
              aria-label={fieldLabel}
              aria-labelledby={labelledBy}
              aria-required={required}
              aria-invalid={invalid || ariaInvalid || undefined}
              aria-describedby={describedByIds}
              spellCheck={false}
              autoCapitalize="off"
              className={cn(
                "block field-sizing-content w-full resize-none bg-transparent font-mono outline-none",
                EDITOR_TEXT,
                padding,
              )}
              style={{ minHeight: minHeight ?? editorMinHeight(compact) }}
            />
          )}
          <FormField
            name={name}
            resetKey={resetKey}
            required={required}
            defaultValue={defaultValue}
            value={value}
            commit={commit}
            onInsertReady={onInsertReady}
            onFiles={takeFiles}
            setInvalid={setInvalid}
            source={sourceMode}
            editorRef={editorRef}
          />
          {notice && (
            <FormError id={noticeId} className="px-3 pb-2">
              {notice}
            </FormError>
          )}
        </div>
        {invalid && <FormError id={errorId}>{t("errors.required")}</FormError>}
        <HistoryPlugin />
        <RemoveFormattingShortcut />
        <ListPlugin />
        <LinkPlugin />
        <ClearEditorPlugin />
        {autoFocus &&
          (selection ? (
            <FocusAt
              source={defaultValue ?? ""}
              start={selection.start}
              end={selection.end}
            />
          ) : (
            <AutoFocusPlugin />
          ))}
        {insertEvent && <InsertPlugin event={insertEvent} />}
      </LexicalComposer>
    </SourceContext.Provider>
  );
}
