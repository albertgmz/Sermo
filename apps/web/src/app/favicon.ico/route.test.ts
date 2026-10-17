import { afterAll, afterEach, expect, mock, test } from "bun:test";
import { siteBody } from "@/lib/test-bodies";
import layout from "../../../messages/en/layout.json";

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

test("a site with no uploaded icon answers with the default mark, as a real ICO file", async () => {
  siteWith(null);
  const response = await GET();
  expect(response.status).toBe(200);
  expect(response.headers.get("content-type")).toBe("image/x-icon");
  const bytes = new Uint8Array(await response.arrayBuffer());
  const view = new DataView(bytes.buffer, bytes.byteOffset);
  // An icon directory (reserved 0, type 1) of 16, 32 and 48 pixel frames, each a PNG.
  expect([view.getUint16(0, true), view.getUint16(2, true)]).toEqual([0, 1]);
  const count = view.getUint16(4, true);
  const frames = Array.from({ length: count }, (_, index) => {
    const entry = 6 + index * 16;
    const offset = view.getUint32(entry + 12, true);
    return {
      size: bytes[entry],
      png: Array.from(bytes.slice(offset + 1, offset + 4)),
    };
  });
  expect(frames.map((frame) => frame.size)).toEqual([16, 32, 48]);
  for (const frame of frames) expect(frame.png).toEqual([0x50, 0x4e, 0x47]);
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
