// The logic behind the dimming of the page around the element an address names. It touches the
// browser only through `SpotlightEnv`, so a test drives it with a fake one.

// The elements an address can name: a thread post, a wall post, a wall comment, a message.
export const TARGET = /^#(?:post|profile-post|profile-comment|message)-\d+$/;

// How long to wait for an element that streams in after the page loads, and how often to look.
const WAIT_MS = 3000;
const POLL_MS = 100;
// How long the dimming stays when nobody does anything.
const SHOW_MS = 4000;
// How long without a scroll counts as the end of the scroll that brought the element into view.
const SETTLE_MS = 150;
// How long a click on a link to the same page waits for the address to change.
const NAVIGATE_MS = 1000;

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

export type SpotlightTarget = {
  getBoundingClientRect(): Box;
  scrollIntoView(options: {
    block: "center";
    behavior: "smooth" | "auto";
  }): void;
};

export type SpotlightEnv = {
  hash(): string;
  find(id: string): SpotlightTarget | null;
  reducedMotion(): boolean;
  // Listens for an event anywhere on the page; returns what stops listening.
  on(type: string, listener: () => void): () => void;
  // Runs `run` on every animation frame until cancelled.
  frames(run: () => void): () => void;
  // Runs `run` later; returns what cancels it.
  later(run: () => void, ms: number): () => void;
  show(box: Box): void;
  hide(): void;
};

// What a person does to take the dimming away. A scroll does too, but only once the scroll that
// showed the element has ended.
const DISMISSING = ["pointerdown", "keydown", "wheel", "touchstart"];

export function createSpotlight(env: SpotlightEnv) {
  const stops: (() => void)[] = [];

  function stop() {
    for (const undo of stops.splice(0)) undo();
    env.hide();
  }

  function reveal(element: SpotlightTarget) {
    element.scrollIntoView({
      block: "center",
      behavior: env.reducedMotion() ? "auto" : "smooth",
    });
    for (const type of DISMISSING) stops.push(env.on(type, stop));
    let settled = false;
    let cancelSettle = () => {};
    const waitForSettle = () => {
      cancelSettle();
      cancelSettle = env.later(() => {
        settled = true;
        // Kept on the element while it is shown: content that shifts afterwards (late pictures,
        // a section that streams in) moves it.
        let shown = measure(element);
        env.show(shown);
        stops.push(
          env.frames(() => {
            const now = measure(element);
            if (sameBox(now, shown)) return;
            shown = now;
            env.show(now);
          }),
        );
        stops.push(env.later(stop, SHOW_MS));
      }, SETTLE_MS);
    };
    stops.push(() => cancelSettle());
    stops.push(
      env.on("scroll", () => {
        if (settled) stop();
        else waitForSettle();
      }),
    );
    waitForSettle();
  }

  // Dims the page around the element the address names, once it is on the page.
  function start() {
    stop();
    const hash = env.hash();
    if (!TARGET.test(hash)) return;
    const id = hash.slice(1);
    let waited = 0;
    const look = () => {
      const element = env.find(id);
      if (element) return reveal(element);
      if (waited >= WAIT_MS) return;
      waited += POLL_MS;
      stops.push(env.later(look, POLL_MS));
    };
    look();
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
