"use client";

import { usePathname, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import {
  type Box,
  createSpotlight,
  createTraversalGuard,
  decideArrival,
  entryId,
  type SpotlightEnv,
  TARGET,
} from "@/components/layout/spotlight";

function browserEnv(show: (box: Box) => void, hide: () => void): SpotlightEnv {
  return {
    hash: () => window.location.hash,
    find: (id) => document.getElementById(id),
    reducedMotion: () =>
      window.matchMedia("(prefers-reduced-motion: reduce)").matches,
    on: (type, listener) => {
      const options = { capture: true, passive: true };
      window.addEventListener(type, listener, options);
      return () => window.removeEventListener(type, listener, options);
    },
    frames: (run) => {
      let id = 0;
      const tick = () => {
        run();
        id = window.requestAnimationFrame(tick);
      };
      id = window.requestAnimationFrame(tick);
      return () => window.cancelAnimationFrame(id);
    },
    later: (run, ms) => {
      const timer = window.setTimeout(run, ms);
      return () => window.clearTimeout(timer);
    },
    show,
    hide,
  };
}

// The history entry's key, where the Navigation API exists (the installed DOM types lack it).
type NavigationWindow = Window & {
  navigation?: { currentEntry?: { key: string } | null };
};
const entryKey = () =>
  (window as NavigationWindow).navigation?.currentEntry?.key;

// Arrivals already handled, by history entry and address: Back and Forward to an entry restore
// its scroll, and only a new entry dims.
const handled = new Set<string>();

// Where entries have no key, traversals are told apart by a guard fed by `popstate`. It is
// watched from the module: the component can be hidden and shown again by a client-side Back.
const traversals = createTraversalGuard((run, ms) => {
  const timer = window.setTimeout(run, ms);
  return () => window.clearTimeout(timer);
});
if (typeof window !== "undefined" && entryKey() === undefined) {
  window.addEventListener("popstate", () => traversals.traversal());
}

// Whether the arrival at the current address starts the dimming; the entry is recorded as handled.
function arrives(navigationType?: string) {
  const hash = window.location.hash;
  const key = entryKey();
  const decision = decideArrival({ key, hash, handled, navigationType });
  if (key !== undefined) handled.add(entryId(key, hash));
  return decision === "guard" ? !traversals.consume() : decision === "start";
}

// When the address names an element of the page (a post, a wall post or comment, a message), it
// is brought into view and the rest of the page is dimmed for a few seconds. A scroll, a click or
// a key press takes the dimming away at once, and it never takes the click or the focus: the first
// click both dismisses it and acts. Mounted once in the site's frame; it covers the first load,
// the address changing within the page and navigations to another page.
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
    window.addEventListener("hashchange", onHashChange);
    document.addEventListener("click", onClick);
    const [entry] = performance.getEntriesByType("navigation");
    if (arrives((entry as PerformanceNavigationTiming)?.type)) current.start();
    return () => {
      window.removeEventListener("hashchange", onHashChange);
      document.removeEventListener("click", onClick);
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
    if (arrives()) spotlight.current?.start();
    else spotlight.current?.stop();
  }, [pathname, search]);

  if (!box) return null;
  const margin = 4;
  return (
    <div
      aria-hidden="true"
      className="pointer-events-none fixed z-50 animate-in rounded-lg duration-300 fade-in [box-shadow:0_0_0_100vmax_var(--spotlight-dim)] motion-reduce:animate-none"
      style={{
        top: box.top - margin,
        left: box.left - margin,
        width: box.width + margin * 2,
        height: box.height + margin * 2,
      }}
    />
  );
}
