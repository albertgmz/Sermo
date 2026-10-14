import { afterAll, expect, mock, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { withIntl } from "@/lib/test-intl";
import { toNavItems } from "./nav";

const navigation = { ...(await import("next/navigation")) };
mock.module("next/navigation", () => ({
  ...navigation,
  usePathname: () => "/",
}));
afterAll(() => {
  mock.module("next/navigation", () => navigation);
});

const { NavLabel } = await import("./nav-label");
const { MobileNav } = await import("./mobile-nav");
const { HeaderNav } = await import("./site-nav");

let next = 0;
function entry(
  title: string,
  builtin: string | null,
  icon: string | null,
  iconPosition: "before" | "after" = "before",
) {
  next += 1;
  return {
    id: next,
    title,
    target: `/${title.toLowerCase()}`,
    builtin,
    icon,
    iconPosition,
    children: [],
  };
}

const render = (node: React.ReactNode) => renderToStaticMarkup(withIntl(node));

test("a label draws the entry's icon before or after the title", () => {
  const [before, after, none] = toNavItems([
    entry("Shop", null, "store"),
    entry("Chat", null, "message-circle", "after"),
    entry("Rules", null, null),
  ]);
  expect(render(<NavLabel item={before} />)).toMatch(
    /^<svg[^>]*lucide-store[^>]*>.*<[/]svg>Shop$/,
  );
  expect(render(<NavLabel item={after} />)).toMatch(
    /^Chat<svg[^>]*lucide-message-circle[^>]*>/,
  );
  expect(render(<NavLabel item={none} />)).toBe("Rules");
});

test("an icon the set does not know draws nothing", () => {
  const [odd] = toNavItems([entry("Odd", null, "retired-icon")]);
  expect(render(<NavLabel item={odd} />)).toBe("Odd");
  expect(render(<NavLabel item={odd} withDefault />)).toMatch(/lucide-link/);
});

test("a built-in's default icon is the fallback and its own icon wins", () => {
  const [plain, own] = toNavItems([
    entry("Settings", "account.settings", null),
    entry("Settings", "account.settings", "star"),
  ]);
  expect(render(<NavLabel item={plain} />)).toBe("Settings");
  expect(render(<NavLabel item={plain} withDefault />)).toMatch(
    /lucide-settings/,
  );
  const html = render(<NavLabel item={own} withDefault />);
  expect(html).toMatch(/lucide-star/);
  expect(html).not.toMatch(/lucide-settings/);
});

test("the header draws the icon of a link on its side of the title", () => {
  const html = render(
    <HeaderNav
      links={toNavItems([
        entry("Shop", null, "store"),
        entry("Chat", null, "message-circle", "after"),
        entry("Rules", null, null),
      ])}
    />,
  );
  expect(html).toMatch(/<svg[^>]*lucide-store[^>]*>.*<[/]svg>Shop<[/]a>/);
  expect(html).toMatch(/>Chat<svg[^>]*lucide-message-circle/);
  expect(html).toContain(">Rules</a>");
});

test("the phone bar keeps the icon above the title whatever the position says", () => {
  const items = toNavItems([
    entry("Shop", null, "store", "after"),
    entry("Home", "mobile.home", null),
  ]).map((item) => ({ ...item, href: item.href ?? "/" }));
  const html = render(
    <MobileNav items={items} unread={{ conversations: 0, notifications: 0 }} />,
  );
  expect(html).toMatch(/lucide-store[^>]*>.*<[/]span><span[^>]*>Shop<[/]span>/);
  expect(html).toMatch(/lucide-house/);
});
