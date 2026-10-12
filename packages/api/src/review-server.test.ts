import { afterEach, expect, test } from "bun:test";
import type { Ctx } from "@sermo/core";
import { CLIENT_IP_HEADER, closeContext, registerEmailJobs } from "@sermo/core";
import { createTestContext, insertUser } from "@sermo/core/testing";
import { signUnsubscribe } from "../../core/src/modules/email/token";
import { createApp } from "./app";
import {
  createServerOptions,
  handleRequest,
  limitRequestBody,
  MAX_NON_UPLOAD_BODY_BYTES,
  MAX_REQUEST_BODY_BYTES,
} from "./server";

const contexts: Ctx[] = [];
afterEach(() => {
  for (const ctx of contexts.splice(0)) closeContext(ctx);
});

const server = {
  requestIP: () => ({ address: "198.51.100.77", family: "IPv4" as const, port: 1 }),
};

async function setup(options: Parameters<typeof createApp>[1] = { trustedProxyHeader: null }) {
  const ctx = createTestContext();
  contexts.push(ctx);
  const user = insertUser(ctx, { username: "Reader" });
  registerEmailJobs(
    ctx,
    { driver: "capture", sender: "forum@example.test" },
    {
      defaults: { "digest.weekly": { inApp: false, email: true, push: false } },
      securityTypes: new Set(),
    },
  );
  const token = await signUnsubscribe(ctx, user.id, "digest.weekly");
  return { ctx, token, app: createApp(ctx, options) };
}

function chunked(text: string): ReadableStream<Uint8Array> {
  const bytes = new TextEncoder().encode(text);
  let offset = 0;
  return new ReadableStream({
    pull(controller) {
      if (offset === bytes.length) controller.close();
      else {
        controller.enqueue(bytes.slice(offset, offset + 7));
        offset = Math.min(offset + 7, bytes.length);
      }
    },
  });
}

function expectSecurityHeaders(response: Response, normal: Response) {
  for (const key of [
    "content-security-policy",
    "cross-origin-resource-policy",
    "cross-origin-opener-policy",
    "origin-agent-cluster",
    "referrer-policy",
    "strict-transport-security",
    "x-content-type-options",
    "x-dns-prefetch-control",
    "x-download-options",
    "x-frame-options",
    "x-permitted-cross-domain-policies",
    "x-xss-protection",
  ]) {
    expect(normal.headers.get(key)).not.toBeNull();
    expect(response.headers.get(key)).toBe(normal.headers.get(key));
  }
}

test("the real socket IP survives normal and chunked requests", async () => {
  const { app } = await setup();
  app.post("/inspect-ip", async (c) =>
    c.json({ ip: c.req.header(CLIENT_IP_HEADER), body: await c.req.text() }),
  );
  const observed: { ip: string | undefined; chunked: boolean }[] = [];
  const options = createServerOptions(app, 0);
  const live = Bun.serve({
    ...options,
    hostname: "127.0.0.1",
    fetch(request, socket) {
      observed.push({
        ip: socket.requestIP(request)?.address,
        chunked: request.headers.get("transfer-encoding") === "chunked",
      });
      return options.fetch(request, socket);
    },
  });
  try {
    for (const body of ["hello", chunked("hello")]) {
      const response = await fetch(new URL("/inspect-ip", live.url), {
        method: "POST",
        headers: { [CLIENT_IP_HEADER]: "spoofed", "x-forwarded-for": "203.0.113.2" },
        body,
      });
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ ip: "127.0.0.1", body: "hello" });
    }
    expect(observed).toEqual([
      { ip: "127.0.0.1", chunked: false },
      { ip: "127.0.0.1", chunked: true },
    ]);
  } finally {
    await live.stop(true);
  }
});

test("the documented JSON unsubscribe body works through the production wrapper", async () => {
  const { app, token } = await setup();
  const response = await handleRequest(
    new Request("http://localhost:3000/api/v1/unsubscribe", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ token }),
    }),
    app,
    server,
  );
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ scope: "digest.weekly" });
});

