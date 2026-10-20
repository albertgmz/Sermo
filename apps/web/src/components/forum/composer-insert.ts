// How the attachment list reaches the writing box of its composer: text to put in at the caret, or
// an attachment whose tags are to come out. A request is an event on the composer's form, so it
// finds its own box and no other: the editor, or the plain field that stands in for it until it is
// entered, listens for it.
const EVENT = "sermo:composer-request";

export type ComposerRequest = { insert: string } | { remove: number };

export const attachTag = (id: number, size: "thumb" | "full") =>
  size === "full" ? `[ATTACH=full]${id}[/ATTACH]` : `[ATTACH]${id}[/ATTACH]`;

// The text without the tags that place attachment `id`, in every form the renderer reads: either
// size (`full`, `thumb`, quoted or not), any case, and space around the option and the id.
export const withoutAttachTag = (text: string, id: number) =>
  text.replace(
    new RegExp(
      String.raw`\[ATTACH(?:=(?:"\s*(?:full|thumb)\s*"|\s*(?:full|thumb)\s*))?\]\s*${id}\s*\[/ATTACH\]`,
      "gi",
    ),
    "",
  );

// The text without any attachment tag.
export const withoutAttachTags = (text: string) =>
  text.replace(
    /\[ATTACH(?:=(?:"\s*(?:full|thumb)\s*"|\s*(?:full|thumb)\s*))?\]\s*\d+\s*\[\/ATTACH\]/gi,
    "",
  );

export function requestOnComposer(
  form: HTMLFormElement | null | undefined,
  request: ComposerRequest,
) {
  form?.dispatchEvent(new CustomEvent(EVENT, { detail: request }));
}

// Asks the composer that holds `inside` to put `text` at its caret.
export function insertIntoComposer(inside: Element | null, text: string) {
  requestOnComposer(inside?.closest("form"), { insert: text });
}

// Asks the composer that holds `inside` to drop the tags of attachment `id`.
export function removeFromComposer(inside: Element | null, id: number) {
  requestOnComposer(inside?.closest("form"), { remove: id });
}

// Runs `handle` with each request made to `form`'s composer.
export function onComposerRequest(
  form: HTMLFormElement | null | undefined,
  handle: (request: ComposerRequest) => void,
) {
  if (!form) return () => {};
  const listener = (event: Event) =>
    handle((event as CustomEvent<ComposerRequest>).detail);
  form.addEventListener(EVENT, listener);
  return () => form.removeEventListener(EVENT, listener);
}

// Replaces the selection of a plain field with `text` and leaves the caret after it. A field that
// never had the focus has its caret at the start by default, which is no choice of the member's:
// the text goes at its end.
export function insertAtCaret(
  field: HTMLTextAreaElement,
  text: string,
  touched = true,
) {
  if (!touched) field.setSelectionRange(field.value.length, field.value.length);
  field.setRangeText(text, field.selectionStart, field.selectionEnd, "end");
  field.focus();
}

// Files that came into the editor from outside (pasted or dropped), offered to the composer's
// attachment list, which uploads them as it does the files of its attach button and puts the
// pictures in the text. Whether anything takes them is the answer: a composer with no attachment
// list, or one that does not allow files, leaves them alone.
const FILES_EVENT = "sermo:composer-files";

export function offerFiles(
  form: HTMLFormElement | null | undefined,
  files: File[],
) {
  if (!form) return false;
  const offer = new CustomEvent(FILES_EVENT, {
    detail: files,
    cancelable: true,
  });
  return !form.dispatchEvent(offer);
}

// Runs `take` with the files offered to `form`'s composer, unless another list took them first.
export function onFilesOffered(
  form: HTMLFormElement | null | undefined,
  take: (files: File[]) => void,
) {
  if (!form) return () => {};
  const listener = (event: Event) => {
    if (event.defaultPrevented) return;
    event.preventDefault();
    take((event as CustomEvent<File[]>).detail);
  };
  form.addEventListener(FILES_EVENT, listener);
  return () => form.removeEventListener(FILES_EVENT, listener);
}
