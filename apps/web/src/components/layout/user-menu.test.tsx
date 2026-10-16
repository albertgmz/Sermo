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

const footers = { bookmarks: <p>bookmarks footer</p> };

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

const body = (tab: "account" | "bookmarks", extra: object = {}) =>
  render(
    <UserMenuBody {...base} tab={tab} onTabChange={() => {}} {...extra} />,
  );

test("until it is reached for the avatar is a plain button, and holds no Base UI part", () => {
  const html = render(
    <UserMenu {...base} triggerAvatar={<span>small avatar</span>} />,
  );
  expect(html).toMatch(
    /^<button type="button" aria-haspopup="dialog" aria-expanded="false"/,
  );
  expect(html).not.toContain("data-slot");
  expect(html).not.toContain("data-base-ui");
  expect(html).toContain('aria-label="Account menu"');
});

test("the avatar is for the account only: it carries no unread count", () => {
  const html = render(
    <UserMenu {...base} triggerAvatar={<span>small avatar</span>} />,
  );
  expect(html).not.toContain("unread");
  expect(html).not.toContain('data-slot="count-badge"');
});

test("the menu holds the Account and Bookmarks tabs, named by their words, under the member's name and a log out button", () => {
  const html = body("account");
  expect(html).toContain("ember");
  expect(html).toContain("Member");
  expect(html).toContain("Log out");
  const tabs = [
    ...html.matchAll(/data-slot="tabs-trigger"[^>]*>(.*?)<\/button>/g),
  ];
  expect(
    tabs.map(([, inside]) => inside.replace(/<svg.*?<\/svg>/, "")),
  ).toEqual(["Account", "Bookmarks"]);
  expect(html).not.toContain("Alerts");
  expect(html).not.toContain("Conversations");
});

test("the account tab lists the links in two columns, with the Data saver state and the theme", () => {
  const html = body("account");
  expect(html).toContain("grid-cols-2");
  expect(html).toContain("Profile");
  expect(html).toContain('href="/account/privacy"');
  expect(html).toMatch(/href="\/account\/data-saver"[^>]*>.*Data saver.*On/);
  expect(html).toContain("Theme");
});

test("the bookmarks list is not mounted, so not asked for, until its tab is the one open", () => {
  const account = body("account");
  expect(account).not.toContain("Loading bookmarks");
  expect(account).not.toContain("bookmarks footer");

  const bookmarks = body("bookmarks");
  expect(bookmarks).toContain("Loading bookmarks");
  expect(bookmarks).toContain("bookmarks footer");
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
      openedBy="pointer"
      label="Account menu"
      title="Account menu"
      trigger={<span>small avatar</span>}
    />,
  );
  expect(html).toContain('data-slot="sheet-trigger"');
  expect(html).toContain('aria-label="Account menu"');
});
