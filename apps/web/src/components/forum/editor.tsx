"use client";

import { $isCodeNode } from "@lexical/code";
import { $isLinkNode, TOGGLE_LINK_COMMAND } from "@lexical/link";
import {
  $isListNode,
  INSERT_ORDERED_LIST_COMMAND,
  INSERT_UNORDERED_LIST_COMMAND,
  REMOVE_LIST_COMMAND,
} from "@lexical/list";
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
import { $isHeadingNode, $isQuoteNode } from "@lexical/rich-text";
import {
  $getRoot,
  $getSelection,
  $isElementNode,
  $isRangeSelection,
  CAN_REDO_COMMAND,
  CAN_UNDO_COMMAND,
  CLEAR_EDITOR_COMMAND,
  COMMAND_PRIORITY_HIGH,
  COMMAND_PRIORITY_LOW,
  createEditor,
  DROP_COMMAND,
  type ElementNode,
  FORMAT_TEXT_COMMAND,
  type LexicalEditor,
  mergeRegister,
  PASTE_COMMAND,
  PASTE_TAG,
  ParagraphNode,
  REDO_COMMAND,
  RootNode,
  TabNode,
  type TextFormatType,
  TextNode,
  UNDO_COMMAND,
} from "lexical";
import {
  Bold,
  Brackets,
  Clapperboard,
  Code,
  Eraser,
  EyeOff,
  Heading,
  Italic,
  Link2,
  List,
  ListOrdered,
  type LucideIcon,
  Redo2,
  SquareCode,
  Strikethrough,
  TextQuote,
  Underline,
  Undo2,
} from "lucide-react";
import { useTranslations } from "next-intl";
import {
  useCallback,
  useContext,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import {
  $exportBb,
  $insertBb,
  $replaceWithBb,
  BB_NODES,
} from "@/components/forum/bb-lexical";
import { linkAddressOf } from "@/components/forum/bb-scan";
import {
  insertAtCaret,
  onComposerRequest,
  withoutAttachTag,
} from "@/components/forum/composer-insert";
import {
  $applyLink,
  $insertText,
  $removeAttachTags,
  $removeFormatting,
  $setBlock,
  $wrapSelection,
  type BlockKind,
  registerRemoveFormattingShortcut,
} from "@/components/forum/editor-commands";
import {
  InsertPlugin,
  type MemberHit,
  MentionPlugin,
  SourceContext,
  type SourceMode,
} from "@/components/forum/editor-extras";
import { FormError } from "@/components/forum/form-error";
import { htmlToBb } from "@/components/forum/html-to-bb";
import { mediaTagOf } from "@/components/forum/media-url";
import { prose } from "@/components/forum/prose";
import { Button } from "@/components/ui/button";
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
    ...[RootNode, ParagraphNode, TextNode, TabNode, ...BB_NODES].map((node) =>
      editor.registerNodeTransform<TextNode | ElementNode>(node, (node) => {
        if (node.getStyle()) node.setStyle("");
        // Empty blocks can carry styles into later typing and list markers.
        if ($isElementNode(node) && node.getTextStyle()) node.setTextStyle("");
      }),
    ),
  );
}

// What a paste puts in: pasted rich text becomes BB code, so that bold, links, lists and the rest
// arrive as formatting and everything else as text, and plain text is taken as typed (its tags
// stay text). The editor's own copies keep Lexical's paste.
function pastedBb(data: DataTransfer): { bb: string; literal: boolean } {
  const html = data.getData("text/html");
  if (html) {
    const bb = htmlToBb(
      new DOMParser().parseFromString(html, "text/html").body,
    );
    if (bb) return { bb, literal: false };
  }
  return { bb: data.getData("text/plain"), literal: true };
}

