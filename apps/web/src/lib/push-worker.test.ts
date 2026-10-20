import { expect, test } from "bun:test";
import {
  NOTIFICATION_BADGE,
  NOTIFICATION_ICON,
  notificationOf,
  openTarget,
  pickWindow,
  readPush,
  renewSubscription,
  type SubscriptionLike,
  targetUrl,
  type WindowLike,
} from "./push-worker";

const ORIGIN = "https://forum.test";

test("a push is read as the backend writes it, and anything else is no message", () => {
  const sent = {
    title: "Ana replied",
    body: "The first words",
    url: `${ORIGIN}/threads/4-topic#post-9`,
    tag: "thread:4",
  };
  expect(readPush(JSON.stringify(sent))).toEqual(sent);
  expect(readPush(JSON.stringify({ title: "Only a title" }))).toEqual({
    title: "Only a title",
    body: "",
    url: "",
    tag: "",
  });
  for (const text of [null, "", "not json", "null", "[]", '{"body":"x"}'])
    expect(readPush(text)).toBeNull();
});

test("the notification carries the icon, the badge, the group's tag and the address", () => {
  const shown = notificationOf(
    { title: "T", body: "B", url: `${ORIGIN}/x`, tag: "thread:4" },
    ORIGIN,
  );
  expect(shown).toEqual({
    title: "T",
    options: {
      body: "B",
      icon: NOTIFICATION_ICON,
      badge: NOTIFICATION_BADGE,
      tag: "thread:4",
      renotify: true,
      data: { url: `${ORIGIN}/x` },
    },
  });
  // Without a tag there is nothing to renotify.
  const untagged = notificationOf(
    { title: "T", body: "", url: "", tag: "" },
    ORIGIN,
  );
  expect(untagged.options.tag).toBeUndefined();
  expect(untagged.options.renotify).toBeUndefined();
});

test("a push that cannot be read still shows a notification, leading to the alerts", () => {
  const shown = notificationOf(null, ORIGIN);
  expect(shown.title).toBe("forum.test");
  expect(targetUrl(shown.options.data.url, ORIGIN)).toBe(
    `${ORIGIN}/notifications`,
  );
});

test("the address of a tap is the item's as the push carries it, or the home page when it is not the site's", () => {
  // Whatever form the item's address takes (a permalink, an anchor, a query), it is kept as it is.
  for (const path of [
    "/posts/9",
    "/conversations/messages/12",
    "/members/3?post=5&comment=7#profile-comment-7",
    "/threads/4-topic?page=3#post-9",
  ]) {
    expect(targetUrl(`${ORIGIN}${path}`, ORIGIN)).toBe(`${ORIGIN}${path}`);
    expect(targetUrl(path, ORIGIN)).toBe(`${ORIGIN}${path}`);
  }
  // Another origin, a backend that fell back to a local base address, or no address of the web.
  for (const raw of [
    "https://elsewhere.test/page",
    "http://localhost:3000/posts/9",
    "http://forum.test/posts/9",
    "//elsewhere.test/page",
    undefined,
    null,
    "",
    5,
    "javascript:alert(1)",
    "http://[",
  ])
    expect(targetUrl(raw, ORIGIN)).toBe(`${ORIGIN}/`);
});

type Fake = WindowLike & { name: string; moved: string[] };

function fakeWindow(
  name: string,
  state: Partial<Pick<WindowLike, "focused" | "visibilityState">> = {},
  controlled = true,
): Fake {
  const client: Fake = {
    name,
    moved: [],
    focused: state.focused ?? false,
    visibilityState: state.visibilityState ?? "hidden",
    focus: async () => client,
    navigate: async (url) => {
      // A window the worker does not control cannot be moved.
      if (!controlled) throw new TypeError("not controlled");
      client.moved.push(url);
      return client;
    },
  };
  return client;
}

test("a tap goes to the window in front, else one showing, else any", () => {
  const hidden = fakeWindow("hidden");
  const visible = fakeWindow("visible", { visibilityState: "visible" });
  const front = fakeWindow("front", {
    focused: true,
    visibilityState: "visible",
  });
  expect(pickWindow([hidden, visible, front])?.name).toBe("front");
  expect(pickWindow([hidden, visible])?.name).toBe("visible");
  // A phone that was locked or showing another app: every window is hidden.
  expect(pickWindow([hidden])?.name).toBe("hidden");
  expect(pickWindow([])).toBeNull();
});

function scopeWith(windows: Fake[]) {
  const opened: string[] = [];
  return {
    opened,
    scope: {
      origin: ORIGIN,
      windows: async () => windows,
      openWindow: async (url: string) => {
        opened.push(url);
        return null;
      },
    },
  };
}

test("a tap moves an open window of the site to the item, and opens none", async () => {
  const open = fakeWindow("open", { visibilityState: "visible" });
  const { opened, scope } = scopeWith([open]);
  await openTarget(`${ORIGIN}/threads/4#post-9`, scope);
  expect(open.moved).toEqual([`${ORIGIN}/threads/4#post-9`]);
  expect(opened).toEqual([]);
});

