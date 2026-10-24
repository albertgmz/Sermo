"use client";

import {
  type ReactNode,
  type RefObject,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  useTransition,
} from "react";

// The core of a part of a screen that the address names (a page of posts, a tab, a filter) and that
// changes in place: `PageSwitch` (numbered pages) and `TabSwitch` (tabs and filters) are drawn on
// it. Its "place" is the part of the address it shows, as `placeOf` reads it from a search string.
// `go` puts a new address in the history (`pushState`, which Next follows) and asks `load` for what
// it names, drawn on the server; the rest of the screen stays as it is (no route skeleton, no
// redraw of the whole screen). Back and Forward show what their address names the same way. What
// comes in is shown in a transition: the old part stays on screen (`busy`) until every part of the
// new one has arrived, so no placeholder shows in between.
//
//   place    The place the server drew (the children of the switch).
//   stamp    Which draw of the screen the children are from: a new one (the server drew the
//            screen again) shows them instead of a place loaded here.
//   load     What a place names, drawn; null when there is nothing to show in place (the address
//            is then opened as a page of its own, which says what is the matter).
//   placeOf  The place a search string names. Stable (a module function or a memoised one).
//   arrive   Called once a place that came in (or the drawn one, gone back to) is on screen.
//   pushed   The address `go` writes for a place, from the one pressed. Default: as pressed.
//   box      The element the part is drawn in.

type Shown = { place: string; node: ReactNode };

export function usePlaceSwitch({
  place,
  stamp,
  load,
  placeOf,
  arrive,
  pushed = (url) => `${location.pathname}${url.search}${url.hash}`,
  box,
}: {
  place: string;
  stamp: number;
  load: (place: string, search: string) => Promise<ReactNode | null>;
  placeOf: (search: string) => string;
  arrive: (box: HTMLDivElement) => void;
  pushed?: (url: URL) => string;
  box: RefObject<HTMLDivElement | null>;
}) {
  const [shown, setShown] = useState<Shown | null>(null);
  const [busy, setBusy] = useState(false);
  // The place being asked for, until it is on screen.
  const [pending, setPending] = useState<string | null>(null);
  const [arriving, startTransition] = useTransition();
  // The place on screen, for the history listener; the newest request, so an answer that comes
  // after a later press is dropped; whether the next place drawn has just come in.
  const showing = useRef(place);
  showing.current = shown?.place ?? place;
  const asked = useRef(0);
  const arrived = useRef(false);
  const onArrive = useRef(arrive);
  onArrive.current = arrive;
  const addressOf = useRef(pushed);
  addressOf.current = pushed;

  // Before the first paint of a new draw, so a place loaded here is not shown over it for a frame.
  // biome-ignore lint/correctness/useExhaustiveDependencies: only a new draw of the screen resets
  useLayoutEffect(() => {
    asked.current += 1;
    setShown(null);
    setBusy(false);
    setPending(null);
  }, [stamp]);

  const show = useCallback(
    async (target: string, search: string) => {
      const ticket = ++asked.current;
      if (target === place) {
        arrived.current = true;
        startTransition(() => {
          setShown(null);
          setBusy(false);
          setPending(null);
        });
        return;
      }
      setBusy(true);
      setPending(target);
      let node: ReactNode | null = null;
      try {
        node = await load(target, search);
      } catch {
        node = null;
      }
      if (ticket !== asked.current) return;
      if (node === null) {
        // The address is already the place's: opened as a page of its own.
        location.reload();
        return;
      }
      arrived.current = true;
      startTransition(() => {
        setShown({ place: target, node });
        setBusy(false);
        setPending(null);
      });
    },
    [place, load],
  );

  // Back, Forward, and coming back to this screen from another: the address names the place.
  useEffect(() => {
    const path = location.pathname;
    const follow = () => {
      if (location.pathname !== path) return;
      const wanted = placeOf(location.search);
      if (wanted !== showing.current) void show(wanted, location.search);
    };
    follow();
    window.addEventListener("popstate", follow);
    return () => window.removeEventListener("popstate", follow);
  }, [placeOf, show]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: runs for each place shown
  useLayoutEffect(() => {
    const node = box.current;
    if (!arrived.current || !node) return;
    arrived.current = false;
    onArrive.current(node);
  }, [shown]);

  // Shows the place an address names; false when it is the place on screen (nothing is done).
  const go = useCallback(
    (href: string) => {
      const url = new URL(href, location.href);
      const target = placeOf(url.search);
      if (target === showing.current) return false;
      window.history.pushState(null, "", addressOf.current(url));
      void show(target, new URL(location.href).search);
      return true;
    },
    [placeOf, show],
  );
  const shownPlace = useCallback(() => showing.current, []);

  return {
    node: shown ? shown.node : null,
    showing: shownPlace,
    busy: busy || arriving,
    pending,
    go,
  };
}
