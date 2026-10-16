import { afterAll, expect, mock, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { withIntl } from "@/lib/test-intl";

const navigation = { ...(await import("next/navigation")) };
mock.module("next/navigation", () => ({
  ...navigation,
  usePathname: () => "/",
}));
afterAll(() => {
  mock.module("next/navigation", () => navigation);
});

const { MobileNav } = await import("./mobile-nav");

const item = (id: number, title: string, builtin: string, href: string) => ({
  id,
  title,
  href,
  external: false,
  builtin,
  icon: null,
  iconPosition: "before" as const,
  iconNode: null,
  match: [],
  children: [],
});

// A member's bar: Home, Messages, Alerts, Profile.
const items = [
  item(1, "Home", "mobile.home", "/"),
  item(2, "Messages", "mobile.messages", "/conversations"),
  item(3, "Alerts", "mobile.alerts", "/notifications"),
  item(4, "Profile", "mobile.profile", "/members/1"),
];

const bar = (conversations: number, notifications: number) =>
  renderToStaticMarkup(
    withIntl(
      <MobileNav
        items={items}
        unread={{ conversations, notifications }}
        member
      />,
    ),
  );

// The markup of the entry that leads to `href`.
const entry = (html: string, href: string) =>
  new RegExp(`<a[^>]*href="${href}"[^>]*>(.*?)</a>`).exec(html)?.[1] ?? "";

test("Messages and Alerts show their unread counts as numbers, and say them to a screen reader", () => {
  const html = bar(2, 7);
  const messages = entry(html, "/conversations");
  expect(messages).toMatch(/data-slot="count-badge"[^>]*>2<\/span>/);
  expect(messages).toContain('<span class="sr-only">, 2 unread</span>');
  const alerts = entry(html, "/notifications");
  expect(alerts).toMatch(/data-slot="count-badge"[^>]*>7<\/span>/);
  expect(alerts).toContain('<span class="sr-only">, 7 unread</span>');
});

test("a count above 99 reads 99+", () => {
  const html = bar(0, 250);
  expect(entry(html, "/notifications")).toMatch(
    /data-slot="count-badge"[^>]*>99\+<\/span>/,
  );
});

test("nothing unread, no number; the other entries never carry one", () => {
  const html = bar(0, 0);
  expect(html).not.toContain("count-badge");
  expect(html).not.toContain("unread");
  const busy = bar(4, 4);
  expect(entry(busy, "/")).not.toContain("count-badge");
  expect(entry(busy, "/members/1")).not.toContain("count-badge");
});
