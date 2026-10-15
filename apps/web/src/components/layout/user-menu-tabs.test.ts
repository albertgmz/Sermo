import { expect, test } from "bun:test";
import { QueryClient, QueryObserver } from "@tanstack/react-query";
import {
  badgeText,
  combinedUnread,
  listKey,
  listQuery,
  openingTab,
} from "./user-menu-tabs";

test("the menu opens on the alerts when any are unread, even with unread conversations", () => {
  expect(openingTab({ notifications: 3, conversations: 0 })).toBe("alerts");
  expect(openingTab({ notifications: 1, conversations: 4 })).toBe("alerts");
});

test("the menu opens on the conversations when only they have something unread", () => {
  expect(openingTab({ notifications: 0, conversations: 2 })).toBe(
    "conversations",
  );
});

test("the menu opens on the account tab when nothing is unread", () => {
  expect(openingTab({ notifications: 0, conversations: 0 })).toBe("account");
});

test("the avatar badge counts alerts and conversations together", () => {
  expect(combinedUnread({ notifications: 3, conversations: 2 })).toBe(5);
  expect(combinedUnread({ notifications: 0, conversations: 0 })).toBe(0);
});

test("a large count is drawn short", () => {
  expect(badgeText(7)).toBe("7");
  expect(badgeText(99)).toBe("99");
  expect(badgeText(100)).toBe("99+");
});

test("a list is held under its kind and its unread count", () => {
  expect(listKey("alerts", 2)).not.toEqual(listKey("alerts", 3));
  expect(listKey("alerts", 2)).not.toEqual(listKey("conversations", 2));
});

// A list is asked for when something subscribes to it, which is what mounting its tab does.
test("a list is not fetched until its tab subscribes, and a new count fetches it again", async () => {
  const client = new QueryClient();
  let loads = 0;
  const load = async () => {
    loads += 1;
    return `rows ${loads}`;
  };
  const tick = () => new Promise((resolve) => setTimeout(resolve, 10));
  const first = new QueryObserver(client, listQuery("alerts", 1, load));
  await tick();
  expect(loads).toBe(0);

  const stop = first.subscribe(() => {});
  await tick();
  expect(loads).toBe(1);
  stop();

  const second = new QueryObserver(client, listQuery("alerts", 2, load));
  const stopSecond = second.subscribe(() => {});
  await tick();
  expect(loads).toBe(2);
  stopSecond();
});

test("nothing is kept once a tab closes: the rows belong to the member who opened it", async () => {
  const client = new QueryClient();
  const observer = new QueryObserver(
    client,
    listQuery("bookmarks", 0, async () => "rows"),
  );
  const stop = observer.subscribe(() => {});
  await observer.refetch();
  expect(client.getQueryData(listKey("bookmarks", 0))).toBe("rows");
  stop();
  await new Promise((resolve) => setTimeout(resolve, 20));
  expect(client.getQueryData(listKey("bookmarks", 0))).toBeUndefined();
});
