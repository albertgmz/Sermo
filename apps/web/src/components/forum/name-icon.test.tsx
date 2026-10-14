import { expect, mock, test } from "bun:test";

mock.module("server-only", () => ({}));

import { renderToStaticMarkup } from "react-dom/server";

const { NameWithIcon } = await import("@/components/forum/name-icon");

const html = (
  nameIcon: { icon: string; position: "before" | "after" } | null,
) =>
  renderToStaticMarkup(
    <p>
      <NameWithIcon user={{ username: "ember", nameIcon }} />
    </p>,
  );

const NAME = '<span class="min-w-0 truncate">ember</span>';

test("an icon before the name comes first, decorative and sized to the text", () => {
  const out = html({ icon: "star", position: "before" });
  expect(out).toContain('<span aria-hidden="true"');
  expect(out.indexOf("<svg")).toBeLessThan(out.indexOf(NAME));
  expect(out).toContain("size-[1.1em]");
  expect(out.match(/<svg/g)).toHaveLength(1);
});

test("an icon after the name comes last", () => {
  const out = html({ icon: "heart", position: "after" });
  expect(out.indexOf(NAME)).toBeLessThan(out.indexOf("<svg"));
  expect(out.match(/<svg/g)).toHaveLength(1);
});

test("the name truncates on its own and the icon never shrinks, on either side", () => {
  for (const position of ["before", "after"] as const) {
    const out = html({ icon: "star", position });
    expect(out).toContain("max-w-full");
    expect(out).toContain(NAME);
    expect(out).toContain("shrink-0");
  }
});

test("a member with no icon, or one the set does not know, gets the plain name", () => {
  expect(html(null)).toBe("<p>ember</p>");
  expect(html({ icon: "not-in-the-set", position: "before" })).toBe(
    "<p>ember</p>",
  );
  expect(html({ icon: "__proto__", position: "after" })).toBe("<p>ember</p>");
});

test("children replace the plain name and the icon stays beside them", () => {
  const out = renderToStaticMarkup(
    <NameWithIcon
      user={{
        username: "ember",
        nameIcon: { icon: "star", position: "after" },
      }}
    >
      Ember!
    </NameWithIcon>,
  );
  expect(out).toContain('<span class="min-w-0 truncate">Ember!</span>');
  expect(out).not.toContain(">ember<");
});
