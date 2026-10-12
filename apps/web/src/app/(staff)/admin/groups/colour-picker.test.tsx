import { afterEach, expect, mock, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { fakeBackend } from "./test-backend";

mock.module("server-only", () => ({}));
mock.module("next/headers", () => ({
  headers: async () => new Headers(),
  cookies: async () => ({ set: () => {} }),
}));
mock.module("next-intl/server", () => ({
  getTranslations: async () => (key: string) => key,
}));

const { ColourPicker } = await import("./colour-picker");

let backend: ReturnType<typeof fakeBackend> | undefined;
afterEach(() => backend?.restore());

const colour = (id: number, value: string) => ({
  id,
  kind: "name",
  name: `Colour ${id}`,
  color: value,
  foreground: null,
  position: id,
  isActive: true,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
});

test("a colour of the catalog is drawn only when it is #rrggbb", async () => {
  backend = fakeBackend({
    "paletteColors.list": () =>
      Response.json({
        items: [
          colour(1, "#aa00ff"),
          colour(2, "red; background: url(//evil.test/x)"),
          colour(3, "rgb(1,2,3)"),
        ],
      }),
  });
  const html = renderToStaticMarkup(await ColourPicker({ current: null }));
  expect(html).toContain("background-color:#aa00ff");
  expect(html).not.toContain("evil.test");
  expect(html).not.toContain("rgb(1,2,3)");
  // The option itself stays: only its swatch is left unpainted.
  expect(html).toContain("Colour 2");
  expect(html).toContain("Colour 3");
});
