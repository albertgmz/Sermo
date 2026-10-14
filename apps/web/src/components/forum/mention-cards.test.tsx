import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { withIntl } from "@/lib/test-intl";
import { MemberCardScope } from "./member-card-scope";
import { MentionCards, mentionAt, mentionId } from "./mention-cards";

test("a mention carries a plain positive decimal id", () => {
  expect(mentionId("12")).toBe(12);
  expect(mentionId("7")).toBe(7);
  for (const bad of [
    "0",
    "-3",
    "1e1",
    "12abc",
    " 12",
    "012",
    "1.5",
    "+4",
    "",
    null,
    undefined,
    "99999999999999999999",
  ]) {
    expect(mentionId(bad)).toBeNull();
  }
});

// The few things of an element that `mentionAt` reads.
function link(attributes: Record<string, string>, text: string) {
  const element = {
    textContent: text,
    getAttribute: (name: string) => attributes[name] ?? null,
    closest: () => element,
  };
  return element as unknown as EventTarget;
}
const inside = { contains: () => true };
const outside = { contains: () => false };

test("the link, its id and its name without the @", () => {
  const found = mentionAt(link({ "data-user-id": "5" }, "@ember"), inside);
  expect(found).toMatchObject({ id: 5, name: "ember" });
});

test("a node that is no mention, one outside the root or one with a bad id gives nothing", () => {
  expect(mentionAt(null, inside)).toBeNull();
  expect(mentionAt({} as EventTarget, inside)).toBeNull();
  expect(mentionAt(link({ "data-user-id": "5" }, "@a"), outside)).toBeNull();
  expect(mentionAt(link({ "data-user-id": "5x" }, "@a"), inside)).toBeNull();
  expect(mentionAt(link({}, "@a"), inside)).toBeNull();
});

test("the wrapper adds no box, and in a disabled scope no element at all", () => {
  const content = <p>hello</p>;
  expect(
    renderToStaticMarkup(withIntl(<MentionCards>{content}</MentionCards>)),
  ).toBe('<div class="contents"><p>hello</p></div>');
  expect(
    renderToStaticMarkup(
      withIntl(
        <MemberCardScope disabled>
          <MentionCards>{content}</MentionCards>
        </MemberCardScope>,
      ),
    ),
  ).toBe("<p>hello</p>");
});
