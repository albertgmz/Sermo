import { afterEach, expect, test } from "bun:test";
import { type Ctx, closeContext, updateSiteSettings } from "@sermo/core";
import { createTestContext, insertUser, userActor } from "@sermo/core/testing";
import { createApp } from "./app";

const contexts: Ctx[] = [];
afterEach(() => {
  for (const ctx of contexts.splice(0)) closeContext(ctx);
});

const ADDRESS = "198.51.100.7";

// Whether the banner applies to a request, as the whole app answers it.
function banner(options: Parameters<typeof createApp>[1], onlyInEurope: boolean) {
  const ctx = createTestContext();
  contexts.push(ctx);
  updateSiteSettings(ctx, userActor(insertUser(ctx, { groupId: 4 })), {
    cookieBannerOutsideEu: !onlyInEurope,
  });
  const app = createApp(ctx, options);
  return async (headers: Record<string, string> = {}) => {
    const response = await app.request(
      "/api/v1/consent/banner",
      { headers: { "x-forwarded-for": ADDRESS, ...headers } },
      { requestIP: () => ({ address: "10.0.0.1", family: "IPv4" as const, port: 1 }) },
    );
    expect(response.status).toBe(200);
    return ((await response.json()) as { show: boolean }).show;
  };
}

const TRUSTED = { trustedProxyHeader: "x-forwarded-for", trustProxyLocation: true };

test("a guest outside Europe is not asked only when the proxy's country is trusted and the site says so", async () => {
  const show = banner(TRUSTED, true);
  expect(await show({ "cf-ipcountry": "US" })).toBe(false);
  expect(await show({ "cf-ipcountry": "ES" })).toBe(true);
  // No country, or one that cannot be told: the banner is shown.
  expect(await show()).toBe(true);
  expect(await show({ "cf-ipcountry": "XX" })).toBe(true);
});

test("a country nobody vouches for does not hide the banner", async () => {
  // Location headers are not trusted by default, and nothing the client sends under the services' names counts.
  expect(
    await banner({ trustedProxyHeader: "x-forwarded-for" }, true)({ "cf-ipcountry": "US" }),
  ).toBe(true);
  expect(
    await banner(
      { trustedProxyHeader: null, trustProxyLocation: true },
      true,
    )({ "cf-ipcountry": "US" }),
  ).toBe(true);
  expect(await banner(TRUSTED, true)({ "x-sermo-client-country": "US" })).toBe(true);
});

test("the banner is shown to everyone while the site shows it everywhere", async () => {
  expect(await banner(TRUSTED, false)({ "cf-ipcountry": "US" })).toBe(true);
});