test("the production wrapper still honors the configured trusted proxy header", async () => {
  const { app } = await setup({ trustedProxyHeader: "x-trusted-proxy" });
  app.post("/inspect-ip", async (c) =>
    c.json({ ip: c.req.header(CLIENT_IP_HEADER), body: await c.req.text() }),
  );
  const live = Bun.serve({ ...createServerOptions(app, 0), hostname: "127.0.0.1" });
  try {
    for (const body of ["hello", chunked("hello")]) {
      const response = await fetch(new URL("/inspect-ip", live.url), {
        method: "POST",
        headers: {
          [CLIENT_IP_HEADER]: "spoofed",
          "x-forwarded-for": "203.0.113.2",
          "x-trusted-proxy": "198.51.100.1, 198.51.100.2",
        },
        body,
      });
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ ip: "198.51.100.2", body: "hello" });
    }
  } finally {
    await live.stop(true);
  }
});

test("a JSON unsubscribe with a charset parameter passes through too", async () => {
  const { app, token } = await setup();
  const response = await handleRequest(
    new Request("http://localhost:3000/api/v1/unsubscribe", {
      method: "POST",
      headers: { "content-type": "application/json; charset=utf-8" },
      body: JSON.stringify({ token }),
    }),
    app,
    server,
  );
  expect(response.status).toBe(200);
});

test("the RFC 8058 form post still takes the token from the query string", async () => {
  const { app, token } = await setup();
  const response = await handleRequest(
    new Request(`http://localhost:3000/api/v1/unsubscribe?token=${token}`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: "List-Unsubscribe=One-Click",
    }),
    app,
    server,
  );
  expect(response.status).toBe(200);
});

test("the HTML confirmation keeps the upstream headers", async () => {
  const { app, token } = await setup();
  const response = await handleRequest(
    new Request(`http://localhost:3000/api/v1/unsubscribe?token=${token}&confirm=1`, {
      method: "POST",
    }),
    app,
    server,
  );
  expect(response.status).toBe(200);
  expect(response.headers.get("content-type")).toContain("text/html");
  expect(response.headers.get("content-security-policy")).toBe(
    "default-src 'none'; frame-ancestors 'none'",
  );
  expect(response.headers.get("x-content-type-options")).toBe("nosniff");
  expect(response.headers.get("ratelimit-limit")).not.toBeNull();
});

test("a throttled confirmation is shown as throttling and keeps Retry-After", async () => {
  const { app, token } = await setup({ trustedProxyHeader: null, rateLimits: { write: 1 } });
  const url = `http://localhost:3000/api/v1/unsubscribe?token=${token}&confirm=1`;
  const first = await handleRequest(new Request(url, { method: "POST" }), app, server);
  expect(first.status).toBe(200);
  const second = await handleRequest(new Request(url, { method: "POST" }), app, server);
  expect(second.status).toBe(429);
  expect(second.headers.get("content-type")).toContain("text/html");
  expect(second.headers.get("retry-after") ?? second.headers.get("ratelimit-reset")).not.toBeNull();
  const text = await second.text();
  expect(text).toContain("Too many requests");
  expect(text).not.toContain("invalid or expired");
});

test("an invalid token is still shown as an invalid link", async () => {
  const { app } = await setup();
  const response = await handleRequest(
    new Request("http://localhost:3000/api/v1/unsubscribe?token=bad&confirm=1", {
      method: "POST",
    }),
    app,
    server,
  );
  expect(response.status).toBe(400);
  expect(await response.text()).toContain("invalid or expired");
});

test("the transport ceiling admits the largest configurable upload plus framing", async () => {
  const { app } = await setup();
  const options = createServerOptions(app, 0);
  const largestSetting = 1_073_741_824; // maxUploadBytes upper bound in the settings contract
  expect(MAX_REQUEST_BODY_BYTES).toBeGreaterThan(largestSetting);
  expect(MAX_REQUEST_BODY_BYTES - largestSetting).toBeGreaterThanOrEqual(1024 * 1024);
  expect(options.maxRequestBodySize).toBe(MAX_REQUEST_BODY_BYTES);
  expect(options.port).toBe(0);
});

test("only the upload route may exceed the in-memory body limit", () => {
  const big = String(MAX_NON_UPLOAD_BODY_BYTES + 1);
  const upload = new Request("http://localhost/api/v1/files", {
    method: "POST",
    headers: { "content-length": big },
  });
  expect(limitRequestBody(upload)).toBe(upload);
  const other = limitRequestBody(
    new Request("http://localhost/api/v1/threads", {
      method: "POST",
      headers: { "content-length": big, "content-type": "application/json" },
    }),
  );
  expect(other).toBeInstanceOf(Response);
  expect((other as Response).status).toBe(413);
});

