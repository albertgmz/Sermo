import { afterAll, expect, mock, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { withIntl } from "@/lib/test-intl";

let pathname = "/";
const navigation = { ...(await import("next/navigation")) };
mock.module("next/navigation", () => ({
  ...navigation,
  usePathname: () => pathname,
}));
afterAll(() => {
  mock.module("next/navigation", () => navigation);
});

const { MobileNav } = await import("./mobile-nav");
const { mobileItems, toNavItems } = await import("./nav");

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

// A member's bar: Home, What's new, Messages, Alerts.
const items = [
  item(1, "Home", "mobile.home", "/"),
  item(2, "What's new", "mobile.novedades", "/novedades"),
  item(3, "Messages", "mobile.messages", "/conversations"),
  item(4, "Alerts", "mobile.alerts", "/notifications"),
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

test("the number is anchored to the icon's right edge, so it never extends the icon box to the right", () => {
  const badge = /<span[^>]*data-slot="count-badge"[^>]*>/.exec(
    entry(bar(0, 5), "/notifications"),
  )?.[0];
  expect(badge).toContain("right-0");
  expect(badge).not.toMatch(/\bleft-/);
});

test("nothing unread, no number; the other entries never carry one", () => {
  const html = bar(0, 0);
  expect(html).not.toContain("count-badge");
  expect(html).not.toContain("unread");
  const busy = bar(4, 4);
  expect(entry(busy, "/")).not.toContain("count-badge");
  expect(entry(busy, "/novedades")).not.toContain("count-badge");
});

test("Messages wears the same envelope as the header's Messages button", () => {
  expect(entry(bar(0, 0), "/conversations")).toContain("lucide-mail");
});

// The bar as the layout builds it from the navigation the backend sends.
const shipped = (member: boolean) =>
  mobileItems(
    toNavItems(
      [
        ["Home", "mobile.home", "/"],
        ["What's new", "mobile.novedades", "/novedades"],
        ...(member
          ? [
              ["Messages", "mobile.messages", "/conversations"],
              ["Alerts", "mobile.alerts", "/notifications"],
            ]
          : [["Log in", "mobile.login", "/login"]]),
      ].map(([title, builtin, target], id) => ({
        id,
        title,
        target,
        builtin,
        icon: null,
        iconPosition: "before" as const,
        children: [],
      })),
    ),
  );

const drawn = (member: boolean, at = "/") => {
  pathname = at;
  try {
    return renderToStaticMarkup(
      withIntl(
        <MobileNav
          items={shipped(member)}
          unread={{ conversations: 0, notifications: 0 }}
          member={member}
        />,
      ),
    );
  } finally {
    pathname = "/";
  }
};

// The entries in the order drawn, the + as "+", and which one is current.
const order = (html: string) =>
  [...html.matchAll(/<a [^>]*href="([^"]+)"[^>]*>|aria-label="Create"/g)].map(
    ([whole, href]) => href ?? (whole.includes("Create") ? "+" : whole),
  );
const current = (html: string) =>
  [...html.matchAll(/<a ([^>]*)>/g)]
    .filter(([, attributes]) => attributes.includes('aria-current="page"'))
    .map(([, attributes]) => /href="([^"]+)"/.exec(attributes)?.[1]);

test("a member's bar is Home, What's new, +, Messages and Alerts; a guest's is Home, What's new, + and Log in", () => {
  expect(order(drawn(true))).toEqual([
    "/",
    "/novedades",
    "+",
    "/conversations",
    "/notifications",
  ]);
  const guest = order(drawn(false));
  expect(guest[0]).toBe("/");
  expect(guest[1]).toBe("/novedades");
  expect(guest.at(-1)).toBe("/login");
  expect(guest).toHaveLength(4);
  expect(drawn(true)).toContain("lucide-newspaper");
});

test("Home is current on the forum list, a forum and a thread; What's new on its own page", () => {
  for (const at of ["/", "/forums/3-garden", "/threads/1-a"])
    expect(current(drawn(true, at)), at).toEqual(["/"]);
  expect(current(drawn(true, "/novedades"))).toEqual(["/novedades"]);
  expect(current(drawn(false, "/novedades"))).toEqual(["/novedades"]);
  expect(current(drawn(true, "/members"))).toEqual([]);
});
