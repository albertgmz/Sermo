import { afterAll, afterEach, expect, mock, test } from "bun:test";
import type { ReactElement } from "react";

const link = { ...(await import("next/link")) };
const navigation = await import("next/navigation");
let refreshed = 0;
mock.module("next/navigation", () => ({
  useRouter: () => ({
    refresh: () => {
      refreshed += 1;
    },
  }),
}));
mock.module("next/link", () => ({ default: () => null }));
const marked: number[] = [];
mock.module("@/app/[locale]/(main)/notifications/actions", () => ({
  markOneRead: async (id: number) => {
    marked.push(id);
  },
}));

const { NotificationLink } = await import("./notification-link");

const realWindow = globalThis.window;
afterAll(() => {
  mock.module("next/link", () => link);
  mock.module("next/navigation", () => navigation);
});
afterEach(() => {
  globalThis.window = realWindow;
  marked.length = 0;
  refreshed = 0;
});

async function click(read: boolean, pathname: string, href = "/x") {
  globalThis.window = { location: { pathname } } as unknown as Window &
    typeof globalThis;
  const row = NotificationLink({
    id: 4,
    href,
    read,
    children: null,
  }) as ReactElement<{ onClick: () => void }>;
  row.props.onClick();
  await Promise.resolve();
  await Promise.resolve();
}

test("following an unread notification marks it and refreshes the route behind it", async () => {
  await click(false, "/notifications");
  expect(marked).toEqual([4]);
  expect(refreshed).toBe(1);
});

test("a thread page is not rendered again, which would count another view", async () => {
  await click(false, "/threads/9");
  expect(marked).toEqual([4]);
  expect(refreshed).toBe(0);
});

test("a notification that is already read is left alone", async () => {
  await click(true, "/notifications");
  expect(marked).toEqual([]);
  expect(refreshed).toBe(0);
});

test("an address outside the site opens in a new tab without the opener, and still marks read", async () => {
  const outside = NotificationLink({
    id: 4,
    href: "https://example.org/news",
    read: false,
    children: null,
  }) as ReactElement<{ target: string; rel: string; onClick: () => void }>;
  expect(outside.type).toBe("a");
  expect(outside.props.target).toBe("_blank");
  expect(outside.props.rel).toBe("noopener noreferrer");
  await click(false, "/notifications", "https://example.org/news");
  expect(marked).toEqual([4]);
  const inside = NotificationLink({
    id: 4,
    href: "/pages/rules",
    read: false,
    children: null,
  }) as ReactElement<{ target?: string }>;
  expect(inside.props.target).toBeUndefined();
});

test("an address a browser reads as another host is treated as outside the site", () => {
  for (const href of ["/\\evil.com", "//evil.com", "https://example.org/x"]) {
    const link = NotificationLink({
      id: 4,
      href,
      read: false,
      children: null,
    }) as ReactElement<{ target?: string }>;
    expect(link.type, href).toBe("a");
    expect(link.props.target, href).toBe("_blank");
  }
});
