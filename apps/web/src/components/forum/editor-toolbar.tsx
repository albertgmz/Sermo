"use client";

import type { TextFormatType } from "lexical";
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
  Smile,
  SquareCode,
  Strikethrough,
  TextQuote,
  Underline,
  Undo2,
} from "lucide-react";
import { useTranslations } from "next-intl";
import {
  type ComponentType,
  createContext,
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
import type { BlockKind } from "@/components/forum/editor-commands";
import { SourceContext } from "@/components/forum/editor-source";
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
import { loader } from "@/components/forum/load-once";
import { mediaTagOf } from "@/components/forum/media-url";
import { cn } from "@/lib/utils";

// Where the caret is, as the bar shows it: the formats and the kind of block that are on there,
// whether it is in a link, and whether there is something to undo or redo.
export type ToolbarState = {
  formats: TextFormatType[];
  block: BlockKind;
  link: boolean;
  canUndo: boolean;
  canRedo: boolean;
};

const AT_REST: ToolbarState = {
  formats: [],
  block: "paragraph",
  link: false,
  canUndo: false,
  canRedo: false,
};

// What a press of the bar asks of the text. A block or a list that is on already is turned off; a
// null link takes the link off.
export type ToolbarAction =
  | { format: TextFormatType }
  | { block: "heading" | "quote" | "code" }
  | { list: "bullet" | "number" }
  | { link: string | null }
  | { insert: string }
  | { wrap: [open: string, close: string] }
  | { run: "removeFormatting" | "undo" | "redo" | "source" };

// What the bar acts on: the editor (`editor-target.ts`), or, until the editor is in, the plain box
// drawn in its place, which keeps the presses for it (`LazyEditor`). `ready` is false until then:
// what needs the editor itself (the emoji picker) waits for it.
export type ToolbarTarget = {
  ready: boolean;
  run: (action: ToolbarAction) => void;
  // Tells `show` what changed where the caret is, until the function it answers is called.
  watch: (show: (state: Partial<ToolbarState>) => void) => () => void;
  // The form of the text, where the composer's picture picker is.
  form: () => HTMLFormElement | null;
};

type PickerMode = "pointer" | "keyboard";

// How a bar leaves things for the bar that takes its place when the editor comes in: the strip
// that is open, the emoji picker, and the control that had the focus (its `data-control`).
export type ToolbarMemory = {
  strip: GroupId | null;
  picker: PickerMode | null;
  focus: string | null;
};

const NO_TARGET: ToolbarTarget = {
  ready: false,
  run: () => {},
  watch: () => () => {},
  form: () => null,
};

export const ToolbarContext = createContext<{
  target: ToolbarTarget;
  memory?: ToolbarMemory;
}>({ target: NO_TARGET });

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

// The formats a button turns on and off, in the bar's order.
export const TEXT_FORMATS: TextFormatType[] = FORMATS.map((f) => f.format);

// One thing the bar does, drawn as a button of a group or of its strip.
type Command = {
  label: string;
  icon: LucideIcon;
  // Set for a command that is on or off where the caret is.
  active?: boolean;
  disabled?: boolean;
  // Stays usable while the BB code source is shown (the command that switches to and from it).
  always?: boolean;
  // `detail` is 0 for a press from the keyboard (`fromKeyboard`).
  run: (press: { detail: number }) => void;
};

type PickerProps = { focusSearch: boolean; onClose: () => void };

// XenForo's sizes: 30 x 32 px buttons, 4 px round, the same on a phone and on a desktop, and a "⋮"
// of 24 px (WCAG's least target; XenForo's is 22 between 1 px margins). Under the pointer a button
// takes XenForo's fill, the border colour, and the text's colour. The narrowest set fits the 270 px
// comment column of a 360 px phone. A command that is on has the accent's tint, its ink and a ring
// of it, so it is told from a hovered button by more than a colour. The focus is an outline, which no
// other state sets, so a focused command that is on still shows where the focus is.
const TOOL =
  "my-0.5 inline-flex h-8 shrink-0 items-center justify-center rounded-[4px] text-muted-foreground outline-none transition-colors hover:bg-border hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring focus-visible:outline-solid aria-pressed:bg-primary/10 aria-pressed:text-primary-ink aria-pressed:ring-1 aria-pressed:ring-inset aria-pressed:ring-primary-ink aria-disabled:opacity-40 aria-disabled:hover:bg-transparent [&_svg]:size-4 [&_svg]:shrink-0";
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
  control,
  command,
  className,
}: {
  // Which command it is (`ToolbarMemory.focus`).
  control: CommandId;
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
      data-control={control}
      onMouseDown={(event) => event.preventDefault()}
      onClick={(event) => {
        if (!unavailable) run(event);
      }}
      className={cn(BUTTON, className)}
    >
      <Icon aria-hidden="true" />
    </button>
  );
}

