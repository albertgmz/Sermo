import { afterAll, expect, mock, test } from "bun:test";
import { readFileSync } from "node:fs";
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
const { hideClosedRegistration, mobileItems, toNavItems } = await import(
  "./nav"
);

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
  item(2, "What's new", "mobile.whats_new", "/whats-new"),
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
  expect(entry(busy, "/whats-new")).not.toContain("count-badge");
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
        ["What's new", "mobile.whats_new", "/whats-new"],
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
    "/whats-new",
    "+",
    "/conversations",
    "/notifications",
  ]);
  const guest = order(drawn(false));
  expect(guest[0]).toBe("/");
  expect(guest[1]).toBe("/whats-new");
  expect(guest.at(-1)).toBe("/login");
  expect(guest).toHaveLength(4);
  expect(drawn(true)).toContain("lucide-newspaper");
});

test("Home is current on the forum list, a forum and a thread; What's new on its own page", () => {
  for (const at of ["/", "/forums/3-garden", "/threads/1-a"])
    expect(current(drawn(true, at)), at).toEqual(["/"]);
  expect(current(drawn(true, "/whats-new"))).toEqual(["/whats-new"]);
  expect(current(drawn(false, "/whats-new"))).toEqual(["/whats-new"]);
  expect(current(drawn(true, "/members"))).toEqual([]);
});

// A guest's bar as the backend sends it since Create account was added, drawn with registration
// open or closed.
const guestBar = (registrationOpen: boolean) =>
  renderToStaticMarkup(
    withIntl(
      <MobileNav
        items={mobileItems(
          hideClosedRegistration(
            toNavItems(
              [
                ["Home", "mobile.home", "/"],
                ["What's new", "mobile.whats_new", "/whats-new"],
                ["Log in", "mobile.login", "/login"],
                ["Create account", "mobile.register", "/register"],
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
            registrationOpen,
          ),
        )}
        unread={{ conversations: 0, notifications: 0 }}
        member={false}
      />,
    ),
  );

// A guest's + is a link to sign in that comes back to the page.
test("a guest sees Create account right after Log in, with the + in the middle and five places in all", () => {
  expect(order(guestBar(true))).toEqual([
    "/",
    "/whats-new",
    "/login?next=%2F",
    "/login",
    "/register",
  ]);
});

test("Create account glows and wears the add-person icon and the accent as text; Log in does not glow", () => {
  const html = guestBar(true);
  const register = /<a[^>]*href="\/register"[^>]*>(.*?)<\/a>/.exec(html)?.[0];
  expect(register).toContain("register-glow");
  expect(register).toContain("lucide-user-plus");
  expect(register).toContain("text-primary-ink");
  expect(register).not.toMatch(/\btext-primary\b(?!-)/);
  expect(register).toContain("Create account");
  expect(entry(html, "/login")).not.toContain("register-glow");
  expect(entry(html, "/")).not.toContain("register-glow");
});

test("a member's bar has no glowing entry", () => {
  expect(drawn(true)).not.toContain("register-glow");
  expect(drawn(true)).not.toContain('href="/register"');
});

test("with registration closed a guest's bar has no Create account entry", () => {
  const html = guestBar(false);
  expect(html).not.toContain('href="/register"');
  expect(html).not.toContain("register-glow");
  expect(order(html)).toEqual(["/", "/whats-new", "/login?next=%2F", "/login"]);
});

const css = readFileSync(
  new URL("../../app/globals.css", import.meta.url),
  "utf8",
);

// The declarations of the first rule whose selector is exactly `selector`, from where `scope`
// starts (the whole sheet by default).
const rule = (selector: string, scope = "") => {
  const from = css.indexOf(`${selector} {`, css.indexOf(scope));
  return from < 0 ? "" : css.slice(from, css.indexOf("}", from));
};

test("the glow is a soft shadow of the accent that swells and fades a few times, then stays still, in both themes", () => {
  const glow = rule(".register-glow");
  expect(glow).toMatch(
    /box-shadow:[^;]*color-mix\(in oklab, var\(--primary\) \d+%, transparent\)/,
  );
  expect(glow).toMatch(/animation:\s*register-glow [^;]* 8 alternate/);
  expect(glow).not.toMatch(/infinite/);
  const frames = css.slice(css.indexOf("@keyframes register-glow"));
  expect(frames).toMatch(
    /^@keyframes register-glow \{\s*from \{\s*box-shadow:[^}]*var\(--primary\)[^}]*\}\s*to \{\s*box-shadow:[^}]*var\(--primary\)/,
  );
});

test("with less motion the glow stays, still", () => {
  const still = rule(
    ".register-glow",
    "@media (prefers-reduced-motion: reduce) {\n  .register-glow",
  );
  expect(still).toMatch(/animation:\s*none/);
  expect(still).not.toContain("box-shadow: none");
  // The still glow is the rule's own shadow, which the animation only varies.
  expect(rule(".register-glow")).toContain("box-shadow:");
});

test("the layout drops Create account from the bar with the site's own registration switch, read from the shared site data", () => {
  const layout = readFileSync(
    new URL("../../app/[locale]/(main)/layout.tsx", import.meta.url),
    "utf8",
  );
  expect(layout).toMatch(
    /mobileItems\(\s*hideClosedRegistration\([\s\S]*?site\.registration\.open,?\s*\)/,
  );
  expect(layout).toContain('import { getSite } from "@/lib/sermo/site";');
});
