import { afterAll, beforeEach, expect, mock, test } from "bun:test";
import { PUSH_OWNER_KEY } from "./push-device";

// The browser's side of a device's subscription, against a stand-in browser: who may keep it.

const removed: string[] = [];
const saved: string[] = [];
mock.module("@/lib/push-actions", () => ({
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
});

beforeEach(() => {
  stored.clear();
  removed.length = 0;
  saved.length = 0;
  held = null;
});

test("turning on records the member, who keeps the subscription on every page", async () => {
  expect(await turnOnPush(KEY, "7")).toEqual({ ok: true });
  expect(saved).toEqual([ENDPOINT]);
  expect(stored.get(PUSH_OWNER_KEY)).toBe("7");
  expect((await heldSubscription("7", KEY))?.endpoint).toBe(ENDPOINT);
  expect(removed).toEqual([]);
});

test("a guest on a browser whose member's session ended lets the subscription go", async () => {
  await turnOnPush(KEY, "7");
  const subscription = held;
  expect(await heldSubscription(null, KEY)).toBeNull();
  expect(subscription?.dropped).toBe(true);
  expect(stored.has(PUSH_OWNER_KEY)).toBe(false);
  // A guest has no account to remove it from: the push service refuses the next send instead.
  expect(removed).toEqual([]);
});

test("another member signing in on the browser does not get the first member's alerts", async () => {
  await turnOnPush(KEY, "7");
  const subscription = held;
  expect(await heldSubscription("8", KEY)).toBeNull();
  expect(subscription?.dropped).toBe(true);
  // Their own account is asked to forget it too (it has no such row; the first member's goes on
  // the next send).
  expect(removed).toEqual([ENDPOINT]);
  // They are offered pushes for themselves, which records them.
  expect(await turnOnPush(KEY, "8")).toEqual({ ok: true });
  expect(stored.get(PUSH_OWNER_KEY)).toBe("8");
});

test("a subscription made for an old key is let go and removed from the account", async () => {
  await turnOnPush(OTHER_KEY, "7");
  const subscription = held;
  expect(await heldSubscription("7", KEY)).toBeNull();
  expect(subscription?.dropped).toBe(true);
  expect(removed).toEqual([ENDPOINT]);
});

test("when the forum's key could not be read, the member's subscription is kept", async () => {
  await turnOnPush(OTHER_KEY, "7");
  expect(await heldSubscription("7", null)).not.toBeNull();
});

test("a subscription no member is recorded for is let go", async () => {
  held = subscriptionFor(new Uint8Array([4, 1, 2]));
  expect(await heldSubscription("7", KEY)).toBeNull();
});

test("turning off forgets the member", async () => {
  await turnOnPush(KEY, "7");
  expect(await turnOffPush()).toEqual({ ok: true });
  expect(stored.has(PUSH_OWNER_KEY)).toBe(false);
  expect(removed).toEqual([ENDPOINT]);
});
