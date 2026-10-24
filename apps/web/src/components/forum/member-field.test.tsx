import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { withIntl } from "@/lib/test-intl";
import { MemberField } from "./member-field";

const draw = (props: Partial<Parameters<typeof MemberField>[0]> = {}) =>
  renderToStaticMarkup(
    withIntl(<MemberField name="author" label="By member" {...props} />),
  );

function labelAndBox(html: string) {
  const forId = html.match(/<label[^>]*for="([^"]+)"[^>]*>By member<\/label>/);
  const box = html.match(/<input[^>]*type="search"[^>]*>/)?.[0] ?? "";
  return { forId: forId?.[1], box };
}

test("the visible label is tied to the box that finds members, which also sends what was typed", () => {
  const { forId, box } = labelAndBox(draw());
  expect(forId).toBeTruthy();
  expect(box).toContain(`id="${forId}"`);
  expect(box).toContain('name="author"');
  expect(box).not.toContain("aria-label");
});

test("a member chosen before is a chip and the username goes with the form", () => {
  const html = draw({ initial: "ember" });
  expect(html).toContain("ember");
  expect(html).toContain('aria-label="Remove ember"');
  expect(html).toContain('<input type="hidden" name="author" value="ember"');
  expect(html).not.toContain('type="search"');
});
