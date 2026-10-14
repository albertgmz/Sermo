"use client";

import { usePathname, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import {
  type Box,
  createSpotlight,
  createTraversalGuard,
  restoresScroll,
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
  const guard = useRef<ReturnType<typeof createTraversalGuard> | null>(null);
  const arrived = useRef(false);

  // Once: the listeners, and the first arrival, unless the browser restores the scroll itself
  // (a reload, or a visit by history).
  useEffect(() => {
    const env = browserEnv(
      (next) => setBox({ ...next }),
      () => setBox(null),
    );
    const current = createSpotlight(env);
    const traversals = createTraversalGuard(env.later);
    spotlight.current = current;
    guard.current = traversals;
    const onPopState = () => traversals.traversal();
    const onHashChange = () => {
      if (traversals.consume()) current.stop();
      else current.start();
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
        current.startWhenHashIs(to.hash);
      }
    };
    window.addEventListener("popstate", onPopState);
    window.addEventListener("hashchange", onHashChange);
    document.addEventListener("click", onClick);
    const [entry] = performance.getEntriesByType("navigation");
    if (!restoresScroll((entry as PerformanceNavigationTiming)?.type)) {
      current.start();
    }
    return () => {
      window.removeEventListener("popstate", onPopState);
      window.removeEventListener("hashchange", onHashChange);
      document.removeEventListener("click", onClick);
      traversals.reset();
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
    if (guard.current?.consume()) spotlight.current?.stop();
    else spotlight.current?.start();
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