test("with no window of the site, a tap opens one at the item (the app's own when installed)", async () => {
  const { opened, scope } = scopeWith([]);
  await openTarget(`${ORIGIN}/members/3#profile-post-5`, scope);
  expect(opened).toEqual([`${ORIGIN}/members/3#profile-post-5`]);
});

test("with only hidden windows of the site, a tap moves one rather than opening a tab each time", async () => {
  const hidden = fakeWindow("hidden");
  const { opened, scope } = scopeWith([hidden]);
  await openTarget(`${ORIGIN}/threads/4`, scope);
  expect(hidden.moved).toEqual([`${ORIGIN}/threads/4`]);
  expect(opened).toEqual([]);
});

test("a window the worker cannot move is left, and a new one opens", async () => {
  const stranger = fakeWindow("stranger", { focused: true }, false);
  const { opened, scope } = scopeWith([stranger]);
  await openTarget(`${ORIGIN}/threads/4`, scope);
  expect(opened).toEqual([`${ORIGIN}/threads/4`]);
});

test("an address elsewhere is never opened: the tap goes to the site's home", async () => {
  const open = fakeWindow("open", { focused: true });
  const { opened, scope } = scopeWith([open]);
  await openTarget("https://elsewhere.test/page", scope);
  expect(open.moved).toEqual([`${ORIGIN}/`]);
  expect(opened).toEqual([]);
  const none = scopeWith([]);
  await openTarget("http://localhost:3000/posts/9", none.scope);
  expect(none.opened).toEqual([`${ORIGIN}/`]);
});

const KEY = new Uint8Array([4, 1, 2]).buffer;

function fakeSubscription(endpoint: string, key: ArrayBuffer | null = KEY) {
  const subscription: SubscriptionLike & { dropped: boolean } = {
    endpoint,
    dropped: false,
    options: { applicationServerKey: key },
    toJSON: () => ({
      keys: { p256dh: `p-${endpoint}`, auth: `a-${endpoint}` },
    }),
    unsubscribe: async () => {
      subscription.dropped = true;
      return true;
    },
  };
  return subscription;
}

function renewScope(answer: { ok: boolean } | "offline" = { ok: true }) {
  const sent: unknown[] = [];
  const keys: ArrayBuffer[] = [];
  const made: ReturnType<typeof fakeSubscription>[] = [];
  return {
    sent,
    keys,
    made,
    scope: {
      subscribe: async (key: ArrayBuffer) => {
        keys.push(key);
        const next = fakeSubscription("https://push.test/again");
        made.push(next);
        return next;
      },
      send: async (body: string) => {
        sent.push(JSON.parse(body));
        if (answer === "offline") throw new TypeError("offline");
        return answer;
      },
    },
  };
}

test("a subscription the browser dropped is made again with its key and handed to the account", async () => {
  const old = fakeSubscription("https://push.test/old");
  const { sent, keys, made, scope } = renewScope();
  await renewSubscription(
    { oldSubscription: old, newSubscription: null },
    scope,
  );
  expect(keys).toEqual([KEY]);
  expect(sent).toEqual([
    {
      previous: "https://push.test/old",
      endpoint: "https://push.test/again",
      keys: {
        p256dh: "p-https://push.test/again",
        auth: "a-https://push.test/again",
      },
    },
  ]);
  expect(made[0].dropped).toBe(false);
});

test("a subscription the browser replaced is handed over as it is", async () => {
  const replaced = fakeSubscription("https://push.test/new");
  const { sent, keys, scope } = renewScope();
  await renewSubscription(
    { oldSubscription: null, newSubscription: replaced },
    scope,
  );
  expect(keys).toEqual([]);
  expect(sent).toEqual([
    {
      previous: null,
      endpoint: "https://push.test/new",
      keys: {
        p256dh: "p-https://push.test/new",
        auth: "a-https://push.test/new",
      },
    },
  ]);
});

test("a renewal the account refuses is taken back; one that could not be sent is kept", async () => {
  const refused = renewScope({ ok: false });
  await renewSubscription(
    {
      oldSubscription: fakeSubscription("https://push.test/old"),
      newSubscription: null,
    },
    refused.scope,
  );
  expect(refused.made[0].dropped).toBe(true);
  const offline = renewScope("offline");
  await renewSubscription(
    {
      oldSubscription: fakeSubscription("https://push.test/old"),
      newSubscription: null,
    },
    offline.scope,
  );
  expect(offline.made[0].dropped).toBe(false);
});

test("without the old key nothing is made: the page offers pushes again", async () => {
  const { sent, made, scope } = renewScope();
  await renewSubscription(
    { oldSubscription: null, newSubscription: null },
    scope,
  );
  await renewSubscription(
    {
      oldSubscription: fakeSubscription("https://push.test/old", null),
      newSubscription: null,
    },
    scope,
  );
  expect(made).toEqual([]);
  expect(sent).toEqual([]);
});
