import { afterAll, afterEach, expect, mock, test } from "bun:test";
import layout from "../../../messages/en/layout.json";

const realFetch = globalThis.fetch;
let cookie = "";

mock.module("server-only", () => ({}));
const intl = await import("next-intl/server");
mock.module("next-intl/server", () => ({
  getTranslations: async () => (key: string) =>
    (layout.site as Record<string, string>)[key],
}));
const nextCache = await import("next/cache");
mock.module("next/cache", () => ({
  ...nextCache,
  cacheLife: () => {},
  cacheTag: () => {},
}));
mock.module("next/headers", () => ({
  headers: async () => new Headers(),
  cookies: async () => ({ toString: () => cookie }),
}));

const { GET } = await import("./route");

afterEach(() => {
  globalThis.fetch = realFetch;
  cookie = "";
});
afterAll(() => {
  mock.module("next-intl/server", () => intl);
});

function siteWith(icon: { fileId: number; url: string } | null) {
  globalThis.fetch = (async () =>
    Response.json({
      name: "Garden Club",
      logo: null,
      icon,
      backdrop: null,
      socialLinks: { discord: null, telegram: null, x: null },
      palette: { accents: [], nameColors: [], prefixColors: [] },
    })) as unknown as typeof fetch;
}

test("a site with no uploaded icon answers with the default mark", async () => {
  siteWith(null);
  const response = await GET();
  expect(response.status).toBe(200);
  expect(response.headers.get("content-type")).toBe("image/svg+xml");
  expect(await response.text()).toStartWith("<svg ");
});

test("a site with an uploaded icon sends the browser to it", async () => {
  siteWith({ fileId: 4, url: "/api/v1/files/4" });
  const response = await GET();
  expect(response.status).toBe(307);
  expect(response.headers.get("location")).toBe("/api/v1/files/4");
});

test("with the brand pictures blocked nothing is sent", async () => {
  siteWith(null);
  cookie = "forum_lite=brand";
  const response = await GET();
  expect(response.status).toBe(204);
  expect(await response.text()).toBe("");
});
