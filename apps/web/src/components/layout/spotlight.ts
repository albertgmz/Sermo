// The logic behind the dimming of the page around the element an address names. It touches the
// browser only through `SpotlightEnv`, so a test drives it with a fake one.

// The elements an address can name: a thread post, a wall post, a wall comment, a message.
export const TARGET = /^#(?:post|profile-post|profile-comment|message)-\d+$/;

// How long to wait for an element that streams in after the page loads, and how often to look. A
// landing waits longer: the page that holds an item can take a while to stream on a slow line.
const WAIT_MS = 3000;
export const LANDING_WAIT_MS = 15000;
const POLL_MS = 100;
// How long the dimming stays when nobody does anything.
const SHOW_MS = 4000;
// How long a click on a link to the same page waits for the address to change.
const NAVIGATE_MS = 1000;
// A landed item is held in place while the page settles around it: until the reader acts, or once
// the document has loaded and nothing has moved it for HOLD_QUIET_MS, and never longer than
// HOLD_MAX_MS.
export const HOLD_QUIET_MS = 1500;
export const HOLD_MAX_MS = 10000;

export type Box = { top: number; left: number; width: number; height: number };

// Reads the rectangle's fields one by one. A real `DOMRect` keeps them as getters on its
// prototype, so spreading or copying it by keys yields an empty object; only plain numbers leave
// this function.
const measure = (element: SpotlightTarget): Box => {
  const rect = element.getBoundingClientRect();
  return {
    top: rect.top,
    left: rect.left,
    width: rect.width,
    height: rect.height,
  };
};

const sameBox = (a: Box, b: Box) =>
  a.top === b.top &&
  a.left === b.left &&
  a.width === b.width &&
  a.height === b.height;

export type SpotlightTarget = { getBoundingClientRect(): Box };

export type SpotlightEnv = {
  hash(): string;
  // The drawn element with this id (a copy of a page kept hidden does not count), or null.
  find(id: string): SpotlightTarget | null;
  // How far from the top of the window a landed element's top goes: under the sticky header, with
  // the element's own gap.
  landingTop(element: SpotlightTarget): number;
  // Listens for an event anywhere on the page; returns what stops listening.
  on(type: string, listener: () => void): () => void;
  // Runs `run` on every animation frame until cancelled.
  frames(run: () => void): () => void;
  // Runs `run` later; returns what cancels it.
  later(run: () => void, ms: number): () => void;
  // The page's scroll, which a landing holds (see `createScrollHolder`).
  scroll: HoldEnv;
  show(box: Box): void;
  hide(): void;
};

// Looks for an element that streams in after the page loads, every POLL_MS for up to `waitMs`,
// and hands it to `found` once it is there. Returns what stops the looking.
export function pollFor<T>(
  find: () => T | null,
  later: (run: () => void, ms: number) => () => void,
  found: (element: T) => void,
  waitMs = WAIT_MS,
) {
  let waited = 0;
  let cancel = () => {};
  const look = () => {
    const element = find();
    if (element) return found(element);
    if (waited >= waitMs) return;
    waited += POLL_MS;
    cancel = later(look, POLL_MS);
  };
  look();
  return () => cancel();
}

// What a person does to take the dimming, the waiting and the holding away.
export const DISMISSING = ["pointerdown", "keydown", "wheel", "touchstart"];

