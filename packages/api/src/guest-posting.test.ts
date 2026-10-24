import { afterEach, expect, spyOn, test } from "bun:test";
import { type Ctx, closeContext, execute, getOperation, schema } from "@sermo/core";
import { createTestContext, insertNode, insertUser, userActor } from "@sermo/core/testing";
import { createApp } from "./app";

const contexts: Ctx[] = [];
afterEach(() => {
  for (const ctx of contexts.splice(0)) closeContext(ctx);
  // biome-ignore lint/suspicious/noExplicitAny: restores the global the spy replaced
  (globalThis.fetch as any).mockRestore?.();
});

test("a guest's reply goes through the REST route, checked for the visitor's own address", async () => {
  const ctx = createTestContext();
  contexts.push(ctx);
  const admin = userActor(insertUser(ctx, { groupId: schema.GROUP_IDS.admin }));
  const forum = insertNode(ctx, { title: "Open" });
  const call = (name: string, input: object) => execute(ctx, getOperation(name), admin, input);
  await call("settings.update", {
    turnstileEnabled: true,
    turnstileSiteKey: "site-key",
    turnstileSecret: "secret",
    turnstileForms: ["guestPost"],
  });
  await call("permissions.set", {
    groupId: schema.GROUP_IDS.guest,
    nodeId: forum.id,
    entries: [{ permission: "forum.guestPost", value: "allow" }],
  });
  const made = (await call("threads.create", { nodeId: forum.id, title: "T", body: "B" })) as {
    thread: { id: number };
  };
  const verified: Record<string, unknown>[] = [];
  spyOn(globalThis, "fetch").mockImplementation((async (_: unknown, init?: RequestInit) => {
    verified.push(JSON.parse(String(init?.body)));
    return Response.json({ success: true, action: "guestPost", hostname: "localhost" });
  }) as unknown as typeof fetch);
  const app = createApp(ctx, { trustedProxyHeader: "x-forwarded-for" });
  const response = await app.request(
    `/api/v1/threads/${made.thread.id}/guest-posts`,
    {
      method: "POST",
      headers: { "content-type": "application/json", "x-forwarded-for": "198.51.100.23" },
      body: JSON.stringify({ body: "Hello", name: "Wanderer", turnstileToken: "token" }),
    },
    { requestIP: () => ({ address: "10.0.0.1", family: "IPv4" as const, port: 1 }) },
  );
  expect(response.status).toBe(201);
  const { postId } = (await response.json()) as { postId: number };
  expect(verified.map((body) => body.remoteip)).toEqual(["198.51.100.23"]);
  expect(
    ctx.sqlite.prepare("SELECT user_id, ip, action FROM ip_log WHERE content_id = ?1").all(postId),
  ).toEqual([{ user_id: schema.GUEST_ACCOUNT_ID, ip: "198.51.100.23", action: "post" }]);
});
