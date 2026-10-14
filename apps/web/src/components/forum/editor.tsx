"use client";

import {
  $createCodeNode,
  $isCodeNode,
  CodeHighlightNode,
  CodeNode,
} from "@lexical/code";
import {
  $isLinkNode,
  AutoLinkNode,
  LinkNode,
  TOGGLE_LINK_COMMAND,
} from "@lexical/link";
import {
  $isListNode,
  INSERT_ORDERED_LIST_COMMAND,
  INSERT_UNORDERED_LIST_COMMAND,
  ListItemNode,
  ListNode,
  REMOVE_LIST_COMMAND,
} from "@lexical/list";
import {
  $convertFromMarkdownString,
  $convertToMarkdownString,
  TRANSFORMERS,
} from "@lexical/markdown";
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
import { MarkdownShortcutPlugin } from "@lexical/react/LexicalMarkdownShortcutPlugin";
import { RichTextPlugin } from "@lexical/react/LexicalRichTextPlugin";
import {
  $createHeadingNode,
  $createQuoteNode,
  $isHeadingNode,
  $isQuoteNode,
  HeadingNode,
  QuoteNode,
} from "@lexical/rich-text";
import { $setBlocksType } from "@lexical/selection";
import {
  $createParagraphNode,
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
  type EditorState,
  type ElementNode,
  FORMAT_TEXT_COMMAND,
  type LexicalEditor,
  mergeRegister,
  PASTE_COMMAND,
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
  Clapperboard,
  Code,
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
  Undo2,
} from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { onComposerRequest } from "@/components/forum/composer-insert";
import {
  $applyLink,
  $insertText,
  $removeAttachTags,
  $wrapSelection,
} from "@/components/forum/editor-commands";
import {
  InsertPlugin,
  type MemberHit,
  MentionPlugin,
} from "@/components/forum/editor-extras";
import { FormError } from "@/components/forum/form-error";
import { mediaTagOf } from "@/components/forum/media-url";
import { unescapeMentions } from "@/components/forum/mention-text";
import { prose } from "@/components/forum/prose";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const NODES = [
  HeadingNode,
  QuoteNode,
  ListNode,
  ListItemNode,
  LinkNode,
  AutoLinkNode,
  CodeNode,
  CodeHighlightNode,
];

const CONFIG: InitialConfigType = {
  namespace: "forum-editor",
  nodes: NODES,
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
      strikethrough: prose.del,
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
    ...[RootNode, ParagraphNode, TextNode, TabNode, ...NODES].map((node) =>
      editor.registerNodeTransform<TextNode | ElementNode>(node, (node) => {
        if (node.getStyle()) node.setStyle("");
        // Empty blocks can carry styles into later typing and list markers.
        if ($isElementNode(node) && node.getTextStyle()) node.setTextStyle("");
      }),
    ),
  );
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
            // Keep Lexical's JSON/HTML/text import and paste history boundary.
            // The registered importers create no media nodes or resource attrs;
            // pasted DOM stays inert, and transforms strip imported CSS.
            return !data || data.files.length > 0;
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
function initialEditorState(markdown: string): string | undefined {
  const scratch = createEditor({ nodes: CONFIG.nodes });
  const unregister = registerStyleTransforms(scratch);
  scratch.update(() => $convertFromMarkdownString(markdown, TRANSFORMERS), {
    discrete: true,
  });
  const state = scratch.getEditorState();
  unregister();
  return state.isEmpty() ? undefined : JSON.stringify(state);
}

type Block = "paragraph" | "heading" | "quote" | "code" | "bullet" | "number";

type ToolbarState = {
  formats: TextFormatType[];
  block: Block;
  link: boolean;
};

const FORMATS = [
  { format: "bold", label: "boldLabel", icon: Bold },
  { format: "italic", label: "italicLabel", icon: Italic },
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
  let block: Block = "paragraph";
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
  ...props
}: React.ComponentProps<typeof Button> & {
  label: string;
  icon: LucideIcon;
  active?: boolean;
}) {
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      aria-label={label}
      title={label}
      aria-pressed={active}
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
  const [state, setState] = useState<ToolbarState>({
    formats: [],
    block: "paragraph",
    link: false,
  });
  const [canUndo, setCanUndo] = useState(false);
  const [canRedo, setCanRedo] = useState(false);
  const [mediaRefused, setMediaRefused] = useState(false);

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
    editor.update(() => {
      const selection = $getSelection();
      if (state.block === block) {
        $setBlocksType(selection, () => $createParagraphNode());
      } else if (block === "heading") {
        $setBlocksType(selection, () => $createHeadingNode("h2"));
      } else if (block === "code") {
        $setBlocksType(selection, () => $createCodeNode());
      } else {
        $setBlocksType(selection, () => $createQuoteNode());
      }
    });
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
    const url = window.prompt(t("linkPrompt"), "https://");
    if (url) editor.update(() => $applyLink(url));
  }

  function addMedia() {
    const address = window.prompt(t("mediaPrompt"), "https://");
    if (!address) {
      setMediaRefused(false);
      return;
    }
    const media = mediaTagOf(address);
    setMediaRefused(!media);
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
      {mediaRefused && (
        <FormError className="px-3 py-1.5">{t("mediaUnsupported")}</FormError>
      )}
    </>
  );
}

