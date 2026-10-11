"use client";

import { CodeHighlightNode, CodeNode } from "@lexical/code";
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
import { $convertToMarkdownString, TRANSFORMERS } from "@lexical/markdown";
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
  $getSelection,
  $isRangeSelection,
  CAN_REDO_COMMAND,
  CAN_UNDO_COMMAND,
  CLEAR_EDITOR_COMMAND,
  COMMAND_PRIORITY_LOW,
  FORMAT_TEXT_COMMAND,
  mergeRegister,
  REDO_COMMAND,
  type TextFormatType,
  UNDO_COMMAND,
} from "lexical";
import {
  Bold,
  Code,
  Heading,
  Italic,
  Link2,
  List,
  ListOrdered,
  type LucideIcon,
  Redo2,
  Strikethrough,
  TextQuote,
  Undo2,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { prose } from "@/components/forum/prose";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const CONFIG: InitialConfigType = {
  namespace: "forum-editor",
  nodes: [
    HeadingNode,
    QuoteNode,
    ListNode,
    ListItemNode,
    LinkNode,
    AutoLinkNode,
    CodeNode,
    CodeHighlightNode,
  ],
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

type Block = "paragraph" | "heading" | "quote" | "bullet" | "number";

type ToolbarState = {
  formats: TextFormatType[];
  block: Block;
  link: boolean;
};

const FORMATS: { format: TextFormatType; label: string; icon: LucideIcon }[] = [
  { format: "bold", label: "Bold", icon: Bold },
  { format: "italic", label: "Italic", icon: Italic },
  { format: "strikethrough", label: "Strikethrough", icon: Strikethrough },
  { format: "code", label: "Inline code", icon: Code },
];

function $readToolbarState(): ToolbarState | null {
  const selection = $getSelection();
  if (!$isRangeSelection(selection)) return null;
  const anchor = selection.anchor.getNode();
  const top = anchor.getTopLevelElement();
  let block: Block = "paragraph";
  if ($isHeadingNode(top)) block = "heading";
  else if ($isQuoteNode(top)) block = "quote";
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

function Toolbar() {
  const [editor] = useLexicalComposerContext();
  const [state, setState] = useState<ToolbarState>({
    formats: [],
    block: "paragraph",
    link: false,
  });
  const [canUndo, setCanUndo] = useState(false);
  const [canRedo, setCanRedo] = useState(false);

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

  function setBlock(block: "heading" | "quote") {
    editor.update(() => {
      const selection = $getSelection();
      if (state.block === block) {
        $setBlocksType(selection, () => $createParagraphNode());
      } else if (block === "heading") {
        $setBlocksType(selection, () => $createHeadingNode("h2"));
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
    const url = window.prompt("Link URL", "https://");
    if (url) editor.dispatchCommand(TOGGLE_LINK_COMMAND, url);
  }

  return (
    <div
      role="toolbar"
      aria-label="Formatting"
      className="flex items-center gap-0.5 overflow-x-auto border-b px-1.5 py-1 [scrollbar-width:none]"
    >
      {FORMATS.map(({ format, label, icon }) => (
        <ToolbarButton
          key={format}
          label={label}
          icon={icon}
          active={state.formats.includes(format)}
          onClick={() => editor.dispatchCommand(FORMAT_TEXT_COMMAND, format)}
        />
      ))}
      <Divider />
      <ToolbarButton
        label="Heading"
        icon={Heading}
        active={state.block === "heading"}
        onClick={() => setBlock("heading")}
      />
      <ToolbarButton
        label="Bullet list"
        icon={List}
        active={state.block === "bullet"}
        onClick={() => toggleList("bullet")}
      />
      <ToolbarButton
        label="Numbered list"
        icon={ListOrdered}
        active={state.block === "number"}
        onClick={() => toggleList("number")}
      />
      <ToolbarButton
        label="Quote"
        icon={TextQuote}
        active={state.block === "quote"}
        onClick={() => setBlock("quote")}
      />
      <ToolbarButton
        label="Link"
        icon={Link2}
        active={state.link}
        onClick={toggleLink}
      />
      <span className="ml-auto flex items-center gap-0.5 pl-2">
        <ToolbarButton
          label="Undo"
          icon={Undo2}
          disabled={!canUndo}
          onClick={() => editor.dispatchCommand(UNDO_COMMAND, undefined)}
        />
        <ToolbarButton
          label="Redo"
          icon={Redo2}
          disabled={!canRedo}
          onClick={() => editor.dispatchCommand(REDO_COMMAND, undefined)}
        />
      </span>
    </div>
  );
}

function FormField({
  name,
  resetKey,
  onChange,
}: Pick<EditorProps, "name" | "resetKey" | "onChange">) {
  const [editor] = useLexicalComposerContext();
  const [markdown, setMarkdown] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const lastValue = useRef("");
  const lastResetKey = useRef(resetKey);

  useEffect(
    () =>
      editor.registerUpdateListener(({ editorState }) => {
        const next = editorState.read(() =>
          $convertToMarkdownString(TRANSFORMERS),
        );
        if (next === lastValue.current) return;
        lastValue.current = next;
        setMarkdown(next);
        onChange?.(next);
      }),
    [editor, onChange],
  );

  useEffect(() => {
    const form = inputRef.current?.form;
    if (!form) return;
    const clear = () => editor.dispatchCommand(CLEAR_EDITOR_COMMAND, undefined);
    form.addEventListener("reset", clear);
    return () => form.removeEventListener("reset", clear);
  }, [editor]);

  useEffect(() => {
    if (resetKey === lastResetKey.current) return;
    lastResetKey.current = resetKey;
    editor.dispatchCommand(CLEAR_EDITOR_COMMAND, undefined);
  }, [editor, resetKey]);

  return <input ref={inputRef} type="hidden" name={name} value={markdown} />;
}

export type EditorProps = {
  name?: string;
  placeholder?: string;
  minHeight?: number;
  compact?: boolean;
  onChange?: (markdown: string) => void;
  resetKey?: string | number;
  className?: string;
};

export function Editor({
  name,
  placeholder = "Type your message here.",
  minHeight,
  compact = false,
  onChange,
  resetKey,
  className,
}: EditorProps) {
  const padding = compact ? "px-3 py-2" : "px-4 py-3";
  return (
    <LexicalComposer initialConfig={CONFIG}>
      <div
        className={cn(
          "min-w-0 rounded-lg border bg-card transition-colors focus-within:border-ring",
          className,
        )}
      >
        {!compact && <Toolbar />}
        <div className="relative">
          <RichTextPlugin
            contentEditable={
              <ContentEditable
                aria-label={placeholder}
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
        </div>
      </div>
      <HistoryPlugin />
      <ListPlugin />
      <LinkPlugin />
      <MarkdownShortcutPlugin transformers={TRANSFORMERS} />
      <ClearEditorPlugin />
      <FormField name={name} resetKey={resetKey} onChange={onChange} />
    </LexicalComposer>
  );
}
