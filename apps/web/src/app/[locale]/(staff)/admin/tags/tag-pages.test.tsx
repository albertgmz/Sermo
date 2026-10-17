import { afterAll, afterEach, expect, mock, test } from "bun:test";
import { renderToReadableStream } from "react-dom/server";
import { formattedTranslator, withIntl } from "@/lib/test-intl";
import { viewerBody } from "@/lib/test-viewer";

const realFetch = globalThis.fetch;
const intl = await import("next-intl/server");
// The rows read their words through the library's hook and the provider of `withIntl`, whatever
// stand-in another suite left in place for it.
const nextIntl = await import("next-intl");
const useIntl = await import("use-intl");
mock.module("next-intl", () => ({
  ...nextIntl,
  useLocale: () => "en",
  useTranslations: useIntl.useTranslations,
}));
mock.module("server-only", () => ({}));
mock.module("next/headers", () => ({
  headers: async () => new Headers(),
  cookies: async () => ({ get: () => undefined, toString: () => "" }),
}));
mock.module("next-intl/server", () => ({
  getLocale: async () => "en",
  getTranslations: async (namespace: string) => formattedTranslator(namespace),
}));

const { TagList } = await import("./tag-list");
const EditTagPage = (await import("./[id]/page")).default;

afterEach(() => {
  globalThis.fetch = realFetch;
});
afterAll(() => {
  mock.module("next-intl/server", () => intl);
  mock.module("next-intl", () => nextIntl);
});

const TAG = {
  id: 12,
  name: "rústico",
  threadCount: 3,
  aliases: ["rustic"],
  createdAt: "2026-01-01T00:00:00.000Z",
};

// The tags the backend lists, and what it was asked.
function backend(items: unknown[] = [TAG], nextCursor: string | null = null) {
  const asked: string[] = [];
  globalThis.fetch = (async (input: string) => {
    const url = new URL(input);
    if (url.pathname === "/api/v1/me") return Response.json(viewerBody(true));
    if (url.pathname === "/api/v1/admin/tags") {
      asked.push(url.search);
      return Response.json({ items, nextCursor });
    }
    throw new Error(`Unexpected ${url.pathname}`);
  }) as unknown as typeof fetch;
  return asked;
}

async function draw(element: React.ReactNode) {
  const failures: unknown[] = [];
  const stream = await renderToReadableStream(withIntl(element), {
    onError: (error) => {
      failures.push(error);
    },
  });
  await stream.allReady;
  const html = (await new Response(stream).text()).replaceAll("&#x27;", "'");
  return { html, failures };
}

const digest = (failures: unknown[]) =>
  failures.map((error) => String((error as { digest?: unknown }).digest));

const here = "/admin/tags/12?name=r%C3%BAstico";

test("a row names the tag, its threads and its old names, and leads to the view, edit and delete", async () => {
  backend();
  const { html } = await draw(<TagList searchParams={Promise.resolve({})} />);
  expect(html).toContain("#rústico");
  expect(html).toContain("3 threads");
  expect(html).toContain("Also answers to #rustic");
  expect(html).toContain(`href="${here}"`);
  expect(html).toContain('href="/tags/r%C3%BAstico"');
  expect(html).toContain("Delete tag");
  // Rename and merge moved to the edit page.
  expect(html).not.toContain('name="into"');
});

test("the search and the cursor still reach the backend, and the next page keeps the search", async () => {
  const asked = backend([TAG], "abc");
  const { html } = await draw(
    <TagList searchParams={Promise.resolve({ q: "rus", cursor: "zz" })} />,
  );
  expect(asked[0]).toContain("query=rus");
  expect(asked[0]).toContain("cursor=zz");
  expect(html).toMatch(/href="\/admin\/tags\?q=rus&(amp;)?cursor=abc"/);
  expect(html).toContain('href="/admin/tags?q=rus"');
});

test("the edit page has the rename, merge and delete forms with the tag's id", async () => {
  backend();
  const { html } = await draw(
    <EditTagPage
      params={Promise.resolve({ locale: "en", id: "12" })}
      searchParams={Promise.resolve({ name: "rústico" })}
    />,
  );
  expect(html.match(/<input[^>]*name="id"[^>]*value="12"/g)).toHaveLength(3);
  expect(html).toMatch(/<input[^>]*name="name"[^>]*value="rústico"/);
  expect(html).toContain('name="into"');
  expect(html).toContain("Rename");
  expect(html).toContain("Merge");
  expect(html).toContain("Delete tag");
});

test("a name that is not the tag's, or an id that is not its own, sends the viewer back to the list", async () => {
  const asked = backend();
  const cases: [string, Record<string, string>][] = [
    ["13", { name: "rústico" }],
    ["12", { name: "rust" }],
    ["12", {}],
  ];
  for (const [id, search] of cases) {
    const { failures } = await draw(
      <EditTagPage
        params={Promise.resolve({ locale: "en", id })}
        searchParams={Promise.resolve(search)}
      />,
    );
    expect(digest(failures).join()).toContain(
      "NEXT_REDIRECT;replace;/admin/tags;",
    );
  }
  // The tag is looked up by its name, one at a time.
  expect(asked[0]).toContain("limit=1");
});

test("a name longer than a tag name can be is a 404, without a read", async () => {
  const asked = backend();
  const { failures } = await draw(
    <EditTagPage
      params={Promise.resolve({ locale: "en", id: "12" })}
      searchParams={Promise.resolve({ name: "a".repeat(121) })}
    />,
  );
  expect(digest(failures).join()).toContain("404");
  expect(asked).toEqual([]);
});

test("the next page keeps the search but not the notice of the last save", async () => {
  backend([TAG], "abc");
  const { html } = await draw(
    <TagList
      searchParams={Promise.resolve({
        q: "rus",
        cursor: "zz",
        notice: "renamed",
      })}
    />,
  );
  expect(html).toContain("Tag renamed.");
  expect(html).toMatch(/href="\/admin\/tags\?q=rus&(amp;)?cursor=abc"/);
  expect(html).not.toMatch(/href="[^"]*notice=/);
});
