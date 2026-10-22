import {
  COMMAND_PRIORITY_HIGH,
  KEY_ARROW_DOWN_COMMAND,
  KEY_ARROW_UP_COMMAND,
  KEY_ENTER_COMMAND,
  KEY_ESCAPE_COMMAND,
  KEY_TAB_COMMAND,
  type LexicalCommand,
  type LexicalEditor,
  mergeRegister,
} from "lexical";

// What a suggestion list over the editor's text (`SuggestionList`) is showing, read at each key.
export type SuggestionState = { count: number; active: number };

// The editor's keys while a suggestion list shows options: the arrow keys move through them
// (round from the last to the first), Enter or Tab picks the active one, Escape closes the list.
// They are the list's alone then, so a dialog around the editor does not take its Escape. With no
// options the keys do what they always do.
export function registerSuggestionKeys(
  editor: LexicalEditor,
  state: () => SuggestionState,
  act: {
    move: (active: number) => void;
    pick: (active: number) => void;
    close: () => void;
  },
) {
  const step = (by: number) => (now: SuggestionState) =>
    act.move((now.active + by + now.count) % now.count);
  const pick = (now: SuggestionState) => act.pick(now.active);
  const keys = [
    [KEY_ARROW_DOWN_COMMAND, step(1)],
    [KEY_ARROW_UP_COMMAND, step(-1)],
    [KEY_ENTER_COMMAND, pick],
    [KEY_TAB_COMMAND, pick],
    [KEY_ESCAPE_COMMAND, act.close],
  ] as const;
  return mergeRegister(
    ...keys.map(([command, run]) =>
      editor.registerCommand(
        // Enter and the arrow keys come with no event when sent by code.
        command as LexicalCommand<KeyboardEvent | null>,
        (event) => {
          const now = state();
          if (now.count === 0 || !event) return false;
          event.preventDefault();
          event.stopPropagation();
          run(now);
          return true;
        },
        COMMAND_PRIORITY_HIGH,
      ),
    ),
  );
}
