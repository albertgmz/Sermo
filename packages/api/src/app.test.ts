import { afterEach, expect, test } from "bun:test";
import type { Ctx } from "@sermo/core";
import { closeContext, operations } from "@sermo/core";
import { createTestContext, insertNode, insertUser } from "@sermo/core/testing";
import { createApp } from "./app";
import { buildOpenApiDocument } from "./openapi";
import { routes } from "./routes";

const contexts: Ctx[] = [];
const env = { requestIP: () => ({ address: "10.0.0.1", family: "IPv4" as const, port: 1 }) };
function setup(options: Parameters<typeof createApp>[1] = { trustedProxyHeader: null }) {
  const ctx = createTestContext();
  contexts.push(ctx);
  const app = createApp(ctx, options);
  const request = (path: string, init: RequestInit = {}) => app.request(path, init, env);
  return { ctx, app, request };
}
afterEach(() => {
  for (const ctx of contexts.splice(0)) closeContext(ctx);
});

function sessionCookies(response: Response): string {
  return response.headers
    .getSetCookie()
    .map((cookie) => cookie.split(";")[0])
    .join("; ");
}
async function register(request: ReturnType<typeof setup>["request"], username = "alice") {
  const response = await request("/api/auth/sign-up/email", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin: "http://localhost:3000",
      "x-forwarded-for": username === "first" || username === "author" ? "10.0.0.10" : "10.0.0.11",
    },
    body: JSON.stringify({
      name: username,
      username,
      email: `${username}@example.test`,
      password: "Password123!",
    }),
  });
  expect(response.status).toBe(200);
  return {
    cookie: sessionCookies(response),
    data: (await response.json()) as { user: { id: string } },
  };
}

test("route table has exactly one entry for each operation", () => {
  expect(routes.length).toBe(operations.length);
  expect(new Set(routes.map((route) => route.operation)).size).toBe(routes.length);
  expect(new Set(operations.map((op) => op.name))).toEqual(
    new Set(routes.map((route) => route.operation)),
  );
});

test("OpenAPI covers REST and Better Auth routes with resolvable references", async () => {
  const { ctx } = setup();
  const document = (await buildOpenApiDocument(ctx)) as {
    paths: Record<string, Record<string, { operationId: string }>>;
    components: { schemas: Record<string, unknown> };
  };
  for (const route of routes)
    expect(document.paths[`/api/v1${route.path}`]?.[route.method.toLowerCase()]?.operationId).toBe(
      route.operation,
    );
  expect(document.paths["/api/auth/sign-up/email"]?.post).toBeDefined();
  expect(document.paths["/api/auth/api-key/create"]?.post).toBeDefined();
  const ids: string[] = [];
  const refs: string[] = [];
  const visit = (value: unknown) => {
    if (!value || typeof value !== "object") return;
    for (const [name, item] of Object.entries(value)) {
      if (name === "$ref") refs.push(String(item));
      else visit(item);
    }
  };
  for (const path of Object.values(document.paths))
    for (const endpoint of Object.values(path)) {
      ids.push(endpoint.operationId);
      visit(endpoint);
    }
  expect(new Set(ids).size).toBe(ids.length);
  for (const ref of refs)
    expect(document.components.schemas[ref.replace("#/components/schemas/", "")]).toBeDefined();
});

test("errors, coercion, health, and security headers", async () => {
  const { request } = setup();
  const health = await request("/health");
  expect(health.status).toBe(200);
  expect(await health.json()).toEqual({ status: "ok" });
  const nodes = await request("/api/v1/nodes");
  expect(nodes.headers.get("content-security-policy")).toBe(
    "default-src 'none'; frame-ancestors 'none'",
  );
  expect(nodes.headers.get("referrer-policy")).toBe("strict-origin-when-cross-origin");
  const invalid = await request("/api/v1/nodes/nope");
  expect(invalid.status).toBe(400);
  expect(((await invalid.json()) as { error: { code: string } }).error.code).toBe("validation");
  expect((await request("/api/v1/nodes/999")).status).toBe(404);
  expect((await request("/api/v1/nodes", { method: "PUT" })).status).toBe(405);
  expect((await request("/nothing")).status).toBe(404);
  expect(
    (
      await request("/api/v1/nodes", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{",
      })
    ).status,
  ).toBe(400);
  expect((await request("/mcp")).headers.get("x-content-type-options")).toBe("nosniff");
});

test("database failure returns a generic 500 and unhealthy status", async () => {
  const { request, ctx } = setup();
  contexts.pop();
  closeContext(ctx);
  const health = await request("/health");
  expect(health.status).toBe(503);
  const response = await request("/api/v1/nodes");
  expect(response.status).toBe(500);
  expect(await response.json()).toEqual({
    error: { code: "internal", message: "Internal server error." },
  });
  expect(response.headers.get("content-security-policy")).toContain("default-src 'none'");
});

