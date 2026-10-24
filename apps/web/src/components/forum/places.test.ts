import { expect, test } from "bun:test";
import {
  placeOfQuery,
  placeOfSearch,
  pushedSearch,
  queryOfSearch,
} from "./places";

test("the server and the browser read the same place from the same address", () => {
  const params = ["tab", "forums"];
  for (const search of [
    "",
    "?tab=hot",
    "?tab=hot&cursor=c1&pages=2",
    "?forums=1&forums=2&tab=latest",
    "?tab=a%20b",
  ])
    expect(placeOfQuery(queryOfSearch(search), params), search).toBe(
      placeOfSearch(search, params),
    );
});

test("a place is only the parameters a switch owns: a list's own place is not part of it", () => {
  expect(placeOfSearch("?tab=posts&cursor=c1&pages=3", ["tab"])).toBe(
    placeOfSearch("?tab=posts", ["tab"]),
  );
  expect(placeOfSearch("?tab=posts", ["tab"])).not.toBe(
    placeOfSearch("?tab=about", ["tab"]),
  );
  // No tab and an empty tab are not told apart from each other, nor from an unknown name.
  expect(placeOfSearch("", ["tab"])).toBe(placeOfSearch("?other=1", ["tab"]));
});

test("a press keeps what the other switches on the screen show now", () => {
  // The section link was drawn when the statistics showed their first tab; they show "viewed" now.
  expect(
    pushedSearch("?section=2&stats=threads", "?stats=viewed", [["stats"]]),
  ).toBe("?section=2&stats=viewed");
  // A switch the address says nothing for loses the value the link carried.
  expect(pushedSearch("?section=2&stats=threads", "", [["stats"]])).toBe(
    "?section=2",
  );
  // Everything else is the link's: a list's place it drops stays dropped.
  expect(pushedSearch("?tab=hot", "?tab=latest&pages=3", [])).toBe("?tab=hot");
  expect(pushedSearch("", "?tab=latest", [])).toBe("");
});

test("the query a loader reads keeps repeated names as a list, as a page's searchParams does", () => {
  expect(queryOfSearch("?a=1&a=2&b=x")).toEqual({ a: ["1", "2"], b: "x" });
  expect(queryOfSearch("")).toEqual({});
});
