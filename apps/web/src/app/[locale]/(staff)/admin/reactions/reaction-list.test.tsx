import { afterAll, afterEach, expect, mock, test } from "bun:test";
import { renderToReadableStream } from "react-dom/server";
import { messages } from "@/i18n/messages";
import { formattedTranslator, withIntl } from "@/lib/test-intl";
import { viewerBody } from "@/lib/test-viewer";
import { fakeBackend } from "../groups/test-backend";

mock.module("server-only", () => ({}));
mock.module("next/headers", () => ({
  headers: async () => new Headers(),
  cookies: async () => ({ get: () => undefined, toString: () => "" }),
}));
const intl = await import("next-intl/server");
mock.module("next-intl/server", () => ({
  getLocale: async () => "en",
  getTranslations: async (namespace: string) => formattedTranslator(namespace),
  getFormatter: async () => ({
    number: (value: number, options?: Intl.NumberFormatOptions) =>
      new Intl.NumberFormat("en", options).format(value),
  }),
}));

const { ReactionList } = await import("./reaction-list");

let backend: ReturnType<typeof fakeBackend> | undefined;
afterEach(() => backend?.restore());
afterAll(() => {
  mock.module("next-intl/server", () => intl);
});

const TYPE = {
  id: 4,
  title: "Like",
  emoji: "x",
  score: 1,
  position: 1,
  isActive: true,
  image: null,
  frames: null,
  forumIds: [],
  hideWhenLocked: false,
  rule: { match: "all", conditions: [] },
  access: "open",
  lockHint: null,
};

async function page(items: unknown[]) {
  backend = fakeBackend({
    "auth.me": () => Response.json(viewerBody(false)),
    "reactionTypes.list": () => Response.json({ items }),
  });
  const stream = await renderToReadableStream(
    withIntl(
      await ReactionList({
        searchParams: Promise.resolve({}),
        addAction: <a href="/admin/reactions/new">Add</a>,
      }),
    ),
  );
  await stream.allReady;
  return new Response(stream).text();
}

const text = messages.adminContent.reactions.list;

test("each type is a row leading to its edit page, with its signed score", async () => {
  const html = await page([
    TYPE,
    { ...TYPE, id: 5, title: "Dislike", score: -1, position: 2 },
    { ...TYPE, id: 6, title: "Thanks", score: 0, position: 3 },
  ]);
  for (const id of [4, 5, 6])
    expect(html).toContain(`href="/admin/reactions/${id}"`);
  expect(html).toContain("Edit Like");
  expect(html).toMatch(/<\/span>\+1<\/span>/);
  expect(html).toMatch(/<\/span>-1<\/span>/);
  expect(html).toMatch(/<\/span>0<\/span>/);
  expect(html).not.toContain(text.inactive);
});

test("the switch posts the type's id and the flipped state, after a confirm step", async () => {
  const html = await page([
    TYPE,
    { ...TYPE, id: 5, title: "Dislike", isActive: false },
  ]);
  expect(html).toContain('name="id" value="4"');
  expect(html).toMatch(
    /name="id" value="4"\/><input type="hidden" name="active" value="0"\/>/,
  );
  expect(html).toMatch(
    /name="id" value="5"\/><input type="hidden" name="active" value="1"\/>/,
  );
  // The switch opens the step instead of submitting at once.
  expect(html).toMatch(/type="button" role="switch" aria-checked="true"/);
  expect(html).toContain('aria-label="Offer Like"');
  expect(html).toContain(text.inactive);
});

test("a row says what limits its type", async () => {
  const html = await page([
    {
      ...TYPE,
      image: { fileId: 1, url: "/api/v1/files/1" },
      frames: { width: 32, height: 32, count: 2, columns: 2 },
      forumIds: [3, 7],
      rule: {
        match: "all",
        conditions: [{ criterion: "posts", value: 5 }],
      },
    },
  ]);
  expect(html).toContain(
    "Animated, 2 frames · In 2 forums · Limited by a rule",
  );
});

test("with no types the list offers to add one", async () => {
  const html = await page([]);
  expect(html).toContain(text.emptyTitle);
  expect(html).toContain('href="/admin/reactions/new"');
});
