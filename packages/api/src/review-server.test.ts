import { afterEach, expect, test } from "bun:test";
import type { Ctx } from "@sermo/core";
import { closeContext, registerEmailJobs } from "@sermo/core";
import { createTestContext, insertUser } from "@sermo/core/testing";
import { signUnsubscribe } from "../../core/src/modules/email/token";
import { createApp } from "./app";
import {
  handleRequest,
  handleUnsubscribeRequest,
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

test("the documented JSON unsubscribe body works through the production wrapper", async () => {
  const { app, token } = await setup();
  const response = await handleUnsubscribeRequest(
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

test("a JSON unsubscribe with a charset parameter passes through too", async () => {
  const { app, token } = await setup();
  const response = await handleUnsubscribeRequest(
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
  const response = await handleUnsubscribeRequest(
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
  const response = await handleUnsubscribeRequest(
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
  const first = await handleUnsubscribeRequest(new Request(url, { method: "POST" }), app, server);
  expect(first.status).toBe(200);
  const second = await handleUnsubscribeRequest(new Request(url, { method: "POST" }), app, server);
  expect(second.status).toBe(429);
  expect(second.headers.get("content-type")).toContain("text/html");
  expect(second.headers.get("retry-after") ?? second.headers.get("ratelimit-reset")).not.toBeNull();
  const text = await second.text();
  expect(text).toContain("Too many requests");
  expect(text).not.toContain("invalid or expired");
});

test("an invalid token is still shown as an invalid link", async () => {
  const { app } = await setup();
  const response = await handleUnsubscribeRequest(
    new Request("http://localhost:3000/api/v1/unsubscribe?token=bad&confirm=1", {
      method: "POST",
    }),
    app,
    server,
  );
  expect(response.status).toBe(400);
  expect(await response.text()).toContain("invalid or expired");
});

test("the transport ceiling admits the largest configurable upload plus framing", () => {
  const largestSetting = 1_073_741_824; // maxUploadBytes upper bound in the settings contract
  expect(MAX_REQUEST_BODY_BYTES).toBeGreaterThan(largestSetting);
  expect(MAX_REQUEST_BODY_BYTES - largestSetting).toBeGreaterThanOrEqual(1024 * 1024);
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