function ContentSafetyPlugin() {
  const [editor] = useLexicalComposerContext();

  useLayoutEffect(
    () =>
      mergeRegister(
        registerStyleTransforms(editor),
        editor.registerCommand(
          PASTE_COMMAND,
          (event) => {
            // Never allow native insertion, even without a Lexical selection.
            event.preventDefault();
            const data = "clipboardData" in event ? event.clipboardData : null;
            if (!data || data.files.length > 0) return true;
            if (data.types.includes("application/x-lexical-editor")) {
              return false;
            }
            const { bb, literal } = pastedBb(data);
            if (bb) {
              const plain = data.getData("text/plain") || bb;
              editor.update(() => $insertBb(bb, literal, plain), {
                tag: PASTE_TAG,
              });
            }
            return true;
          },
          COMMAND_PRIORITY_HIGH,
        ),
        editor.registerCommand(
          DROP_COMMAND,
          (event) => {
            // External drops otherwise fall through to native DOM insertion.
            event.preventDefault();
            return true;
          },
          COMMAND_PRIORITY_HIGH,
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

function RemoveFormattingShortcut() {
  const [editor] = useLexicalComposerContext();
  useEffect(() => registerRemoveFormattingShortcut(editor), [editor]);
  return null;
}

type ToolbarState = {
  formats: TextFormatType[];
  block: BlockKind;
  link: boolean;
};

const FORMATS = [
  { format: "bold", label: "boldLabel", icon: Bold },
  { format: "italic", label: "italicLabel", icon: Italic },
  { format: "underline", label: "underlineLabel", icon: Underline },
  { format: "strikethrough", label: "strikethroughLabel", icon: Strikethrough },
  { format: "code", label: "inlineCodeLabel", icon: Code },
] as const satisfies {
  format: TextFormatType;
  label: string;
  icon: LucideIcon;
}[];

function $readToolbarState(): ToolbarState | null {
  const selection = $getSelection();
  if (!$isRangeSelection(selection)) return null;
  const anchor = selection.anchor.getNode();
  const top = anchor.getTopLevelElement();
  let block: BlockKind = "paragraph";
  if ($isHeadingNode(top)) block = "heading";
  else if ($isQuoteNode(top)) block = "quote";
  else if ($isCodeNode(top)) block = "code";
  else if ($isListNode(top)) {
    block = top.getListType() === "number" ? "number" : "bullet";
  }
  return {
    formats: FORMATS.map((f) => f.format).filter((f) => selection.hasFormat(f)),
    block,
    link: $isLinkNode(anchor) || $isLinkNode(anchor.getParent()),
  };
}

function ToolbarButton({
  label,
  icon: Icon,
  active,
  always,
  disabled,
  ...props
}: React.ComponentProps<typeof Button> & {
  label: string;
  icon: LucideIcon;
  active?: boolean;
  // Stays usable while the BB code source is shown (the button that switches to and from it).
  always?: boolean;
}) {
  const source = useContext(SourceContext)?.active;
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      aria-label={label}
      title={label}
      aria-pressed={active}
      disabled={disabled || (source && !always)}
      onMouseDown={(event) => event.preventDefault()}
      className="size-10 text-muted-foreground aria-pressed:bg-muted aria-pressed:text-foreground md:size-8"
      {...props}
    >
      <Icon />
    </Button>
  );
}

function Divider() {
  return <span className="mx-1 h-5 w-px shrink-0 bg-border" />;
}

function Toolbar({ className }: { className?: string }) {
  const t = useTranslations("editor.editor");
  const [editor] = useLexicalComposerContext();
  const source = useContext(SourceContext);
  const [state, setState] = useState<ToolbarState>({
    formats: [],
    block: "paragraph",
    link: false,
  });
  const [canUndo, setCanUndo] = useState(false);
  const [canRedo, setCanRedo] = useState(false);
  // The button whose address was refused.
  const [refused, setRefused] = useState<"media" | "link" | null>(null);

  useEffect(
    () =>
      mergeRegister(
        editor.registerUpdateListener(({ editorState }) => {
          const next = editorState.read($readToolbarState);
          if (next) setState(next);
        }),
        editor.registerCommand(
          CAN_UNDO_COMMAND,
          (payload) => {
            setCanUndo(payload);
            return false;
          },
          COMMAND_PRIORITY_LOW,
        ),
        editor.registerCommand(
          CAN_REDO_COMMAND,
          (payload) => {
            setCanRedo(payload);
            return false;
          },
          COMMAND_PRIORITY_LOW,
        ),
      ),
    [editor],
  );

  function setBlock(block: "heading" | "quote" | "code") {
    editor.update(() => $setBlock(state.block, block));
  }

  function toggleList(block: "bullet" | "number") {
    if (state.block === block) {
      editor.dispatchCommand(REMOVE_LIST_COMMAND, undefined);
    } else if (block === "bullet") {
      editor.dispatchCommand(INSERT_UNORDERED_LIST_COMMAND, undefined);
    } else {
      editor.dispatchCommand(INSERT_ORDERED_LIST_COMMAND, undefined);
    }
  }

  function toggleLink() {
    if (state.link) {
      editor.dispatchCommand(TOGGLE_LINK_COMMAND, null);
      return;
    }
    const input = window.prompt(t("linkPrompt"), "https://");
    if (!input) {
      setRefused(null);
      return;
    }
    const url = linkAddressOf(input);
    setRefused(url ? null : "link");
    if (url) editor.update(() => $applyLink(url));
  }

  function addMedia() {
    const address = window.prompt(t("mediaPrompt"), "https://");
    if (!address) {
      setRefused(null);
      return;
    }
    const media = mediaTagOf(address);
    setRefused(media ? null : "media");
    if (media) editor.update(() => $insertText(media));
  }

  return (
    <>
      <div
        role="toolbar"
        aria-label={t("aria.formatting")}
        className={cn(
          "relative flex items-center gap-0.5 overflow-x-auto border-b px-1.5 py-1 [scrollbar-width:none]",
          className,
        )}
      >
        {FORMATS.map(({ format, label, icon }) => (
          <ToolbarButton
            key={format}
            label={t(label)}
            icon={icon}
            active={state.formats.includes(format)}
            onClick={() => editor.dispatchCommand(FORMAT_TEXT_COMMAND, format)}
          />
        ))}
        <ToolbarButton
          label={t("removeFormattingLabel")}
          icon={Eraser}
          onClick={() => editor.update(() => $removeFormatting())}
        />
        <Divider />
        <ToolbarButton
          label={t("headingLabel")}
          icon={Heading}
          active={state.block === "heading"}
          onClick={() => setBlock("heading")}
        />
        <ToolbarButton
          label={t("bulletListLabel")}
          icon={List}
          active={state.block === "bullet"}
          onClick={() => toggleList("bullet")}
        />
        <ToolbarButton
          label={t("numberedListLabel")}
          icon={ListOrdered}
          active={state.block === "number"}
          onClick={() => toggleList("number")}
        />
        <ToolbarButton
          label={t("quoteLabel")}
          icon={TextQuote}
          active={state.block === "quote"}
          onClick={() => setBlock("quote")}
        />
        <ToolbarButton
          label={t("linkLabel")}
          icon={Link2}
          active={state.link}
          onClick={toggleLink}
        />
        <ToolbarButton
          label={t("spoilerLabel")}
          icon={EyeOff}
          onClick={() =>
            editor.update(() => $wrapSelection("[SPOILER]", "[/SPOILER]"))
          }
        />
        <ToolbarButton
          label={t("codeBlockLabel")}
          icon={SquareCode}
          active={state.block === "code"}
          // Turning a list item or a quote into a code block would pull it out of its list or quote
          // and leave the rest broken, so the button waits until the caret is somewhere else.
          disabled={["bullet", "number", "quote"].includes(state.block)}
          onClick={() => setBlock("code")}
        />
        <ToolbarButton
          label={t("mediaLabel")}
          icon={Clapperboard}
          onClick={addMedia}
        />
        <span className="ml-auto flex items-center gap-0.5 pl-2">
          <ToolbarButton
            label={t("sourceLabel")}
            icon={Brackets}
            active={source?.active}
            always
            onClick={() => source?.toggle()}
          />
          <ToolbarButton
            label={t("undoLabel")}
            icon={Undo2}
            disabled={!canUndo}
            onClick={() => editor.dispatchCommand(UNDO_COMMAND, undefined)}
          />
          <ToolbarButton
            label={t("redoLabel")}
            icon={Redo2}
            disabled={!canRedo}
            onClick={() => editor.dispatchCommand(REDO_COMMAND, undefined)}
          />
        </span>
      </div>
      {refused && (
        <FormError className="px-3 py-1.5">
          {t(refused === "media" ? "mediaUnsupported" : "linkUnsupported")}
        </FormError>
      )}
    </>
  );
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
  setInvalid,
  source,
  editorRef,
}: Pick<
  EditorProps,
  "name" | "resetKey" | "required" | "defaultValue" | "onInsertReady"
> & {
  value: string;
  commit: (text: string) => void;
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
      commit(next === written.current ? (original.current ?? next) : next);
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
  useEffect(
    () =>
      onComposerRequest(inputRef.current?.form, (request) => {
        const box = shown.current.active ? shown.current.field.current : null;
        if (box) {
          if ("insert" in request) insertAtCaret(box, request.insert);
          else box.value = withoutAttachTag(box.value, request.remove);
          commit(box.value);
        } else if ("insert" in request) {
          editor.update(() => $insertText(request.insert));
          editor.focus();
        } else {
          editor.update(() => $removeAttachTags(request.remove));
        }
      }),
    [editor, commit],
  );

  // Says that requests are now taken here, for a composer that queued some on the way.
  useEffect(() => onInsertReady?.(), [onInsertReady]);

  const clear = useCallback(() => {
    setInvalid(false);
    // What is written after a clear is not the text the editor opened with.
    original.current = undefined;
    editor.dispatchCommand(CLEAR_EDITOR_COMMAND, undefined);
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
  // Where the formatting bar is drawn instead, for a composer that has a bar of its own.
  toolbarContainer?: HTMLElement | null;
  // Takes the focus once it is on the page, with the caret after what it holds.
  autoFocus?: boolean;
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
  toolbarContainer,
  autoFocus,
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
  const errorId = useId();
  const describedByIds =
    [describedBy, invalid ? errorId : undefined].filter(Boolean).join(" ") ||
    undefined;
  const padding = compact ? "px-3 py-2" : "px-4 py-3";
  const [initialConfig] = useState<InitialConfigType>(() => {
    const editorState = defaultValue && initialEditorState(defaultValue);
    return editorState ? { ...CONFIG, editorState } : CONFIG;
  });

  // The BB code as it is sent, and the field that shows it as text.
  const [value, setValue] = useState(defaultValue ?? "");
  const [sourceShown, setSourceShown] = useState(false);
  const valueRef = useRef(value);
  valueRef.current = value;
  const sourceRef = useRef(false);
  const field = useRef<HTMLTextAreaElement>(null);
  const editorRef = useRef<LexicalEditor>(null);
  const changed = useRef(onChange);
  changed.current = onChange;
  const lastValue = useRef<string>(undefined);
  const commit = useCallback((text: string) => {
    if (text === lastValue.current) return;
    lastValue.current = text;
    setValue(text);
    changed.current?.(text);
  }, []);
  // Between the rich text and the source, in both directions without losing a character: the
  // source is what the rich text is written as, and the rich text is read from the source.
  const toggle = useCallback(() => {
    const editor = editorRef.current;
    if (!editor) return;
    if (sourceRef.current) {
      sourceRef.current = false;
      editor.update(
        () => {
          $replaceWithBb(valueRef.current);
          $getRoot().selectEnd();
        },
        { discrete: true },
      );
      setSourceShown(false);
    } else {
      sourceRef.current = true;
      setSourceShown(true);
    }
  }, []);
  const sourceMode = useMemo<SourceMode>(
    () => ({ active: sourceShown, field, commit, toggle }),
    [sourceShown, commit, toggle],
  );
  // The field takes the focus when it appears, and the rich text when it comes back.
  const started = useRef(false);
  useEffect(() => {
    if (!started.current) {
      started.current = true;
      return;
    }
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
        <ContentSafetyPlugin />
        <div
          className={cn(
            "min-w-0 rounded-lg border bg-card transition-colors focus-within:border-ring",
            className,
          )}
        >
          {toolbar && <Toolbar />}
          {toolbarContainer &&
            createPortal(
              <Toolbar className="border-b-0 p-0" />,
              toolbarContainer,
            )}
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
                        "pointer-events-none absolute inset-0 truncate text-base leading-relaxed text-muted-foreground md:text-sm",
                        padding,
                      )}
                    >
                      {placeholder}
                    </div>
                  }
                  className={cn(
                    prose.root,
                    "text-base outline-none md:text-sm",
                    padding,
                  )}
                  style={{ minHeight: minHeight ?? (compact ? 40 : 120) }}
                />
              }
              ErrorBoundary={LexicalErrorBoundary}
            />
            {findMembers && <MentionPlugin find={findMembers} />}
          </div>
          {sourceShown && (
            <textarea
              ref={field}
              id={id}
              value={value}
              onChange={(event) => commit(event.target.value)}
              aria-label={fieldLabel}
              aria-labelledby={labelledBy}
              aria-required={required}
              aria-invalid={invalid || ariaInvalid || undefined}
              aria-describedby={describedByIds}
              spellCheck={false}
              autoCapitalize="off"
              className={cn(
                "block field-sizing-content w-full resize-none bg-transparent font-mono text-base leading-relaxed outline-none md:text-sm",
                padding,
              )}
              style={{ minHeight: minHeight ?? (compact ? 40 : 120) }}
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
            setInvalid={setInvalid}
            source={sourceMode}
            editorRef={editorRef}
          />
        </div>
        {invalid && <FormError id={errorId}>{t("errors.required")}</FormError>}
        <HistoryPlugin />
        <RemoveFormattingShortcut />
        <ListPlugin />
        <LinkPlugin />
        <ClearEditorPlugin />
        {autoFocus && <AutoFocusPlugin />}
        {insertEvent && <InsertPlugin event={insertEvent} />}
      </LexicalComposer>
    </SourceContext.Provider>
  );
}
