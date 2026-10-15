// Replaying the key that asked for a menu on the menu's real trigger, so that Base UI does what it
// does for a keyboard open (focus the first item, or the last for ArrowUp). Plain code with the
// element and the event maker handed in, so it can be tested without a browser.

export type Replay = "click" | "ArrowDown" | "ArrowUp";

type Replayable = {
  focus(): void;
  click(): void;
  dispatchEvent(event: unknown): unknown;
};

const keydown = (key: string) =>
  new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true });

// A replay that runs once. React runs a new component's effects twice in development (Strict Mode)
// and again when a hidden subtree is shown (Activity): a second click on a menu that is already
// open would close it, and a second arrow would move the highlight.
export function replayOnce(makeKey: (key: string) => unknown = keydown) {
  let done = false;
  return (element: Replayable | null, replay: Replay | null) => {
    if (done || !replay || !element) return;
    done = true;
    element.focus();
    if (replay === "click") element.click();
    else element.dispatchEvent(makeKey(replay));
  };
}
