import { afterAll, afterEach, expect, mock, test } from "bun:test";

let cookie = "";

mock.module("server-only", () => ({}));
const intl = await import("next-intl/server");
mock.module("next-intl/server", () => ({
  getLocale: async () => "en",
  getTranslations: async () => (key: string) => key,
}));
mock.module("next/headers", () => ({
  headers: async () => new Headers(),
  cookies: async () => ({ toString: () => cookie }),
}));

const { GET } = await import("./route");

afterEach(() => {
  cookie = "";
});
afterAll(() => {
  mock.module("next-intl/server", () => intl);
});

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
  for (const size of [192, 512]) {
    const response = await ask(String(size));
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("image/png");
    const bytes = new Uint8Array(await response.arrayBuffer());
    expect(Array.from(bytes.slice(1, 4))).toEqual([0x50, 0x4e, 0x47]);
    expect(dimensions(bytes)).toEqual([size, size]);
  }
});

test("any other size is not found", async () => {
  expect((await ask("64")).status).toBe(404);
});

test("with the brand pictures blocked nothing is sent", async () => {
  cookie = "forum_lite=brand";
  const response = await ask("192");
  expect(response.status).toBe(204);
  expect(await response.text()).toBe("");
});
