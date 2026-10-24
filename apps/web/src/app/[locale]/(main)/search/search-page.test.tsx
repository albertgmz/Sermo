import { afterAll, afterEach, expect, mock, test } from "bun:test";
import { Fragment } from "react";
import { renderToReadableStream } from "react-dom/server";
import { fakeBackend } from "@/app/[locale]/(staff)/admin/groups/test-backend";
import { translator, withIntl } from "@/lib/test-intl";
import { viewerBody } from "@/lib/test-viewer";

mock.module("server-only", () => ({}));
const intl = await import("next-intl/server");
const { createTranslator } = await import("use-intl");
const { messages } = await import("@/i18n/messages");
// The `details` line takes tags (t.rich): the real translator fills them.
mock.module("next-intl/server", () => ({
  getLocale: async () => "en",
  getTranslations: async (namespace: string) =>
    namespace === "search.search"
      ? createTranslator({ locale: "en", messages, namespace } as never)
      : translator(namespace),
}));
mock.module("next/headers", () => ({
  headers: async () => new Headers(),
  cookies: async () => ({ get: () => undefined, toString: () => "" }),
}));
const nextIntl = { ...(await import("next-intl")) };
const { useTranslations, useFormatter } = await import("use-intl");
mock.module("next-intl", () => ({
  ...nextIntl,
  useLocale: () => "en",
  useTranslations,
  useFormatter,
}));

const { searchPage } = await import("./search-page");

afterAll(() => {
  mock.module("next-intl/server", () => intl);
  mock.module("next-intl", () => nextIntl);
});
let backend: ReturnType<typeof fakeBackend> | undefined;
afterEach(() => backend?.restore());

const when = "2026-01-01T00:00:00.000Z";
const result = (threadId: number, postId: number, position: number) => ({
  post: {
    id: postId,
    position,
    createdAt: when,
    author: { id: 4, username: "ana" },
    excerpt: "garden hose",
  },
  thread: {
    id: threadId,
    title: `Thread ${threadId}`,
    nodeId: 2,
    node: { id: 2, title: "General" },
    prefix: null,
  },
});

async function links(signedIn: boolean) {
  backend = fakeBackend({
    "auth.me": () => Response.json(viewerBody(signedIn)),
    "search.query": () =>
      Response.json({
        items: [result(7, 70, 0), result(8, 81, 5)],
        nextCursor: null,
        total: 2,
      }),
    "users.cards": () => Response.json({ items: [] }),
  });
  const found = await searchPage(
    { query: "garden", titlesOnly: false, author: "" } as never,
    undefined,
    1,
  );
  if ("message" in found) throw new Error(found.message);
  const stream = await renderToReadableStream(
    withIntl(
      <div>
        {found.results.rows.map((row) => (
          <Fragment key={row.key}>{row.node}</Fragment>
        ))}
      </div>,
    ),
  );
  await stream.allReady;
  const html = await new Response(stream).text();
  return [...html.matchAll(/href="(\/threads\/[^"]*)"/g)].map((m) => m[1]);
}

test("a member's search result for a thread opens where they left off; a reply opens that post", async () => {
  expect(await links(true)).toEqual([
    "/threads/7/unread",
    "/threads/8#post-81",
  ]);
});

test("a guest's search result for a thread opens its start", async () => {
  expect(await links(false)).toEqual(["/threads/7", "/threads/8#post-81"]);
});
