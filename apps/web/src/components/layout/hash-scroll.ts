import { DISMISSING, pollFor } from "@/components/layout/spotlight";

// Brings the element an address names into view once it is on the page. A section that streams in
// after the page loads is not there when the browser looks for it, so the browser stays at the top.

export type ScrollEnv = {
  hash(): string;
  find(
    id: string,
  ): { scrollIntoView(options: { block: "start" }): void } | null;
  // Whether the arrival is a visit by history inside the app (Back, Forward): the router puts the
  // reader back where they were.
  traversal(): boolean;
  // Listens for an event anywhere on the page; returns what stops listening.
  on(type: string, listener: () => void): () => void;
  // Runs `run` later; returns what cancels it.
  later(run: () => void, ms: number): () => void;
};

// The element id an address names: decoded when it can be, as written when it cannot.
function idOf(hash: string) {
  const raw = hash.slice(1);
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}

// Returns what cancels the wait. The wait also ends when the reader scrolls, touches or types.
export function scrollToHash(env: ScrollEnv) {
  const id = idOf(env.hash());
  if (!id || env.traversal()) return () => {};
  const stops: (() => void)[] = [];
  const stop = () => {
    for (const undo of stops.splice(0)) undo();
  };
  for (const type of DISMISSING) stops.push(env.on(type, stop));
  stops.push(
    pollFor(
      () => env.find(id),
      env.later,
      (element) => {
        element.scrollIntoView({ block: "start" });
        stop();
      },
    ),
  );
  return stop;
}

// The element with this id, once it is drawn. A section that streams in is first sent inside a
// hidden container and moved into place after: until then the id exists but the element has no
// box, and scrolling to it does nothing. A target must therefore draw a box of its own (not
// `display: contents`), or it is never found.
export function drawnById<T extends { getClientRects(): { length: number } }>(
  document: { getElementById(id: string): T | null },
  id: string,
) {
  const element = document.getElementById(id);
  return element && element.getClientRects().length > 0 ? element : null;
}
