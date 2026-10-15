import { afterAll, afterEach, expect, mock, test } from "bun:test";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderToStaticMarkup } from "react-dom/server";
import { withIntl } from "@/lib/test-intl";
import { toNavItems } from "./nav-server";

mock.module("server-only", () => ({}));
mock.module("next/headers", () => ({
  headers: async () => new Headers(),
  cookies: async () => ({ set: () => {} }),
}));
// The menu reads its words through the library's hook and the provider of `withIntl`, whatever
// stand-in another suite left in place for it.
const nextIntl = await import("next-intl");
const useIntl = await import("use-intl");
mock.module("next-intl", () => ({
  ...nextIntl,
  useLocale: () => "en",
  useTranslations: useIntl.useTranslations,
}));
const navigation = { ...(await import("next/navigation")) };
mock.module("next/navigation", () => ({
  ...navigation,
  usePathname: () => "/",
}));
afterAll(() => {
  mock.module("next-intl", () => nextIntl);
  mock.module("next/navigation", () => navigation);
});

const realFetch = globalThis.fetch;
let asked = 0;
globalThis.fetch = (async () => {
  asked += 1;
  return Response.json({});
}) as unknown as typeof fetch;
afterAll(() => {
  globalThis.fetch = realFetch;
});
afterEach(() => {
  asked = 0;
});

const { UserMenu } = await import("./user-menu");
const { UserMenuBody } = await import("./user-menu-body");
const { default: UserMenuPopup } = await import("./user-menu-popup");

const links = toNavItems(
  [
    {
      id: 1,
      title: "Profile",
      target: "/members/1",
      builtin: "account.profile",
      icon: null,
      iconPosition: "before" as const,
      children: [],
    },
  ],
  "/members/1",
).map((item) => ({ ...item, href: item.href ?? "/" }));

const footers = {
  alerts: <p>alerts footer</p>,
  conversations: <p>conversations footer</p>,
  bookmarks: <p>bookmarks footer</p>,
};

const screenLinks = [
  { href: "/account/privacy", label: "Privacy" },
  { href: "/account/data-saver", label: "Data saver" },
];

const base = {
  user: { username: "ember", title: "Member" },
  avatar: <span>avatar</span>,
  links,
  screenLinks,
  lite: { master: true, blocked: [] },
  footers,
};

const render = (node: React.ReactNode) =>
  renderToStaticMarkup(
    withIntl(
      <QueryClientProvider client={new QueryClient()}>
        {node}
      </QueryClientProvider>,
    ),
  );

const body = (
  tab: "alerts" | "conversations" | "account" | "bookmarks",
  extra: object = {},
) =>
  render(
    <UserMenuBody
      {...base}
      unread={{ notifications: 3, conversations: 2 }}
      tab={tab}
      onTabChange={() => {}}
      {...extra}
    />,
  );

test("until it is reached for the avatar is a plain button with the one badge, and holds no Base UI part", () => {
  const html = render(
    <UserMenu
      {...base}
      triggerAvatar={<span>small avatar</span>}
      unread={{ notifications: 3, conversations: 2 }}
    />,
  );
  expect(html).toMatch(
    /^<button type="button" aria-haspopup="dialog" aria-expanded="false"/,
  );
  expect(html).not.toContain("data-slot");
  expect(html).not.toContain("data-base-ui");
  expect(html).toContain('aria-label="Account menu, 5 unread"');
  expect(html).toMatch(/aria-hidden="true"[^>]*>5<\/span>/);
});

test("with nothing unread the avatar carries no badge", () => {
  const html = render(
    <UserMenu
      {...base}
      triggerAvatar={<span>small avatar</span>}
      unread={{ notifications: 0, conversations: 0 }}
    />,
  );
  expect(html).toContain('aria-label="Account menu"');
  expect(html).not.toMatch(/rounded-full bg-primary/);
});

test("the menu holds the four tabs, each with its own count, under the member's name and a log out button", () => {
  const html = body("account");
  expect(html).toContain("ember");
  expect(html).toContain("Member");
  expect(html).toContain("Log out");
  expect(html).toContain('aria-label="Alerts, 3 unread"');
  expect(html).toContain('aria-label="Conversations, 2 unread"');
  expect(html).toContain('aria-label="Account"');
  expect(html).toContain('aria-label="Bookmarks"');
});

test("the account tab lists the links in two columns, with the Data saver state and the theme", () => {
  const html = body("account");
  expect(html).toContain("grid-cols-2");
  expect(html).toContain("Profile");
  expect(html).toContain('href="/account/privacy"');
  expect(html).toMatch(/href="\/account\/data-saver"[^>]*>.*Data saver.*On/);
  expect(html).toContain("Theme");
});

test("a list is not mounted, so not asked for, until its tab is the one open", () => {
  const account = body("account");
  expect(account).not.toContain("Loading alerts");
  expect(account).not.toContain("Loading conversations");
  expect(account).not.toContain("Loading bookmarks");
  expect(account).not.toContain("alerts footer");

  const alerts = body("alerts");
  expect(alerts).toContain("Loading alerts");
  expect(alerts).toContain("alerts footer");
  expect(alerts).not.toContain("Loading conversations");
  expect(alerts).not.toContain("Loading bookmarks");

  expect(body("conversations")).toContain("Loading conversations");
  expect(body("bookmarks")).toContain("Loading bookmarks");
  expect(asked).toBe(0);
});

test("the status line is there only for a member who may post on their wall", () => {
  expect(body("account")).not.toContain("Update your status");
  const html = body("account", { status: { wallHref: "/members/1" } });
  expect(html).toContain('placeholder="Update your status…"');
});

test("the loaded menu is the real trigger on a phone: a sheet, with the same label", () => {
  const html = render(
    <UserMenuPopup
      {...base}
      label="Account menu, 5 unread"
      title="Account menu"
      trigger={<span>small avatar</span>}
      unread={{ notifications: 3, conversations: 2 }}
    />,
  );
  expect(html).toContain('data-slot="sheet-trigger"');
  expect(html).toContain('aria-label="Account menu, 5 unread"');
});
