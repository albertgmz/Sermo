import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { NameWithIcon } from "@/components/forum/name-icon";

const html = (
  nameIcon: { icon: string; position: "before" | "after" } | null,
) =>
  renderToStaticMarkup(
    <p>
      <NameWithIcon user={{ username: "ember", nameIcon }} />
    </p>,
  );

test("an icon before the name comes first, decorative and sized to the text", () => {
  const out = html({ icon: "star", position: "before" });
  expect(out).toMatch(/^<p><span aria-hidden="true"[^>]*><svg/);
  expect(out.endsWith("ember</p>")).toBe(true);
  expect(out).toContain("size-[1.1em]");
  expect(out.match(/<svg/g)).toHaveLength(1);
});

test("an icon after the name comes last", () => {
  const out = html({ icon: "heart", position: "after" });
  expect(out.startsWith('<p>ember<span aria-hidden="true"')).toBe(true);
  expect(out.match(/<svg/g)).toHaveLength(1);
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
  expect(out.startsWith("Ember!<span")).toBe(true);
  expect(out).not.toContain(">ember<");
});
