// Which commands of the formatting bar are buttons and which sit in a menu, at each width of the
// bar. The sizes are XenForo's, measured on the bar's own width (a container query, so the editor
// in a narrow column or in a composer's bottom bar picks its size from the room it has): extra
// small below 420 px, small from 420, medium from 575, large from 900. Extra small has a wider
// step from 350 px that also shows Bold and Italic (a 390 px phone's bar has the room; the 326 px
// bar of a 360 px phone does not). At every size each command is in the bar exactly once, as a
// button or as an item of one menu.

export type ToolbarSize = "xs" | "xsWide" | "sm" | "md" | "lg";

export const TOOLBAR_SIZES: readonly ToolbarSize[] = [
  "xs",
  "xsWide",
  "sm",
  "md",
  "lg",
];

// The narrowest bar of each size, in CSS pixels. `SHOWN` spells the same numbers out for Tailwind;
// a test holds the two together.
export const SIZE_FROM: Record<ToolbarSize, number> = {
  xs: 0,
  xsWide: 350,
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
  | "spoiler"
  | "codeBlock"
  | "media"
  | "source"
  | "undo"
  | "redo";

export type MenuId = "text" | "paragraph" | "insert" | "more";

// The classes that show a part of the bar at the sizes named, and hide it at the others. Spelled
// out whole so that Tailwind finds them.
export const SHOWN = {
  xs: "@min-[350px]:hidden",
  "xs xsWide": "@min-[420px]:hidden",
  "xs xsWide sm md": "@min-[900px]:hidden",
  "xsWide sm md": "hidden @min-[350px]:flex @min-[900px]:hidden",
  "xsWide sm md lg": "hidden @min-[350px]:flex",
  sm: "hidden @min-[420px]:flex @min-[575px]:hidden",
  "sm md lg": "hidden @min-[420px]:flex",
  md: "hidden @min-[575px]:flex @min-[900px]:hidden",
  "md lg": "hidden @min-[575px]:flex",
  lg: "hidden @min-[900px]:flex",
  all: "",
} as const;
export type Shown = keyof typeof SHOWN;

export type Slot =
  | { kind: "command"; id: CommandId; shown: Shown }
  | { kind: "menu"; id: MenuId; items: CommandId[]; shown: Shown }
  | { kind: "divider"; shown: Shown };

const command = (id: CommandId, shown: Shown): Slot => ({
  kind: "command",
  id,
  shown,
});
const menu = (id: MenuId, items: CommandId[], shown: Shown): Slot => ({
  kind: "menu",
  id,
  items,
  shown,
});

// The bar from its start, in order. A menu that holds different commands at different sizes is
// one slot per size range.
export const START: Slot[] = [
  command("bold", "xsWide sm md lg"),
  command("italic", "xsWide sm md lg"),
  command("underline", "lg"),
  command("strikethrough", "lg"),
  command("code", "lg"),
  command("removeFormatting", "lg"),
  menu(
    "text",
    [
      "bold",
      "italic",
      "underline",
      "strikethrough",
      "code",
      "removeFormatting",
    ],
    "xs",
  ),
  menu(
    "text",
    ["underline", "strikethrough", "code", "removeFormatting"],
    "xsWide sm md",
  ),
  { kind: "divider", shown: "md lg" },
  command("heading", "lg"),
  command("bullet", "lg"),
  command("number", "lg"),
  command("quote", "lg"),
  menu(
    "paragraph",
    ["heading", "bullet", "number", "quote"],
    "xs xsWide sm md",
  ),
  { kind: "divider", shown: "md lg" },
  command("link", "sm md lg"),
  command("spoiler", "lg"),
  command("codeBlock", "lg"),
  command("media", "md lg"),
  menu("insert", ["link", "spoiler", "codeBlock", "media"], "xs xsWide"),
  menu("insert", ["spoiler", "codeBlock", "media"], "sm"),
  menu("insert", ["spoiler", "codeBlock"], "md"),
];

// The bar's end, kept to the right.
export const END: Slot[] = [
  command("source", "sm md lg"),
  menu("more", ["source"], "xs xsWide"),
  command("undo", "all"),
  command("redo", "all"),
];

export function sizesOf(shown: Shown): readonly ToolbarSize[] {
  return shown === "all" ? TOOLBAR_SIZES : (shown.split(" ") as ToolbarSize[]);
}

export type SizeLayout = {
  direct: CommandId[];
  menus: { id: MenuId; items: CommandId[] }[];
};

// What the bar holds at one size: its buttons and its menus, in order.
export function layoutAt(size: ToolbarSize): SizeLayout {
  const layout: SizeLayout = { direct: [], menus: [] };
  for (const slot of [...START, ...END]) {
    if (!sizesOf(slot.shown).includes(size)) continue;
    if (slot.kind === "command") layout.direct.push(slot.id);
    else if (slot.kind === "menu") {
      layout.menus.push({ id: slot.id, items: slot.items });
    }
  }
  return layout;
}
