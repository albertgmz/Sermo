import { expect, test } from "bun:test";
import {
  NOTIFICATION_BADGE,
  NOTIFICATION_ICON,
  notificationOf,
  openTarget,
  pickWindow,
  readPush,
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

test("the address of a tap is the item's, or the alert list when it has none a window can open", () => {
  // Whatever form the item's address takes (an anchor, a permalink), it is kept as it is.
  expect(targetUrl(`${ORIGIN}/threads/4-topic#post-9`, ORIGIN)).toBe(
    `${ORIGIN}/threads/4-topic#post-9`,
  );
  expect(targetUrl("/conversations/messages/12", ORIGIN)).toBe(
    `${ORIGIN}/conversations/messages/12`,
  );
  expect(targetUrl("https://elsewhere.test/page", ORIGIN)).toBe(
    "https://elsewhere.test/page",
  );
  for (const raw of [undefined, null, "", 5, "javascript:alert(1)", "http://["])
    expect(targetUrl(raw, ORIGIN)).toBe(`${ORIGIN}/notifications`);
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

test("a tap goes to the window in front, else one showing, and never to one hidden", () => {
  const hidden = fakeWindow("hidden");
  const visible = fakeWindow("visible", { visibilityState: "visible" });
  const front = fakeWindow("front", {
    focused: true,
    visibilityState: "visible",
  });
  expect(pickWindow([hidden, visible, front])?.name).toBe("front");
  expect(pickWindow([hidden, visible])?.name).toBe("visible");
  // Hidden: a browser tab or the app, the worker cannot tell; a new window goes to the app.
  expect(pickWindow([hidden])).toBeNull();
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

test("with only hidden windows of the site, a tap opens a new one (the app's own when installed)", async () => {
  const hidden = fakeWindow("hidden");
  const { opened, scope } = scopeWith([hidden]);
  await openTarget(`${ORIGIN}/threads/4`, scope);
  expect(hidden.moved).toEqual([]);
  expect(opened).toEqual([`${ORIGIN}/threads/4`]);
});

test("a window the worker cannot move is left, and a new one opens", async () => {
  const stranger = fakeWindow("stranger", { focused: true }, false);
  const { opened, scope } = scopeWith([stranger]);
  await openTarget(`${ORIGIN}/threads/4`, scope);
  expect(opened).toEqual([`${ORIGIN}/threads/4`]);
});

test("an address elsewhere opens on its own and leaves the site's windows alone", async () => {
  const open = fakeWindow("open", { focused: true });
  const { opened, scope } = scopeWith([open]);
  await openTarget("https://elsewhere.test/page", scope);
  expect(open.moved).toEqual([]);
  expect(opened).toEqual(["https://elsewhere.test/page"]);
});
