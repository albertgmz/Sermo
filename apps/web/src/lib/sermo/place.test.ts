import { expect, test } from "bun:test";
import { placeOfPath } from "./place";

test("a page is named by its kind and, for a forum, thread or member, its id alone", () => {
  expect(placeOfPath("/")).toBe("forumList");
  expect(placeOfPath("/?tab=new")).toBe("forumList");
  expect(placeOfPath("/novedades")).toBe("latest");
  expect(placeOfPath("/forums/12-general")).toBe("forum:12");
  expect(placeOfPath("/forums/12/new")).toBe("forum:12");
  expect(placeOfPath("/threads/345-a-title?page=3")).toBe("thread:345");
  expect(placeOfPath("/threads/345/unread")).toBe("thread:345");
  expect(placeOfPath("/members")).toBe("members");
  expect(placeOfPath("/members/month?month=2026-01")).toBe("members");
  expect(placeOfPath("/members/6-wren")).toBe("member:6");
  expect(placeOfPath("/online?type=guest")).toBe("online");
  expect(placeOfPath("/search?q=secret")).toBe("search");
});

test("a direct message is never named, and other pages are a page", () => {
  expect(placeOfPath("/conversations/77-private-title")).toBe("conversations");
  expect(placeOfPath("/conversations")).toBe("conversations");
  expect(placeOfPath("/account/privacy")).toBe("page");
  expect(placeOfPath("/threads/abc")).toBe("page");
  expect(placeOfPath("/posts/9")).toBe("page");
});

test("no path, no page view: nothing is named", () => {
  expect(placeOfPath(null)).toBeNull();
});
