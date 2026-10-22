import { afterAll, beforeEach, expect, mock, test } from "bun:test";
import { PUSH_OWNER_KEY } from "./push-device";

// The browser's side of a device's subscription, against a stand-in browser: who may keep it.

const removed: string[] = [];
const saved: string[] = [];
const restored: {
  endpoint: string;
  keys: { p256dh: string; auth: string };
  viewer: { member: string; session: string };
}[] = [];
// What the action finds: the account lists the device, saves it, or is full. `hold` keeps it
// waiting, as when the backend is slow.
let outcome: "listed" | "saved" | "full" = "listed";
let hold: Promise<void> | null = null;
mock.module("@/lib/push-actions", () => ({
  restorePushSubscription: async (
    subscription: { endpoint: string; keys: { p256dh: string; auth: string } },
    _userAgent: string,
    viewer: { member: string; session: string },
  ) => {
    restored.push({ ...subscription, viewer });
    await hold;
    return { ok: true, result: outcome };
  },
  removePushSubscription: async (endpoint: string) => {
    removed.push(endpoint);
    return { ok: true };
  },
  savePushSubscription: async (subscription: { endpoint: string }) => {
    saved.push(subscription.endpoint);
    return { ok: true };
  },
}));
const { heldSubscription, turnOffPush, turnOnPush } = await import(
  "./push-client"
);

// base64url of the bytes 4, 1, 2 and of 4, 9, 9.
const SESSION = "10";
const KEY = "BAEC";
const OTHER_KEY = "BAkJ";
const ENDPOINT = "https://fcm.googleapis.com/fcm/send/device";

const stored = new Map<string, string>();
let held: {
  endpoint: string;
  dropped: boolean;
  options: { applicationServerKey: ArrayBuffer };
  unsubscribe(): Promise<boolean>;
  toJSON(): { keys: Record<string, string> };
} | null = null;

function subscriptionFor(key: Uint8Array) {
  const subscription = {
    endpoint: ENDPOINT,
    dropped: false,
    options: { applicationServerKey: key.slice().buffer },
    unsubscribe: async () => {
      subscription.dropped = true;
      held = null;
      return true;
    },
    toJSON: () => ({ keys: { p256dh: "p", auth: "a" } }),
  };
  return subscription;
}

const globals = globalThis as Record<string, unknown>;
const before = {
  localStorage: globals.localStorage,
  navigator: globals.navigator,
  Notification: globals.Notification,
  window: globals.window,
};
// What the page is told when pushes change here.
const told: string[] = [];
globals.window = {
  dispatchEvent: (event: Event) => told.push(event.type),
};
globals.localStorage = {
  getItem: (key: string) => stored.get(key) ?? null,
  setItem: (key: string, value: string) => stored.set(key, value),
  removeItem: (key: string) => stored.delete(key),
};
Object.defineProperty(globalThis, "navigator", {
  configurable: true,
  value: {
    userAgent: "Test browser",
    serviceWorker: {
      ready: Promise.resolve({
        pushManager: {
          getSubscription: async () => held,
          subscribe: async (options: { applicationServerKey: Uint8Array }) => {
            held = subscriptionFor(options.applicationServerKey);
            return held;
          },
        },
      }),
    },
  },
});
globals.Notification = { requestPermission: async () => "granted" };
afterAll(() => {
  globals.localStorage = before.localStorage;
  Object.defineProperty(globalThis, "navigator", {
    configurable: true,
    value: before.navigator,
  });
  globals.Notification = before.Notification;
  globals.window = before.window;
});

beforeEach(() => {
  stored.clear();
  removed.length = 0;
  saved.length = 0;
  restored.length = 0;
  outcome = "listed";
  hold = null;
  told.length = 0;
  held = null;
});

test("turning on records the member, who keeps the subscription on every page", async () => {
  expect(await turnOnPush(KEY, "7", SESSION)).toEqual({ ok: true });
  expect(saved).toEqual([ENDPOINT]);
  expect(stored.get(PUSH_OWNER_KEY)).toBe("7");
  // The cards read the subscription again.
  expect(told).toEqual(["sermo-push-change"]);
  expect((await heldSubscription("7", KEY))?.endpoint).toBe(ENDPOINT);
  expect(removed).toEqual([]);
});

test("a guest on a browser whose member's session ended lets the subscription go", async () => {
  await turnOnPush(KEY, "7", SESSION);
  const subscription = held;
  expect(await heldSubscription(null, KEY)).toBeNull();
  expect(subscription?.dropped).toBe(true);
  expect(stored.has(PUSH_OWNER_KEY)).toBe(false);
  // A guest has no account to remove it from: the push service refuses the next send instead.
  expect(removed).toEqual([]);
});

test("another member signing in on the browser does not get the first member's alerts", async () => {
  await turnOnPush(KEY, "7", SESSION);
  const subscription = held;
  expect(await heldSubscription("8", KEY)).toBeNull();
  expect(subscription?.dropped).toBe(true);
  // Their own account is asked to forget it too (it has no such row; the first member's goes on
  // the next send).
  expect(removed).toEqual([ENDPOINT]);
  // They are offered pushes for themselves, which records them.
  expect(await turnOnPush(KEY, "8", SESSION)).toEqual({ ok: true });
  expect(stored.get(PUSH_OWNER_KEY)).toBe("8");
});

test("a subscription made for an old key is let go and removed from the account", async () => {
  await turnOnPush(OTHER_KEY, "7", SESSION);
  const subscription = held;
  expect(await heldSubscription("7", KEY)).toBeNull();
  expect(subscription?.dropped).toBe(true);
  expect(removed).toEqual([ENDPOINT]);
});

