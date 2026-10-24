"use client";

import { Check, X } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useSyncExternalStore } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

// The line at the top of a page that says what the member just did on it (bought, wore, upgraded).
// A form whose action answered with a notice says so here (`announce`), in place: the page is not
// opened again for it, so the line floats in view under the header, wherever the member is on the
// page, as XenForo's flash message does, and goes after a few seconds (it takes no room, so
// nothing moves when it goes). It stays while the pointer is on it or it holds focus, and the
// member can close it (its button, or Escape). Its live region is in the page all the time and
// the words are put into it, so a screen reader hears them while focus stays where it was.
// `drawn` is the notice the address names (`?notice=`, an older link), drawn as a plain line.
// `texts` holds the words of each notice the page knows; any other draws nothing.

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

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

// The floating notice. The box takes no taps and no room until there are words in it; the
// `<output>` (a polite status) is always there, and its text is a new element each time it is said.
export function NoticeBox({
  text,
  seq: said,
  closeLabel,
}: {
  text: string | null;
  seq: number;
  closeLabel: string;
}) {
  return (
    <div className="pointer-events-none fixed inset-x-4 top-[calc(var(--spacing-site-header)+0.5rem)] z-50 mx-auto max-w-md">
      {/* biome-ignore lint/a11y/noStaticElementInteractions: pointer and focus only keep the notice on screen; the close button and Escape are the actions */}
      <div
        className={cn(
          text &&
            "pointer-events-auto flex items-start gap-2 rounded-lg border border-success/30 bg-[color-mix(in_oklab,var(--success)_10%,var(--background))] py-3 pr-2 pl-4 text-sm text-pretty shadow-md",
        )}
        onMouseEnter={() => holdNotice("hover", true)}
        onMouseLeave={() => holdNotice("hover", false)}
        onFocus={() => holdNotice("focus", true)}
        onBlur={() => holdNotice("focus", false)}
      >
        {text && (
          <Check
            aria-hidden="true"
            className="mt-0.5 size-4 shrink-0 text-success"
          />
        )}
        <output aria-live="polite" className="min-w-0 flex-1 self-center">
          {text && <span key={said}>{text}</span>}
        </output>
        {text && (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="-my-2 size-11 shrink-0"
            aria-label={closeLabel}
            onClick={() => announce(null)}
          >
            <X aria-hidden="true" className="size-4" />
          </Button>
        )}
      </div>
    </div>
  );
}

export function PageNotice({
  drawn,
  texts,
  className,
}: {
  drawn?: string;
  texts: Record<string, string>;
  className?: string;
}) {
  const t = useTranslations("layout.noticeBanner");
  const now = useSyncExternalStore(subscribe, saidNotice, () => null);
  // A notice belongs to the page it was said on.
  useEffect(() => () => announce(null), []);
  const shown = now !== null;
  useEffect(() => (shown ? closeOnEscape(document) : undefined), [shown]);
  const inline = noticeText(texts, drawn);
  return (
    <>
      {inline && (
        <output
          className={cn(
            "flex items-start gap-2 rounded-lg border border-success/30 bg-success/10 px-4 py-3 text-sm text-pretty",
            className,
          )}
        >
          <Check
            aria-hidden="true"
            className="mt-0.5 size-4 shrink-0 text-success"
          />
          {inline}
        </output>
      )}
      <NoticeBox
        text={noticeText(texts, now?.notice)}
        seq={now?.seq ?? 0}
        closeLabel={t("dismiss")}
      />
    </>
  );
}

// For a form: says its action's notice once the answer is in.
export function useAnnounce(notice: string | undefined, answer: object) {
  // biome-ignore lint/correctness/useExhaustiveDependencies: each answer is said, also a repeat
  useEffect(() => {
    if (notice) announce(notice);
  }, [answer]);
}
