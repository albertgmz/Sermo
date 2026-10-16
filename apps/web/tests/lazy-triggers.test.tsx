import { afterAll, expect, mock, test } from "bun:test";
import type { ComponentType, ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { withIntl } from "@/lib/test-intl";

// The plain trigger drawn first and the real one that replaces it must be the same element, so
// that nothing moves or reads differently when the popup arrives. Each trigger is rendered as the
// page draws it; the `LazyPopup` stand-in below records what it was given, and the real popup is
// then rendered from exactly that.

mock.module("server-only", () => ({}));
mock.module("next/headers", () => ({
  headers: async () => new Headers(),
  cookies: async () => ({ get: () => undefined, toString: () => "" }),
}));
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
  useRouter: () => ({ push() {}, refresh() {} }),
}));

type Captured = {
  load: () => Promise<{ default: ComponentType<Record<string, unknown>> }>;
  popup: Record<string, unknown>;
  trigger: (lazy: Record<string, unknown>) => ReactElement;
};
let captured: Captured | undefined;
const realPopup = { ...(await import("@/components/ui/lazy-popup")) };
mock.module("@/components/ui/lazy-popup", () => ({
  ...realPopup,
  LazyPopup: (props: Captured) => {
    captured = props;
    return props.trigger({});
  },
}));
afterAll(() => {
  mock.module("next-intl", () => nextIntl);
  mock.module("next/navigation", () => navigation);
  mock.module("@/components/ui/lazy-popup", () => realPopup);
});

const { toNavItems } = await import("@/components/layout/nav-server");
const { UserMenu } = await import("@/components/layout/user-menu");
const { HeaderPanel } = await import("@/components/layout/header-panel");
const { GuestMenu } = await import("@/components/layout/guest-menu");
const { HeaderNav, MobileMenu } = await import("@/components/layout/site-nav");
const { MemberCardTrigger } = await import(
  "@/components/forum/member-card-trigger"
);
const { ShareButton } = await import("@/components/forum/share-button");
const { TabMore } = await import("@/components/forum/tab-more");
const { ProfileMore } = await import(
  "@/app/[locale]/(main)/members/[id]/profile-more"
);
const { LazyTooltip } = await import("@/components/ui/lazy-tooltip");
const { FeedFiltersButton } = await import(
  "@/components/forum/feed-filters-button"
);

type Tag = { name: string; attributes: Record<string, string> };

// The first element of some markup: its tag and attributes.
function firstTag(html: string): Tag {
  const match = /<(button|a|span)((?:\s[^>]*)?)>/.exec(html);
  if (!match) throw new Error(`not an element: ${html.slice(0, 80)}`);
  const attributes: Record<string, string> = {};
  for (const [, name, value] of match[2].matchAll(
    /\s([^\s=]+)(?:="([^"]*)")?/g,
  )) {
    attributes[name] = value ?? "";
  }
  return { name: match[1], attributes };
}

// What a visitor and assistive technology can tell apart. Left out: what Base UI adds for its own
// bookkeeping (`id`, `tabindex`, `data-base-ui-*`), and the open state (the real popup mounts open).
const IGNORED = /^(id|tabindex|aria-expanded|aria-controls|data-base-ui.*)$/;

function comparable({ name, attributes }: Tag, withSlot: boolean) {
  const kept = Object.entries(attributes).filter(
    ([key]) =>
      !IGNORED.test(key) &&
      (withSlot ? true : key !== "data-slot") &&
      !key.startsWith("data-popup") &&
      key !== "data-loading",
  );
  return { name, attributes: Object.fromEntries(kept) };
}

const render = (node: React.ReactNode) => renderToStaticMarkup(withIntl(node));

async function pair(
  page: React.ReactNode,
  extra: Record<string, unknown> = {},
) {
  captured = undefined;
  const plain = render(page);
  const call = captured as Captured | undefined;
  if (!call) throw new Error("the page drew no lazy popup");
  const Real = (await call.load()).default;
  const real = render(<Real {...call.popup} openedBy="pointer" {...extra} />);
  return { plain: firstTag(plain), real: firstTag(real) };
}

type Entry = {
  id: number;
  title: string;
  target: string;
  builtin: null;
  icon: null;
  iconPosition: "before";
  children: Entry[];
};
const entry = (id: number, title: string, children: Entry[] = []): Entry => ({
  id,
  title,
  target: `/${title.toLowerCase()}`,
  builtin: null,
  icon: null,
  iconPosition: "before" as const,
  children,
});
const links = toNavItems([
  entry(1, "Community", [entry(2, "Rules"), entry(3, "Staff")]),
]);

const lite = { master: true, blocked: [] };
const unread = { notifications: 2, conversations: 1 };
const footers = {
  alerts: <p>a</p>,
  conversations: <p>c</p>,
  bookmarks: <p>b</p>,
};

const cases: [string, () => React.ReactNode, boolean][] = [
  [
    "the avatar button",
    () => (
      <UserMenu
        triggerAvatar={<span>avatar</span>}
        unread={unread}
        user={{ username: "ember", title: "Member" }}
        avatar={<span>avatar</span>}
        links={[]}
        screenLinks={[]}
        lite={lite}
        footers={footers}
      />
    ),
    // A phone gets a sheet and a wide screen a popover: the width decides, not the page.
    false,
  ],
  [
    "the search panel's icon",
    () => (
      <HeaderPanel
        label="Search"
        title="Search"
        unread={1}
        icon={<span>icon</span>}
        shortcut="search"
        className="size-10"
      >
        <p>panel</p>
      </HeaderPanel>
    ),
    true,
  ],
  ["the guest options button", () => <GuestMenu lite={lite} />, true],
  ["a header heading with links", () => <HeaderNav links={links} />, true],
  [
    "the phone menu button",
    () => <MobileMenu links={links} logo={<span>logo</span>} />,
    true,
  ],
  [
    "a member's name",
    () => (
      <MemberCardTrigger id={3} href="/members/3" name="ember">
        ember
      </MemberCardTrigger>
    ),
    true,
  ],
  [
    "the feed filters button",
    () => (
      <FeedFiltersButton tab="latest" filter={{ unread: true }} count={1} />
    ),
    true,
  ],
  [
    "the share button",
    () => <ShareButton href="/threads/3#post-1" label="Share" className="x" />,
    true,
  ],
  [
    "the button of the tabs that do not fit",
    () => (
      <TabMore
        tabs={[{ value: "a", label: "A", href: "/?tab=a" }]}
        label="More"
        className="x"
      />
    ),
    true,
  ],
  [
    "a profile's more button",
    () => (
      <ProfileMore
        label="More"
        className="x"
        profileHref="/members/3"
        findPosts="Find posts"
        findThreads="Find threads"
      />
    ),
    true,
  ],
  [
    "a postbit tooltip",
    () => (
      <LazyTooltip label="Chrome on Windows" className="x">
        <i />
      </LazyTooltip>
    ),
    true,
  ],
];

for (const [name, page, withSlot] of cases) {
  test(`${name}: the plain trigger is the real trigger as far as the page can tell`, async () => {
    const { plain, real } = await pair(page());
    expect(comparable(plain, withSlot)).toEqual(comparable(real, withSlot));
  });
}

test("the plain triggers are in the markup the server sends, with the attributes that announce a popup", () => {
  for (const [name, page] of cases) {
    const html = render(page());
    const { attributes } = firstTag(html);
    if (name === "a postbit tooltip") continue;
    expect(attributes["aria-haspopup"], name).toMatch(/^(dialog|menu)$/);
    expect(attributes["aria-expanded"], name).toBe("false");
  }
});
