// Runs `run` once the page has loaded and the browser has a moment to spare, so that what it does
// never competes with the page for its first paint: at the browser's next idle time, at the latest
// two seconds after the page's load, or, where there is no `requestIdleCallback` (Safari), shortly
// after the load. The answer cancels it.

export type IdleWindow = {
  document: { readyState: DocumentReadyState };
  addEventListener: (
    type: "load",
    run: () => void,
    options: { once: true },
  ) => void;
  removeEventListener: (type: "load", run: () => void) => void;
  requestIdleCallback?: (
    run: () => void,
    options?: { timeout: number },
  ) => number;
  cancelIdleCallback?: (id: number) => void;
  setTimeout: (run: () => void, delay: number) => number;
  clearTimeout: (id: number) => void;
};

export function whenIdle(run: () => void, view: IdleWindow = window) {
  let cancel = () => {};
  const idle = () => {
    if (view.requestIdleCallback && view.cancelIdleCallback) {
      const id = view.requestIdleCallback(run, { timeout: 2000 });
      cancel = () => view.cancelIdleCallback?.(id);
    } else {
      const id = view.setTimeout(run, 200);
      cancel = () => view.clearTimeout(id);
    }
  };
  if (view.document.readyState === "complete") idle();
  else {
    view.addEventListener("load", idle, { once: true });
    cancel = () => view.removeEventListener("load", idle);
  }
  return () => cancel();
}
