import { expect, test } from "bun:test";
import { claimPanel, watchPanel } from "./inline-panel";

test("opening a form in place closes the one open elsewhere, so one is open at a time", () => {
  const closed: string[] = [];
  const stopTags = watchPanel("tags", () => closed.push("tags"));
  const stopPoll = watchPanel("poll", () => closed.push("poll"));
  claimPanel("poll");
  expect(closed).toEqual(["tags"]);
  claimPanel("tags");
  expect(closed).toEqual(["tags", "poll"]);
  // A form that is gone is not closed again.
  stopPoll();
  claimPanel("tags");
  expect(closed).toEqual(["tags", "poll"]);
  stopTags();
});
