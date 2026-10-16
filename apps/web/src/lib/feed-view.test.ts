import { expect, test } from "bun:test";
import { FEED_VIEWS as BACKEND_VIEWS } from "@sermo/core/contracts";
import {
  DEFAULT_FEED_VIEW,
  FEED_ROW_ESTIMATE,
  FEED_VIEWS,
  parseFeedView,
} from "@/lib/feed-view";

test("the layouts are the backend's own, in its order, and cards come first", () => {
  expect([...FEED_VIEWS]).toEqual([...BACKEND_VIEWS]);
  expect(DEFAULT_FEED_VIEW).toBe("cards");
});

test("a value that names a layout is taken, anything else is not", () => {
  expect(parseFeedView("compact")).toBe("compact");
  expect(parseFeedView("cards")).toBe("cards");
  for (const value of ["grid", "", undefined, null, 1, ["compact"]])
    expect(parseFeedView(value)).toBeNull();
});

test("every layout has a row height to start from, and a compact row is far shorter than a card", () => {
  expect(Object.keys(FEED_ROW_ESTIMATE).sort()).toEqual([...FEED_VIEWS].sort());
  expect(FEED_ROW_ESTIMATE.compact).toBeLessThan(FEED_ROW_ESTIMATE.cards / 3);
});
