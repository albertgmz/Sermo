import { afterAll, expect, mock, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { withIntl } from "@/lib/test-intl";

const navigation = { ...(await import("next/navigation")) };
mock.module("next/navigation", () => ({
  ...navigation,
  usePathname: () => "/forums/3-help",
}));
afterAll(() => {
  mock.module("next/navigation", () => navigation);
});

const { CreateButton } = await import("./create-button");
const { MobileNav } = await import("./mobile-nav");

const render = (node: React.ReactNode) => renderToStaticMarkup(withIntl(node));
const source = (file: string) =>
  readFileSync(join(import.meta.dir, file), "utf8");

test("for a guest the button is a link to sign in that comes back to the page", () => {
  for (const variant of ["header", "bar"] as const) {
    const html = render(<CreateButton variant={variant} member={false} />);
    expect(html).toContain('href="/login?next=%2Fforums%2F3-help"');
    expect(html).toContain('aria-label="Create"');
    expect(html).not.toContain("aria-haspopup");
  }
});

test("for a member it is a plain button until it is reached for, and it carries no dialog code", () => {
  const html = render(<CreateButton variant="header" member />);
  expect(html).toMatch(
    /<button[^>]*aria-haspopup="dialog"[^>]*aria-expanded="false"/,
  );
  expect(html).toContain(">Create<");
  // The dialog, the chooser and the composer come with the import made on first use.
  const src = source("create-button.tsx");
  expect(src).toContain('import("@/components/layout/create-popup")');
  expect(src).not.toMatch(
    /^import (?!type )[^;]*?from "@\/components\/(layout\/create-popup|forum\/create-flow|ui\/dialog)";/m,
  );
  expect(src).not.toMatch(/from "@\/components\/forum\//);
});

test("on a wide screen the button is in the header with its label, on a phone it is the round + of the bar", () => {
  const header = render(<CreateButton variant="header" member />);
  expect(header).toMatch(/class="[^"]*\bhidden\b[^"]*md:inline-flex/);
  const bar = render(<CreateButton variant="bar" member />);
  expect(bar).toMatch(/class="[^"]*rounded-full[^"]*md:hidden/);
  // Icon only, so the button is named by its label; the touch target is at least 40 px.
  expect(bar).toContain('aria-label="Create"');
  expect(bar).toContain("size-11");
  expect(bar).not.toContain(">Create<");
});

test("the bottom bar holds the + in the middle of its entries: an even count splits evenly, an odd one puts the extra entry after it", () => {
  const item = (id: number, title: string) => ({
    id,
    title,
    href: `/${title}`,
    external: false,
    builtin: null,
    icon: null,
    iconPosition: "before" as const,
    iconNode: null,
    match: [],
    children: [],
  });
  const order = (titles: string[], member: boolean) => {
    const html = render(
      <MobileNav
        items={titles.map((title, id) => item(id, title))}
        unread={{ conversations: 0, notifications: 0 }}
        member={member}
      />,
    );
    return [...html.matchAll(/href="\/([a-e])"|aria-label="Create"/g)].map(
      (match) => match[1] ?? "+",
    );
  };
  // A member's bar (Home, Messages, Alerts, Profile) and a guest's (Home, Log in).
  expect(order(["a", "b", "c", "d"], true)).toEqual(["a", "b", "+", "c", "d"]);
  expect(order(["a", "b"], false)).toEqual(["a", "+", "b"]);
  // An administrator may still fill the bar with five.
  expect(order(["a", "b", "c", "d", "e"], true)).toEqual([
    "a",
    "b",
    "c",
    "+",
    "d",
    "e",
  ]);
  // With no entries the button is still there.
  const empty = render(
    <MobileNav
      items={[]}
      unread={{ conversations: 0, notifications: 0 }}
      member={false}
    />,
  );
  expect(empty).toContain('href="/login?next=%2Fforums%2F3-help"');
});

// A member's header holds the navigation, Search, Create, Messages, Alerts and the avatar from
// 768 px up; between `md` and `lg` it has no room for words it can spare (measured: with the label
// and the site's name the member's corner ran 68 px past a 768 px screen). A guest's Create is not
// drawn below `lg` at all. The logo's part is in `site-header.test.tsx`.
test("between md and lg Create is a square +, and the navigation scrolls, without a bar, before the page does", () => {
  const header = render(<CreateButton variant="header" member />);
  expect(header).toMatch(/class="[^"]*max-lg:w-10[^"]*max-lg:px-0/);
  expect(header).toContain('<span class="max-lg:sr-only">Create</span>');
  expect(header).toContain('aria-label="Create"');
  const site = source("site-header.tsx");
  expect(site).toMatch(
    /<HeaderNav[\s\S]*?className="[^"]*\bmin-w-0\b[^"]*\boverflow-x-auto\b[^"]*\bwhitespace-nowrap\b[^"]*\[scrollbar-width:none\][^"]*\[&::-webkit-scrollbar\]:hidden/,
  );
  // The gaps are the guest's as they were: only the member's own pieces change.
  expect(site).toContain(
    '<Container className="flex h-14 items-center gap-1 md:gap-4">',
  );
  expect(site).toContain(
    '<div className="ml-auto flex items-center gap-1 md:gap-2">',
  );
});