// Lands on the element an address names: its top goes just under the header at once (never a
// smooth scroll, whose end is reckoned before the page has settled) and is held there while
// pictures and late sections above it load, until the reader acts; the rest of the page is dimmed
// around it for a few seconds. A soft navigation to such an address starts at the top of the new
// page while the element streams in.
export function createSpotlight(env: SpotlightEnv) {
  const stops: (() => void)[] = [];
  const dimming: (() => void)[] = [];
  const holder = createScrollHolder(env.scroll);

  // Takes the dimming away; the page stays held.
  function undim() {
    for (const undo of dimming.splice(0)) undo();
    env.hide();
  }

  function stop() {
    for (const undo of stops.splice(0)) undo();
    holder.stop();
    undim();
  }

  // The scroll position that puts the element's top where a landing wants it.
  const wanted = (element: SpotlightTarget) => () =>
    env.scroll.scrollY() +
    element.getBoundingClientRect().top -
    env.landingTop(element);

  function land(element: SpotlightTarget) {
    holder.hold(wanted(element), {
      quietMs: HOLD_QUIET_MS,
      maxMs: HOLD_MAX_MS,
    });
    // Kept on the element while it is shown: content that shifts afterwards moves it.
    let shown = measure(element);
    env.show(shown);
    dimming.push(
      env.frames(() => {
        const now = measure(element);
        if (sameBox(now, shown)) return;
        shown = now;
        env.show(now);
      }),
    );
    dimming.push(env.later(undim, SHOW_MS));
  }

  // Lands on the element the address names, once it is on the page. `fromTop`: a navigation from
  // another page, which shows the new page from its top while the element is not drawn yet.
  function start(options: { fromTop?: boolean } = {}) {
    stop();
    const hash = env.hash();
    if (!TARGET.test(hash)) return;
    const id = hash.slice(1);
    for (const type of DISMISSING) stops.push(env.on(type, stop));
    if (options.fromTop && !env.find(id)) env.scroll.scrollTo(0);
    stops.push(pollFor(() => env.find(id), env.later, land, LANDING_WAIT_MS));
  }

  // A link to another place on this page was followed: starts once the address has changed.
  function startWhenHashIs(hash: string, onArrive?: () => void) {
    stop();
    let waited = 0;
    const look = () => {
      if (env.hash() === hash) {
        onArrive?.();
        return start();
      }
      if (waited >= NAVIGATE_MS) return;
      waited += 50;
      stops.push(env.later(look, 50));
    };
    look();
  }

  return { start, startWhenHashIs, stop };
}

// The kinds of page load the browser restores the scroll position for itself.
export const restoresScroll = (type: string | undefined) =>
  type === "reload" || type === "back_forward";

// Whether an arrival at an address starts the dimming. Which history entries were handled is
// remembered, because the order in which the router, the component and the page's `popstate`
// listener see a Back or Forward is not reliable. `key` is the history entry's key (the
// Navigation API); it stays the same through the router's `replaceState` and differs for every
// new navigation, even to an address already visited. `handled` holds `entryId(key, hash)` of the
// arrivals already seen. `navigationType` is the document load's type, given only when the
// component mounts. Answers "guard" when there is no key: the caller falls back to the traversal
// guard below.
export const entryId = (key: string, hash: string) => `${key}${hash}`;

export function decideArrival(arrival: {
  key: string | undefined;
  hash: string;
  handled: ReadonlySet<string>;
  navigationType?: string;
}): "start" | "skip" | "guard" {
  if (!TARGET.test(arrival.hash)) return "skip";
  if (restoresScroll(arrival.navigationType)) return "skip";
  if (arrival.key === undefined) return "guard";
  return arrival.handled.has(entryId(arrival.key, arrival.hash))
    ? "skip"
    : "start";
}

// The fallback where history entries have no key: tells a visit by history (Back, Forward)
// from a new navigation. A traversal is announced by
// `traversal()` before the address, the path or the query change in the page, or the component
// mounts again. `consume()` asks whether the change being handled is that traversal: every
// effect of the same commit gets the same answer, and the mark is gone by the next task. A link
// followed clears it (`reset()`), and one that no change follows is forgotten after a moment.
export function createTraversalGuard(
  later: (run: () => void, ms: number) => () => void,
) {
  let traversed = false;
  let cancel = () => {};
  const reset = () => {
    traversed = false;
    cancel();
  };
  return {
    traversal() {
      reset();
      traversed = true;
      cancel = later(reset, 1000);
    },
    consume() {
      const was = traversed;
      if (was) {
        cancel();
        cancel = later(reset, 0);
      }
      return was;
    },
    reset,
  };
}

// How long a returned-to entry keeps being put back at the scroll position the reader left. The
// browser (or the router) can jump to the address's element after the page is drawn, and the page
// can still be streaming and too short to scroll that far.
export const RESTORE_MS = 1000;

