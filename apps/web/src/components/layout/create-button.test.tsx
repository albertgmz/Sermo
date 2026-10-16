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

test("the bottom bar holds the + in the middle of its entries", () => {
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
  const items = ["a", "b", "c", "d"].map((title, id) => item(id, title));
  const html = render(
    <MobileNav
      items={items}
      unread={{ conversations: 0, notifications: 0 }}
      member
    />,
  );
  const order = [...html.matchAll(/href="\/([a-d])"|aria-label="Create"/g)].map(
    (match) => match[1] ?? "+",
  );
  expect(order).toEqual(["a", "b", "+", "c", "d"]);
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
