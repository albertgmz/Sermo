import { afterAll, expect, mock, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { withIntl } from "@/lib/test-intl";
import type { MatrixPermission } from "./permission-matrix";

// The matrix reads its words through the library's hook and the provider of `withIntl`, whatever
// stand-in another suite left in place for it; the module is given back afterwards.
const nextIntl = { ...(await import("next-intl")) };
const useIntl = await import("use-intl");
mock.module("next-intl", () => ({
  ...nextIntl,
  useTranslations: useIntl.useTranslations,
}));
afterAll(() => {
  mock.module("next-intl", () => nextIntl);
});

const { PermissionMatrix } = await import("./permission-matrix");

const row = (
  id: string,
  category: string,
  type: "flag" | "integer" = "flag",
  scope: "global" | "node" = "global",
): MatrixPermission => ({
  id,
  type,
  scope,
  title: id,
  category,
  categoryTitle: `Category ${category}`,
  unit: type === "integer" ? "count" : null,
});

const PERMISSIONS = [
  row("profile.view", "profile"),
  row("profile.post", "profile"),
  row("conversation.max", "conversation", "integer"),
  row("tag.manage", "moderation"),
  row("warning.maxPoints", "moderation", "integer"),
];

const render = (node: React.ReactNode) => renderToStaticMarkup(withIntl(node));

// The opening tags that carry `attribute`.
const tags = (html: string, attribute: string) =>
  (html.match(/<[a-z]+ [^>]*>/g) ?? []).filter((tag) =>
    tag.includes(attribute),
  );

test("two tabs, general and moderation, with every row of both in the form", () => {
  const html = render(
    <PermissionMatrix
      permissions={PERMISSIONS}
      entries={{ "profile.view": "allow", "warning.maxPoints": 5 }}
    />,
  );
  expect(html).toContain('role="tablist"');
  expect(html).toContain('aria-label="Kinds of permission"');
  expect(html).toContain("General permissions");
  expect(html).toContain("Moderation");
  // The tab that is not shown is hidden, not left out: its controls are submitted too.
  expect(html.match(/role="tabpanel"/g)?.length).toBe(2);
  const panels = tags(html, 'role="tabpanel"');
  expect(panels.filter((tag) => tag.includes('hidden=""'))).toHaveLength(1);
  expect(html.match(/name="perm:/g)?.length).toBe(PERMISSIONS.length);
  expect(html.match(/name="was:/g)?.length).toBe(PERMISSIONS.length);
  expect(html).toContain('name="num:warning.maxPoints"');
  expect(html).toContain('value="5"');
  // Real tabs (Base UI's: the arrow keys move between them, Enter or Space opens one), the
  // first one open, each with a visible focus ring.
  const tabs = tags(html, 'role="tab"');
  expect(tabs).toHaveLength(2);
  expect(tabs[0]).toContain('aria-selected="true"');
  expect(tabs[1]).toContain('aria-selected="false"');
  for (const tab of tabs) {
    expect(tab).toContain("<button");
    expect(tab).toContain("focus-visible:ring-ring/50");
  }
  expect(html).toContain("No changes");
  expect(html).toContain("Set here");
  expect(html).not.toContain("Changed, was");
});

test("bulk buttons for each tab and each category holding a yes/no permission", () => {
  const html = render(
    <PermissionMatrix permissions={PERMISSIONS} entries={{}} />,
  );
  for (const scope of [
    "General permissions",
    "Moderation",
    "Category profile",
    "Category moderation",
  ]) {
    expect(html).toContain(
      `<fieldset aria-label="Every yes/no permission in ${scope}"`,
    );
  }
  // A category of integers alone has none.
  expect(html).not.toContain(
    'aria-label="Every yes/no permission in Category conversation"',
  );
  expect(html.match(/>Allow all</g)?.length).toBe(4);
  expect(html.match(/>Never for all</g)?.length).toBe(4);
  expect(html.match(/>Clear all \(inherit\)</g)?.length).toBe(4);
  // On a phone a category's buttons keep a one-word label beside the icon.
  for (const word of ["Allow", "Never", "Clear"]) {
    expect(
      html.match(new RegExp(`<span class="sm:hidden">${word}</span>`, "g"))
        ?.length,
    ).toBe(2);
  }
  // They only change the form: none of them submits it.
  const groups = html.split("<fieldset").slice(1);
  expect(groups).toHaveLength(4);
  for (const group of groups) {
    expect(group.slice(0, group.indexOf("</fieldset>"))).not.toContain(
      'type="submit"',
    );
  }
});

test("on a forum No stays a choice on every yes/no row, and one tab needs no tab list", () => {
  const html = render(
    <PermissionMatrix
      permissions={[
        row("forum.view", "forum", "flag", "node"),
        row("forum.reply", "forum", "flag", "node"),
      ]}
      entries={{ "forum.reply": "no" }}
      allowNo
    />,
  );
  expect(html.match(/<option value="no"/g)?.length).toBe(2);
  expect(html).toContain('<option value="no" selected="">No</option>');
  expect(html).not.toContain('role="tablist"');
  expect(html).toContain(
    'aria-label="Every yes/no permission in General permissions"',
  );
  expect(html.match(/name="perm:/g)?.length).toBe(2);
});

test("the guest-post permission of a forum is a row with its words and the choice saved for it", () => {
  const html = render(
    <PermissionMatrix
      permissions={[
        {
          ...row("forum.guestPost", "forum", "flag", "node"),
          title: "Post as a guest",
          help: "Start threads and reply without an account.",
        },
      ]}
      entries={{ "forum.guestPost": "allow" }}
      allowNo
    />,
  );
  expect(html).toContain("Post as a guest");
  expect(html).toContain("Start threads and reply without an account.");
  expect(html).toContain('name="perm:forum.guestPost"');
  expect(html).toContain('<option value="allow" selected="">Allow</option>');
});

test("a search result's permission starts the filter, opens its tab and shows only its row", () => {
  const html = render(
    <PermissionMatrix
      permissions={PERMISSIONS}
      entries={{}}
      focus="warning.maxPoints"
    />,
  );
  expect(tags(html, 'id="matrix-filter"')[0]).toContain(
    'value="warning.maxPoints"',
  );
  // The moderation tab is the one shown.
  const tabs = tags(html, 'role="tab"');
  expect(tabs[1]).toContain('aria-selected="true"');
  const rows = tags(html, "data-permission=");
  expect(rows).toHaveLength(PERMISSIONS.length);
  for (const tag of rows)
    expect(tag.includes('hidden=""'), tag).toBe(
      !tag.includes('data-permission="warning.maxPoints"'),
    );
});

test("a permission the matrix does not hold leaves the filter empty and the first tab open", () => {
  const html = render(
    <PermissionMatrix permissions={PERMISSIONS} entries={{}} focus="nope.no" />,
  );
  expect(tags(html, 'id="matrix-filter"')[0]).toContain('value=""');
  expect(tags(html, 'role="tab"')[0]).toContain('aria-selected="true"');
});
