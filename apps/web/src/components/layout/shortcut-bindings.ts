import type {
  HotkeyCallback,
  HotkeySequence,
  RegisterableHotkey,
} from "@tanstack/react-hotkeys";
import {
  focusReply,
  moveToItem,
  openCreate,
  openSearch,
  popupOpen,
} from "./shortcut-actions";
import {
  GO_TO,
  hotkeyOf,
  SEQUENCE_TIMEOUT,
  SHORTCUTS,
  type ShortcutId,
} from "./shortcuts";

// Keys typed into a field belong to the field (the library skips inputs, text areas, selects and
// editable content). The library's own default of cancelling the key is turned off: a key is
// cancelled only when it did something.
export const OPTIONS = {
  ignoreInputs: true,
  preventDefault: false,
  stopPropagation: false,
} as const;

type Hotkeys = {
  hotkey: RegisterableHotkey;
  callback: HotkeyCallback;
}[];
type Sequences = {
  sequence: HotkeySequence;
  callback: HotkeyCallback;
}[];

// What the registered shortcuts are bound to: one key each, and `g` then a key. Keep the result for
// the life of the page: it remembers when the last `g` was pressed.
export function createShortcuts({
  go,
  openHelp,
}: {
  go: (path: string) => void;
  openHelp: () => void;
}): { hotkeys: Hotkeys; sequences: Sequences } {
  // The `c` that ends `g` then `c` is also a `c` of its own and must not start a thread.
  let lastG = Number.NEGATIVE_INFINITY;

  // The keys do nothing while a dialog or a menu is open, and nothing for a key something else
  // has already handled (a closed select takes letters to find an option). The action says whether
  // it did anything; the key is cancelled only then, so the browser keeps the keys of a page the
  // shortcut has no use on. Cancelling after the action still stops the letter being typed into a
  // field the action focused: the browser acts on the key once this handler has returned.
  const act =
    (action: (event: KeyboardEvent) => boolean): HotkeyCallback =>
    (event) => {
      if (event.defaultPrevented || popupOpen(document)) return;
      if (action(event)) event.preventDefault();
    };
  const did = (action: () => void) => () => {
    action();
    return true;
  };

  const actions: Partial<Record<ShortcutId, HotkeyCallback>> = {
    help: act(did(openHelp)),
    // The library also matches a key by its place on the keyboard: the minus key of a Spanish or
    // German keyboard and the colon key of a French one sit where `/` is on a US one.
    search: act((event) => event.key === "/" && openSearch(document, go)),
    next: act(() => moveToItem(document, 1)),
    previous: act(() => moveToItem(document, -1)),
    reply: act(() => focusReply(document)),
    create: (event, context) => {
      const endsSequence = event.timeStamp - lastG <= SEQUENCE_TIMEOUT;
      lastG = Number.NEGATIVE_INFINITY;
      if (!endsSequence) act(() => openCreate(document))(event, context);
    },
  };

  const registered = SHORTCUTS.filter((shortcut) => !shortcut.native);
  const hotkeys: Hotkeys = registered
    .filter((shortcut) => shortcut.keys.length === 1)
    .flatMap((shortcut) => {
      const callback = actions[shortcut.id];
      return callback ? [{ hotkey: hotkeyOf(shortcut.keys[0]), callback }] : [];
    });
  hotkeys.push({
    hotkey: hotkeyOf("g"),
    callback: (event) => {
      lastG = event.timeStamp;
    },
  });
  const sequences: Sequences = registered.flatMap((shortcut) =>
    shortcut.id in GO_TO
      ? [
          {
            sequence: shortcut.keys.map(hotkeyOf),
            callback: act(
              did(() => go(GO_TO[shortcut.id as keyof typeof GO_TO])),
            ),
          },
        ]
      : [],
  );
  return { hotkeys, sequences };
}
