import { afterAll, afterEach, expect, mock, test } from "bun:test";
import { siteBody } from "@/lib/test-bodies";
import layout from "../../messages/en/layout.json";

const realFetch = globalThis.fetch;
const realError = console.error;
let cookie = "";

mock.module("server-only", () => ({}));
const intl = await import("next-intl/server");
mock.module("next-intl/server", () => ({
  getLocale: async () => "en",
  getTranslations: async () => (key: string) =>
    (layout.site as Record<string, string>)[key],
}));
mock.module("next/headers", () => ({
  headers: async () => new Headers(),
  cookies: async () => ({ toString: () => cookie }),
}));
const nextCache = await import("next/cache");
mock.module("next/cache", () => ({
  ...nextCache,
  cacheLife: () => {},
  cacheTag: () => {},
}));

const { default: manifest } = await import("./manifest");

afterEach(() => {
  globalThis.fetch = realFetch;
  console.error = realError;
  cookie = "";
});
afterAll(() => {
  mock.module("next-intl/server", () => intl);
});

test("the manifest carries what the site says about itself", async () => {
  globalThis.fetch = (async () =>
    Response.json(
      siteBody({
        name: "Garden Club",
        description: "Plants and people",
        icon: { fileId: 4, url: "/api/v1/files/4" },
        palette: {
          accents: [
            {
              id: 1,
              kind: "accent",
              name: "Green",
              color: "#2e7d32",
              foreground: "#ffffff",
              position: 0,
              isActive: true,
              createdAt: "2026-01-01T00:00:00.000Z",
              updatedAt: "2026-01-01T00:00:00.000Z",
            },
          ],
          nameColors: [],
          prefixColors: [],
        },
      }),
    )) as unknown as typeof fetch;
  const result = await manifest();
  expect(result.name).toBe("Garden Club");
  expect(result.description).toBe("Plants and people");
  expect(result.theme_color).toBe("#2e7d32");
  expect(result.icons).toEqual([
    { src: "/api/v1/files/4", sizes: "512x512", type: "image/png" },
  ]);
});

test("when the site cannot be read the manifest still installs the forum", async () => {
  console.error = () => {};
  globalThis.fetch = (async () => {
    throw new Error("connection refused");
  }) as unknown as typeof fetch;
  const result = await manifest();
  expect(result.name).toBe(layout.site.defaultName);
  expect(result.start_url).toBe("/");
  expect(result.display).toBe("standalone");
  expect(result.theme_color).toBe("#dc2626");
  expect(result.icons?.length).toBeGreaterThan(0);
});

test("with the brand pictures blocked the manifest names no icon", async () => {
  cookie = "forum_lite=brand";
  globalThis.fetch = (async () =>
    Response.json(siteBody())) as unknown as typeof fetch;
  const result = await manifest();
  expect(result.name).toBe("Garden Club");
  expect("icons" in result).toBe(false);
});
