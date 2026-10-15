import { afterAll, beforeEach, expect, mock, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { withIntl } from "@/lib/test-intl";

mock.module("server-only", () => ({}));
const intl = { ...(await import("next-intl/server")) };
const headersModule = { ...(await import("next/headers")) };
const art = { ...(await import("@/components/forum/art")) };
let cookie = "";
mock.module("next/headers", () => ({
  headers: async () => new Headers(),
  cookies: async () => ({ get: () => undefined, toString: () => cookie }),
}));
mock.module("next-intl/server", () => ({
  getLocale: async () => "en",
  getTranslations: async () => (key: string, values?: Record<string, string>) =>
    values ? `${key}:${Object.values(values).join(",")}` : key,
}));
// The gate reads the visitor's LITE choice on the server; the page is the thing under test here.
mock.module("@/components/forum/art", () => ({
  LazyArt: ({ src, category }: { src: string; category: string }) => (
    <span data-art={`${category} ${src}`} />
  ),
}));
const { mediaPage } = await import("./media-page");

beforeEach(() => {
  cookie = "";
});

afterAll(() => {
  mock.module("next-intl/server", () => intl);
  mock.module("next/headers", () => headersModule);
  mock.module("@/components/forum/art", () => art);
});

const file = (id: number, thumbnail: boolean) => ({
  fileId: id,
  url: `/api/v1/files/${id}`,
  contentType: "image/png",
  byteSize: 1,
  width: 10,
  height: 10,
  thumbnailUrl: thumbnail ? `/api/v1/files/${id + 1000}` : null,
});

function reader(answer: unknown) {
  const asked: unknown[] = [];
  const read = (async (_contract: unknown, input: unknown) => {
    asked.push(input);
    return answer;
  }) as never;
  return { read, asked };
}

test("a page of pictures is one row holding a grid of links to where each is", async () => {
  const { read, asked } = reader({
    nextCursor: "next",
    items: [
      {
        type: "post",
        id: 30,
        createdAt: "2026-01-01T00:00:00.000Z",
        file: file(7, true),
        postId: 99,
        position: 0,
        threadId: 5,
        threadTitle: "Holiday",
      },
      {
        type: "profilePost",
        id: 29,
        createdAt: "2026-01-01T00:00:00.000Z",
        file: file(6, false),
        profilePostId: 4,
        profileUserId: 12,
      },
    ],
  });
  const page = await mediaPage("c1", read);
  expect(asked).toEqual([{ cursor: "c1" }]);
  expect(page.nextCursor).toBe("next");
  expect(page.rows).toHaveLength(1);
  expect(page.rows[0]?.key).toBe("media-30");
  const html = renderToStaticMarkup(withIntl(page.rows[0]?.node));
  expect(html).toContain('href="/threads/5#post-99"');
  expect(html).toContain('aria-label="inThread:Holiday"');
  // The thumbnail is drawn through the gate of the post pictures, never the original.
  expect(html).toContain('data-art="postImages /api/v1/files/1007"');
  expect(html).toContain('href="/members/12?post=4#profile-post-4"');
  expect(html).toContain('aria-label="onProfile"');
  // A picture with no thumbnail is not fetched at all: an icon stands in for it.
  expect(html).not.toContain("/api/v1/files/6");
  expect(html).not.toContain("/api/v1/files/7");
});

test("a page with nothing to show has no rows, and keeps the cursor to go on", async () => {
  const { read } = reader({ nextCursor: "more", items: [] });
  expect(await mediaPage(undefined, read)).toEqual({
    rows: [],
    nextCursor: "more",
  });
});

const items = [
  {
    type: "post",
    id: 30,
    createdAt: "2026-01-01T00:00:00.000Z",
    file: file(7, true),
    postId: 99,
    position: 0,
    threadId: 5,
    threadTitle: "Holiday",
  },
  {
    type: "profilePost",
    id: 29,
    createdAt: "2026-01-01T00:00:00.000Z",
    file: file(6, false),
    profilePostId: 4,
    profileUserId: 12,
  },
];

// The pictures the page tells the viewer about are the props of its grid.
async function entriesOf() {
  const { read } = reader({ nextCursor: null, items });
  const page = await mediaPage(undefined, read);
  const grid = page.rows[0]?.node as {
    props: { entries: { ref: unknown; url: string | null; id: number }[] };
  };
  return grid.props.entries;
}

test("each card names where the picture is, and the viewer is told what each one is", async () => {
  const { read } = reader({ nextCursor: null, items });
  const page = await mediaPage(undefined, read);
  const html = renderToStaticMarkup(withIntl(page.rows[0]?.node));
  expect(html).toContain(">Holiday<");
  expect(html).toContain(">wallPost<");
  expect(await entriesOf()).toEqual([
    {
      id: 30,
      ref: { kind: "post", contentId: 99, fileId: 7 },
      url: "/api/v1/files/7",
      width: 10,
      height: 10,
      label: "inThread:Holiday",
    },
    {
      id: 29,
      ref: { kind: "wall", contentId: 4, fileId: 6 },
      url: "/api/v1/files/6",
      width: 10,
      height: 10,
      label: "onProfile",
    },
  ]);
});

test("with post pictures blocked by LITE the viewer is told no address at all", async () => {
  cookie = "forum_lite=all";
  const entries = await entriesOf();
  expect(entries.map((entry) => entry.url)).toEqual([null, null]);
  // The original is nowhere in what the browser is sent (the thumbnails go through the art gate).
  expect(JSON.stringify(entries)).not.toContain("/api/v1/files/");
});
