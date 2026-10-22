import { afterEach, expect, test } from "bun:test";
import type { Ctx } from "@sermo/core";
import { closeContext } from "@sermo/core";
import { createTestContext } from "@sermo/core/testing";
import { createApp } from "./app";

const contexts: Ctx[] = [];
afterEach(() => {
  for (const ctx of contexts.splice(0)) closeContext(ctx);
});

test("a guest reads the smilies at GET /api/v1/smilies", async () => {
  const ctx = createTestContext();
  contexts.push(ctx);
  const app = createApp(ctx, { trustedProxyHeader: null });
  const response = await app.request(
    "/api/v1/smilies",
    {},
    {
      requestIP: () => ({ address: "10.9.0.1", family: "IPv4" as const, port: 1 }),
    },
  );
  expect(response.status).toBe(200);
  const { items } = (await response.json()) as { items: { title: string; codes: string[] }[] };
  expect(items.find((item) => item.title === "Laugh")?.codes).toEqual([":LOL:"]);
});
