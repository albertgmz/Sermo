import { afterEach, expect, test } from "bun:test";
import { type Ctx, closeContext, requestLocation } from "@sermo/core";
import { createTestContext } from "@sermo/core/testing";
import { signNotMe } from "../../core/src/modules/security/not-me-token";
import { createApp } from "./app";

const contexts: Ctx[] = [];
afterEach(() => {
  for (const ctx of contexts.splice(0)) closeContext(ctx);
});

// The location the services see for a request, after the adapter's middleware.
function seen(options: Parameters<typeof createApp>[1]) {
  const ctx = createTestContext();
  contexts.push(ctx);
  const app = createApp(ctx, options);
  app.get("/_test/echo", (c) => c.json(requestLocation(c.req.raw.headers)));
  return async (headers: Record<string, string>) => {
    const response = await app.request(
      "/_test/echo",
      { headers: { "x-forwarded-for": "198.51.100.1", ...headers } },
      { requestIP: () => ({ address: "10.0.0.1", family: "IPv4" as const, port: 1 }) },
    );
    return (await response.json()) as {
      country: string | null;
      region: string | null;
      city: string | null;
    } | null;
  };
}

const PROXY = { "cf-ipcountry": "ES", "cf-region": "Catalonia", "cf-ipcity": "Barcelona" };
const FORGED = {
  "x-sermo-client-country": "KP",
  "x-sermo-client-region": "Pyongyang",
  "x-sermo-client-city": "Pyongyang",
};

test("a location the client sends under the services' names is dropped, trusted proxy or not", async () => {
  expect(await seen({ trustedProxyHeader: null })(FORGED)).toBeNull();
  expect(await seen({ trustedProxyHeader: "x-forwarded-for" })(FORGED)).toBeNull();
  expect(
    await seen({ trustedProxyHeader: "x-forwarded-for", trustProxyLocation: true })(FORGED),
  ).toBeNull();
});

test("the proxy's location headers count only behind a trusted proxy that was said to send them", async () => {
  // No proxy configured: anyone can send a cf-* header.
  expect(await seen({ trustedProxyHeader: null, trustProxyLocation: true })(PROXY)).toBeNull();
  // A proxy, but not told to trust its location headers (the default).
  expect(await seen({ trustedProxyHeader: "x-forwarded-for" })(PROXY)).toBeNull();
  expect(
    await seen({ trustedProxyHeader: "x-forwarded-for", trustProxyLocation: true })(PROXY),
  ).toEqual({ country: "ES", region: "Catalonia", city: "Barcelona" });
});

test("the proxy's headers win over a forged copy, and unusable values are ignored", async () => {
  const read = seen({ trustedProxyHeader: "x-forwarded-for", trustProxyLocation: true });
  expect(await read({ ...FORGED, ...PROXY })).toMatchObject({ country: "ES", city: "Barcelona" });
  expect(await read({ "cf-ipcountry": "XX" })).toBeNull();
  expect(await read({ "cf-ipcountry": "T1" })).toBeNull();
  expect(await read({ "cf-ipcountry": "Spain" })).toBeNull();
  // A city with accents survives the trip through a header, percent-encoded or not.
  expect(await read({ "cf-ipcountry": "CH", "cf-ipcity": "Z%C3%BCrich" })).toMatchObject({
    city: "Zürich",
  });
});

test("without the proxy's address header the request did not pass the proxy: its location headers count for nothing", async () => {
  const ctx = createTestContext();
  contexts.push(ctx);
  const app = createApp(ctx, { trustedProxyHeader: "x-forwarded-for", trustProxyLocation: true });
  app.get("/_test/echo", (c) => c.json(requestLocation(c.req.raw.headers)));
  const response = await app.request("/_test/echo", { headers: PROXY });
  expect(await response.json()).toBeNull();
});

let nextAddress = 10;
// The place the log keeps for a sign-in made through the whole app, with these headers.
async function signedInFrom(
  options: Parameters<typeof createApp>[1],
  headers: Record<string, string>,
) {
  const ctx = createTestContext();
  contexts.push(ctx);
  const app = createApp(ctx, options);
  // A fresh address per case: Better Auth limits sign-in attempts per address.
  nextAddress += 1;
  const address = `198.51.100.${nextAddress}`;
  const env = { requestIP: () => ({ address, family: "IPv4" as const, port: 1 }) };
  const post = (path: string, body: object, extra: Record<string, string> = {}) =>
    app.request(
      path,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          origin: "http://localhost:3000",
          "x-forwarded-for": address,
          ...extra,
        },
        body: JSON.stringify(body),
      },
      env,
    );
  const up = await post("/api/auth/sign-up/email", {
    name: "ada",
    username: "ada",
    email: "ada@example.test",
    password: "Password123!",
  });
  expect(up.status).toBe(200);
  const response = await post(
    "/api/auth/sign-in/email",
    { email: "ada@example.test", password: "Password123!" },
    headers,
  );
  expect(response.status).toBe(200);
  return ctx.sqlite
    .prepare<{ country: string | null; region: string | null; city: string | null }, []>(
      "SELECT country, region, city FROM ip_log WHERE action = 'sign_in'",
    )
    .all();
}

test("a sign-in through the app logs no place a client forged, and the proxy's only when trusted", async () => {
  const forged = { ...FORGED, "user-agent": "Mozilla/5.0" };
  // Forged internal headers never reach the services, in any configuration.
  for (const options of [
    { trustedProxyHeader: null },
    { trustedProxyHeader: "x-forwarded-for" },
    { trustedProxyHeader: "x-forwarded-for", trustProxyLocation: true },
  ])
    expect(await signedInFrom(options, forged)).toEqual([
      { country: null, region: null, city: null },
    ]);
  // The proxy's own headers: ignored unless trusted.
  expect(await signedInFrom({ trustedProxyHeader: "x-forwarded-for" }, PROXY)).toEqual([
    { country: null, region: null, city: null },
  ]);
  expect(
    await signedInFrom(
      { trustedProxyHeader: "x-forwarded-for", trustProxyLocation: true },
      {
        ...FORGED,
        ...PROXY,
      },
    ),
  ).toEqual([{ country: "ES", region: "Catalonia", city: "Barcelona" }]);
});

test("POST /api/v1/not-me works for a guest: a bad link is a 400, a good one signs the member out", async () => {
  const ctx = createTestContext();
  contexts.push(ctx);
  const app = createApp(ctx, { trustedProxyHeader: null });
  const env = { requestIP: () => ({ address: "198.51.100.8", family: "IPv4" as const, port: 1 }) };
  const post = (token: string) =>
    app.request(
      "/api/v1/not-me",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ token }),
      },
      env,
    );
  const bad = await post("not-a-real-token-at-all");
  expect(bad.status).toBe(400);
  expect(((await bad.json()) as { error: { code: string } }).error.code).toBe("validation");
  const up = await app.request(
    "/api/auth/sign-up/email",
    {
      method: "POST",
      headers: { "content-type": "application/json", origin: "http://localhost:3000" },
      body: JSON.stringify({
        name: "ada",
        username: "ada",
        email: "ada@example.test",
        password: "Password123!",
      }),
    },
    env,
  );
  const userId = Number(((await up.json()) as { user: { id: string } }).user.id);
  ctx.clock.advance(1000);
  const token = await signNotMe(ctx, userId);
  ctx.clock.advance(1000);
  const good = await post(token);
  expect(good.status).toBe(200);
  expect(await good.json()).toEqual({ revoked: 1 });
  expect((await post(token)).status).toBe(400);
});
