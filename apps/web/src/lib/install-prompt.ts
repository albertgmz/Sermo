import { useSyncExternalStore } from "react";

// The browser's offer to install the forum (`beforeinstallprompt`: Chrome, Edge and Samsung
// Internet), kept for our own card and the account menu, and what happened to it. The browser sends
// the event once per page load, often before the page has hydrated, so it is caught as soon as this
// module runs. Holding it back (`preventDefault`) keeps the browser's own bar off the screen: the
// forum asks with its card, after the cookie banner, and not while "Not now" holds.

type InstallEvent = Event & {
  prompt(): Promise<{ outcome: "accepted" | "dismissed" }>;
};

export type InstallState = {
  // The browser has an install dialog ready.
  native: boolean;
  // The app was installed from this page.
  installed: boolean;
  // How many times the account menu asked for the install card.
  asked: number;
  // Whether this page has the cards (`AppPrompts`, in the forum's pages but not the panel's): the
  // iOS steps can be shown only there.
  host: boolean;
};

const NONE: InstallState = {
  native: false,
  installed: false,
  asked: 0,
  host: false,
};
let deferred: InstallEvent | null = null;
let state = NONE;
const listeners = new Set<() => void>();

function set(next: Partial<InstallState>) {
  state = { ...state, ...next };
  for (const listener of listeners) listener();
}

if (typeof window !== "undefined") {
  window.addEventListener("beforeinstallprompt", (event) => {
    event.preventDefault();
    deferred = event as InstallEvent;
    set({ native: true });
  });
  window.addEventListener("appinstalled", () => {
    deferred = null;
    set({ native: false, installed: true });
  });
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useInstallState() {
  return useSyncExternalStore(
    subscribe,
    () => state,
    () => NONE,
  );
}

// Opens the browser's install dialog. It can be opened once per event; the browser sends another on
// a later page load.
export async function promptInstall() {
  const event = deferred;
  if (!event) return null;
  deferred = null;
  set({ native: false });
  try {
    return (await event.prompt()).outcome;
  } catch {
    return null;
  }
}

// The cards say they are on the page, for as long as they are.
export function hostInstallCard() {
  set({ host: true });
  return () => set({ host: false });
}

// The account menu asks for the install card (the iOS steps), whatever "Not now" said.
export function askForInstallCard() {
  set({ asked: state.asked + 1 });
}
