import { afterAll, expect, mock, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { messages } from "@/i18n/messages";
import { withIntl } from "@/lib/test-intl";

mock.module("server-only", () => ({}));
mock.module("next/headers", () => ({
  headers: async () => new Headers(),
  cookies: async () => ({ get: () => undefined, toString: () => "" }),
}));
const navigation = { ...(await import("next/navigation")) };
mock.module("next/navigation", () => ({
  ...navigation,
  useRouter: () => ({
    push() {},
    refresh() {},
    replace() {},
    back() {},
    prefetch() {},
  }),
}));
afterAll(() => {
  mock.module("next/navigation", () => navigation);
});

const { FiltersForm, readForm } = await import("./feed-filters-popup");
type Options = Parameters<typeof FiltersForm>[0]["options"];

const options = (over: Partial<Options> = {}): Options => ({
  signedIn: true,
  forums: [
    { id: 1, title: "Community", depth: 0 },
    { id: 2, title: "General", depth: 1 },
    { id: 3, title: "Off topic", depth: 1 },
    { id: 4, title: "Staff room", depth: 0 },
    { id: 5, title: "Plans", depth: 1 },
  ],
  prefixes: [{ id: 7, label: "Solved" }],
  saved: [
    {
      id: 11,
      name: "Quiet corner",
      scope: "following",
      filter: { unread: true },
    },
  ],
  hiddenForumIds: [3],
  excludedForumIds: [],
  filterLimit: 10,
  ...over,
});

function html(props: Partial<Parameters<typeof FiltersForm>[0]> = {}) {
  return renderToStaticMarkup(
    withIntl(
      <FiltersForm
        tab="latest"
        filter={{}}
        options={options()}
        go={() => {}}
        onHidden={() => {}}
        {...props}
      />,
    ),
  );
}

test("the form is built from the filter on screen", () => {
  const out = html({
    filter: {
      forumIds: [2],
      prefixId: 7,
      type: "locked",
      tag: "rust",
      watched: true,
    },
  });
  expect(out).toMatch(/name="forums" checked="" value="2"/);
  expect(out).toMatch(/name="forums" value="3"/);
  expect(out).toMatch(/<option value="7" selected/);
  expect(out).toMatch(/<option value="locked" selected/);
  expect(out).toContain('value="rust"');
  expect(out).toMatch(/name="watched" checked=""/);
  expect(out).not.toMatch(/name="unread" checked/);
});

test("a member sees what they hide, the people-I-follow switch and their saved filters", () => {
  const out = html();
  // The hidden forum's button is pressed, the others are not.
  expect(out).toContain('aria-label="Show Off topic in my feed again"');
  expect(out).toContain('aria-label="Hide General from my feed"');
  expect((out.match(/aria-pressed="false"/g) ?? []).length).toBe(4);
  expect(out).toContain('name="followed"');
  expect(out).toContain("Quiet corner");
  expect(out).toContain("1 of 10 saved");
  expect(html({ tab: "following" })).toMatch(/name="followed" checked=""/);
});

test("a guest gets the filters that need no account, and a note about the others", () => {
  const out = html({
    options: options({ signedIn: false, saved: [], hiddenForumIds: [] }),
  });
  expect(out).not.toContain('name="followed"');
  expect(out).not.toContain('name="watched"');
  expect(out).not.toContain('name="unread"');
  expect(out).not.toContain("aria-pressed");
  expect(out).not.toContain("saveName");
  expect(out).toContain(messages.forum.feedFilters.signInNote);
  expect(out).toContain('name="forums"');
  expect(out).toContain('name="tag"');
});

test("the forums the site leaves out are not offered, nor the forums under them", () => {
  const out = html({ options: options({ excludedForumIds: [1] }) });
  expect(out).not.toContain(">Community<");
  expect(out).not.toContain(">General<");
  expect(out).not.toContain(">Off topic<");
  expect(out).toContain(">Staff room<");
  expect(out).toContain(">Plans<");
});

test("saved filters at the cap say so, an empty list says it is empty", () => {
  const full = Array.from({ length: 10 }, (_, i) => ({
    id: i + 1,
    name: `F${i}`,
    scope: "latest" as const,
    filter: {},
  }));
  expect(html({ options: options({ saved: full }) })).toContain(
    "10 of 10 saved",
  );
  expect(html({ options: options({ saved: [] }) })).toContain(
    messages.forum.feedFilters.savedEmpty,
  );
});

test("the form's fields are read back as a filter and the tab it asks for", () => {
  const form = new FormData();
  form.append("forums", "2");
  form.append("forums", "5");
  form.set("prefix", "7");
  form.set("type", "sticky");
  form.set("tag", "#Rust");
  form.set("unread", "on");
  expect(readForm(form, "hot")).toEqual({
    filter: {
      forumIds: [2, 5],
      prefixId: 7,
      type: "sticky",
      tag: "Rust",
      unread: true,
    },
    target: "hot",
  });
  form.set("followed", "on");
  expect(readForm(form, "latest").target).toBe("following");
  const plain = new FormData();
  plain.set("prefix", "");
  plain.set("type", "");
  plain.set("tag", "  ");
  // Leaving "people I follow" off on the Following tab goes back to Latest.
  expect(readForm(plain, "following")).toEqual({
    filter: {},
    target: "latest",
  });
  expect(readForm(plain, "hot")).toEqual({ filter: {}, target: "hot" });
});
