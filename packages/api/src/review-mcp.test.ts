import { afterEach, expect, test } from "bun:test";
import type { Ctx } from "@sermo/core";
import { closeContext, updateSiteSettings } from "@sermo/core";
import { createTestContext, insertUser, userActor } from "@sermo/core/testing";
import { createApp } from "./app";

const contexts: Ctx[] = [];
let nextIp = 1;
function setup(options: Parameters<typeof createApp>[1] = { trustedProxyHeader: null }) {
  const ctx = createTestContext();
  contexts.push(ctx);
  const app = createApp(ctx, options);
  const ip = `10.1.0.${nextIp++}`;
  const env = { requestIP: () => ({ address: ip, family: "IPv4" as const, port: 1 }) };
  const request = (path: string, init: RequestInit = {}) => app.request(path, init, env);
  return { ctx, request };
}
afterEach(() => {
  for (const ctx of contexts.splice(0)) closeContext(ctx);
});

type Request = ReturnType<typeof setup>["request"];
type Entry = { id: number; result?: { isError?: boolean; content: { text: string }[] } };

function call(name: string, args: object, id: number) {
  return { jsonrpc: "2.0", id, method: "tools/call", params: { name, arguments: args } };
}

function mcp(request: Request, body: unknown, headers: Record<string, string> = {}) {
  return request("/mcp", {
    method: "POST",
    headers: {
      accept: "application/json, text/event-stream",
      "content-type": "application/json",
      ...headers,
    },
    body: JSON.stringify(body),
  });
}

const errorCode = (entry: Entry) =>
  JSON.parse(entry.result?.content?.[0]?.text ?? "{}").error?.code;

async function register(request: Request, username = "alice") {
  const response = await request("/api/auth/sign-up/email", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin: "http://localhost:3000",
      "x-forwarded-for": `198.51.100.${nextIp++}`,
    },
    body: JSON.stringify({
      name: username,
      username,
      email: `${username}@example.test`,
      password: "Password123!",
    }),
  });
  expect(response.status).toBe(200);
  return response.headers
    .getSetCookie()
    .map((cookie) => cookie.split(";")[0])
    .join("; ");
}

test("tool calls in one MCP request are charged to the write, read and search limits", async () => {
  const { request } = setup({
    trustedProxyHeader: null,
    rateLimits: { write: 2, read: 3, search: 1, mcp: 100 },
  });
  const writes = await mcp(
    request,
    Array.from({ length: 5 }, (_, i) => call("posts_create", { threadId: 1, body: "x" }, i + 1)),
  );
  const writeEntries = (await writes.json()) as Entry[];
  expect(writeEntries).toHaveLength(5);
  const codes = writeEntries.map(errorCode);
  expect(codes.filter((code) => code === "rate_limited")).toHaveLength(3);
  expect(codes.filter((code) => code === "unauthenticated")).toHaveLength(2);

  const reads = await mcp(request, [
    ...Array.from({ length: 4 }, (_, i) => call("nodes_list", {}, i + 1)),
    { jsonrpc: "2.0", id: 9, method: "ping" },
  ]);
  const readEntries = (await reads.json()) as Entry[];
  expect(readEntries.filter((entry) => errorCode(entry) === "rate_limited")).toHaveLength(1);
  // Calls beyond the limit fail alone; the rest of the batch still completes.
  expect(readEntries.find((entry) => entry.id === 9)).toBeDefined();
  expect(readEntries.filter((entry) => entry.result?.isError !== true).length).toBe(4);

  const searches = await mcp(request, [
    call("search_query", { q: "a" }, 1),
    call("search_query", { q: "b" }, 2),
  ]);
  const searchEntries = (await searches.json()) as Entry[];
  expect(searchEntries.map(errorCode)).toEqual([undefined, "rate_limited"]);
});

test("MCP tool calls share their bucket with REST requests of the same caller", async () => {
  const { request } = setup({ trustedProxyHeader: null, rateLimits: { write: 1, mcp: 100 } });
  const write = {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ parentId: null, type: "forum", title: "Guest" }),
  };
  expect((await request("/api/v1/nodes", write)).status).toBe(401);
  const response = await mcp(request, call("nodes_create", { title: "Guest" }, 1));
  expect(errorCode((await response.json()) as Entry)).toBe("rate_limited");
});

test("rejected MCP requests carry the refreshed cookies once, successful ones too", async () => {
  const { request } = setup({ trustedProxyHeader: null, rateLimits: { mcp: 2 } });
  const cookie = await register(request);
  const tokenOnly = cookie.split("; ").find((part) => part.startsWith("sermo.session_token="))!;
  const refreshed = (response: Response) =>
    response.headers.getSetCookie().filter((value) => value.startsWith("sermo.session_data="));

  const ok = await mcp(request, { jsonrpc: "2.0", id: 1, method: "ping" }, { cookie: tokenOnly });
  expect(ok.status).toBe(200);
  expect(refreshed(ok)).toHaveLength(1);

  const wrongMethod = await request("/mcp", { headers: { cookie: tokenOnly } });
  expect(wrongMethod.status).toBe(405);
  expect(refreshed(wrongMethod)).toHaveLength(1);

  const limited = await mcp(
    request,
    { jsonrpc: "2.0", id: 1, method: "ping" },
    { cookie: tokenOnly },
  );
  expect(limited.status).toBe(429);
  expect(refreshed(limited)).toHaveLength(1);
});

