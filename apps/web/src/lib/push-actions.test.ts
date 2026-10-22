import { beforeEach, expect, mock, test } from "bun:test";

// The action that puts a device back under the session a member now has: it saves the subscription
// (a listed one too, which moves its session link), never a new one past the device limit, and only
// for the member and session the page was drawn for.

const asked: { name: string; input: Record<string, unknown> }[] = [];
let items: { endpoint: string }[] = [];
let viewer: { id: number; sessionId: number | null } | null = {
  id: 7,
  sessionId: 11,
};
mock.module("@/lib/sermo/client", () => ({
  call: async (contract: { name: string }, input: Record<string, unknown>) => {
    asked.push({ name: contract.name, input });
    return contract.name === "push.list" ? { items } : { ok: true };
  },
}));
mock.module("@/lib/sermo/session", () => ({
  getViewer: async () => ({ user: viewer }),
}));
mock.module("@/lib/sermo/outcome", () => ({
  attemptInPlace: async (_to: string, run: () => Promise<unknown>) => {
    try {
      return { ok: true, value: await run() };
    } catch (error) {
      return { ok: false, error: String(error) };
    }
  },
}));
const { restorePushSubscription } = await import("./push-actions");

const device = {
  endpoint: "https://fcm.googleapis.com/fcm/send/abc",
  keys: { p256dh: "p", auth: "a" },
};
const page = { member: "7", session: "11" };
const names = () => asked.map((call) => call.name);
const devices = (count: number) =>
  Array.from({ length: count }, (_, at) => ({
    endpoint: `https://fcm.googleapis.com/fcm/send/other-${at}`,
  }));

beforeEach(() => {
  asked.length = 0;
  items = [];
  viewer = { id: 7, sessionId: 11 };
});

test("a device the account no longer lists is saved again", async () => {
  items = devices(1);
  expect(await restorePushSubscription(device, "Agent", page)).toEqual({
    ok: true,
    result: "saved",
  });
  expect(names()).toEqual(["push.list", "push.subscribe"]);
  expect(asked[1]?.input).toEqual({ ...device, userAgent: "Agent" });
});

test("a device the account lists is saved again, which ties it to this session, however the address is spelled", async () => {
  items = [{ endpoint: "https://fcm.googleapis.com/fcm/send/abc" }];
  expect(await restorePushSubscription(device, "Agent", page)).toEqual({
    ok: true,
    result: "listed",
  });
  expect(
    await restorePushSubscription(
      { ...device, endpoint: "https://FCM.googleapis.com:443/fcm/send/abc" },
      "Agent",
      page,
    ),
  ).toEqual({ ok: true, result: "listed" });
  expect(names()).toEqual([
    "push.list",
    "push.subscribe",
    "push.list",
    "push.subscribe",
  ]);
});

test("a listed device is saved at the device limit too: it updates its own row, it adds none", async () => {
  items = [{ endpoint: device.endpoint }, ...devices(9)];
  expect(await restorePushSubscription(device, "Agent", page)).toEqual({
    ok: true,
    result: "listed",
  });
  expect(names()).toEqual(["push.list", "push.subscribe"]);
});

test("at the device limit nothing is saved, so no other device is pushed out", async () => {
  items = devices(10);
  expect(await restorePushSubscription(device, "Agent", page)).toEqual({
    ok: true,
    result: "full",
  });
  expect(names()).toEqual(["push.list"]);
  items = devices(9);
  expect((await restorePushSubscription(device, "Agent", page)).ok).toBe(true);
  expect(names().at(-1)).toBe("push.subscribe");
});

test("another member or session than the page was drawn for asks the backend nothing", async () => {
  viewer = { id: 8, sessionId: 11 };
  expect((await restorePushSubscription(device, "Agent", page)).ok).toBe(false);
  viewer = { id: 7, sessionId: 12 };
  expect((await restorePushSubscription(device, "Agent", page)).ok).toBe(false);
  viewer = { id: 7, sessionId: null };
  expect((await restorePushSubscription(device, "Agent", page)).ok).toBe(false);
  expect(asked).toEqual([]);
});

test("a guest (the member was signed out since the page was drawn) asks the backend nothing", async () => {
  viewer = null;
  expect(await restorePushSubscription(device, "Agent", page)).toEqual({
    ok: false,
    error: "",
  });
  expect(asked).toEqual([]);
});
