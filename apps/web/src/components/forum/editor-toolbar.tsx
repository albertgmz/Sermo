"use client";

import { Toolbar as Bar } from "@base-ui/react/toolbar";
import { $isCodeNode } from "@lexical/code";
import { $isLinkNode, TOGGLE_LINK_COMMAND } from "@lexical/link";
import {
  $isListNode,
  INSERT_ORDERED_LIST_COMMAND,
  INSERT_UNORDERED_LIST_COMMAND,
  REMOVE_LIST_COMMAND,
} from "@lexical/list";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import { $isHeadingNode, $isQuoteNode } from "@lexical/rich-text";
import {
  $getSelection,
  $isRangeSelection,
  CAN_REDO_COMMAND,
  CAN_UNDO_COMMAND,
  COMMAND_PRIORITY_LOW,
  FORMAT_TEXT_COMMAND,
  mergeRegister,
  REDO_COMMAND,
  type TextFormatType,
  UNDO_COMMAND,
} from "lexical";
import {
  Bold,
  Brackets,
  Clapperboard,
  Code,
  EllipsisVertical,
  Eraser,
  EyeOff,
  Heading,
  ImageIcon,
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
import { useContext, useEffect, useId, useRef, useState } from "react";
import { isWebAddress, linkAddressOf } from "@/components/forum/bb-scan";
import { pickImage } from "@/components/forum/composer-insert";
import {
  $applyLink,
  $insertText,
  $removeFormatting,
  $setBlock,
  $wrapSelection,
  type BlockKind,
} from "@/components/forum/editor-commands";
import { SourceContext } from "@/components/forum/editor-extras";
import {
  type CommandId,
  GROUPS,
  type GroupId,
  SHOWN,
  type Slot,
  toggleStrip,
} from "@/components/forum/editor-toolbar-layout";
import { FormError } from "@/components/forum/form-error";
import { mediaTagOf } from "@/components/forum/media-url";
import { cn } from "@/lib/utils";

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

// One thing the bar does, drawn as a button of a group or of its strip.
type Command = {
  label: string;
  icon: LucideIcon;
  // Set for a command that is on or off where the caret is.
  active?: boolean;
  disabled?: boolean;
  // Stays usable while the BB code source is shown (the command that switches to and from it).
  always?: boolean;
  run: () => void;
};

// XenForo's sizes: 30 x 32 px buttons and a 22 px "⋮", the same on a phone and on a desktop (eight
// buttons in three boxes fit the 326 px bar of a 360 px phone).
const TOOL =
  "my-0.5 inline-flex h-8 shrink-0 items-center justify-center rounded-sm text-muted-foreground outline-none transition-colors hover:bg-muted hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50 aria-pressed:bg-muted aria-pressed:text-foreground data-disabled:opacity-40 data-disabled:hover:bg-transparent [&_svg]:size-4 [&_svg]:shrink-0";
const BUTTON = `${TOOL} mx-px w-[30px]`;

function useUnavailable() {
  const source = useContext(SourceContext)?.active;
  return (command: Command) =>
    Boolean(command.disabled || (source && !command.always));
}

// A press keeps the focus where it is (`preventDefault`), in the editor with its selection, so a
// phone keeps its keyboard up; a command that moves the selection puts the focus back in the
// editor itself (Lexical does), and the BB code source puts it in its own field.
function ToolbarButton({
  command,
  className,
}: {
  command: Command;
  className?: string;
}) {
  const unavailable = useUnavailable();
  const { label, icon: Icon, active, run } = command;
  return (
    <Bar.Button
      aria-label={label}
      title={label}
      aria-pressed={active}
      disabled={unavailable(command)}
      onMouseDown={(event) => event.preventDefault()}
      onClick={run}
      className={cn(BUTTON, className)}
    >
      <Icon aria-hidden="true" />
    </Bar.Button>
  );
}

export function Toolbar({ className }: { className?: string }) {
  const t = useTranslations("editor.editor");
  const [editor] = useLexicalComposerContext();
  const source = useContext(SourceContext);
  const unavailable = useUnavailable();
  const [state, setState] = useState<ToolbarState>({
    formats: [],
    block: "paragraph",
    link: false,
  });
  const [canUndo, setCanUndo] = useState(false);
  const [canRedo, setCanRedo] = useState(false);
  // The button whose address was refused.
  const [refused, setRefused] = useState<"media" | "link" | "image" | null>(
    null,
  );
  // The group whose strip is open, one at a time, as in XenForo.
  const [open, setOpen] = useState<GroupId | null>(null);
  const stripId = useId();
  const strips = useRef<Partial<Record<GroupId, HTMLDivElement | null>>>({});
  const triggers = useRef<Partial<Record<GroupId, HTMLButtonElement | null>>>(
    {},
  );
  // A strip opened from the keyboard takes the focus on its first button.
  const [enterStrip, setEnterStrip] = useState(false);

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

  useEffect(() => {
    if (!enterStrip || !open) return;
    setEnterStrip(false);
    // The strip's first button the bar's size draws.
    [...(strips.current[open]?.querySelectorAll("button") ?? [])]
      .find((button) => button.offsetParent !== null)
      ?.focus();
  }, [enterStrip, open]);

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

  // Asks for an address; empty or cancelled asks nothing more.
  function ask(prompt: string) {
    const input = window.prompt(prompt, "https://");
    if (!input) setRefused(null);
    return input || null;
  }

  function toggleLink() {
    if (state.link) {
      editor.dispatchCommand(TOGGLE_LINK_COMMAND, null);
      return;
    }
    const input = ask(t("linkPrompt"));
    if (!input) return;
    const url = linkAddressOf(input);
    setRefused(url ? null : "link");
    if (url) editor.update(() => $applyLink(url));
  }

  function addMedia() {
    const address = ask(t("mediaPrompt"));
    if (!address) return;
    const media = mediaTagOf(address);
    setRefused(media ? null : "media");
    if (media) editor.update(() => $insertText(media));
  }

  // The composer's own picture picker, whose pictures go in at the caret once they are uploaded
  // (`[ATTACH=full]`); where the composer takes no files, a picture on the web by its address.
  function addImage() {
    if (pickImage(editor.getRootElement()?.closest("form"))) {
      setRefused(null);
      return;
    }
    const input = ask(t("imagePrompt"));
    if (!input) return;
    const url = linkAddressOf(input);
    const ok = url !== null && isWebAddress(url);
    setRefused(ok ? null : "image");
    if (ok) editor.update(() => $insertText(`[IMG]${url}[/IMG]`));
  }

  const [bold, italic, underline, strikethrough, code] = FORMATS.map(
    ({ format, label, icon }): Command => ({
      label: t(label),
      icon,
      active: state.formats.includes(format),
      run: () => editor.dispatchCommand(FORMAT_TEXT_COMMAND, format),
    }),
  );
  const commands: Record<CommandId, Command> = {
    bold,
    italic,
    underline,
    strikethrough,
    code,
    removeFormatting: {
      label: t("removeFormattingLabel"),
      icon: Eraser,
      run: () => editor.update(() => $removeFormatting()),
    },
    heading: {
      label: t("headingLabel"),
      icon: Heading,
      active: state.block === "heading",
      run: () => setBlock("heading"),
    },
    bullet: {
      label: t("bulletListLabel"),
      icon: List,
      active: state.block === "bullet",
      run: () => toggleList("bullet"),
    },
    number: {
      label: t("numberedListLabel"),
      icon: ListOrdered,
      active: state.block === "number",
      run: () => toggleList("number"),
    },
    quote: {
      label: t("quoteLabel"),
      icon: TextQuote,
      active: state.block === "quote",
      run: () => setBlock("quote"),
    },
    link: {
      label: t("linkLabel"),
      icon: Link2,
      active: state.link,
      run: toggleLink,
    },
    image: { label: t("imageLabel"), icon: ImageIcon, run: addImage },
    spoiler: {
      label: t("spoilerLabel"),
      icon: EyeOff,
      run: () => editor.update(() => $wrapSelection("[SPOILER]", "[/SPOILER]")),
    },
    codeBlock: {
      label: t("codeBlockLabel"),
      icon: SquareCode,
      active: state.block === "code",
      // Turning a list item or a quote into a code block would pull it out of its list or quote
      // and leave the rest broken, so the command waits until the caret is somewhere else.
      disabled: ["bullet", "number", "quote"].includes(state.block),
      run: () => setBlock("code"),
    },
    media: { label: t("mediaLabel"), icon: Clapperboard, run: addMedia },
    source: {
      label: t("sourceLabel"),
      icon: Brackets,
      active: source?.active ?? false,
      always: true,
      run: () => source?.toggle(),
    },
    undo: {
      label: t("undoLabel"),
      icon: Undo2,
      disabled: !canUndo,
      run: () => editor.dispatchCommand(UNDO_COMMAND, undefined),
    },
    redo: {
      label: t("redoLabel"),
      icon: Redo2,
      disabled: !canRedo,
      run: () => editor.dispatchCommand(REDO_COMMAND, undefined),
    },
  };

  const draw = (slot: Slot) => (
    <ToolbarButton
      key={`${slot.id}-${slot.shown}`}
      command={commands[slot.id]}
      className={SHOWN[slot.shown]}
    />
  );

  return (
    <>
      {/* The bar picks its size from its own width (see `editor-toolbar-layout.ts`). */}
      <div className="@container rounded-t-[inherit]">
        <Bar.Root
          aria-label={t("aria.formatting")}
          className={cn(
            "flex flex-wrap items-center gap-1 rounded-t-[inherit] border-b bg-muted p-1.5",
            className,
          )}
        >
          {GROUPS.map((group) => {
            const more = group.more.map((slot) => commands[slot.id]);
            const expanded = open === group.id;
            return (
              <Bar.Group
                key={group.id}
                data-group={group.id}
                aria-label={t(`groups.${group.id}`)}
                className={cn(
                  "flex items-center rounded-lg border bg-card px-1 transition-colors group-focus-within/editor:border-dashed group-focus-within/editor:border-ring/60",
                  // The misc group keeps to the right and takes what is left of the line.
                  group.id === "misc" && "flex-1 justify-end",
                  SHOWN[group.shown],
                )}
              >
                {group.direct.map(draw)}
                <Bar.Button
                  ref={(element) => {
                    triggers.current[group.id] = element;
                  }}
                  aria-label={t("moreOptions")}
                  title={t("moreOptions")}
                  aria-expanded={expanded}
                  aria-controls={`${stripId}-${group.id}`}
                  // Its strip holds a command that is on where the caret is.
                  data-active={
                    more.some((command) => command.active) || undefined
                  }
                  disabled={more.every(unavailable)}
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={(event) => {
                    setOpen((current) => toggleStrip(current, group.id));
                    // Enter or Space (a click with no pointer) goes on into the strip.
                    setEnterStrip(!expanded && event.detail === 0);
                  }}
                  className={cn(
                    TOOL,
                    "w-[22px] opacity-50 aria-expanded:opacity-100 data-active:opacity-100",
                    SHOWN[group.moreShown],
                  )}
                >
                  <EllipsisVertical aria-hidden="true" />
                </Bar.Button>
              </Bar.Group>
            );
          })}
          {GROUPS.map((group) => (
            <Bar.Group
              key={group.id}
              ref={(element: HTMLDivElement | null) => {
                strips.current[group.id] = element;
              }}
              id={`${stripId}-${group.id}`}
              data-strip={group.id}
              aria-label={t(`groups.${group.id}`)}
              onKeyDown={(event) => {
                if (event.key !== "Escape") return;
                event.stopPropagation();
                setOpen(null);
                triggers.current[group.id]?.focus();
              }}
              className={cn(
                "basis-full flex-wrap items-center px-1",
                open === group.id ? "flex" : "hidden",
              )}
            >
              {group.more.map(draw)}
            </Bar.Group>
          ))}
        </Bar.Root>
      </div>
      {refused && (
        <FormError className="px-3 py-1.5">
          {t(
            refused === "media"
              ? "mediaUnsupported"
              : refused === "image"
                ? "imageUnsupported"
                : "linkUnsupported",
          )}
        </FormError>
      )}
    </>
  );
}