test("MCP body and batch rejections through the app never duplicate refreshed cookies", async () => {
  const { request } = setup();
  const cookie = (await register(request))
    .split("; ")
    .find((part) => part.startsWith("sermo.session_token="))!;
  const cases = [
    { body: "{", status: 400 },
    { body: "x".repeat(4 * 1024 * 1024 + 1), status: 413 },
    {
      body: JSON.stringify(
        Array.from({ length: 101 }, (_, id) => ({ jsonrpc: "2.0", id, method: "ping" })),
      ),
      status: 400,
    },
    {
      body: JSON.stringify([
        call("nodes_list", {}, 1),
        { jsonrpc: "2.0", method: "notifications/cancelled", params: { requestId: 1 } },
      ]),
      status: 400,
    },
    { body: JSON.stringify([call("nodes_list", {}, 7), call("nodes_list", {}, 7)]), status: 400 },
    { body: "", headers: { accept: "application/json" }, status: 406 },
    { body: "", headers: { "content-type": "text/plain" }, status: 415 },
  ];
  for (const entry of cases) {
    const response = await request("/mcp", {
      method: "POST",
      headers: {
        accept: "application/json, text/event-stream",
        "content-type": "application/json",
        cookie,
        ...entry.headers,
      },
      body: entry.body,
    });
    expect(response.status).toBe(entry.status);
    const cookies = response.headers.getSetCookie();
    expect(cookies.filter((value) => value.startsWith("sermo.session_data="))).toHaveLength(1);
    const names = cookies.map((value) => value.split("=")[0]);
    expect(new Set(names).size).toBe(names.length);
  }
});

test("known paths answer unsupported methods with 405 and an accurate Allow header", async () => {
  const { request } = setup({ trustedProxyHeader: null });
  const allow = async (method: string, path: string) => {
    const response = await request(path, { method });
    return [response.status, response.headers.get("allow")] as const;
  };
  expect(await allow("PUT", "/api/v1/files")).toEqual([405, "POST"]);
  expect(await allow("PUT", "/api/v1/files/1")).toEqual([405, "GET, HEAD"]);
  expect(await allow("PUT", "/health")).toEqual([405, "GET, HEAD"]);
  expect(await allow("POST", "/robots.txt")).toEqual([405, "GET, HEAD"]);
  expect(await allow("PUT", "/nodes/3/feed.atom")).toEqual([405, "GET, HEAD"]);
  expect(await allow("PUT", "/forums/3/feed.atom")).toEqual([405, "GET, HEAD"]);
  expect(await allow("PUT", "/api/v1/openapi.json")).toEqual([405, "GET, HEAD"]);
  const operationRoute = await request("/api/v1/nodes", { method: "PUT" });
  expect(operationRoute.status).toBe(405);
  expect(operationRoute.headers.get("allow")).toContain("POST");
  for (const path of ["/nothing/here", "/api/v1/nothing", "/some-key.txt"]) {
    const response = await request(path, { method: "PUT" });
    expect(response.status).toBe(404);
    expect(response.headers.get("allow")).toBeNull();
  }
});

test("only the currently configured IndexNow key path advertises GET and HEAD", async () => {
  const { ctx, request } = setup();
  const admin = userActor(insertUser(ctx, { groupId: 4 }));
  for (const key of ["example-key-123", "replacement-key-456", null]) {
    updateSiteSettings(ctx, admin, { indexNowKey: key });
    for (const name of ["example-key-123", "replacement-key-456", "unknown-key-789"]) {
      const path = `/${name}.txt`;
      const get = await request(path);
      expect(get.status).toBe(name === key ? 200 : 404);
      const head = await request(path, { method: "HEAD" });
      expect(head.status).toBe(get.status);
      expect(await head.text()).toBe("");
      for (const method of ["POST", "PUT", "OPTIONS", "DELETE", "PATCH"]) {
        const response = await request(path, { method });
        expect(response.status).toBe(name === key ? 405 : 404);
        expect(response.headers.get("allow")).toBe(name === key ? "GET, HEAD" : null);
      }
    }
  }
});

test("IndexNow method detection matches decoded GET paths", async () => {
  const { ctx, request } = setup();
  updateSiteSettings(ctx, userActor(insertUser(ctx, { groupId: 4 })), {
    indexNowKey: "example-key-123",
  });
  for (const path of [
    "/%65xample-key-123.txt",
    "/example-key-123%2etxt",
    "/example-key-123.txt?ignored=1",
  ]) {
    expect((await request(path)).status).toBe(200);
    for (const method of ["POST", "PUT", "OPTIONS"]) {
      const response = await request(path, { method });
      expect(response.status).toBe(405);
      expect(response.headers.get("allow")).toBe("GET, HEAD");
    }
  }
  for (const path of [
    "/%ZZexample-key-123.txt",
    "/example-key-123.txt%2F",
    "/nested/example-key-123.txt",
  ]) {
    expect((await request(path)).status).toBe(404);
    const response = await request(path, { method: "POST" });
    expect(response.status).toBe(404);
    expect(response.headers.get("allow")).toBeNull();
  }
});
