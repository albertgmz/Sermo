import { afterAll, afterEach, expect, mock, spyOn, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { viewerBody } from "@/lib/test-viewer";

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

let cookie: string | undefined;
mock.module("server-only", () => ({}));
mock.module("next/headers", () => ({
  headers: async () => new Headers(),
  cookies: async () => ({
    get: () => (cookie === undefined ? undefined : { value: cookie }),
    toString: () => "",
  }),
}));
const intl = await import("next-intl/server");
mock.module("next-intl/server", () => ({
  getLocale: async () => "en",
  getTranslations: async () => (key: string) => key,
  getFormatter: async () => ({}),
}));
// The parts of the banner that need the app router or the request are replaced by markers.
const html = await import("@/components/forum/html-content");
mock.module("@/components/forum/html-content", () => ({
  HtmlContent: (props: { children: string }) => (
    <div data-html="">{props.children}</div>
  ),
}));
const dismiss = await import("@/components/forum/notice-dismiss-button");
mock.module("@/components/forum/notice-dismiss-button", () => ({
  NoticeDismissButton: (props: { id: number }) => (
    <button type="submit" data-dismiss={props.id} />
  ),
}));

const { NoticeBanner, NoticeStrip } = await import("./notice-banner");

afterAll(() => {
  mock.module("next-intl/server", () => intl);
  mock.module("@/components/forum/html-content", () => html);
  mock.module("@/components/forum/notice-dismiss-button", () => dismiss);
});

const items = [
  {
    id: 1,
    title: "Maintenance",
    bodyHtml: "<p>Tonight</p>",
    dismissible: true,
  },
  { id: 2, title: "Rules", bodyHtml: "<p>Read them</p>", dismissible: false },
];

function backend(answer: () => Response) {
  globalThis.fetch = (async (input: string) =>
    new URL(input).pathname.endsWith("/me")
      ? Response.json(viewerBody(false))
      : answer()) as unknown as typeof fetch;
}

async function draw() {
  const banner = (await NoticeBanner()) as {
    props: Parameters<typeof NoticeStrip>[0];
  } | null;
  return banner ? renderToStaticMarkup(await NoticeStrip(banner.props)) : "";
}

test("each notice shows its title and text, with a dismiss button only when it can be dismissed", async () => {
  cookie = undefined;
  backend(() => Response.json({ items }));
  const markup = await draw();
  expect(markup).toContain("Maintenance");
  expect(markup).toContain("Tonight");
  expect(markup).toContain("Rules");
  expect(markup).toContain('data-dismiss="1"');
  expect(markup).not.toContain('data-dismiss="2"');
});

test("a notice a guest dismissed is never drawn", async () => {
  cookie = "1";
  backend(() => Response.json({ items }));
  const markup = await draw();
  expect(markup).not.toContain("Maintenance");
  expect(markup).toContain("Rules");
  // A notice that cannot be dismissed stays, whatever the cookie says.
  cookie = "1.2";
  expect(await draw()).toContain("Rules");
});

test("no notices draws nothing", async () => {
  cookie = undefined;
  backend(() => Response.json({ items: [] }));
  expect(await NoticeBanner()).toBeNull();
});

test("a failed read draws nothing and does not break the page", async () => {
  cookie = undefined;
  const quiet = spyOn(console, "error").mockImplementation(() => {});
  try {
    backend(() =>
      Response.json(
        { error: { code: "internal", message: "Broken" } },
        { status: 500 },
      ),
    );
    expect(await NoticeBanner()).toBeNull();
  } finally {
    quiet.mockRestore();
  }
});
