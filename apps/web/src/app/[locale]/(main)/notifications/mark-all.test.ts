import { expect, test } from "bun:test";
import { markAllThenRefresh } from "./mark-all";

test("the route is refreshed once the notifications are marked", async () => {
  const order: string[] = [];
  const state = await markAllThenRefresh(
    async () => {
      order.push("marked");
      return {};
    },
    () => order.push("refreshed"),
    {},
  );
  expect(order).toEqual(["marked", "refreshed"]);
  expect(state).toEqual({});
});

test("a refusal is shown and nothing is refreshed", async () => {
  let refreshed = 0;
  const state = await markAllThenRefresh(
    async () => ({ error: "No." }),
    () => {
      refreshed += 1;
    },
    {},
  );
  expect(refreshed).toBe(0);
  expect(state).toEqual({ error: "No." });
});
