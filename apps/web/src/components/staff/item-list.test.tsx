import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { withIntl } from "@/lib/test-intl";
import { ConfirmStep } from "./confirm-step";
import {
  type Item,
  ItemList,
  ItemRow,
  keepsAsking,
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
      <RowToggle action={action} fields={{ id: "1" }} checked label="Active" />
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
  // The icon's box does not clip it: a frame may overhang, a tick keeps its focus ring.
  const box = /<span class="([^"]*size-10[^"]*)"><span>👍/.exec(html)?.[1];
  expect(box).toBeDefined();
  expect(box).not.toContain("overflow-hidden");
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
      fields={{ id: "2" }}
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

test("a row link given a text shows it as a plain link, and keeps the longer label for assistive technology", () => {
  const link = render(<RowLink href="/x" label="Edit Like" text="Edit" />);
  expect(link).toContain(">Edit</a>");
  expect(link).toContain('aria-label="Edit Like"');
  expect(link).not.toContain("<svg");
  expect(link).not.toContain("size-10");
});

test("the switch sends the flipped state itself, under the field the action reads", () => {
  const on = render(
    <RowToggle action={action} fields={{ id: "2" }} checked label="Shown" />,
  );
  expect(on).toContain('<input type="hidden" name="active" value="0"/>');
  const off = render(
    <RowToggle
      action={action}
      fields={{ id: "2" }}
      field="visible"
      checked={false}
      label="Shown"
    />,
  );
  expect(off).toContain('<input type="hidden" name="visible" value="1"/>');
  expect(off).not.toContain('name="active"');
  // Without a confirmation the switch submits at once.
  expect(/<button[^>]*role="switch"[^>]*>/.exec(off)?.[0]).toContain(
    'type="submit"',
  );
});

test("a switch with a confirmation only opens its step: nothing is sent from the switch", () => {
  const html = render(
    <RowToggle
      action={action}
      fields={{ id: "2" }}
      checked
      label="Active"
      confirm={{
        warning: "Members stop seeing it.",
        submit: "Deactivate",
        danger: true,
      }}
    />,
  );
  expect(/<button[^>]*role="switch"[^>]*>/.exec(html)?.[0]).toContain(
    'type="button"',
  );
  // Closed until the switch is pressed.
  expect(html).not.toContain("Members stop seeing it.");
  expect(html).not.toContain('type="submit"');
});

test("the confirm step closes once a save goes through, and stays open on a refusal", () => {
  const open = { state: null, checked: true };
  // Nothing settled yet.
  expect(keepsAsking(open, { state: null, checked: true })).toBe(true);
  // The page is drawn again with the flipped state (a redirect to the same page).
  expect(keepsAsking(open, { state: null, checked: false })).toBe(false);
  // The action answers with a notice.
  expect(
    keepsAsking(open, { state: { notice: "Saved." }, checked: true }),
  ).toBe(false);
  // The action refuses: the error shows and the step can be confirmed again.
  const refused = { state: { error: "Not allowed." }, checked: true };
  expect(keepsAsking(open, refused)).toBe(true);
  // The same refusal drawn again is not a new save.
  expect(keepsAsking(refused, refused)).toBe(true);
  // A second refusal is a new state object: still open.
  expect(
    keepsAsking(refused, { state: { error: "Not allowed." }, checked: true }),
  ).toBe(true);
});

test("a row can hold a delete step and a line of its own, wrapping under the title on a phone", () => {
  const html = render(
    <ul>
      <ItemRow
        title="Spam"
        actions={
          <ConfirmStep
            action={action}
            fields={{ id: 3 }}
            summary="Delete"
            warning="The filter is removed."
          />
        }
        panel={<p>Matched 12 times.</p>}
      />
    </ul>,
  );
  const row = /<li class="([^"]*)"/.exec(html)?.[1] ?? "";
  expect(row.split(" ")).toContain("flex-wrap");
  // The title keeps 10rem: below that the controls go under it.
  expect(html).toContain('<div class="min-w-0 flex-[1_1_10rem] py-1">');
  // The controls take the row's width once the step opens, or a toggle asks; a popup inside a
  // control (Base UI's `data-open`) does not count.
  expect(html).toContain("has-[details[open]]:basis-full");
  expect(html).toContain("has-[[data-asking]]:basis-full");
  expect(html).not.toContain("has-[[data-open]]");
  expect(html).toContain("<details");
  expect(html).toContain(
    '<div class="min-w-0 basis-full"><p>Matched 12 times.</p>',
  );
});

test("a heading's action sits at the end of the card's heading, before the rows", () => {
  const html = render(
    <ItemList
      label="Tabs"
      heading="Tabs"
      description="Above the forum list."
      action={<a href="/admin/forums/tabs/new">Add tab</a>}
      items={ITEMS}
      empty={{ title: "None" }}
    />,
  );
  const head = html.slice(0, html.indexOf("<ul"));
  expect(head).toContain("Tabs</h2>");
  expect(head).toContain('<a href="/admin/forums/tabs/new">Add tab</a>');
  expect(head.indexOf("Above the forum list.")).toBeLessThan(
    head.indexOf("Add tab"),
  );
});
