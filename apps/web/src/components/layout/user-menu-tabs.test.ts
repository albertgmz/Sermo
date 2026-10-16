import { expect, test } from "bun:test";
import { QueryClient, QueryObserver } from "@tanstack/react-query";
import { listKey, listQuery } from "./user-menu-list-query";

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

test("the light trigger path holds no react-query: the tabs module imports nothing from it", async () => {
  const { readFileSync } = await import("node:fs");
  const source = readFileSync(
    new URL("./user-menu-tabs.ts", import.meta.url),
    "utf8",
  );
  expect(source).not.toMatch(/react-query/);
});
