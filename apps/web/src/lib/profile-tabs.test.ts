import { expect, test } from "bun:test";
import { isProfileTab, profileTabTarget } from "./profile-tabs";

const cases = (rows: [string, string | undefined][]) => {
  for (const [from, to] of rows) {
    const url = new URL(from, "http://localhost");
    expect(profileTabTarget(url.pathname, url.search), from).toBe(to);
  }
};

test("an old tab address of a profile goes to the tab's page, with the rest of its query", () => {
  cases([
    ["/members/5-wren?tab=posts", "/members/5-wren/posts"],
    ["/members/5-wren?tab=threads", "/members/5-wren/threads"],
    ["/members/5-wren?tab=about", "/members/5-wren/about"],
    ["/members/5-wren?tab=posts&page=3", "/members/5-wren/posts?page=3"],
    [
      "/members/5-wren?page=2&tab=threads&utm_source=x",
      "/members/5-wren/threads?page=2&utm_source=x",
    ],
    ["/members/5?tab=posts", "/members/5/posts"],
  ]);
});

test("the wall's tab, an unknown tab and an empty one go to the wall", () => {
  cases([
    ["/members/5-wren?tab=wall", "/members/5-wren"],
    ["/members/5-wren?tab=wall&cursor=abc", "/members/5-wren?cursor=abc"],
    ["/members/5-wren?tab=bogus", "/members/5-wren"],
    ["/members/5-wren?tab=", "/members/5-wren"],
    ["/members/5-wren?tab=POSTS&page=2", "/members/5-wren?page=2"],
  ]);
});

test("an address that names no tab is current", () => {
  cases([
    ["/members/5-wren", undefined],
    ["/members/5-wren?page=2", undefined],
    ["/members/5-wren?post=9", undefined],
  ]);
});

test("only the three tabs are pages under a profile", () => {
  expect(["posts", "threads", "about"].every(isProfileTab)).toBe(true);
  for (const other of ["wall", "", "edit", undefined])
    expect(isProfileTab(other)).toBe(false);
});
