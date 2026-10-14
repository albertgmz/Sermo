// How text reaches the writing box of a composer from elsewhere in it (the attachment list). The
// request is an event on the composer's form, so it finds its own box and no other: the editor, or
// the plain field that stands in for it until it is entered, listens for it.
const INSERT_EVENT = "sermo:insert-text";

export const attachTag = (id: number, size: "thumb" | "full") =>
  size === "full" ? `[ATTACH=full]${id}[/ATTACH]` : `[ATTACH]${id}[/ATTACH]`;

// Asks the composer that holds `inside` to put `text` at its caret.
export function insertIntoComposer(inside: Element | null, text: string) {
  inside
    ?.closest("form")
    ?.dispatchEvent(new CustomEvent(INSERT_EVENT, { detail: text }));
}

// Runs `insert` with the text of each request made to `form`'s composer.
export function onComposerInsert(
  form: HTMLFormElement | null | undefined,
  insert: (text: string) => void,
) {
  if (!form) return () => {};
  const listener = (event: Event) =>
    insert(String((event as CustomEvent<string>).detail ?? ""));
  form.addEventListener(INSERT_EVENT, listener);
  return () => form.removeEventListener(INSERT_EVENT, listener);
}

// Replaces the selection of a plain field with `text` and leaves the caret after it.
export function insertAtCaret(field: HTMLTextAreaElement, text: string) {
  field.setRangeText(text, field.selectionStart, field.selectionEnd, "end");
  field.focus();
}
