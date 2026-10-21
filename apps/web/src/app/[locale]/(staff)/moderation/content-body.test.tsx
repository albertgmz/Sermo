import { afterAll, expect, mock, test } from "bun:test";
import { renderToReadableStream } from "react-dom/server";
import { formattedTranslator, withIntl } from "@/lib/test-intl";

// A reported or queued item's detail: the text, and the files attached to it under the text.

mock.module("server-only", () => ({}));
mock.module("next/headers", () => ({
  headers: async () => new Headers(),
  cookies: async () => ({
    get: () => undefined,
    set: () => {},
    toString: () => "",
  }),
}));
const navigation = await import("next/navigation");
mock.module("next/navigation", () => ({
  ...navigation,
  usePathname: () => "/moderation/reports/1",
  useSearchParams: () => new URLSearchParams(),
  useRouter: () => ({ refresh: () => {}, push: () => {} }),
}));
const intl = { ...(await import("next-intl")) };
const { useTranslations } = await import("use-intl");
mock.module("next-intl", () => ({
  ...intl,
  useLocale: () => "en",
  useTranslations,
}));
const intlServer = { ...(await import("next-intl/server")) };
mock.module("next-intl/server", () => ({
  ...intlServer,
  getLocale: async () => "en",
  getTranslations: async (namespace: string) => formattedTranslator(namespace),
}));
afterAll(() => {
  mock.module("next/navigation", () => navigation);
  mock.module("next-intl", () => intl);
  mock.module("next-intl/server", () => intlServer);
});

const { ContentBody } = await import("./content-body");

const file = (over: Record<string, unknown>) => ({
  fileId: 5,
  url: "/attachments/5/plan.pdf",
  thumbnailUrl: null,
  widths: [],
  contentType: "application/pdf",
  byteSize: 2048,
  width: null,
  height: null,
  filename: "plan.pdf",
  ...over,
});

async function draw(
  html: string,
  attachments: ReturnType<typeof file>[],
  type: "post" | "profile_post" = "post",
) {
  const stream = await renderToReadableStream(
    withIntl(
      <ContentBody type={type} id={31} html={html} attachments={attachments} />,
    ),
  );
  await stream.allReady;
  return new Response(stream).text();
}

test("the files attached to an item are listed under its text", async () => {
  const out = await draw("<p>See the plan</p>", [
    file({}),
    file({
      fileId: 6,
      url: "/attachments/6/photo.png",
      contentType: "image/png",
      filename: "photo.png",
      width: 640,
      height: 480,
    }),
  ]);
  expect(out.indexOf("See the plan")).toBeGreaterThan(-1);
  expect(out).toContain('href="/attachments/5/plan.pdf"');
  expect(out).toContain("plan.pdf");
  expect(out).toContain('href="/attachments/6/photo.png"');
  expect(out.indexOf("plan.pdf")).toBeGreaterThan(out.indexOf("See the plan"));
});

test("an item with no files lists none", async () => {
  const out = await draw("<p>Only words</p>", []);
  expect(out).toContain("Only words");
  expect(out).not.toContain("<ul");
});
