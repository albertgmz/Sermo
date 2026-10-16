// Which commands of the formatting bar are buttons and which sit in a menu, at each width of the
// bar. The sizes are XenForo's, measured on the bar's own width (a container query, so the editor
// in a narrow column or in a composer's bottom bar picks its size from the room it has): extra
// small below 420 px, small from 420, medium from 575, large from 900. At every size each command
// is in the bar exactly once, as a button or as an item of one menu.

export type ToolbarSize = "xs" | "sm" | "md" | "lg";

export const TOOLBAR_SIZES: readonly ToolbarSize[] = ["xs", "sm", "md", "lg"];

// The narrowest bar of each size, in CSS pixels.
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
  xs: "@min-[420px]:hidden",
  "xs sm md": "@min-[900px]:hidden",
  sm: "hidden @min-[420px]:flex @min-[575px]:hidden",
  "sm md": "hidden @min-[420px]:flex @min-[900px]:hidden",
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
  command("bold", "sm md lg"),
  command("italic", "sm md lg"),
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
    "sm md",
  ),
  { kind: "divider", shown: "md lg" },
  command("heading", "lg"),
  command("bullet", "lg"),
  command("number", "lg"),
  command("quote", "lg"),
  menu("paragraph", ["heading", "bullet", "number", "quote"], "xs sm md"),
  { kind: "divider", shown: "md lg" },
  command("link", "sm md lg"),
  command("spoiler", "lg"),
  command("codeBlock", "lg"),
  command("media", "md lg"),
  menu("insert", ["link", "spoiler", "codeBlock", "media"], "xs"),
  menu("insert", ["spoiler", "codeBlock", "media"], "sm"),
  menu("insert", ["spoiler", "codeBlock"], "md"),
];

// The bar's end, kept to the right.
export const END: Slot[] = [
  command("source", "sm md lg"),
  menu("more", ["source"], "xs"),
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

// Where the focus goes when a menu of the bar closes. A command chosen by pointer gives it back to
// the editor, with its selection, so the member types on in the format just chosen; Escape, a
// press elsewhere and a command chosen from the keyboard leave it to the menu (its trigger).
export function focusAfterMenu(
  chosen: boolean,
  closeType: string,
): "editor" | "trigger" {
  return chosen && closeType !== "keyboard" ? "editor" : "trigger";
}
