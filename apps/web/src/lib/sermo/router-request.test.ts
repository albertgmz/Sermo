import { expect, mock, test } from "bun:test";

// A request the router makes (the page asked for again, a refresh) carries the `rsc` header; the
// request that opens the page does not.
let sent = new Headers();
mock.module("next/headers", () => ({ headers: async () => sent }));

const { isRouterRequest } = await import("./request-page");

test("the request that opens a page is not the router's", async () => {
  sent = new Headers({ accept: "text/html" });
  expect(await isRouterRequest()).toBe(false);
});

test("a request with the rsc header is the router's", async () => {
  sent = new Headers({ rsc: "1" });
  expect(await isRouterRequest()).toBe(true);
});
