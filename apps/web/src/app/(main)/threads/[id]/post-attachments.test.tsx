import { expect, mock, test } from "bun:test";
import { renderToReadableStream } from "react-dom/server";
import { LITE_COOKIE } from "@/lib/lite-preferences";
import lite from "../../../../../messages/en/lite.json";
import threads from "../../../../../messages/en/threads.json";

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

// The text comes from the message files; arguments are put into their places.
function translator(namespace: string) {
  const files = {
    "threads.page": threads.page,
    "lite.litePlaceholder": lite.litePlaceholder,
  } as Record<string, unknown>;
  return (key: string, values: Record<string, unknown> = {}) => {
    let value: unknown = files[namespace];
    for (const part of key.split(".")) {
      value = (value as Record<string, unknown> | undefined)?.[part];
    }
    return String(value ?? key).replace(/\{(\w+)\}/g, (_, name) =>
      String(values[name]),
    );
  };
}
const realIntl = { ...(await import("next-intl")) };
mock.module("next-intl", () => ({ ...realIntl, useTranslations: translator }));
mock.module("next-intl/server", () => ({
  getTranslations: async (namespace: string) => translator(namespace),
}));

const { PostAttachments } = await import("./post-attachments");

const file = (fileId: number, over: Record<string, unknown> = {}) => ({
  fileId,
  url: `/api/v1/files/${fileId}`,
  thumbnailUrl: null,
  contentType: "image/png",
  byteSize: 2048,
  width: null,
  height: null,
  ...over,
});

async function html(attachments: ReturnType<typeof file>[]) {
  const stream = await renderToReadableStream(
    // biome-ignore lint/suspicious/noExplicitAny: the attachments are shaped by the test
    await PostAttachments({ attachments: attachments as any }),
  );
  await stream.allReady;
  return new Response(stream).text();
}

test("a picture without a size is a download link while pictures are loaded", async () => {
  cookie = undefined;
  const out = await html([file(7)]);
  expect(out).toContain('href="/api/v1/files/7"');
});

test("with post pictures blocked a picture without a size is a row with no address", async () => {
  for (const blocked of ["postImages", "all"]) {
    cookie = blocked;
    const out = await html([
      file(7),
      file(8, { contentType: "application/pdf" }),
    ]);
    expect(out).not.toContain("/api/v1/files/7");
    // The row is still there, and other files stay downloads.
    expect(out).toContain('<span class="truncate">7</span>');
    expect(out).toContain('href="/api/v1/files/8"');
  }
});

test("blocked pictures with a size keep the placeholder and no address", async () => {
  cookie = "postImages";
  const out = await html([file(7, { width: 40, height: 30 })]);
  expect(out).not.toContain("/api/v1/files/7");
  expect(out).toContain("lite-placeholder");
});

test("each picture says which one it is among the post's pictures", async () => {
  cookie = undefined;
  const out = await html([
    file(1, { width: 10, height: 10 }),
    file(2, { width: 10, height: 10 }),
    file(3, { width: 10, height: 10 }),
  ]);
  expect(out).toContain('aria-label="Attached picture 1 of 3"');
  expect(out).toContain('aria-label="Attached picture 2 of 3"');
  expect(out).toContain('aria-label="Attached picture 3 of 3"');
});
