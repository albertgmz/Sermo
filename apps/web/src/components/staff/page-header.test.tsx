import { expect, test } from "bun:test";
import { renderToReadableStream, renderToStaticMarkup } from "react-dom/server";
import { withIntl } from "@/lib/test-intl";
import { AddLink, HeaderLink, PageHeader, SortLink } from "./page-header";

const TRAIL = [
  { href: "/admin", label: "Home" },
  { href: "/admin/sections/users", label: "Users" },
  { href: "/admin/users", label: "Members" },
];

test("the title, its line and the actions; no trail on the panel's home", () => {
  const html = renderToStaticMarkup(
    withIntl(
      <PageHeader
        title="Administration"
        description="What needs attention."
        actions={<a href="/admin/x">Add</a>}
      />,
    ),
  );
  expect(html).toContain("<h1");
  expect(html).toContain("Administration");
  expect(html).toContain("What needs attention.");
  expect(html).toContain('<a href="/admin/x">Add</a>');
  expect(html).not.toContain("<nav");
  // Below the title on a phone, at its right from 640 px.
  expect(html).toContain("flex flex-col gap-3 sm:flex-row");
});

test("the trail is a breadcrumb from 768 px and a single link to the parent on a phone", () => {
  const html = renderToStaticMarkup(
    withIntl(<PageHeader trail={TRAIL} title="Member" />),
  );
  const back = /<a[^>]*aria-label="Back to Members"[^>]*>/.exec(html)?.[0];
  expect(back).toContain('href="/admin/users"');
  expect(back).toContain("md:hidden");
  const nav = html.slice(html.indexOf("<nav"));
  expect(nav).toContain("hidden md:block");
  for (const crumb of TRAIL) expect(nav).toContain(`href="${crumb.href}"`);
  expect(nav.indexOf("Home")).toBeLessThan(nav.indexOf("Members"));
});

test("an empty trail draws nothing, and a trail still on its way does not hold the title", async () => {
  const empty = renderToStaticMarkup(
    withIntl(<PageHeader trail={[]} title="Setup" />),
  );
  expect(empty).not.toContain("<nav");
  expect(empty).not.toContain("Back to");

  let settle: (crumbs: typeof TRAIL) => void = () => {};
  const later = new Promise<typeof TRAIL>((resolve) => {
    settle = resolve;
  });
  const stream = await renderToReadableStream(
    withIntl(<PageHeader trail={later} title="Member" />),
  );
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  // The shell is out with the title and the trail's placeholder before the trail settles.
  const shell = decoder.decode((await reader.read()).value);
  expect(shell).toContain("Member</h1>");
  expect(shell).not.toContain("Back to Members");
  settle(TRAIL);
  let rest = "";
  for (
    let chunk = await reader.read();
    !chunk.done;
    chunk = await reader.read()
  )
    rest += decoder.decode(chunk.value);
  expect(rest).toContain('aria-label="Back to Members"');
});

test("the header's links: Add is the primary one with a plus, Sort and the others are outlined", () => {
  const html = renderToStaticMarkup(
    withIntl(
      <>
        <AddLink href="/admin/reactions/new">Add reaction</AddLink>
        <SortLink href="/admin/reactions/sort">Sort</SortLink>
        <HeaderLink href="/admin/users/batch">Batch update</HeaderLink>
      </>,
    ),
  );
  const [add, sort, other] = html.split("</a>");
  expect(add).toContain('href="/admin/reactions/new"');
  expect(add).toContain("lucide-plus");
  expect(add).not.toContain("border-border");
  expect(sort).toContain("lucide-arrow-up-down");
  for (const link of [sort, other]) expect(link).toContain("border-border");
  // Touch-sized on every width.
  for (const link of [add, sort, other]) expect(link).toContain("min-h-10");
});
