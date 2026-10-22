import { onFilesOffered } from "@/components/forum/composer-insert";

// The file as the attachment list holds it: `type` is the content type the backend stored it
// with, which says whether it can be placed in the text as a picture.
type Stored = { id: number; type?: string };

// The order in which an attachment list takes files. Each batch waits for the one before it, so
// files go up and into the text in the order they were given, and a refusal is not wiped by the
// batch that follows it: the error is cleared only when a batch starts with nothing else in flight.
// `inText`: the files came into the text (pasted or dropped), so each picture goes in at the caret
// once it is stored, as the member would have done with its button, unless the editor already shows
// it there: `settle` then tells the editor how its upload ended and says it did so.
export function createIntake<T extends Stored>(deps: {
  send: (file: File) => Promise<T | undefined>;
  place: (file: T) => void;
  settle?: (file: File, stored: T | undefined) => boolean;
  clearError: () => void;
}) {
  let last: Promise<void> = Promise.resolve();
  let waiting = 0;
  return function take(files: File[], inText = false) {
    if (waiting === 0) deps.clearError();
    waiting += 1;
    last = last
      .then(async () => {
        for (const file of files) {
          const stored = await deps.send(file);
          if (!inText || deps.settle?.(file, stored)) continue;
          if (stored?.type?.startsWith("image/")) deps.place(stored);
        }
      })
      .finally(() => {
        waiting -= 1;
      });
    return last;
  };
}

// Takes the files the editor offers to this composer, while files may be added here.
export function receiveOffers(
  form: HTMLFormElement | null | undefined,
  allowed: boolean,
  take: (files: File[], inText: boolean) => void,
) {
  if (!allowed) return () => {};
  return onFilesOffered(form, (offered) => take(offered, true));
}
