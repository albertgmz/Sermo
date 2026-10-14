"use client";

import { usePathname, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import {
  type Box,
  createSpotlight,
  createTraversalGuard,
  type SpotlightEnv,
  startsOnMount,
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

// History traversals are watched from the module, not from the component: the component can be
// hidden and shown again by a client-side Back (the router keeps pages it left), and then its own
// listeners and state are gone while the traversal is still the cause of what happens next.
const traversals = createTraversalGuard((run, ms) => {
  const timer = window.setTimeout(run, ms);
  return () => window.clearTimeout(timer);
});
if (typeof window !== "undefined") {
  window.addEventListener("popstate", () => traversals.traversal());
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
  // (a reload, or a visit by history of the document) or the component comes back by a traversal.
  useEffect(() => {
    const env = browserEnv(
      (next) => setBox(next),
      () => setBox(null),
    );
    const current = createSpotlight(env);
    spotlight.current = current;
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
    window.addEventListener("hashchange", onHashChange);
    document.addEventListener("click", onClick);
    const [entry] = performance.getEntriesByType("navigation");
    if (
      startsOnMount((entry as PerformanceNavigationTiming)?.type, traversals)
    ) {
      current.start();
    }
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
    if (traversals.consume()) spotlight.current?.stop();
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
