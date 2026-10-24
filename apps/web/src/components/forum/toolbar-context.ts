import type { TextFormatType } from "lexical";
import { createContext } from "react";
import type { BlockKind } from "@/components/forum/editor-commands";
import type { GroupId } from "@/components/forum/editor-toolbar-layout";

// What the formatting bar (`editor-toolbar.tsx`) acts on, and how it hands over to the next one.
// Apart from the bar, so that a box can hold the bar's place without the bar's code.

// Where the caret is, as the bar shows it: the formats and the kind of block that are on there,
// whether it is in a link, and whether there is something to undo or redo.
export type ToolbarState = {
  formats: TextFormatType[];
  block: BlockKind;
  link: boolean;
  canUndo: boolean;
  canRedo: boolean;
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

export type PickerMode = "pointer" | "keyboard";

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
