// Ctrl+Enter (Cmd+Enter on a Mac) sends the composer the text is in, as a press on its submit
// button does. One place for every box a composer has: the plain field that stands in for the
// editor, the editor's text and its BB code source (the editor's own key is
// `registerSubmitShortcut`).

import { useSyncExternalStore } from "react";

type Keys = Pick<
  KeyboardEvent,
  | "key"
  | "ctrlKey"
  | "metaKey"
  | "altKey"
  | "shiftKey"
  | "repeat"
  | "isComposing"
>;

export const isApple = () =>
  typeof navigator !== "undefined" &&
  /Mac|iPhone|iPad/.test(navigator.platform);

const never = () => () => {};

// The keys as the submit button's tooltip names them: "Save (Ctrl+Enter)", with the Command key's
// sign on a Mac. The server and the first draw say Ctrl, which a Mac then corrects.
export function useSubmitTitle(label: string) {
  const apple = useSyncExternalStore(never, isApple, () => false);
  return `${label} (${apple ? "⌘" : "Ctrl"}+Enter)`;
}

// A held key sends once; Alt and Shift keep Enter's own uses; a key that ends a word being composed
// (an input method) is not a press.
export function isSubmitShortcut(event: Keys, apple = isApple()) {
  const modifier = event.ctrlKey || (apple && event.metaKey);
  return (
    event.key === "Enter" &&
    modifier &&
    !event.altKey &&
    !event.shiftKey &&
    !event.repeat &&
    !event.isComposing
  );
}

// Sends `form` through its first submit button, so validation and the action run as on a press.
// Nothing is sent while `text` is empty or the button is off (a file on its way, a post being
// taken, text still to write). Whether it was sent.
export function submitComposer(form: HTMLFormElement | null, text: string) {
  const button = form?.querySelector<HTMLButtonElement>(
    'button[type="submit"]',
  );
  if (!form || !button || text.trim() === "") return false;
  if (button.disabled || button.getAttribute("aria-disabled") === "true") {
    return false;
  }
  form.requestSubmit(button);
  return true;
}

// For a plain text field (the box before the editor, and the source).
export function submitOnShortcut(
  event: React.KeyboardEvent<HTMLTextAreaElement>,
) {
  if (
    event.nativeEvent.defaultPrevented ||
    !isSubmitShortcut(event.nativeEvent)
  ) {
    return;
  }
  event.preventDefault();
  submitComposer(event.currentTarget.form, event.currentTarget.value);
}
