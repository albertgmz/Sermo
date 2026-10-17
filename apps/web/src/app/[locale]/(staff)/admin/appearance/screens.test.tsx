import { afterAll, afterEach, expect, mock, test } from "bun:test";
import { renderToReadableStream } from "react-dom/server";
import { messages } from "@/i18n/messages";
import { translator, withIntl } from "@/lib/test-intl";
import { viewerBody } from "@/lib/test-viewer";

const realFetch = globalThis.fetch;
const intl = await import("next-intl/server");
mock.module("server-only", () => ({}));
mock.module("next/headers", () => ({
  headers: async () => new Headers(),
  cookies: async () => ({ get: () => undefined, toString: () => "" }),
}));
mock.module("next-intl/server", () => ({
  getLocale: async () => "en",
  getTranslations: async (namespace: string) => translator(namespace, true),
}));

const { PaletteEdit, PaletteList } = await import("./palette-screen");
const { CatalogEdit, CatalogList } = await import("./catalog-screen");

afterEach(() => {
  globalThis.fetch = realFetch;
});
afterAll(() => {
  mock.module("next-intl/server", () => intl);
});

const STAMPS = {
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};
const colour = (id: number, name: string, isActive = true) => ({
  id,
  kind: "accent",
  name,
  color: "#112233",
  foreground: "#ffffff",
  position: id * 10,
  isActive,
  ...STAMPS,
});
// A cover with no picture yet: it is drawn without the picture gates.
const cover = (id: number, name: string) => ({
  id,
  kind: "profile_cover",
  name,
  image: null,
  placement: null,
  position: id * 10,
  isActive: false,
  ...STAMPS,
});

function backend() {
  globalThis.fetch = (async (input: string) => {
    const path = new URL(input).pathname;
    if (path === "/api/v1/appearance/colors")
      return Response.json({
        items: [colour(5, "Teal"), colour(6, "Rose", false)],
      });
    if (path === "/api/v1/appearance/images")
      return Response.json({ items: [cover(3, "Dunes"), cover(4, "Fjord")] });
    return Response.json(viewerBody(false));
  }) as unknown as typeof fetch;
}

async function draw(element: Promise<React.ReactNode> | React.ReactNode) {
  const stream = await renderToReadableStream(withIntl(await element));
  await stream.allReady;
  return new Response(stream).text();
}

test("a colour row links to its page, says whether it is active and keeps its delete", async () => {
  backend();
  const html = await draw(
    PaletteList({ kind: "accent", searchParams: Promise.resolve({}) }),
  );
  expect(html).toContain('href="/admin/appearance/accents/5"');
  expect(html).toContain('href="/admin/appearance/accents/6"');
  expect(html).not.toContain('role="switch"');
  expect(html).toContain(messages.adminAppearance.palette.active);
  expect(html).toContain(messages.adminAppearance.palette.inactive);
  expect(html).toContain(`${messages.adminAppearance.palette.delete}…`);
  expect(html).toContain('name="kind" value="accent"');
});

test("the page of a colour has every field of the old editor and the colour in use", async () => {
  backend();
  const html = await draw(
    PaletteEdit({ kind: "accent", params: Promise.resolve({ id: "5" }) }),
  );
  for (const name of [
    "kind",
    "id",
    "name",
    "color",
    "foreground",
    "position",
    "isActive",
  ]) {
    expect(html).toContain(`name="${name}"`);
  }
  expect(html).toContain('value="#112233"');
  expect(html).toContain('value="50"');
  expect(html).toContain(messages.adminAppearance.palette.looks);
  expect(html).toContain(messages.adminAppearance.palette.sampleButton);
});

test("a new colour starts active and has no id", async () => {
  backend();
  const html = await draw(PaletteEdit({ kind: "name" }));
  expect(html).not.toContain('name="id"');
  expect(html).not.toContain('name="foreground"');
  expect(html).toMatch(/name="isActive"[^>]*checked/);
  expect(html).toContain("Create name colour");
});

test("a colour the address names but the palette lacks is not found", async () => {
  backend();
  await expect(
    PaletteEdit({ kind: "accent", params: Promise.resolve({ id: "99" }) }),
  ).rejects.toThrow();
});

test("a picture row shows that it waits for a picture, and the old editor address leads to the page", async () => {
  backend();
  const html = await draw(
    CatalogList({ kind: "profile_cover", searchParams: Promise.resolve({}) }),
  );
  expect(html).toContain('href="/admin/appearance/covers/3"');
  expect(html).toContain(messages.adminAppearance.catalog.noPicture);
  await expect(
    CatalogList({
      kind: "profile_cover",
      searchParams: Promise.resolve({ edit: "4" }),
    }),
  ).rejects.toThrow();
});

test("the page of a picture keeps the picture upload, and a frame its placement", async () => {
  backend();
  const html = await draw(
    CatalogEdit({
      kind: "profile_cover",
      params: Promise.resolve({ id: "3" }),
    }),
  );
  expect(html).toContain('name="fileId"');
  expect(html).toContain('name="id" value="3"');
  expect(html).not.toContain('name="width"');
  const fresh = await draw(CatalogEdit({ kind: "frame" }));
  expect(fresh).toContain('name="width"');
  expect(fresh).toContain('name="scale"');
  expect(fresh).not.toContain("Reset to measured");
  expect(fresh).toContain("Create frame");
});
