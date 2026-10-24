import { useEffect } from "react";

// What the notice said in place is: which one, for how long, and what keeps it. Kept apart from the
// words and the box (`PageNotice`, `NoticeCard`), so a form that says a notice brings only this to
// the page.

// The notice a Share button says once its link is on the clipboard (`shareLink`), drawn by the
// main layout (`ShareNotice`). Kept here, so that the layout reads it without the share code.
export const LINK_COPIED = "linkCopied";

// How long a notice said in place stays.
const SHOWN_MS = 6000;

type Said = { notice: string; seq: number };

let said: Said | null = null;
let seq = 0;
let timer: ReturnType<typeof setTimeout> | undefined;
const holds = new Set<"hover" | "focus">();
const listeners = new Set<() => void>();

// The time starts again each time it is set, and runs only while nothing holds the notice.
function setTimer() {
  clearTimeout(timer);
  timer =
    said && holds.size === 0
      ? setTimeout(() => announce(null), SHOWN_MS)
      : undefined;
}

// Said again, a notice is a new one: its time starts over and it is read out again.
export function announce(notice: string | null) {
  said = notice ? { notice, seq: ++seq } : null;
  if (!said) holds.clear();
  setTimer();
  for (const listener of listeners) listener();
}

export const saidNotice = () => said;

// The pointer is on the notice, or focus is in it.
export function holdNotice(by: "hover" | "focus", held: boolean) {
  if (held) holds.add(by);
  else holds.delete(by);
  setTimer();
}

// Escape closes the notice while it is shown; a key a dialog or menu already took is left alone.
export function closeOnEscape(target: EventTarget) {
  const close = (event: Event) => {
    if ((event as KeyboardEvent).key === "Escape" && !event.defaultPrevented)
      announce(null);
  };
  target.addEventListener("keydown", close);
  return () => target.removeEventListener("keydown", close);
}

export function noticeText(
  texts: Record<string, string>,
  notice: string | null | undefined,
) {
  return notice && Object.hasOwn(texts, notice) ? texts[notice] : null;
}

export const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

// For a form: says its action's notice once the answer is in.
export function useAnnounce(notice: string | undefined, answer: object) {
  // biome-ignore lint/correctness/useExhaustiveDependencies: each answer is said, also a repeat
  useEffect(() => {
    if (notice) announce(notice);
  }, [answer]);
}
