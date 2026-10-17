import { expect, test } from "bun:test";
import { use } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { withIntl } from "@/lib/test-intl";
import { ScreenFrame } from "./screen-frame";

const render = (node: React.ReactNode) => renderToStaticMarkup(withIntl(node));

test("the frame draws the page header, the content below it", () => {
  const html = render(
    <ScreenFrame
      heading="Reaction types"
      subtitle="The reactions members leave."
      trail={[
        { href: "/admin", label: "Home" },
        { href: "/admin/sections/content", label: "Content" },
      ]}
      actions={<a href="/admin/reactions/new">Add</a>}
      label="Loading"
      fallback={<p>Waiting</p>}
    >
      <p>The list</p>
    </ScreenFrame>,
  );
  expect(html).toContain('aria-label="Back to Content"');
  expect(html).toContain('href="/admin/sections/content"');
  expect(html).toContain('<a href="/admin/reactions/new">Add</a>');
  expect(html).toContain("The reactions members leave.");
  expect(html.indexOf("Reaction types</h1>")).toBeLessThan(
    html.indexOf("The list"),
  );
});

test("without a trail it is the same page header, with no way up", () => {
  const html = render(
    <ScreenFrame
      heading="Tags"
      subtitle="The tags on threads."
      label="Loading"
      fallback={<p>Waiting</p>}
    >
      <p>The list</p>
    </ScreenFrame>,
  );
  expect(html).toContain(
    '<h1 class="text-2xl font-bold tracking-tight [overflow-wrap:anywhere]">Tags</h1>',
  );
  expect(html).toContain("The tags on threads.");
  expect(html).not.toContain("<nav");
  expect(html).not.toContain("Back to");
  expect(html).toContain("The list");
});

test("the row of links between sibling pages shows while the content still loads", () => {
  const Waiting = () => use(new Promise<never>(() => {}));
  const html = render(
    <ScreenFrame
      heading="Anti-spam"
      nav={<nav aria-label="Settings groups">The groups</nav>}
      label="Loading"
      fallback={<p>Waiting</p>}
    >
      <Waiting />
    </ScreenFrame>,
  );
  expect(html).toContain('<nav aria-label="Settings groups">The groups</nav>');
  expect(html).toContain("Waiting");
  expect(html.indexOf("The groups")).toBeLessThan(html.indexOf("Waiting"));
});