test("when the forum's key could not be read, the member's subscription is kept", async () => {
  await turnOnPush(OTHER_KEY, "7", SESSION);
  expect(await heldSubscription("7", null)).not.toBeNull();
});

test("a subscription no member is recorded for is let go", async () => {
  held = subscriptionFor(new Uint8Array([4, 1, 2]));
  expect(await heldSubscription("7", KEY)).toBeNull();
});

test("turning off forgets the member", async () => {
  await turnOnPush(KEY, "7", SESSION);
  expect(await turnOffPush()).toEqual({ ok: true });
  expect(stored.has(PUSH_OWNER_KEY)).toBe(false);
  expect(told).toEqual(["sermo-push-change", "sermo-push-change"]);
  expect(removed).toEqual([ENDPOINT]);
});

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

test("the same session as the last save asks nothing, so a device removed on purpose stays removed", async () => {
  await turnOnPush(KEY, "7", SESSION);
  told.length = 0;
  // The account does not list it (another device removed it), but the session is the one it was
  // saved under: no request, nothing saved.
  outcome = "saved";
  expect((await heldSubscription("7", KEY, SESSION))?.endpoint).toBe(ENDPOINT);
  await flush();
  expect(restored).toEqual([]);
  expect(told).toEqual([]);
});

test("a new session checks the account once, saves a lost device and tells the cards", async () => {
  await turnOnPush(KEY, "7", SESSION);
  told.length = 0;
  outcome = "saved";
  await heldSubscription("7", KEY, "11");
  await flush();
  expect(restored).toEqual([
    {
      endpoint: ENDPOINT,
      keys: { p256dh: "p", auth: "a" },
      viewer: { member: "7", session: "11" },
    },
  ]);
  expect(told).toEqual(["sermo-push-change"]);
  expect(stored.get("sermo-push-session")).toBe("11");
  // Recorded: the next page of this session asks nothing.
  await heldSubscription("7", KEY, "11");
  await flush();
  expect(restored).toHaveLength(1);
});

test("a device the account still lists is recorded under the new session, with no redraw", async () => {
  await turnOnPush(KEY, "7", SESSION);
  told.length = 0;
  await heldSubscription("7", KEY, "11");
  await flush();
  expect(restored).toHaveLength(1);
  expect(told).toEqual([]);
  expect(stored.get("sermo-push-session")).toBe("11");
});

test("a browser from before the session was kept is checked once", async () => {
  held = subscriptionFor(new Uint8Array([4, 1, 2]));
  stored.set(PUSH_OWNER_KEY, "7");
  await heldSubscription("7", KEY, SESSION);
  await flush();
  expect(restored).toHaveLength(1);
  expect(stored.get("sermo-push-session")).toBe(SESSION);
  await heldSubscription("7", KEY, SESSION);
  await flush();
  expect(restored).toHaveLength(1);
});

test("an account at its device limit is left as it is, and asked again only in a later session", async () => {
  await turnOnPush(KEY, "7", SESSION);
  told.length = 0;
  outcome = "full";
  await heldSubscription("7", KEY, "11");
  await flush();
  expect(restored).toHaveLength(1);
  expect(told).toEqual([]);
  expect(stored.get("sermo-push-session")).toBe("11");
  // Every later page of this session asks nothing.
  await heldSubscription("7", KEY, "11");
  await flush();
  expect(restored).toHaveLength(1);
  await heldSubscription("7", KEY, "12");
  await flush();
  expect(restored).toHaveLength(2);
});

test("turning off while the restore waits leaves no row behind", async () => {
  await turnOnPush(KEY, "7", SESSION);
  outcome = "saved";
  let release = () => {};
  hold = new Promise<void>((resolve) => {
    release = resolve;
  });
  await heldSubscription("7", KEY, "11");
  await flush();
  expect(await turnOffPush()).toEqual({ ok: true });
  removed.length = 0;
  release();
  await flush();
  expect(removed).toEqual([ENDPOINT]);
  expect(stored.has(PUSH_OWNER_KEY)).toBe(false);
  expect(stored.has("sermo-push-session")).toBe(false);
});

test("turning off while a listed device is tied to the new session leaves no row behind", async () => {
  await turnOnPush(KEY, "7", SESSION);
  outcome = "listed";
  let release = () => {};
  hold = new Promise<void>((resolve) => {
    release = resolve;
  });
  await heldSubscription("7", KEY, "11");
  await flush();
  expect(await turnOffPush()).toEqual({ ok: true });
  removed.length = 0;
  release();
  await flush();
  expect(removed).toEqual([ENDPOINT]);
  expect(stored.has("sermo-push-session")).toBe(false);
});

test("a page with nothing to restore asks nothing", async () => {
  await turnOnPush(KEY, "7", SESSION);
  await heldSubscription("7", KEY, null);
  await heldSubscription("7", null, "11");
  await flush();
  expect(restored).toEqual([]);
});

test("a subscription that is let go, or a guest's page, is never saved again", async () => {
  await turnOnPush(KEY, "7", SESSION);
  restored.length = 0;
  expect(await heldSubscription("8", KEY, "11")).toBeNull();
  expect(restored).toEqual([]);
  await turnOnPush(KEY, "7", SESSION);
  expect(await heldSubscription(null, KEY, "11")).toBeNull();
  expect(restored).toEqual([]);
  await turnOnPush(OTHER_KEY, "7", SESSION);
  expect(await heldSubscription("7", KEY, "11")).toBeNull();
  expect(restored).toEqual([]);
});
