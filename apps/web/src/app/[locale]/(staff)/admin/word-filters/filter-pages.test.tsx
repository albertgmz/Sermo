import { afterAll, afterEach, expect, mock, test } from "bun:test";
import { renderToReadableStream } from "react-dom/server";
import { translator, withIntl } from "@/lib/test-intl";
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
  getTranslations: async (namespace: string) => translator(namespace, true),
}));

const { FilterList } = await import("./filter-list");
const EditFilterPage = (await import("./[id]/page")).default;
const NewFilterPage = (await import("./new/page")).default;

afterEach(() => {
  globalThis.fetch = realFetch;
});
afterAll(() => {
  mock.module("next-intl/server", () => intl);
  mock.module("next-intl", () => nextIntl);
});

const FILTERS = [
  {
    id: 4,
    term: "heck",
    action: "replace",
    replacement: "h*ck",
    isActive: true,
  },
  {
    id: 9,
    term: "darn",
    action: "moderate",
    replacement: null,
    isActive: false,
  },
];

function backend(manage: boolean) {
  globalThis.fetch = (async (input: string) => {
    const { pathname } = new URL(input);
    if (pathname === "/api/v1/me") {
      return Response.json({
        ...viewerBody(true),
        resolvedPermissions: { "wordFilter.manage": manage },
      });
    }
    if (pathname === "/api/v1/moderation/word-filters") {
      return Response.json({ items: FILTERS });
    }
    throw new Error(`Unexpected ${pathname}`);
  }) as unknown as typeof fetch;
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

test("a manager's rows lead to the edit page and keep the remove step", async () => {
  backend(true);
  const { html } = await draw(
    <FilterList searchParams={Promise.resolve({})} />,
  );
  expect(html).toContain('href="/admin/word-filters/4"');
  expect(html).toContain('href="/admin/word-filters/9"');
  expect(html).toContain('aria-label="Edit heck"');
  expect(html).toContain("Remove filter");
  // The switch stays in the form: there is no action that only flips it.
  expect(html).not.toContain('role="switch"');
  expect(html).toContain("Replaced with h*ck");
  expect(html).toContain("Hold the post for moderation");
  expect(html).toContain("Off");
});

test("a reader sees what each filter does but has no edit link and no remove step", async () => {
  backend(false);
  const { html } = await draw(
    <FilterList searchParams={Promise.resolve({})} />,
  );
  expect(html).toContain("heck");
  expect(html).toContain("Replaced with h*ck");
  expect(html).not.toContain("/admin/word-filters/");
  expect(html).not.toContain("Remove filter");
});

test("the edit page sends the same fields as the old row form, with the word fixed", async () => {
  backend(true);
  const { html } = await draw(
    <EditFilterPage
      params={Promise.resolve({ locale: "en", id: "4" })}
      searchParams={Promise.resolve({})}
    />,
  );
  const word = /<input[^>]*name="term"[^>]*>/.exec(html)?.[0] ?? "";
  expect(word).toContain('value="heck"');
  expect(word).toContain("readOnly");
  expect(html).toContain('name="action"');
  expect(html).toContain('<option value="replace" selected="">');
  expect(html).toMatch(/name="replacement"[^>]*value="h\*ck"/);
  expect(html).toMatch(/<input[^>]*name="isActive"[^>]*checked/);
  expect(html).not.toContain('name="creating"');
  expect(html).toContain("Remove filter");
});

test("the new page adds a filter: the creating marker, an empty word, active by default", async () => {
  backend(true);
  const { html } = await draw(<NewFilterPage />);
  expect(html).toContain('name="creating"');
  const word = /<input[^>]*name="term"[^>]*>/.exec(html)?.[0] ?? "";
  expect(word).not.toContain("readOnly");
  expect(html).toMatch(/<input[^>]*name="isActive"[^>]*checked/);
});

test("neither page opens for someone who may only read the filters", async () => {
  backend(false);
  const edit = await draw(
    <EditFilterPage
      params={Promise.resolve({ locale: "en", id: "4" })}
      searchParams={Promise.resolve({})}
    />,
  );
  expect(digest(edit.failures).join()).toContain("404");
  const added = await draw(<NewFilterPage />);
  expect(digest(added.failures).join()).toContain("404");
});

test("a filter that does not exist is a 404", async () => {
  backend(true);
  const { failures } = await draw(
    <EditFilterPage
      params={Promise.resolve({ locale: "en", id: "77" })}
      searchParams={Promise.resolve({})}
    />,
  );
  expect(digest(failures).join()).toContain("404");
});