export function Toolbar() {
  const t = useTranslations("editor.editor");
  const { target, memory } = useContext(ToolbarContext);
  const source = useContext(SourceContext);
  const unavailable = useUnavailable();
  const [state, setState] = useState<ToolbarState>(AT_REST);
  // The button whose address was refused.
  const [refused, setRefused] = useState<"media" | "link" | "image" | null>(
    null,
  );
  // The emoji picker: its code, fetched on the first press (no part of the editor's first load),
  // whether it is open (and was opened from the keyboard, which puts the focus in its search box),
  // and whether its code could not be fetched (a later press asks again).
  const [Picker, setPicker] = useState<ComponentType<PickerProps>>();
  const [picker, setPickerOpen] = useState<PickerMode | null>(
    memory?.picker ?? null,
  );
  const [pickerFailed, setPickerFailed] = useState(false);
  const [askPicker] = useState(() =>
    loader(
      () =>
        import("@/components/forum/emoji-picker").catch((error) => {
          setPickerFailed(true);
          setPickerOpen(null);
          throw error;
        }),
      (loaded) => setPicker(() => loaded.default),
    ),
  );
  // Asked for when it opens, and again when it was open in the bar this one takes the place of.
  useEffect(() => {
    if (picker) askPicker();
  }, [picker, askPicker]);
  // The group whose strip is open, one at a time, as in XenForo.
  const [open, setOpen] = useState<GroupId | null>(memory?.strip ?? null);
  // What a bar that takes this one's place starts from.
  useEffect(() => {
    if (!memory) return;
    memory.strip = open;
    memory.picker = picker;
  }, [memory, open, picker]);
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

  // The control that had the focus in the bar this one takes the place of has it here.
  useLayoutEffect(() => {
    const control = memory?.focus;
    if (!memory || !control) return;
    memory.focus = null;
    controls()
      .filter(inView)
      .find((button) => button.dataset.control === control)
      ?.focus();
  }, [memory, controls]);

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
    () => target.watch((next) => setState((last) => ({ ...last, ...next }))),
    [target],
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

  // Asks for an address; empty or cancelled asks nothing more.
  function ask(prompt: string) {
    const input = window.prompt(prompt, "https://");
    if (!input) setRefused(null);
    return input || null;
  }

  function toggleLink() {
    if (state.link) {
      target.run({ link: null });
      return;
    }
    const input = ask(t("linkPrompt"));
    if (!input) return;
    const url = linkAddressOf(input);
    setRefused(url ? null : "link");
    if (url) target.run({ link: url });
  }

  function addMedia() {
    const address = ask(t("mediaPrompt"));
    if (!address) return;
    const media = mediaTagOf(address);
    setRefused(media ? null : "media");
    if (media) target.run({ insert: media });
  }

  // The composer's own picture picker, whose pictures go in at the caret once they are uploaded
  // (`[ATTACH=full]`); where the composer takes no files, a picture on the web by its address.
  function addImage() {
    if (pickImage(target.form())) {
      setRefused(null);
      return;
    }
    const tag = imageTag(ask(t("imagePrompt")));
    if (!tag) return;
    setRefused(tag === "refused" ? "image" : null);
    if (tag !== "refused") target.run({ insert: tag });
  }

  const [bold, italic, underline, strikethrough, code] = FORMATS.map(
    ({ format, label, icon }): Command => ({
      label: t(label),
      icon,
      active: state.formats.includes(format),
      run: () => target.run({ format }),
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
      run: () => target.run({ run: "removeFormatting" }),
    },
    heading: {
      label: t("headingLabel"),
      icon: Heading,
      active: state.block === "heading",
      run: () => target.run({ block: "heading" }),
    },
    bullet: {
      label: t("bulletListLabel"),
      icon: List,
      active: state.block === "bullet",
      run: () => target.run({ list: "bullet" }),
    },
    number: {
      label: t("numberedListLabel"),
      icon: ListOrdered,
      active: state.block === "number",
      run: () => target.run({ list: "number" }),
    },
    quote: {
      label: t("quoteLabel"),
      icon: TextQuote,
      active: state.block === "quote",
      run: () => target.run({ block: "quote" }),
    },
    link: {
      label: t("linkLabel"),
      icon: Link2,
      active: state.link,
      run: toggleLink,
    },
    image: { label: t("imageLabel"), icon: ImageIcon, run: addImage },
    emoji: {
      label: t("emojiPickerLabel"),
      icon: Smile,
      active: picker !== null,
      run: (press) => {
        if (picker) {
          setPickerOpen(null);
          return;
        }
        setPickerFailed(false);
        setPickerOpen(fromKeyboard(press) ? "keyboard" : "pointer");
      },
    },
    spoiler: {
      label: t("spoilerLabel"),
      icon: EyeOff,
      run: () => target.run({ wrap: ["[SPOILER]", "[/SPOILER]"] }),
    },
    codeBlock: {
      label: t("codeBlockLabel"),
      icon: SquareCode,
      active: state.block === "code",
      // Turning a list item or a quote into a code block would pull it out of its list or quote
      // and leave the rest broken, so the command waits until the caret is somewhere else.
      disabled: ["bullet", "number", "quote"].includes(state.block),
      run: () => target.run({ block: "code" }),
    },
    media: { label: t("mediaLabel"), icon: Clapperboard, run: addMedia },
    source: {
      label: t("sourceLabel"),
      icon: Brackets,
      active: source?.active ?? false,
      always: true,
      run: () => target.run({ run: "source" }),
    },
    undo: {
      label: t("undoLabel"),
      icon: Undo2,
      disabled: !state.canUndo,
      run: () => target.run({ run: "undo" }),
    },
    redo: {
      label: t("redoLabel"),
      icon: Redo2,
      disabled: !state.canRedo,
      run: () => target.run({ run: "redo" }),
    },
  };

  const draw = (slot: Slot) => (
    <ToolbarButton
      key={`${slot.id}-${slot.shown}`}
      control={slot.id}
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
          // XenForo's bar, 55 px: 6 px of padding around 42 px boxes, 3 px apart. At rest it is a band
          // of the border colour, into which the boxes' borders melt; while the text is written in
          // it clears and the boxes show their edges; it clears too while a strip is open, whose
          // buttons lie on the bar itself and take the border colour under the pointer.
          className="flex flex-wrap items-center gap-[3px] rounded-t-[inherit] border-b bg-border p-1.5 outline-none group-focus-within/editor:bg-transparent has-[[aria-expanded=true]]:bg-transparent"
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
                  "flex min-w-0 items-center rounded-[9px] border bg-card px-1.5 py-0.5",
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
                  data-control={`more-${group.id}`}
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
                "min-w-0 basis-full flex-wrap items-center px-1.5",
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
      {picker && Picker && target.ready && !source?.active && (
        <Picker
          focusSearch={picker === "keyboard"}
          onClose={() => setPickerOpen(null)}
        />
      )}
      {pickerFailed && (
        <FormError className="px-3 py-1.5">{t("emojiLoadFailed")}</FormError>
      )}
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
