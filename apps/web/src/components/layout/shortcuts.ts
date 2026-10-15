import type { Hotkey } from "@tanstack/react-hotkeys";

// The keyboard shortcuts of the site: the one list the provider registers and the help dialog
// shows. `native` marks the shortcuts that belong to something else (the dialogs close on Esc by
// themselves, the editor takes Ctrl+\): they are listed for the reader and never registered here.

export type ShortcutId =
  | "help"
  | "search"
  | "escape"
  | "next"
  | "previous"
  | "reply"
  | "create"
  | "goHome"
  | "goAlerts"
  | "goConversations"
  | "removeFormatting";

type ShortcutGroup = "general" | "lists" | "goTo" | "editor";

type Shortcut = {
  id: ShortcutId;
  group: ShortcutGroup;
  // As the help shows them, one key cap per entry. A registered shortcut with more than one is a
  // sequence: `g`, then `h`.
  keys: readonly string[];
  native?: true;
};

export const SHORTCUTS: readonly Shortcut[] = [
  { id: "help", group: "general", keys: ["?"] },
  { id: "search", group: "general", keys: ["/"] },
  { id: "escape", group: "general", keys: ["Esc"], native: true },
  { id: "next", group: "lists", keys: ["j"] },
  { id: "previous", group: "lists", keys: ["k"] },
  { id: "reply", group: "lists", keys: ["r"] },
  { id: "create", group: "lists", keys: ["c"] },
  { id: "goHome", group: "goTo", keys: ["g", "h"] },
  { id: "goAlerts", group: "goTo", keys: ["g", "n"] },
  { id: "goConversations", group: "goTo", keys: ["g", "c"] },
  {
    id: "removeFormatting",
    group: "editor",
    keys: ["Ctrl", "\\"],
    native: true,
  },
];

export const GROUPS: readonly ShortcutGroup[] = [
  "general",
  "lists",
  "goTo",
  "editor",
];

// Where `g` then the key goes.
export const GO_TO = {
  goHome: "/",
  goAlerts: "/notifications",
  goConversations: "/conversations",
} as const;

// How long the second key of a sequence may take, in milliseconds (the library's own default,
// kept here because `c` has to know when a `g` is still waiting for its second key).
export const SEQUENCE_TIMEOUT = 1000;

// The library names a letter in capitals; `?` and `/` are written as they are.
export function hotkeyOf(key: string) {
  return (/^[a-z]$/.test(key) ? key.toUpperCase() : key) as Hotkey;
}
