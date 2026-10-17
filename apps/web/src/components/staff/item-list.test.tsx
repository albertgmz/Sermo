import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { withIntl } from "@/lib/test-intl";
import {
  type Item,
  ItemList,
  ItemRow,
  matches,
  RowLink,
  RowToggle,
} from "./item-list";

const action = async () => null;

const ITEMS: Item[] = [
  {
    id: 1,
    title: "Like",
    href: "/admin/reactions/1",
    icon: <span>👍</span>,
    description: "Score 1",
    badges: <span data-badge="">Active</span>,
    toggle: (
      <RowToggle
        action={action}
        fields={{ id: "1", active: "0" }}
        checked
        label="Active"
      />
    ),
    actions: <RowLink href="/admin/reactions/1" label="Edit Like" />,
  },
  { id: 2, title: "Éxito" },
  { id: 3, title: <b>Sad</b>, search: "sad face" },
];

const render = (node: React.ReactNode) => renderToStaticMarkup(withIntl(node));

test("the rows show their icon, linked title, line, badges, switch and actions, then the count", () => {
  const html = render(
    <ItemList
      label="Reaction types"
      heading="Reaction types"
      items={ITEMS}
      empty={{ title: "None yet" }}
    />,
  );
  expect(html).toContain('aria-label="Reaction types"');
  expect(html.match(/<li/g)?.length).toBe(3);
  expect(html).toContain('<a class="text-sm font-medium');
  expect(html).toContain('href="/admin/reactions/1"');
  expect(html).toContain("Score 1");
  expect(html).toContain("data-badge");
  expect(html).toContain('role="switch"');
  expect(html).toContain('aria-checked="true"');
  expect(html).toContain('<input type="hidden" name="active" value="0"/>');
  expect(html).toContain('aria-label="Edit Like"');
  expect(html).toContain("Showing 3 entries");
  // No filter box unless asked.
  expect(html).not.toContain('type="search"');
});

test("an empty list shows its empty state and no count", () => {
  const html = render(
    <ItemList
      label="Tags"
      items={[]}
      filter
      empty={{
        title: "No tags yet",
        description: "Tags appear when members add them.",
        action: <a href="/admin/tags/new">Add a tag</a>,
      }}
    />,
  );
  expect(html).toContain("No tags yet");
  expect(html).toContain("Tags appear when members add them.");
  expect(html).toContain('href="/admin/tags/new"');
  expect(html).not.toContain("<ul");
  expect(html).not.toContain("Showing");
  expect(html).not.toContain('type="search"');
});

test("the filter box is offered on request, labelled", () => {
  const html = render(
    <ItemList label="Tags" items={ITEMS} filter empty={{ title: "None" }} />,
  );
  expect(html).toContain('type="search"');
  expect(html).toMatch(/<label for="[^"]+" class="sr-only">Filter<\/label>/);
});

test("the filter matches the title or the search text, ignoring case and accents", () => {
  const [like, exito, sad] = ITEMS;
  expect(matches(like, "")).toBe(true);
  expect(matches(like, "  LIK ")).toBe(true);
  expect(matches(exito, "exito")).toBe(true);
  expect(matches(exito, "like")).toBe(false);
  // A title that is not text is found by its search text only.
  expect(matches(sad, "face")).toBe(true);
  expect(matches({ id: 4, title: <b>Sad</b> }, "sad")).toBe(false);
});

test("a row stands on its own, and a title without a link is plain", () => {
  const html = render(
    <ul>
      <ItemRow title="Plain" />
    </ul>,
  );
  expect(html).toContain("Plain");
  expect(html).not.toContain("<a");
  expect(html).not.toContain('role="switch"');
});

test("the switch shows the state it has and the row link its own icon", () => {
  const off = render(
    <RowToggle
      action={action}
      fields={{ id: "2", active: "1" }}
      checked={false}
      label="Active"
    />,
  );
  expect(off).toContain('aria-checked="false"');
  expect(off).toContain('aria-label="Active"');
  expect(off).toContain('name="id" value="2"');
  const link = render(
    <RowLink href="/x" label="Open" icon={<svg data-icon="eye" />} />,
  );
  expect(link).toContain('data-icon="eye"');
  expect(link).toContain('title="Open"');
});
