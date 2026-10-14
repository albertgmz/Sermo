// Brings the element an address names into view once it is on the page. A section that streams in
// after the page loads is not there when the browser looks for it, so the browser stays at the top.

// How long to wait for the element, and how often to look.
const WAIT_MS = 3000;
const POLL_MS = 100;

export type ScrollEnv = {
  hash(): string;
  find(
    id: string,
  ): { scrollIntoView(options: { block: "start" }): void } | null;
  // Runs `run` later; returns what cancels it.
  later(run: () => void, ms: number): () => void;
};

// Returns what cancels the wait.
export function scrollToHash(env: ScrollEnv) {
  const id = decodeURIComponent(env.hash().slice(1));
  if (!id) return () => {};
  let waited = 0;
  let cancel = () => {};
  const look = () => {
    const element = env.find(id);
    if (element) return element.scrollIntoView({ block: "start" });
    if (waited >= WAIT_MS) return;
    waited += POLL_MS;
    cancel = env.later(look, POLL_MS);
  };
  look();
  return () => cancel();
}
