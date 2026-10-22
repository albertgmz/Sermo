import { afterEach, expect, test } from "bun:test";
import { EARLY_INSTALL_KEY, installScript } from "./install-early";

// A window as far as the install offer needs one.
function fakeWindow() {
  const listeners = new Map<string, ((event: Event) => void)[]>();
  const window: Record<string, unknown> = {
    addEventListener: (type: string, listener: (event: Event) => void) =>
      listeners.set(type, [...(listeners.get(type) ?? []), listener]),
  };
  const fire = (type: string, event: object) => {
    for (const listener of listeners.get(type) ?? []) listener(event as Event);
  };
  return { window, fire };
}

function offer() {
  const calls = { prevented: 0, prompted: 0 };
  const event = {
    preventDefault: () => {
      calls.prevented += 1;
    },
    prompt: async () => {
      calls.prompted += 1;
      return { outcome: "accepted" as const };
    },
  };
  return { event, calls };
}

const original = Object.getOwnPropertyDescriptor(globalThis, "window");
afterEach(() => {
  if (original) Object.defineProperty(globalThis, "window", original);
  else Reflect.deleteProperty(globalThis, "window");
});

test("the script in the head holds an offer that comes before the page's scripts and keeps the browser's bar away", () => {
  const { window, fire } = fakeWindow();
  new Function("window", "addEventListener", installScript)(
    window,
    window.addEventListener,
  );
  const { event, calls } = offer();
  fire("beforeinstallprompt", event);
  expect(calls.prevented).toBe(1);
  expect(window[EARLY_INSTALL_KEY]).toBe(event);
});

test("an offer that came before the module loaded is the one it opens", async () => {
  const { window } = fakeWindow();
  const { event, calls } = offer();
  window[EARLY_INSTALL_KEY] = event;
  Object.assign(globalThis, { window });
  const { promptInstall } = await import("./install-prompt");
  expect(await promptInstall()).toBe("accepted");
  expect(calls.prompted).toBe(1);
  // It can be opened once.
  expect(await promptInstall()).toBeNull();
});
