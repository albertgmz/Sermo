"use client";

import { Quote } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import {
  bbOf,
  partialQuote,
  selectedBody,
} from "@/components/forum/selection-bb";

// The button and where it goes (viewport pixels), with the quote it would insert, worked out when
// it was offered: pressing it must not depend on a selection the press itself may clear.
type Offer = { quote: string; left: number; top: number };

const BUTTON_WIDTH = 96;
const BUTTON_HEIGHT = 44;

function offerOf(selection: Selection | null): Offer | null {
  if (!selection || selection.rangeCount === 0 || selection.isCollapsed)
    return null;
  const range = selection.getRangeAt(0);
  const body = selectedBody(range);
  if (!body) return null;
  const inside = range.cloneRange();
  if (!body.contains(range.endContainer))
    inside.setEnd(body, body.childNodes.length);
  const source = bbOf(inside.cloneContents());
  const end = Array.from(inside.getClientRects()).at(-1);
  // Nothing is offered for a selection whose end is out of view: the button stays with it.
  if (!source || !end || end.bottom < 0 || end.top > window.innerHeight)
    return null;
  // Below the selection: a phone's own menu sits above it, and its handles hang just under it.
  const touch = window.matchMedia("(pointer: coarse)").matches;
  const top = Math.min(
    end.bottom + (touch ? 28 : 8),
    window.innerHeight - BUTTON_HEIGHT,
  );
  const left = Math.max(
    8,
    Math.min(end.right, window.innerWidth - BUTTON_WIDTH - 8),
  );
  return { quote: partialQuote(body, source), left, top };
}

// XenForo's "Quote" tooltip: a button near the text selected inside one post (or message) that
// quotes only that text into the reply editor, which listens for `event`.
export function SelectionQuote({ event }: { event: string }) {
  const t = useTranslations("forum.contentActions");
  const [offer, setOffer] = useState<Offer | null>(null);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    // After a pause, so a drag in progress or a handle being moved offers nothing yet.
    const schedule = () => {
      clearTimeout(timer);
      timer = setTimeout(() => setOffer(offerOf(window.getSelection())), 150);
    };
    document.addEventListener("selectionchange", schedule);
    window.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("resize", schedule);
    return () => {
      clearTimeout(timer);
      document.removeEventListener("selectionchange", schedule);
      window.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", schedule);
    };
  }, []);

  if (!offer) return null;
  return (
    <button
      type="button"
      data-selection-quote=""
      style={{ left: offer.left, top: offer.top }}
      // Keeps the selection while the button is pressed.
      onMouseDown={(press) => press.preventDefault()}
      onClick={() => {
        window.dispatchEvent(new CustomEvent(event, { detail: offer.quote }));
        document.getElementById("reply")?.scrollIntoView({ block: "start" });
        window.getSelection()?.removeAllRanges();
        setOffer(null);
      }}
      className="fixed z-50 m-0 inline-flex min-h-11 items-center gap-1.5 rounded-md border bg-popover px-3 text-sm font-medium text-popover-foreground shadow-md"
    >
      <Quote aria-hidden="true" className="size-4" />
      {t("quote")}
    </button>
  );
}
