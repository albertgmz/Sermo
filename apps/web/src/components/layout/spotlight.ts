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
        env.show(element.getBoundingClientRect());
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
    stops.push(
      env.on("resize", () => {
        if (settled) env.show(element.getBoundingClientRect());
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
  function startWhenHashIs(hash: string) {
    stop();
    let waited = 0;
    const look = () => {
      if (env.hash() === hash) return start();
      if (waited >= NAVIGATE_MS) return;
      waited += 50;
      stops.push(env.later(look, 50));
    };
    look();
  }

  return { start, startWhenHashIs, stop };
}
