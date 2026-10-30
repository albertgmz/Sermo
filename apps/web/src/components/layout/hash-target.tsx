"use client";

import { usePathname, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { drawnById } from "@/components/layout/hash-scroll";
import {
  type Box,
  createHistoryScroll,
  createScrollRestorer,
  createSpotlight,
  createTraversalGuard,
  decideArrival,
  entryId,
  HASH_LINK_EVENT,
  type HoldEnv,
  LAND_EVENT,
  SHOW_MS,
  type SpotlightEnv,
  TARGET,
} from "@/components/layout/spotlight";

const listen: SpotlightEnv["on"] = (type, listener) => {
  const options = { capture: true, passive: true };
  window.addEventListener(type, listener, options);
  return () => window.removeEventListener(type, listener, options);
};
const everyFrame: SpotlightEnv["frames"] = (run) => {
  let id = 0;
  const tick = () => {
    run();
    id = window.requestAnimationFrame(tick);
  };
  id = window.requestAnimationFrame(tick);
  return () => window.cancelAnimationFrame(id);
};
const after: SpotlightEnv["later"] = (run, ms) => {
  const timer = window.setTimeout(run, ms);
  return () => window.clearTimeout(timer);
};

// Where a landed element's top goes: just under the sticky header (measured, so a change to the
// header's height follows), with the element's own scroll margin as the gap. Without the header,
// the page's scroll padding stands for it.
function landingTop(element: Element) {
  const header = document.querySelector("[data-site-header]");
  const under = header
    ? Math.max(0, header.getBoundingClientRect().bottom)
    : Number.parseFloat(
        getComputedStyle(document.documentElement).scrollPaddingTop,
      ) || 0;
  return (
    under + (Number.parseFloat(getComputedStyle(element).scrollMarginTop) || 0)
  );
}

function browserEnv(show: (box: Box) => void, hide: () => void): SpotlightEnv {
  return {
    hash: () => window.location.hash,
    find: (id) => drawnById(document, id),
    landingTop: (element) => landingTop(element as Element),
    on: listen,
    frames: everyFrame,
    later: after,
    scroll: holdEnv,
    show,
    hide,
  };
}

// The Navigation API (the installed DOM types lack it): the history entry's key, and the event
// that announces a navigation before it happens.
type NavigationWindow = Window & {
  navigation?: {
    currentEntry?: { key: string } | null;
    addEventListener(
      type: "navigate",
      listener: (event: { navigationType: string }) => void,
    ): void;
    removeEventListener(
      type: "navigate",
      listener: (event: { navigationType: string }) => void,
    ): void;
  };
};
const entryKey = () =>
  (window as NavigationWindow).navigation?.currentEntry?.key;

// The page's scroll as `createScrollHolder` holds it; also kept still by the comments that load
// above in place (`EarlierComments`).
export const holdEnv: HoldEnv = {
  scrollY: () => window.scrollY,
  maxScrollY: () => document.documentElement.scrollHeight - window.innerHeight,
  scrollTo: (y) => window.scrollTo({ top: y, behavior: "instant" }),
  loaded: () => document.readyState === "complete",
  on: listen,
  frames: everyFrame,
  later: after,
};

// Arrivals already handled, by history entry and address: Back and Forward to an entry restore
// its scroll, and only a new entry is marked.
const handled = new Set<string>();

// Where the reader left each handled entry, and the restoring of it. On a traversal the browser
// can jump to the element the address names instead of the saved position (Next scrolls to the
// address of a navigation and leaves a traversal to the browser), so the position is put back once
// the page is drawn and held for a moment (see `createScrollRestorer`).
const restorer = createScrollRestorer(holdEnv);
const historyScroll = createHistoryScroll({
  key: () => entryKey(),
  hash: () => window.location.hash,
  scrollY: () => window.scrollY,
  handled,
  restore: (y) => restorer.restore(y),
});
const onNavigate = (event: { navigationType: string }) =>
  historyScroll.onNavigate(event.navigationType);

// Where entries have no key, traversals are told apart by a guard fed by `popstate`. It is
// watched from the module: the component can be hidden and shown again by a client-side Back.
const traversals = createTraversalGuard((run, ms) => {
  const timer = window.setTimeout(run, ms);
  return () => window.clearTimeout(timer);
});
if (typeof window !== "undefined" && entryKey() === undefined) {
  window.addEventListener("popstate", () => traversals.traversal());
}

// Whether the arrival at the current address starts the mark; the entry is recorded as handled.
function arrives(navigationType?: string) {
  const hash = window.location.hash;
  const key = entryKey();
  const decision = decideArrival({ key, hash, handled, navigationType });
  if (key !== undefined) {
    const id = entryId(key, hash);
    // Back or Forward to an entry already handled: it ends where the reader left it.
    historyScroll.revisit();
    handled.add(id);
  }
  return decision === "guard" ? !traversals.consume() : decision === "start";
}

// When the address names an element of the page (a post, a wall post or comment, a message), the
// page lands on it (its top under the header, held there while the page settles; see
// `createSpotlight`) and the element is marked for a few seconds (`TargetMark`); the rest of the
// page stays as it is. A wheel turn, a touch, a click or a key press takes the mark away at once,
// and it never takes the click or the focus: the first click both dismisses it and acts. Mounted
// once in the site's frame; it covers the first load, the address changing within the page and
// navigations to another page.
export function HashTarget() {
  const pathname = usePathname();
  const search = useSearchParams().toString();
  const [box, setBox] = useState<Box | null>(null);
  const spotlight = useRef<ReturnType<typeof createSpotlight> | null>(null);
  const arrived = useRef(false);

  // Once: the listeners, and the first arrival, unless the browser restores the scroll itself
  // (a reload, or a visit by history of the document) or the entry was handled already.
  useEffect(() => {
    const env = browserEnv(
      (next) => setBox(next),
      () => setBox(null),
    );
    const current = createSpotlight(env);
    spotlight.current = current;
    const onHashChange = () => {
      if (arrives()) current.start();
      else current.stop();
    };
    const onClick = (event: MouseEvent) => {
      traversals.reset();
      const link =
        event.target instanceof Element
          ? event.target.closest("a[href]")
          : null;
      if (!(link instanceof HTMLAnchorElement)) return;
      const to = new URL(link.href, window.location.href);
      const here = window.location;
      if (
        to.origin === here.origin &&
        to.pathname === here.pathname &&
        to.search === here.search &&
        TARGET.test(to.hash)
      ) {
        // A link followed is a new arrival, even to the address already shown.
        current.startWhenHashIs(to.hash, () => {
          const key = entryKey();
          if (key !== undefined) handled.add(entryId(key, to.hash));
        });
      }
    };
    // A link that changed the address by itself (see HashLink): a new arrival.
    const onHashLink = (event: Event) => {
      const hash = (event as CustomEvent<string>).detail;
      current.startWhenHashIs(hash, () => {
        const key = entryKey();
        if (key !== undefined) handled.add(entryId(key, hash));
      });
    };
    // Something just written or edited on the page (see `landOn`).
    const onLand = (event: Event) =>
      current.start({ hash: (event as CustomEvent<string>).detail });
    window.addEventListener(LAND_EVENT, onLand);
    window.addEventListener(HASH_LINK_EVENT, onHashLink);
    window.addEventListener("hashchange", onHashChange);
    document.addEventListener("click", onClick);
    (window as NavigationWindow).navigation?.addEventListener(
      "navigate",
      onNavigate,
    );
    const [entry] = performance.getEntriesByType("navigation");
    if (arrives((entry as PerformanceNavigationTiming)?.type)) current.start();
    return () => {
      window.removeEventListener(LAND_EVENT, onLand);
      window.removeEventListener(HASH_LINK_EVENT, onHashLink);
      window.removeEventListener("hashchange", onHashChange);
      document.removeEventListener("click", onClick);
      (window as NavigationWindow).navigation?.removeEventListener(
        "navigate",
        onNavigate,
      );
      current.stop();
    };
  }, []);

  // A navigation to another page or query: a new arrival, unless it is a visit by history.
  // biome-ignore lint/correctness/useExhaustiveDependencies: the path and the query are what starts it again
  useEffect(() => {
    if (!arrived.current) {
      arrived.current = true;
      return;
    }
    if (arrives()) spotlight.current?.start({ fromTop: true });
    else spotlight.current?.stop();
  }, [pathname, search]);

  return box && <TargetMark box={box} />;
}

// The mark on the element: an edge and a light fill of the accent, a little outside its box, that
// fade in, stay and fade out in the time the mark is shown (`.target-mark` in globals.css). It
// floats under the sticky header and never takes a click.
export function TargetMark({ box }: { box: Box }) {
  const margin = 4;
  return (
    <div
      aria-hidden="true"
      className="target-mark pointer-events-none fixed z-20 rounded-lg"
      style={{
        top: box.top - margin,
        left: box.left - margin,
        width: box.width + margin * 2,
        height: box.height + margin * 2,
        animationDuration: `${SHOW_MS}ms`,
      }}
    />
  );
}
