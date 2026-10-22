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

// The bar a frame holds: its first child, drawn by the server.
function barOf(frame: HTMLElement | null) {
  const bar = frame?.firstElementChild;
  return bar instanceof HTMLElement ? bar : null;
}

// A strip of tabs (`children`, the bar that scrolls) with a ">" over its right end, as XenForo's
// scrolling tab bar: shown while tabs lie beyond that edge, a press scrolls the bar on. The arrow
// is for pointers only: a tab reached with the keyboard is scrolled into view by the browser.
export function TabStripWithArrow({ children }: { children: React.ReactNode }) {
  const frame = useRef<HTMLDivElement>(null);
  const [more, setMore] = useState(false);
  useEffect(() => {
    const bar = barOf(frame.current);
    if (!bar) return;
    const update = () => setMore(stripHasMore(bar));
    update();
    bar.addEventListener("scroll", update, { passive: true });
    const resized = new ResizeObserver(update);
    resized.observe(bar);
    return () => {
      bar.removeEventListener("scroll", update);
      resized.disconnect();
    };
  }, []);
  return (
    <div ref={frame} className="relative">
      {children}
      <button
        type="button"
        tabIndex={-1}
        aria-hidden="true"
        hidden={!more}
        onClick={() => {
          const bar = barOf(frame.current);
          bar?.scrollBy({ left: stripStep(bar), behavior: "smooth" });
        }}
        className="absolute top-0 right-0 bottom-px flex w-10 items-center justify-end bg-linear-to-l from-card from-50% to-transparent pr-2 text-muted-foreground transition-colors hover:text-foreground"
      >
        <ChevronRight className="size-4" />
      </button>
    </div>
  );
}
