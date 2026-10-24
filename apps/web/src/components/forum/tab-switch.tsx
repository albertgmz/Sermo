"use client";

import { type ReactNode, useCallback, useEffect, useMemo, useRef } from "react";
import { placeOfSearch, pushedSearch } from "@/components/forum/places";
import {
  type Registered,
  SwitchContext,
  type Switching,
  switches,
} from "@/components/forum/tab-switch-context";
import { usePlaceSwitch } from "@/components/forum/use-place-switch";
import { cn } from "@/lib/utils";

// TabSwitch: the part of a screen that its tabs, or its filters, change in place: the tab bar and
// the panel under it, drawn on the server as one. It owns some parameters of the address (`params`:
// `tab` on a profile, the tab and the filters on the feed). A press on a link to this same page that
// names other values for them, or a form sent to this page that does, puts that address in the
// history and asks `load` for the part as that address draws it; the rest of the screen (the header,
// the side column, the scroll position, a text being typed elsewhere) stays as it is, the tab pressed
// shows as the open one at once and the panel waits dimmed until all of the new one has arrived.
// Back and Forward show what their address names the same way. Links and forms stay plain: a press
// with a modifier key, or a browser without scripts, opens them as pages. The links to this page
// that change nothing the switch owns (a list's own place, an anchor) are left as they are.
//
// Props
//   place   What the server drew, as `placeOfQuery(query, params)` reads it.
//   params  The parameters of the address the switch owns.
//   stamp   Which draw of the screen the children are from (`Date.now()` where it is drawn).
//   load    The part as the address with that search draws it; null when there is nothing to show
//           in place (the address is then opened as a page of its own).
//
// Inside, an element with `data-switch-panel` is what dims while the next part is on its way, and
// one with `data-switch-title` names the part where the page's title does (a tab with a title of
// its own): the title follows it.

// A link or a form to this page: the address it opens, or null for anything else (another page,
// a new tab, a download).
function sameScreen(href: string) {
  const url = new URL(href, location.href);
  if (url.origin !== location.origin || url.pathname !== location.pathname)
    return null;
  return url;
}

// The name of the part shown, where it has one of its own (`data-switch-title`).
function titleOf(node: HTMLElement | null) {
  return (
    node
      ?.querySelector("[data-switch-title]")
      ?.getAttribute("data-switch-title") ?? null
  );
}

// What comes once a part is on screen (`arriveAt`) is fetched with the first press, in step with
// the part itself: the part is not shown before it is there.
let arriveAt: typeof import("@/components/forum/tab-switch-arrive").arriveAt;
const loadArrive = () =>
  import("@/components/forum/tab-switch-arrive").then((found) => {
    arriveAt = found.arriveAt;
  });

export function TabSwitch({
  place,
  params,
  stamp,
  load,
  children,
  className,
}: {
  place: string;
  params: string[];
  stamp: number;
  load: (search: string) => Promise<ReactNode | null>;
  children: ReactNode;
  className?: string;
}) {
  // The names, not the array the server sent, are what the switch owns.
  const key = params.join("&");
  // biome-ignore lint/correctness/useExhaustiveDependencies: the names, not the array, matter
  const owned = useMemo(() => [...params], [key]);
  const placeOf = useCallback(
    (search: string) => placeOfSearch(search, owned),
    [owned],
  );
  const loadPlace = useCallback(
    async (_place: string, search: string) =>
      (await Promise.all([load(search), loadArrive()]))[0],
    [load],
  );
  // The link pressed, which keeps the keyboard when the part drawn anew replaces it.
  const pressed = useRef<string | null>(null);
  const box = useRef<HTMLDivElement>(null);
  // The page's title as the server drew it, and the name of the part in it.
  const titled = useRef<{ title: string; part: string } | null>(null);
  useEffect(() => {
    const part = titleOf(box.current);
    if (part) titled.current = { title: document.title, part };
  }, []);
  const switched = usePlaceSwitch({
    box,
    place,
    stamp,
    load: loadPlace,
    placeOf,
    arrive: (node) => {
      const href = pressed.current;
      pressed.current = null;
      arriveAt?.(node, href, titleOf(node), titled.current);
    },
    pushed: (url) =>
      `${location.pathname}${pushedSearch(
        url.search,
        location.search,
        [...switches]
          .filter((other) => other.params !== owned)
          .map((other) => other.params),
      )}${url.hash}`,
  });

  // Known to the links outside it (`goInPlace`) and to the other switches, which keep what it shows.
  const { go, showing } = switched;
  useEffect(() => {
    const entry: Registered = {
      params: owned,
      differs: (search) => placeOf(search) !== showing(),
      go,
    };
    switches.add(entry);
    return () => {
      switches.delete(entry);
    };
  }, [owned, placeOf, go, showing]);

  const context = useMemo<Switching>(
    () => ({
      pending: switched.pending,
      placeOf,
      go: switched.go,
      reload: switched.reload,
    }),
    [switched.pending, placeOf, switched.go, switched.reload],
  );

  // Before the link's own handler, which would open the address as a page.
  function onClickCapture(event: React.MouseEvent<HTMLDivElement>) {
    if (event.defaultPrevented || event.button !== 0) return;
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey)
      return;
    const link = (event.target as Element).closest<HTMLAnchorElement>(
      "a[href]",
    );
    if (!link || link.target || link.hasAttribute("download")) return;
    // A list's "Load more" puts its next page under the rows it holds, whatever the address names.
    if (link.closest("[data-list-more]")) return;
    const url = sameScreen(link.href);
    if (!url || placeOf(url.search) === switched.showing()) return;
    event.preventDefault();
    pressed.current = link.getAttribute("href");
    switched.go(url.href);
  }

  // A form that asks this page for something the switch owns (a search box, a month).
  function onSubmitCapture(event: React.FormEvent<HTMLDivElement>) {
    const form = event.target as HTMLFormElement;
    const native = event.nativeEvent as SubmitEvent;
    const submitter = native.submitter as HTMLButtonElement | null;
    const method = (
      submitter?.getAttribute("formmethod") ?? form.getAttribute("method")
    )?.toLowerCase();
    if (event.defaultPrevented || (method && method !== "get")) return;
    const url = sameScreen(
      submitter?.hasAttribute("formaction")
        ? submitter.formAction
        : form.action,
    );
    if (!url) return;
    url.search = "";
    for (const [name, value] of new FormData(form, submitter))
      if (typeof value === "string") url.searchParams.append(name, value);
    if (placeOf(url.search) === switched.showing()) return;
    event.preventDefault();
    switched.go(url.href);
  }

  return (
    <SwitchContext value={context}>
      <div
        ref={box}
        aria-busy={switched.busy || undefined}
        onClickCapture={onClickCapture}
        onSubmitCapture={onSubmitCapture}
        className={cn(
          "scroll-mt-4 [&_[data-switch-panel]]:transition-opacity [&[aria-busy=true]_[data-switch-panel]]:opacity-60",
          className,
        )}
      >
        {switched.node ?? children}
      </div>
    </SwitchContext>
  );
}
