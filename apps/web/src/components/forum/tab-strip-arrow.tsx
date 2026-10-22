"use client";

import { ChevronRight } from "lucide-react";
import { useEffect, useRef, useState } from "react";

type Strip = Pick<HTMLElement, "scrollLeft" | "clientWidth" | "scrollWidth">;

// Whether tabs lie beyond the strip's right edge (a pixel of rounding left aside).
export function stripHasMore(strip: Strip) {
  return strip.scrollLeft + strip.clientWidth < strip.scrollWidth - 1;
}

// How far one press scrolls: most of the strip's width, so the last tab seen stays in sight.
export function stripStep(strip: Strip) {
  return Math.round(strip.clientWidth * 0.75);
}

// The ">" over the right end of a strip of tabs wider than its box (XenForo's scrolling tab bar):
// shown while tabs lie beyond that edge, a press scrolls the strip on. It is for pointers only: a
// tab reached with the keyboard is scrolled into view by the browser. The strip is the element
// just before it, inside a `relative` frame.
export function TabStripArrow() {
  const button = useRef<HTMLButtonElement>(null);
  const [more, setMore] = useState(false);
  useEffect(() => {
    const strip = button.current?.previousElementSibling;
    if (!(strip instanceof HTMLElement)) return;
    const update = () => setMore(stripHasMore(strip));
    update();
    strip.addEventListener("scroll", update, { passive: true });
    const resized = new ResizeObserver(update);
    resized.observe(strip);
    return () => {
      strip.removeEventListener("scroll", update);
      resized.disconnect();
    };
  }, []);
  return (
    <button
      ref={button}
      type="button"
      tabIndex={-1}
      aria-hidden="true"
      hidden={!more}
      onClick={() => {
        const strip = button.current?.previousElementSibling;
        if (strip instanceof HTMLElement)
          strip.scrollBy({ left: stripStep(strip), behavior: "smooth" });
      }}
      className="absolute top-0 right-0 bottom-px flex w-10 items-center justify-end bg-linear-to-l from-card from-50% to-transparent pr-2 text-muted-foreground transition-colors hover:text-foreground"
    >
      <ChevronRight className="size-4" />
    </button>
  );
}