test("Better Auth sessions, username sign-in, sign-out, and API keys", async () => {
  const { request } = setup();
  const { cookie } = await register(request);
  expect((await request("/api/v1/me", { headers: { cookie } })).status).toBe(200);
  const signIn = await request("/api/auth/sign-in/username", {
    method: "POST",
    headers: { "content-type": "application/json", origin: "http://localhost:3000" },
    body: JSON.stringify({ username: "alice", password: "Password123!" }),
  });
  expect(signIn.status).toBe(200);
  const signInEmail = await request("/api/auth/sign-in/email", {
    method: "POST",
    headers: { "content-type": "application/json", origin: "http://localhost:3000" },
    body: JSON.stringify({ email: "alice@example.test", password: "Password123!" }),
  });
  expect(signInEmail.status).toBe(200);
  expect(signInEmail.headers.get("content-security-policy")).toContain("default-src 'none'");
  const currentCookie = sessionCookies(signInEmail);
  const tokenOnly = currentCookie
    .split("; ")
    .find((part) => part.startsWith("sermo.session_token="));
  const refreshed = await request("/api/v1/me", { headers: { cookie: tokenOnly! } });
  expect(refreshed.status).toBe(200);
  expect(
    refreshed.headers.getSetCookie().some((value) => value.startsWith("sermo.session_data=")),
  ).toBe(true);
  const created = await request("/api/auth/api-key/create", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin: "http://localhost:3000",
      cookie: currentCookie,
    },
    body: JSON.stringify({ name: "test" }),
  });
  expect(created.status).toBe(200);
  const key = (await created.json()) as { id: string; key: string };
  expect(
    (await request("/api/v1/me", { headers: { authorization: `Bearer ${key.key}` } })).status,
  ).toBe(200);
  expect(
    (
      await request("/api/auth/api-key/create", {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${key.key}` },
        body: "{}",
      })
    ).status,
  ).not.toBe(200);
  const revoked = await request("/api/auth/api-key/delete", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin: "http://localhost:3000",
      cookie: currentCookie,
    },
    body: JSON.stringify({ keyId: key.id }),
  });
  expect(revoked.status).toBe(200);
  expect(
    (await request("/api/v1/me", { headers: { authorization: `Bearer ${key.key}` } })).status,
  ).toBe(401);
  expect(
    (
      await request("/api/auth/sign-out", {
        method: "POST",
        headers: { origin: "http://localhost:3000", cookie: currentCookie },
      })
    ).status,
  ).toBe(200);
});

test("cookie writes enforce CSRF and JSON while API keys can write", async () => {
  const { request } = setup();
  const { cookie } = await register(request);
  const crossSite = await request("/api/v1/profile", {
    method: "PATCH",
    headers: { cookie, origin: "https://evil.example", "content-type": "text/plain" },
    body: "{}",
  });
  expect(crossSite.status).toBe(403);
  expect(((await crossSite.json()) as { error: { code: string } }).error.code).toBe(
    "csrf_rejected",
  );
  expect(
    (
      await request("/api/v1/profile", {
        method: "PATCH",
        headers: { cookie, origin: "http://localhost:3000" },
        body: "{}",
      })
    ).status,
  ).toBe(415);
  expect(
    (
      await request("/api/v1/profile", {
        method: "PATCH",
        headers: { cookie, origin: "http://localhost:3000", "content-type": "application/json" },
        body: JSON.stringify({ about: "Hi" }),
      })
    ).status,
  ).toBe(200);
});

test("rate limits preserve headers and separate guest IPs", async () => {
  const { app } = setup({
    trustedProxyHeader: "x-forwarded-for",
    rateLimits: { read: 1, search: 1, write: 1, mcp: 1 },
    rateLimitWindowMs: 100,
  });
  const request = (path: string, init: RequestInit = {}) => app.request(path, init, env);
  expect(
    (
      await request("/api/v1/nodes", {
        headers: { "x-forwarded-for": "spoofed, 192.0.2.1", "x-sermo-client-ip": "fake" },
      })
    ).status,
  ).toBe(200);
  const limited = await request("/api/v1/nodes", {
    headers: { "x-forwarded-for": "spoofed, 192.0.2.1" },
  });
  expect(limited.status).toBe(429);
  expect(limited.headers.get("retry-after")).toBeTruthy();
  expect(limited.headers.get("ratelimit-limit")).toBe("1");
  expect(limited.headers.get("x-content-type-options")).toBe("nosniff");
  expect(((await limited.json()) as { error: { code: string } }).error.code).toBe("rate_limited");
  expect(
    (await request("/api/v1/nodes", { headers: { "x-forwarded-for": "spoofed, 192.0.2.2" } }))
      .status,
  ).toBe(200);
  expect((await request("/api/v1/search?q=test")).status).not.toBe(429);
  expect((await request("/api/v1/search?q=test")).status).toBe(429);
  const mcp = await request("/mcp");
  expect(mcp.status).not.toBe(429);
  expect(mcp.headers.get("content-security-policy")).toContain("default-src 'none'");
  expect((await request("/mcp")).status).toBe(429);
  await Bun.sleep(120);
  expect(
    (await request("/api/v1/nodes", { headers: { "x-forwarded-for": "spoofed, 192.0.2.1" } }))
      .status,
  ).toBe(200);
});

test("guest cannot create content through the REST adapter", async () => {
  const { request, ctx } = setup();
  const forum = insertNode(ctx, { type: "forum" });
  const response = await request(`/api/v1/nodes/${forum.id}/threads`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ title: "Hello", body: "Hi" }),
  });
  expect(response.status).toBe(401);
  const user = insertUser(ctx);
  expect(user.id).toBeGreaterThan(0);
});

test("expired sessions and invalid authorization return 401", async () => {
  const { request, ctx } = setup();
  const { cookie } = await register(request);
  const tokenCookie = cookie.split("; ").find((part) => part.startsWith("sermo.session_token="));
  expect(tokenCookie).toBeDefined();
  ctx.sqlite.query("UPDATE auth_session SET expires_at = 0").run();
  const expired = await request("/api/v1/me", { headers: { cookie: tokenCookie! } });
  expect(expired.status).toBe(401);
  expect(((await expired.json()) as { error: { code: string } }).error.code).toBe(
    "unauthenticated",
  );
  expect((await request("/api/v1/me", { headers: { authorization: "Basic abc" } })).status).toBe(
    401,
  );
});

test("API-key write bypasses cookie CSRF and a second user has an independent limit", async () => {
  const { request, ctx } = setup({
    trustedProxyHeader: "x-forwarded-for",
    rateLimits: { write: 2 },
  });
  const first = await register(request, "first");
  const second = await register(request, "second");
  const created = await request("/api/auth/api-key/create", {
    method: "POST",
    headers: {
      cookie: first.cookie,
      origin: "http://localhost:3000",
      "content-type": "application/json",
    },
    body: JSON.stringify({ name: "write" }),
  });
  expect(created.status).toBe(200);
  const key = ((await created.json()) as { key: string }).key;
  const forum = insertNode(ctx, { type: "forum" });
  const firstWrite = await request(`/api/v1/nodes/${forum.id}/threads`, {
    method: "POST",
    headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
    body: JSON.stringify({ title: "Key thread", body: "Written by key" }),
  });
  expect(firstWrite.status).toBe(201);
  const secondWrite = await request(`/api/v1/nodes/${forum.id}/threads`, {
    method: "POST",
    headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
    body: JSON.stringify({ title: "Another key thread", body: "Written by key" }),
  });
  expect(secondWrite.status).toBe(201);
  expect(
    (
      await request(`/api/v1/nodes/${forum.id}/threads`, {
        method: "POST",
        headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
        body: JSON.stringify({ title: "Limited", body: "Written by key" }),
      })
    ).status,
  ).toBe(429);
  expect(
    (
      await request(`/api/v1/nodes/${forum.id}/threads`, {
        method: "POST",
        headers: {
          cookie: second.cookie,
          origin: "http://localhost:3000",
          "content-type": "application/json",
        },
        body: JSON.stringify({ title: "Second user", body: "Allowed" }),
      })
    ).status,
  ).toBe(201);
});

test("thread, reply, reaction, listing, and search work over HTTP", async () => {
  const { request, ctx } = setup({ trustedProxyHeader: "x-forwarded-for" });
  const author = await register(request, "author");
  const reader = await register(request, "reader");
  const forum = insertNode(ctx, { type: "forum" });
  const json = (cookie: string, body: object): RequestInit => ({
    method: "POST",
    headers: { cookie, origin: "http://localhost:3000", "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const created = await request(
    `/api/v1/nodes/${forum.id}/threads`,
    json(author.cookie, { title: "Sermo search title", body: "Opening body" }),
  );
  expect(created.status).toBe(201);
  const thread = (await created.json()) as { thread: { id: number }; post: { id: number } };
  const reply = await request(
    `/api/v1/threads/${thread.thread.id}/posts`,
    json(reader.cookie, { body: "A searchable reply" }),
  );
  expect(reply.status).toBe(201);
  const replyPost = (await reply.json()) as { id: number };
  const reactionType = ctx.sqlite
    .query<{ id: number }, []>("SELECT id FROM reaction_types LIMIT 1")
    .get();
  expect(reactionType).toBeDefined();
  const reaction = await request(`/api/v1/reactions/post/${replyPost.id}`, {
    method: "PUT",
    headers: {
      cookie: author.cookie,
      origin: "http://localhost:3000",
      "content-type": "application/json",
    },
    body: JSON.stringify({ reactionTypeId: reactionType!.id }),
  });
  expect(reaction.status).toBe(200);
  const listed = await request(`/api/v1/threads/${thread.thread.id}/posts?page=1&limit=20`);
  expect(listed.status).toBe(200);
  expect(((await listed.json()) as { items: unknown[] }).items).toHaveLength(2);
  const searched = await request("/api/v1/search?q=searchable");
  expect(searched.status).toBe(200);
  expect(((await searched.json()) as { items: unknown[] }).items.length).toBeGreaterThan(0);
});
