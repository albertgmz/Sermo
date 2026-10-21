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
import {
  useCallback,
  useContext,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { linkAddressOf } from "@/components/forum/bb-scan";
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
  entryOf,
  fromKeyboard,
  imageTag,
  moveTo,
  placeStop,
  registerStripEscape,
} from "@/components/forum/editor-toolbar-keys";
import {
  activeMore,
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

// XenForo's sizes: 30 x 32 px buttons, the same on a phone and on a desktop, and a "⋮" of 24 px
// (WCAG's least target; XenForo's is 22). Eight buttons in three boxes fit the 270 px comment
// column of a 360 px phone. A command that is on has the accent's tint, its ink and a ring of it,
// so it is told from a hovered button by more than a colour. The focus is an outline, which no
// other state sets, so a focused command that is on still shows where the focus is.
const TOOL =
  "my-0.5 inline-flex h-8 shrink-0 items-center justify-center rounded-sm text-muted-foreground outline-none transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring focus-visible:outline-solid aria-pressed:bg-primary/10 aria-pressed:text-primary-ink aria-pressed:ring-1 aria-pressed:ring-inset aria-pressed:ring-primary-ink aria-disabled:opacity-40 aria-disabled:hover:bg-transparent [&_svg]:size-4 [&_svg]:shrink-0";
const BUTTON = `${TOOL} mx-px w-[30px]`;

// Drawn by the bar's size, which a container query decides: a hidden one has no box.
const inView = (element: Element) => element.getClientRects().length > 0;

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
  const unavailable = useUnavailable()(command);
  const { label, icon: Icon, active, run } = command;
  return (
    // An unavailable button stays focusable (`aria-disabled`), so the arrow keys do not skip it.
    <button
      type="button"
      tabIndex={-1}
      aria-label={label}
      title={label}
      aria-pressed={active}
      aria-disabled={unavailable || undefined}
      onMouseDown={(event) => event.preventDefault()}
      onClick={() => {
        if (!unavailable) run();
      }}
      className={cn(BUTTON, className)}
    >
      <Icon aria-hidden="true" />
    </button>
  );
}

export function Toolbar() {
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
  const strips = useRef<Partial<Record<GroupId, HTMLFieldSetElement | null>>>(
    {},
  );
  const triggers = useRef<Partial<Record<GroupId, HTMLButtonElement | null>>>(
    {},
  );
  // A strip opened from the keyboard takes the focus on its first button.
  const [enterStrip, setEnterStrip] = useState(false);
  const bar = useRef<HTMLDivElement>(null);
  // The button last used, which stays the bar's stop of the Tab order while it is in view.
  const last = useRef<HTMLButtonElement | null>(null);
  const openNow = useRef(open);
  openNow.current = open;
  const controls = useCallback(
    () => [
      ...(bar.current?.querySelectorAll<HTMLButtonElement>("button") ?? []),
    ],
    [],
  );
  // One button of the bar, in view, is in the Tab order: put again after every render (a strip
  // opened or closed) and whenever the bar's size changes what it shows, so the stop is never a
  // button that went out of view, whatever had the focus then.
  const placeTabStop = useCallback(
    () => placeStop(controls(), last.current, inView),
    [controls],
  );
  useLayoutEffect(() => {
    placeTabStop();
  });
  useEffect(() => {
    const element = bar.current;
    if (!element || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(placeTabStop);
    observer.observe(element);
    return () => observer.disconnect();
  }, [placeTabStop]);

  useEffect(() => {
    if (!bar.current) return;
    return registerStripEscape(
      bar.current,
      () => openNow.current,
      (group) => {
        setOpen(null);
        triggers.current[group]?.focus();
      },
    );
  }, []);

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
    entryOf(
      [...(strips.current[open]?.querySelectorAll("button") ?? [])],
      null,
      inView,
    )?.focus();
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
    const tag = imageTag(ask(t("imagePrompt")));
    if (!tag) return;
    setRefused(tag === "refused" ? "image" : null);
    if (tag !== "refused") editor.update(() => $insertText(tag));
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
        {/* One stop of the Tab order: the button last used, or the first in view, and the
            arrow keys move along the buttons in view (`editor-toolbar-keys.ts`). A press on
            the bar keeps the focus in the text. */}
        <div
          ref={bar}
          role="toolbar"
          aria-label={t("aria.formatting")}
          aria-orientation="horizontal"
          onMouseDown={(event) => event.preventDefault()}
          onFocus={(event) => {
            if (event.target instanceof HTMLButtonElement) {
              last.current = event.target;
              placeTabStop();
            }
          }}
          onKeyDown={(event) => {
            const shown = controls().filter(inView);
            const next = moveTo(
              event.key,
              shown.indexOf(event.target as HTMLButtonElement),
              shown.length,
            );
            if (next === null) return;
            event.preventDefault();
            shown[next]?.focus();
          }}
          className="flex flex-wrap items-center gap-1 rounded-t-[inherit] border-b bg-muted p-1 outline-none"
        >
          {GROUPS.map((group) => {
            const more = group.more.map((slot) => commands[slot.id]);
            const expanded = open === group.id;
            // Unavailable while nothing in its strip works (the BB code source shows), except to
            // close a strip that was open.
            const disabled = more.every(unavailable) && !expanded;
            const name = t("moreOptionsOf", {
              group: t(`groups.${group.id}`),
            });
            return (
              <fieldset
                key={group.id}
                data-group={group.id}
                aria-label={t(`groups.${group.id}`)}
                className={cn(
                  "flex min-w-0 items-center rounded-lg border bg-card px-0.5 transition-colors group-focus-within/editor:border-dashed group-focus-within/editor:border-ring/60",
                  // The misc group keeps to the right and takes what is left of the line.
                  group.id === "misc" && "flex-1 justify-end",
                  SHOWN[group.shown],
                )}
              >
                {group.direct.map(draw)}
                <button
                  type="button"
                  tabIndex={-1}
                  ref={(element) => {
                    triggers.current[group.id] = element;
                  }}
                  aria-label={name}
                  title={name}
                  aria-expanded={expanded}
                  aria-controls={`${stripId}-${group.id}`}
                  aria-disabled={disabled || undefined}
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={(event) => {
                    if (disabled) return;
                    setOpen((current) => toggleStrip(current, group.id));
                    setEnterStrip(!expanded && fromKeyboard(event));
                  }}
                  className={cn(
                    TOOL,
                    "w-6 opacity-50 aria-expanded:opacity-100",
                    SHOWN[group.moreShown],
                    // Its strip holds a command that is on where the caret is, at this width.
                    activeMore(
                      group.more,
                      (id) => commands[id].active === true,
                    ),
                  )}
                >
                  <EllipsisVertical aria-hidden="true" />
                </button>
              </fieldset>
            );
          })}
          {GROUPS.map((group) => (
            <fieldset
              key={group.id}
              ref={(element) => {
                strips.current[group.id] = element;
              }}
              id={`${stripId}-${group.id}`}
              data-strip={group.id}
              aria-label={t("moreOptionsOf", {
                group: t(`groups.${group.id}`),
              })}
              className={cn(
                "min-w-0 basis-full flex-wrap items-center px-0.5",
                // Only where its ⋮ is: a strip left open when the bar grows past the sizes that
                // hide anything of its group is not drawn there.
                open === group.id
                  ? cn("flex", SHOWN[group.moreShown])
                  : "hidden",
              )}
            >
              {group.more.map(draw)}
            </fieldset>
          ))}
        </div>
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
