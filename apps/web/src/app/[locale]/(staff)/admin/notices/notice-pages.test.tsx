import { afterAll, afterEach, expect, mock, test } from "bun:test";
import { renderToReadableStream } from "react-dom/server";
import { CRITERIA_BODY } from "@/lib/test-criteria";
import { translator, withIntl } from "@/lib/test-intl";
import { viewerBody } from "@/lib/test-viewer";
import { fakeBackend } from "../groups/test-backend";

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
  getFormatter: async () => ({
    dateTime: (date: Date) => date.toISOString().slice(0, 10),
  }),
  getTranslations: async (namespace: string) => translator(namespace, true),
}));

const { NoticeList } = await import("./notice-list");
const NewNoticePage = (await import("./new/page")).default;
const EditNoticePage = (await import("./[id]/page")).default;

let backend: ReturnType<typeof fakeBackend> | undefined;
afterEach(() => backend?.restore());
afterAll(() => {
  mock.module("next-intl/server", () => intl);
  mock.module("next-intl", () => nextIntl);
});

const NOTICE = {
  id: 5,
  title: "Maintenance tonight",
  bodySource: "Back at nine.",
  bodyHtml: "<p>Back at nine.</p>",
  rule: { match: "all", conditions: [] },
  dismissible: true,
  active: false,
  startsAt: "2026-05-01T09:30:00.000Z",
  endsAt: null,
  createdAt: "2026-04-01T00:00:00.000Z",
  updatedAt: "2026-04-01T00:00:00.000Z",
};

function serve() {
  backend = fakeBackend({
    "auth.me": () => Response.json(viewerBody(true)),
    "notices.list": () => Response.json({ items: [NOTICE] }),
    "groups.list": () => Response.json({ items: [] }),
    "criteria.list": () =>
      Response.json({
        items: CRITERIA_BODY,
        groups: [],
        awards: [],
        creditRules: [],
        reactionTypes: [],
      }),
    "shopCategories.list": () => Response.json({ items: [] }),
  });
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

// The closed card of the page's dates, if it is closed.
const schedule = (html: string) =>
  /<details(?![^>]*\sopen)[^>]*>[\s\S]*?<\/details>/.exec(html)?.[0] ?? "";

test("a notice is a row leading to its edit page, with its state, audience and dates", async () => {
  serve();
  const { html } = await draw(
    <NoticeList
      searchParams={Promise.resolve({})}
      addAction={<a href="/admin/notices/new">New notice</a>}
    />,
  );
  expect(html).toContain('href="/admin/notices/5"');
  expect(html).toContain("Maintenance tonight");
  expect(html).toContain("Inactive");
  expect(html).toContain("Everyone");
  expect(html).toContain("from 2026-05-01");
});

test("the new page writes a notice with the same fields, its dates in a closed card", async () => {
  serve();
  const { html } = await draw(<NewNoticePage />);
  for (const name of [
    "title",
    "body",
    "dismissible",
    "active",
    "startsAt",
    "endsAt",
  ]) {
    expect(html).toContain(`name="${name}"`);
  }
  expect(html).toContain('name="rule"');
  expect(html).not.toContain('name="id"');
  expect(schedule(html)).toContain('name="startsAt"');
  expect(schedule(html)).toContain('name="endsAt"');
  expect(schedule(html)).not.toContain('name="title"');
});

test("the edit page holds the notice's values, its id and the delete step", async () => {
  serve();
  const { html } = await draw(
    <EditNoticePage
      params={Promise.resolve({ locale: "en", id: "5" })}
      searchParams={Promise.resolve({})}
    />,
  );
  expect(html).toMatch(/<input[^>]*name="id"[^>]*value="5"/);
  expect(html).toMatch(
    /<input[^>]*name="title"[^>]*value="Maintenance tonight"/,
  );
  expect(html).toMatch(
    /<input[^>]*name="startsAt"[^>]*value="2026-05-01T09:30"/,
  );
  expect(html).not.toMatch(/<input[^>]*name="active"[^>]*checked/);
  expect(html).toContain("Delete notice");
});

test("a notice that does not exist is a 404", async () => {
  serve();
  const { failures } = await draw(
    <EditNoticePage
      params={Promise.resolve({ locale: "en", id: "99" })}
      searchParams={Promise.resolve({})}
    />,
  );
  expect(
    failures.map((error) => String((error as { digest?: unknown }).digest)),
  ).toContain("NEXT_HTTP_ERROR_FALLBACK;404");
});
