import { expect, test } from "bun:test";
import {
  feedHref,
  filterFromParams,
  filterKey,
  filterParams,
  isFiltered,
  without,
  withoutExcluded,
} from "./feed-filters";

test("an address names a filter, field by field", () => {
  expect(
    filterFromParams({
      forums: "3,4,4,x,0",
      prefix: "2",
      type: "sticky",
      tag: " rust ",
      watched: "1",
      unread: "1",
    }),
  ).toEqual({
    forumIds: [3, 4],
    prefixId: 2,
    type: "sticky",
    tag: "rust",
    watched: true,
    unread: true,
  });
});

test("a field that is malformed, unknown or off is left out", () => {
  expect(
    filterFromParams({
      forums: "a,b",
      prefix: "-1",
      type: "pinned",
      tag: "  ",
      watched: "0",
      unread: "true",
    }),
  ).toEqual({});
  expect(filterFromParams({ forums: ["5", "6"], tag: ["x", "y"] })).toEqual({
    forumIds: [5],
    tag: "x",
  });
  expect(filterFromParams({})).toEqual({});
  expect(isFiltered({})).toBe(false);
});

test("at most the backend's number of forums are kept", () => {
  const many = Array.from({ length: 40 }, (_, i) => i + 1).join(",");
  expect(filterFromParams({ forums: many }).forumIds).toHaveLength(20);
});

test("a filter is one address, whatever order it was built in", () => {
  const filter = { unread: true, tag: "a b", forumIds: [2, 1], watched: true };
  expect(filterParams(filter).toString()).toBe(
    "forums=2%2C1&tag=a+b&watched=1&unread=1",
  );
  expect(filterKey(filter)).toBe(filterKey({ ...filter }));
  expect(filterFromParams(Object.fromEntries(filterParams(filter)))).toEqual(
    filter,
  );
  expect(feedHref("hot", { prefixId: 3 })).toBe("/novedades?tab=hot&prefix=3");
  expect(feedHref("latest")).toBe("/novedades?tab=latest");
});

test("a chip takes its field off, one forum at a time", () => {
  const filter = { forumIds: [1, 2], tag: "x", unread: true };
  expect(without(filter, "tag")).toEqual({ forumIds: [1, 2], unread: true });
  expect(without(filter, "forumIds", 1)).toEqual({
    forumIds: [2],
    tag: "x",
    unread: true,
  });
  expect(without({ forumIds: [1] }, "forumIds", 1)).toEqual({});
  expect(without(filter, "forumIds")).toEqual({ tag: "x", unread: true });
});

test("a forum the site leaves out takes the forums under it along", () => {
  const forums = [
    { id: 1, depth: 0 },
    { id: 2, depth: 1 },
    { id: 3, depth: 2 },
    { id: 4, depth: 1 },
    { id: 5, depth: 0 },
    { id: 6, depth: 1 },
  ];
  expect(withoutExcluded(forums, [2]).map((f) => f.id)).toEqual([1, 4, 5, 6]);
  expect(withoutExcluded(forums, [1]).map((f) => f.id)).toEqual([5, 6]);
  expect(withoutExcluded(forums, [3, 5]).map((f) => f.id)).toEqual([1, 2, 4]);
  expect(withoutExcluded(forums, []).map((f) => f.id)).toEqual([
    1, 2, 3, 4, 5, 6,
  ]);
});