function FormField({
  name,
  resetKey,
  onChange,
  required,
  defaultValue,
  onInsertReady,
  setInvalid,
}: Pick<
  EditorProps,
  | "name"
  | "resetKey"
  | "onChange"
  | "required"
  | "defaultValue"
  | "onInsertReady"
> & {
  setInvalid: (invalid: boolean) => void;
}) {
  const [editor] = useLexicalComposerContext();
  const [markdown, setMarkdown] = useState(defaultValue ?? "");
  const inputRef = useRef<HTMLInputElement>(null);
  const validationRef = useRef<HTMLInputElement>(null);
  const lastValue = useRef("");
  const lastResetKey = useRef(resetKey);

  useEffect(() => {
    const sync = (editorState: EditorState) => {
      if (validationRef.current) {
        const hasText = editorState.read(() =>
          Boolean($getRoot().getTextContent().trim()),
        );
        validationRef.current.value = hasText ? "filled" : "";
        if (hasText) setInvalid(false);
      }
      const next = unescapeMentions(
        editorState.read(() => $convertToMarkdownString(TRANSFORMERS)),
      );
      if (next === lastValue.current) return;
      lastValue.current = next;
      setMarkdown(next);
      onChange?.(next);
    };
    // The initial state is set before this listener exists, so read it once.
    sync(editor.getEditorState());
    return editor.registerUpdateListener(({ editorState }) =>
      sync(editorState),
    );
  }, [editor, onChange, setInvalid]);

  // Text asked for from elsewhere in the composer (an attachment's tag) goes in at the caret.
  useEffect(
    () =>
      onComposerRequest(inputRef.current?.form, (request) => {
        if ("insert" in request) {
          editor.update(() => $insertText(request.insert));
          editor.focus();
        } else {
          editor.update(() => $removeAttachTags(request.remove));
        }
      }),
    [editor],
  );

  // Says that requests are now taken here, for a composer that queued some on the way.
  useEffect(() => onInsertReady?.(), [onInsertReady]);

  useEffect(() => {
    const form = inputRef.current?.form;
    if (!form) return;
    const clear = () => {
      setInvalid(false);
      editor.dispatchCommand(CLEAR_EDITOR_COMMAND, undefined);
    };
    form.addEventListener("reset", clear);
    return () => form.removeEventListener("reset", clear);
  }, [editor, setInvalid]);

  useEffect(() => {
    if (resetKey === lastResetKey.current) return;
    lastResetKey.current = resetKey;
    setInvalid(false);
    editor.dispatchCommand(CLEAR_EDITOR_COMMAND, undefined);
  }, [editor, resetKey, setInvalid]);

  return (
    <>
      <input ref={inputRef} type="hidden" name={name} value={markdown} />
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
              editor.focus();
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
  onChange?: (markdown: string) => void;
  resetKey?: string | number;
  className?: string;
  // Typing an "@" then offers the members this finds.
  findMembers?: (prefix: string) => Promise<MemberHit[]>;
  // The name of a window event whose detail is Markdown to add at the end of the editor.
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
  return (
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
        <div className="relative">
          <RichTextPlugin
            contentEditable={
              <ContentEditable
                id={id}
                aria-label={labelledBy ? undefined : placeholder}
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
        <FormField
          name={name}
          resetKey={resetKey}
          onChange={onChange}
          required={required}
          defaultValue={defaultValue}
          onInsertReady={onInsertReady}
          setInvalid={setInvalid}
        />
      </div>
      {invalid && <FormError id={errorId}>{t("errors.required")}</FormError>}
      <HistoryPlugin />
      <ListPlugin />
      <LinkPlugin />
      <MarkdownShortcutPlugin transformers={TRANSFORMERS} />
      <ClearEditorPlugin />
      {autoFocus && <AutoFocusPlugin />}
      {insertEvent && <InsertPlugin event={insertEvent} />}
    </LexicalComposer>
  );
}
