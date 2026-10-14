import { expect, mock, test } from "bun:test";
import { renderToReadableStream } from "react-dom/server";
import { LITE_COOKIE } from "@/lib/lite-preferences";
import lite from "../../../messages/en/lite.json";

let cookie: string | undefined;
mock.module("server-only", () => ({}));
mock.module("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) =>
      name === LITE_COOKIE && cookie !== undefined
        ? { name, value: cookie }
        : undefined,
    toString: () => (cookie === undefined ? "" : `${LITE_COOKIE}=${cookie}`),
  }),
  headers: async () => new Headers(),
}));
mock.module("next-intl/server", () => ({
  getLocale: async () => "en",
  getTranslations: async (namespace: string) => (key: string) =>
    namespace === "lite.litePlaceholder"
      ? key === "label"
        ? lite.litePlaceholder.label
        : lite.litePlaceholder.aria.label
      : key,
}));
const { HtmlContent } = await import("./html-content");

const slot = (id: number, size = "thumb") =>
  `<span class="bb-attach" data-attach-id="${id}" data-attach-size="${size}">${id}</span>`;
const picture = {
  fileId: 1,
  url: "/api/v1/files/1/cat.png",
  thumbnailUrl: "/api/v1/files/1/thumb.png",
  contentType: "image/png",
  byteSize: 100,
  width: 800,
  height: 400,
};

async function render(body: string, attachments = [picture]) {
  const stream = await renderToReadableStream(
    await HtmlContent({ children: body, attachments }),
  );
  await stream.allReady;
  return new Response(stream).text();
}

test("a tag becomes its attachment, and one of another item stays as text", async () => {
  cookie = undefined;
  const out = await render(`<p>${slot(1)} and ${slot(2)}</p>`);
  expect(out).toContain('src="/api/v1/files/1/thumb.png"');
  expect(out).toContain(">attachment</span>");
  expect(out).not.toContain('data-attach-id="2"');
});

test("with post pictures blocked the picture never reaches the page", async () => {
  cookie = "postImages";
  const out = await render(`<p>${slot(1, "full")}</p>`);
  expect(out).not.toContain("/api/v1/files/1");
  expect(out).toContain("lite-placeholder");
});
