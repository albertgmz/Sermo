import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { withIntl } from "@/lib/test-intl";
import { ScreenFrame } from "./screen-frame";

const render = (node: React.ReactNode) => renderToStaticMarkup(withIntl(node));

test("with a trail or actions the frame draws the page header, the content below it", () => {
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

test("without either it keeps the plain heading of the screens not moved yet", () => {
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
    '<header><h1 class="text-2xl font-bold tracking-tight">Tags</h1>',
  );
  expect(html).not.toContain("<nav");
  expect(html).toContain("The list");
});
