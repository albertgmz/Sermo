import { afterAll, afterEach, expect, mock, test } from "bun:test";
import { siteBody } from "@/lib/test-bodies";
import layout from "../../../../messages/en/layout.json";

const realFetch = globalThis.fetch;
let cookie = "";

mock.module("server-only", () => ({}));
const intl = await import("next-intl/server");
mock.module("next-intl/server", () => ({
  getLocale: async () => "en",
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
    Response.json(siteBody({ icon }))) as unknown as typeof fetch;
}

const ask = (size: string) =>
  GET(new Request(`http://localhost/pwa-icon/${size}`), {
    params: Promise.resolve({ size }),
  });

// Width and height from the PNG header.
function dimensions(bytes: Uint8Array) {
  const view = new DataView(bytes.buffer, bytes.byteOffset);
  return [view.getUint32(16), view.getUint32(20)];
}

test("the default mark is a square PNG of the size asked for", async () => {
  siteWith(null);
  for (const size of [180, 192, 512]) {
    const response = await ask(String(size));
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("image/png");
    const bytes = new Uint8Array(await response.arrayBuffer());
    expect(Array.from(bytes.slice(1, 4))).toEqual([0x50, 0x4e, 0x47]);
    expect(dimensions(bytes)).toEqual([size, size]);
  }
});

test("the badge of a notification is a 96 pixel PNG on transparency", async () => {
  siteWith(null);
  const response = await ask("badge");
  expect(response.status).toBe(200);
  const bytes = new Uint8Array(await response.arrayBuffer());
  expect(dimensions(bytes)).toEqual([96, 96]);
  // Colour type 6: RGBA.
  expect(bytes[25]).toBe(6);
});

test("any other size is not found", async () => {
  siteWith(null);
  expect((await ask("64")).status).toBe(404);
});

test("with the brand pictures blocked nothing is sent", async () => {
  siteWith(null);
  cookie = "forum_lite=brand";
  for (const size of ["192", "badge"]) {
    const response = await ask(size);
    expect(response.status).toBe(204);
    expect(await response.text()).toBe("");
  }
});

test("a site with an uploaded icon is sent to it, and its notifications have no badge of ours", async () => {
  siteWith({ fileId: 7, url: "/api/v1/files/7" });
  const response = await ask("192");
  expect(response.status).toBe(307);
  expect(response.headers.get("location")).toBe("/api/v1/files/7");
  expect((await ask("badge")).status).toBe(404);
  cookie = "forum_lite=brand";
  expect((await ask("192")).status).toBe(204);
});