test("a chunked non-upload body is cut off at the limit", async () => {
  const chunk = new Uint8Array(600);
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      controller.enqueue(chunk);
    },
  });
  const limited = limitRequestBody(
    new Request("http://localhost/api/v1/threads", {
      method: "POST",
      body,
      duplex: "half",
    } as RequestInit),
    1000,
  ) as Request;
  await expect(limited.arrayBuffer()).rejects.toThrow();
});

test("handleRequest answers an oversized non-upload request with the 413 envelope", async () => {
  const { app } = await setup();
  const response = await handleRequest(
    new Request("http://localhost/api/v1/me", {
      method: "POST",
      headers: { "content-length": String(MAX_NON_UPLOAD_BODY_BYTES + 1) },
    }),
    app,
    server,
  );
  expect(response.status).toBe(413);
  expect(((await response.json()) as { error: { code: string } }).error.code).toBe(
    "payload_too_large",
  );
});

test.each([
  "/api/v1/unsubscribe",
  "/api/v1/unsubscribe?confirm=1",
  "/api/auth/sign-in/email",
  "/mcp",
  "/read-body",
])("a chunked overflow on %s returns the secured 413 envelope over HTTP", async (path) => {
  const { app } = await setup();
  app.post("/read-body", async (c) => {
    try {
      await c.req.text();
    } catch {
      // A reader may consume the error and even return a successful response.
    }
    return c.text("handled", 200, { "content-encoding": "identity", etag: "old" });
  });
  const live = Bun.serve({
    ...createServerOptions(app, 0, { maxNonUploadBodyBytes: 64 }),
    hostname: "127.0.0.1",
  });
  try {
    const normal = await fetch(new URL("/health", live.url));
    await normal.text();
    const response = await fetch(new URL(path, live.url), {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
      },
      body: chunked(JSON.stringify({ token: "x".repeat(128) })),
    });
    expect(response.status).toBe(413);
    expect(await response.json()).toEqual({
      error: { code: "payload_too_large", message: "The request body is too large." },
    });
    expectSecurityHeaders(response, normal);
    expect(response.headers.get("content-encoding")).toBeNull();
    expect(response.headers.get("etag")).toBeNull();
  } finally {
    await live.stop(true);
  }
});

test.each([false, true])("the byte limit accepts its boundary (chunked: %s)", async (streamed) => {
  const { app } = await setup();
  app.post("/echo-body", async (c) => c.text(await c.req.text()));
  const live = Bun.serve({
    ...createServerOptions(app, 0, { maxNonUploadBodyBytes: 64 }),
    hostname: "127.0.0.1",
  });
  try {
    const normal = await fetch(new URL("/health", live.url));
    await normal.text();
    for (const text of ["x".repeat(63), "é".repeat(32), `${"é".repeat(32)}x`]) {
      const response = await fetch(new URL("/echo-body", live.url), {
        method: "POST",
        body: streamed ? chunked(text) : text,
      });
      if (new TextEncoder().encode(text).byteLength <= 64) {
        expect(response.status).toBe(200);
        expect(await response.text()).toBe(text);
      } else {
        expect(response.status).toBe(413);
        expect(await response.json()).toEqual({
          error: { code: "payload_too_large", message: "The request body is too large." },
        });
        expectSecurityHeaders(response, normal);
      }
    }
  } finally {
    await live.stop(true);
  }
});

test("the outer boundary handles an overflow even when the app rethrows it", async () => {
  const { app } = await setup();
  app.post("/read-body", async (c) => c.text(await c.req.text()));
  app.onError((error) => {
    throw error;
  });
  const live = Bun.serve({
    ...createServerOptions(app, 0, { maxNonUploadBodyBytes: 64 }),
    hostname: "127.0.0.1",
  });
  try {
    const normal = await fetch(new URL("/health", live.url));
    await normal.text();
    const response = await fetch(new URL("/read-body", live.url), {
      method: "POST",
      body: chunked("x".repeat(65)),
    });
    expect(response.status).toBe(413);
    expect(await response.json()).toEqual({
      error: { code: "payload_too_large", message: "The request body is too large." },
    });
    expectSecurityHeaders(response, normal);
  } finally {
    await live.stop(true);
  }
});
