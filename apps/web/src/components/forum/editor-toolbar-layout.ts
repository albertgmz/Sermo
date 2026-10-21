// Which commands of the formatting bar are buttons and which sit behind a group's "⋮", at each
// width of the bar. The bar is XenForo's: four boxed groups (text, paragraph, insert, and the misc
// group on the right), each showing its first few commands as buttons and a "⋮" that opens a strip
// with the rest, one strip at a time, on a line under the groups. The sizes are XenForo's too,
// measured on the bar's own width (a container query, so an editor in a narrow column picks its
// size from the room it has): extra small below 420 px, small from 420, medium from 575, large from
// 900. At every size each command is in the bar exactly once, as a button or in one strip.

export type ToolbarSize = "xs" | "sm" | "md" | "lg";

export const TOOLBAR_SIZES: readonly ToolbarSize[] = ["xs", "sm", "md", "lg"];

// The narrowest bar of each size, in CSS pixels. `SHOWN` spells the same numbers out for Tailwind;
// a test holds the two together.
export const SIZE_FROM: Record<ToolbarSize, number> = {
  xs: 0,
  sm: 420,
  md: 575,
  lg: 900,
};

export type CommandId =
  | "bold"
  | "italic"
  | "underline"
  | "strikethrough"
  | "code"
  | "removeFormatting"
  | "heading"
  | "bullet"
  | "number"
  | "quote"
  | "link"
  | "image"
  | "spoiler"
  | "codeBlock"
  | "media"
  | "source"
  | "undo"
  | "redo";

export type GroupId = "text" | "paragraph" | "insert" | "misc";

// The classes that show a part of the bar at the sizes named, and hide it at the others. Spelled
// out whole so that Tailwind finds them.
export const SHOWN = {
  xs: "@min-[420px]:hidden",
  "xs sm": "@min-[575px]:hidden",
  "xs sm md": "@min-[900px]:hidden",
  sm: "hidden @min-[420px]:flex @min-[575px]:hidden",
  "sm md lg": "hidden @min-[420px]:flex",
  "md lg": "hidden @min-[575px]:flex",
  lg: "hidden @min-[900px]:flex",
  all: "",
} as const;
export type Shown = keyof typeof SHOWN;

// The classes that draw a "⋮" as holding a command that is on (the accent's ink, full opacity), at
// the sizes named only: its strip holds the command only there, and elsewhere the command is a
// button in view or in another strip. Spelled out whole so that Tailwind finds them; a test holds
// them to `SHOWN`.
export const ACTIVE_ON = {
  xs: "@max-[419px]:text-primary-ink @max-[419px]:opacity-100",
  "xs sm": "@max-[574px]:text-primary-ink @max-[574px]:opacity-100",
  "xs sm md": "@max-[899px]:text-primary-ink @max-[899px]:opacity-100",
  sm: "@min-[420px]:@max-[574px]:text-primary-ink @min-[420px]:@max-[574px]:opacity-100",
  "sm md lg": "@min-[420px]:text-primary-ink @min-[420px]:opacity-100",
  "md lg": "@min-[575px]:text-primary-ink @min-[575px]:opacity-100",
  lg: "@min-[900px]:text-primary-ink @min-[900px]:opacity-100",
  all: "text-primary-ink opacity-100",
} as const satisfies Record<Shown, string>;

export type Slot = { id: CommandId; shown: Shown };

export type Group = {
  id: GroupId;
  // Where the group's box is drawn: not where it would be empty.
  shown: Shown;
  // Its buttons, in order.
  direct: Slot[];
  // What its strip holds, in order, and where its "⋮" is drawn: where the strip holds something.
  more: Slot[];
  moreShown: Shown;
};

const slot = (id: CommandId, shown: Shown = "all"): Slot => ({ id, shown });

// XenForo's table (its `editorToolbarConfig`), with Sermo's commands. Medium keeps Media as a
// button, as small does: a smaller bar never shows a button that a larger one keeps behind its "⋮".
export const GROUPS: Group[] = [
  {
    id: "text",
    shown: "all",
    direct: [
      slot("removeFormatting", "lg"),
      slot("bold"),
      slot("italic"),
      slot("underline", "md lg"),
      slot("strikethrough", "lg"),
    ],
    more: [
      slot("underline", "xs sm"),
      slot("strikethrough", "xs sm md"),
      slot("code"),
      // Extra small has no paragraph group: its commands join the text strip.
      slot("heading", "xs"),
      slot("bullet", "xs"),
      slot("number", "xs"),
    ],
    moreShown: "all",
  },
  {
    id: "paragraph",
    shown: "sm md lg",
    direct: [
      slot("bullet", "sm md lg"),
      slot("number", "md lg"),
      slot("heading", "md lg"),
    ],
    more: [slot("number", "sm"), slot("heading", "sm")],
    moreShown: "sm",
  },
  {
    id: "insert",
    shown: "all",
    direct: [
      slot("link"),
      slot("image"),
      slot("media", "sm md lg"),
      slot("quote", "lg"),
      slot("spoiler", "lg"),
      slot("codeBlock", "lg"),
    ],
    more: [
      slot("media", "xs"),
      slot("quote", "xs sm md"),
      slot("spoiler", "xs sm md"),
      slot("codeBlock", "xs sm md"),
    ],
    moreShown: "xs sm md",
  },
  {
    id: "misc",
    shown: "all",
    direct: [slot("undo"), slot("redo", "lg"), slot("source", "lg")],
    more: [
      slot("redo", "xs sm md"),
      slot("source", "xs sm md"),
      slot("removeFormatting", "xs sm md"),
    ],
    moreShown: "xs sm md",
  },
];

export function sizesOf(shown: Shown): readonly ToolbarSize[] {
  return shown === "all" ? TOOLBAR_SIZES : (shown.split(" ") as ToolbarSize[]);
}

export type SizeLayout = {
  groups: { id: GroupId; direct: CommandId[]; more: CommandId[] }[];
};

// What the bar holds at one size: its groups, each with its buttons and its strip, in order.
export function layoutAt(size: ToolbarSize): SizeLayout {
  const at = (slots: Slot[]) =>
    slots.filter((s) => sizesOf(s.shown).includes(size)).map((s) => s.id);
  return {
    groups: GROUPS.filter((group) => sizesOf(group.shown).includes(size)).map(
      (group) => ({
        id: group.id,
        direct: at(group.direct),
        more: sizesOf(group.moreShown).includes(size) ? at(group.more) : [],
      }),
    ),
  };
}

// The classes of a "⋮" whose strip holds commands that are on (`on`), each at the sizes where the
// strip holds it.
export const activeMore = (more: Slot[], on: (id: CommandId) => boolean) =>
  more
    .filter((slot) => on(slot.id))
    .map((slot) => ACTIVE_ON[slot.shown])
    .join(" ");

// The strip open after a "⋮" is pressed: its own, or none when it was already open. Opening one
// closes the one that was open.
export const toggleStrip = (open: GroupId | null, pressed: GroupId) =>
  open === pressed ? null : pressed;
