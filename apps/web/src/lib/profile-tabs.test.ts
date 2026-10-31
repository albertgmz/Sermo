import { expect, test } from "bun:test";
import {
  isProfileTab,
  profileAddress,
  profileTabLinks,
  profileTabTarget,
} from "./profile-tabs";

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

test("a profile's links keep its segment as the address spelled it, slug or not", () => {
  const labels = {
    wall: "Wall",
    posts: "Posts",
    threads: "Threads",
    about: "About",
  };
  for (const [segment, address] of [
    // Entered by a member link (`/members/54`), which a client navigation does not redirect.
    ["54", "/members/54"],
    ["54-prurchail54", "/members/54-prurchail54"],
  ]) {
    expect(profileAddress(segment)).toBe(address);
    expect(
      profileTabLinks(address, labels, 7).map(({ value, href }) => [
        value,
        href,
      ]),
    ).toEqual([
      ["", address],
      ["posts", `${address}/posts`],
      ["threads", `${address}/threads`],
      ["about", `${address}/about`],
    ]);
  }
  expect(profileTabLinks("/members/54", labels, 7)[1]).toMatchObject({
    label: "Posts",
    count: 7,
  });
});
