import { afterEach, expect, test } from "bun:test";
import { type Ctx, closeContext, requestLocation } from "@sermo/core";
import { createTestContext } from "@sermo/core/testing";
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