// The scroll position kept for each handled history entry, saved when the entry is left.
export function createScrollMemory(handled: ReadonlySet<string>) {
  const positions = new Map<string, number>();
  return {
    // Only entries whose arrival was handled are kept. (An entry whose address names no target
    // is never given here: see `createHistoryScroll`.)
    leave(id: string, y: number) {
      if (handled.has(id)) positions.set(id, y);
    },
    recall: (id: string) => positions.get(id),
  };
}

export type HoldEnv = {
  scrollY(): number;
  // The furthest the page can be scrolled right now.
  maxScrollY(): number;
  scrollTo(y: number): void;
  // Whether the document and its pictures have finished loading.
  loaded(): boolean;
  on(type: string, listener: () => void): () => void;
  frames(run: () => void): () => void;
  later(run: () => void, ms: number): () => void;
};

// Holds the page at a scroll position: at once, then every frame it moves the page back if
// something else did (the jump to an address, a picture or a section loading above), as far as
// the page is long enough. The reader's first action ends it, and so do the limits it is given:
// `forMs` in any case; `quietMs` once the document has loaded and nothing moved the page for that
// long; `maxMs` at the latest. A second hold replaces the first.
export function createScrollHolder(env: HoldEnv) {
  const stops: (() => void)[] = [];
  function stop() {
    for (const undo of stops.splice(0)) undo();
  }
  function hold(
    wanted: () => number,
    limits: { forMs?: number; quietMs?: number; maxMs?: number },
  ) {
    stop();
    for (const type of DISMISSING) stops.push(env.on(type, stop));
    let moved = false;
    const keep = () => {
      const to = Math.max(0, Math.min(wanted(), env.maxScrollY()));
      if (Math.abs(env.scrollY() - to) < 1) return;
      env.scrollTo(to);
      moved = true;
    };
    keep();
    stops.push(env.frames(keep));
    for (const ms of [limits.forMs, limits.maxMs])
      if (ms !== undefined) stops.push(env.later(stop, ms));
    const { quietMs } = limits;
    if (quietMs !== undefined) {
      moved = false;
      const check = () => {
        if (!moved && env.loaded()) return stop();
        moved = false;
        stops.push(env.later(check, quietMs));
      };
      stops.push(env.later(check, quietMs));
    }
  }
  return { hold, stop };
}

// Puts the page back at `y` on a return to a history entry, and holds it there for a moment.
export function createScrollRestorer(env: HoldEnv) {
  const holder = createScrollHolder(env);
  return {
    restore: (y: number) => holder.hold(() => y, { forMs: RESTORE_MS }),
    stop: holder.stop,
  };
}

// Sent on the window by a link that changed the address without a navigation: the hash it names.
export const HASH_LINK_EVENT = "sermo:hash-link";

// The history entry's scroll position, kept while an address that names a target is left and put
// back when it is returned to. Every other entry is left to the browser, which restores it itself.
export function createHistoryScroll(deps: {
  // The key of the current entry (the Navigation API), if there is one.
  key(): string | undefined;
  hash(): string;
  scrollY(): number;
  handled: ReadonlySet<string>;
  restore(y: number): void;
}) {
  const memory = createScrollMemory(deps.handled);
  return {
    // A navigation is about to leave the current entry; a replacement of it is not leaving.
    onNavigate(navigationType: string) {
      const key = deps.key();
      const hash = deps.hash();
      if (key === undefined || navigationType === "replace") return;
      if (!TARGET.test(hash)) return;
      memory.leave(entryId(key, hash), deps.scrollY());
    },
    // The entry now shown, before it is recorded as handled: a revisit is put back where it was.
    revisit() {
      const key = deps.key();
      const hash = deps.hash();
      if (key === undefined || !TARGET.test(hash)) return;
      const id = entryId(key, hash);
      if (!deps.handled.has(id)) return;
      const y = memory.recall(id);
      if (y !== undefined) deps.restore(y);
    },
  };
}
