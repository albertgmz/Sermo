"use client";

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
  ChevronDown,
  Clapperboard,
  Code,
  Ellipsis,
  Eraser,
  EyeOff,
  Heading,
  Italic,
  Link2,
  List,
  ListOrdered,
  type LucideIcon,
  Pilcrow,
  Plus,
  Redo2,
  SquareCode,
  Strikethrough,
  TextQuote,
  Type,
  Underline,
  Undo2,
} from "lucide-react";
import { useTranslations } from "next-intl";
import { useContext, useEffect, useState } from "react";
import { linkAddressOf } from "@/components/forum/bb-scan";
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
  END,
  type MenuId,
  SHOWN,
  type Slot,
  START,
} from "@/components/forum/editor-toolbar-layout";
import { FormError } from "@/components/forum/form-error";
import { mediaTagOf } from "@/components/forum/media-url";
import { Button, buttonVariants } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
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

const MENU_ICONS: Record<MenuId, LucideIcon> = {
  text: Type,
  paragraph: Pilcrow,
  insert: Plus,
  more: Ellipsis,
};

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

// One thing the bar does, drawn as a button or as an item of a menu.
type Command = {
  label: string;
  icon: LucideIcon;
  // Set for a command that is on or off where the caret is.
  active?: boolean;
  disabled?: boolean;
  // Stays usable while the BB code source is shown (the command that switches to and from it).
  always?: boolean;
  // Puts the focus where it belongs itself (the BB code source: in its field, or back in the
  // editor).
  focuses?: boolean;
  run: () => void;
};

function useUnavailable() {
  const source = useContext(SourceContext)?.active;
  return (command: Command) =>
    Boolean(command.disabled || (source && !command.always));
}

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
    <Button
      type="button"
      variant="ghost"
      size="icon"
      aria-label={label}
      title={label}
      aria-pressed={active}
      disabled={unavailable(command)}
      onMouseDown={(event) => event.preventDefault()}
      onClick={run}
      className={cn(
        "size-10 text-muted-foreground aria-pressed:bg-muted aria-pressed:text-foreground md:size-8",
        className,
      )}
    >
      <Icon />
    </Button>
  );
}

// A group of commands behind one button, for a bar too narrow to show them all. A chosen command
// leaves the focus where it puts it: in the editor, with its selection (Lexical moves the focus
// there whenever a command changes the selection), or in the BB code field. Base UI respects that;
// only Escape and a press elsewhere give the focus back to this button.
function ToolbarMenu({
  id,
  label,
  items,
  className,
}: {
  id: MenuId;
  label: string;
  items: Command[];
  className?: string;
}) {
  const [editor] = useLexicalComposerContext();
  const unavailable = useUnavailable();
  const Icon = MENU_ICONS[id];
  // The focus goes to the editor inside the press, so that a phone raises its keyboard again.
  const choose = (item: Command) => {
    item.run();
    if (!item.focuses) editor.focus();
  };
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label={label}
        title={label}
        data-active={items.some((item) => item.active) || undefined}
        disabled={items.every(unavailable)}
        onMouseDown={(event) => event.preventDefault()}
        className={cn(
          buttonVariants({ variant: "ghost" }),
          "group size-10 gap-0 px-0 text-muted-foreground data-active:bg-muted data-active:text-foreground md:size-8",
          className,
        )}
      >
        <Icon />
        {id !== "more" && (
          <ChevronDown className="-mr-1 size-3 transition-transform group-data-popup-open:rotate-180" />
        )}
      </DropdownMenuTrigger>
      <DropdownMenuContent className="w-auto min-w-44">
        {items.map((item) => {
          const ItemIcon = item.icon;
          const shared = {
            disabled: unavailable(item),
            onClick: () => choose(item),
            className: "min-h-10 gap-2 md:min-h-8",
          };
          return item.active === undefined ? (
            <DropdownMenuItem key={item.label} {...shared}>
              <ItemIcon />
              {item.label}
            </DropdownMenuItem>
          ) : (
            <DropdownMenuCheckboxItem
              key={item.label}
              checked={item.active}
              closeOnClick
              {...shared}
            >
              <ItemIcon />
              {item.label}
            </DropdownMenuCheckboxItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function Divider({ className }: { className?: string }) {
  return <span className={cn("mx-1 h-5 w-px shrink-0 bg-border", className)} />;
}

export function Toolbar({ className }: { className?: string }) {
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
      focuses: true,
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

  const draw = (slot: Slot, index: number) => {
    const shown = SHOWN[slot.shown];
    if (slot.kind === "divider") {
      return <Divider key={`divider-${index}`} className={shown} />;
    }
    if (slot.kind === "command") {
      return (
        <ToolbarButton
          key={slot.id}
          command={commands[slot.id]}
          className={shown}
        />
      );
    }
    return (
      <ToolbarMenu
        key={`${slot.id}-${slot.shown}`}
        id={slot.id}
        label={t(`menus.${slot.id}`)}
        items={slot.items.map((id) => commands[id])}
        className={shown}
      />
    );
  };

  return (
    <>
      {/* The bar picks its size from its own width (see `editor-toolbar-layout.ts`). */}
      <div className="@container">
        <div
          role="toolbar"
          aria-label={t("aria.formatting")}
          className={cn(
            "flex flex-wrap items-center gap-0.5 border-b px-1.5 py-1",
            className,
          )}
        >
          {START.map(draw)}
          <span className="ml-auto flex items-center gap-0.5">
            {END.map(draw)}
          </span>
        </div>
      </div>
      {refused && (
        <FormError className="px-3 py-1.5">
          {t(refused === "media" ? "mediaUnsupported" : "linkUnsupported")}
        </FormError>
      )}
    </>
  );
}
