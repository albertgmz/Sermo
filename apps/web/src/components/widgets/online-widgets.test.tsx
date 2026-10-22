import { afterAll, afterEach, beforeEach, expect, mock, test } from "bun:test";
import { renderToReadableStream } from "react-dom/server";
import { messages } from "@/i18n/messages";
import { widgetBody } from "@/lib/test-bodies";
import { formattedTranslator, withIntl } from "@/lib/test-intl";
import { viewerBody } from "@/lib/test-viewer";

const realFetch = globalThis.fetch;

mock.module("server-only", () => ({}));
mock.module("next/headers", () => ({
  headers: async () => new Headers(),
  cookies: async () => ({ get: () => undefined, toString: () => "" }),
}));
const intlServer = await import("next-intl/server");
mock.module("next-intl/server", () => ({
  getLocale: async () => "en",
  getFormatter: async () => ({ number: (value: number) => String(value) }),
  getTranslations: async (namespace: string) => formattedTranslator(namespace),
}));
const intl = { ...(await import("next-intl")) };
const { useTranslations, useFormatter } = await import("use-intl");
mock.module("next-intl", () => ({
  ...intl,
  useLocale: () => "en",
  useTranslations,
  useFormatter,
}));

const { viewerOfRequest } = await import("@/lib/sermo/client");
const { WidgetArea } = await import("./widget-area");

afterAll(() => {
  mock.module("next-intl/server", () => intlServer);
  mock.module("next-intl", () => intl);
});
// Another test file leaves a stand-in for the viewer in place: the widgets ask the backend.
beforeEach(() => {
  mock.module("@/lib/sermo/session", () => ({ getViewer: viewerOfRequest }));
});
afterEach(() => {
  globalThis.fetch = realFetch;
});

const titles = messages.widgets.widgetArea.titles;
const context = { params: {}, widgets: [], href: () => "/" };

const card = (id: number, username: string, over = {}) => ({
  id,
  username,
  avatar: null,
  frame: null,
  nameColor: null,
  nameIcon: null,
  title: "",
  badges: [],
  level: 1,
  restricted: false,
  ...over,
});
const minutesAgo = (minutes: number) =>
  new Date(Date.now() - minutes * 60_000).toISOString();

const refusal = () =>
  Response.json(
    { error: { code: "forbidden", message: "Not for you." } },
    { status: 403 },
  );

type Answer = () => Response;
const asked: string[] = [];
function backend(answers: Record<string, Answer>) {
  asked.length = 0;
  globalThis.fetch = (async (url: string) => {
    const { pathname } = new URL(url);
    if (pathname === "/api/v1/me") return Response.json(viewerBody(false));
    asked.push(pathname);
    const answer = answers[pathname];
    return answer ? answer() : Response.json({ items: [] });
  }) as unknown as typeof fetch;
}

async function draw(...widgets: ReturnType<typeof widgetBody>[]) {
  const errors: unknown[] = [];
  const stream = await renderToReadableStream(
    withIntl(<WidgetArea widgets={widgets as never} context={context} />),
    {
      onError: (error) => {
        errors.push(error);
      },
    },
  );
  await stream.allReady;
  return { html: await new Response(stream).text(), errors };
}

const online = (options: Record<string, unknown> = {}) =>
  widgetBody({
    id: 1,
    position: "overview_bottom",
    type: "recentlyActive",
    options,
  });
const totals = widgetBody({
  id: 2,
  position: "novedades_sidebar",
  type: "siteTotals",
});

const RECENT = "/api/v1/members/recently-active";
const STATS = "/api/v1/site/stats";

test("the members seen in the last 24 hours are named in the order given, with the total and a link to the members", async () => {
  backend({
    [RECENT]: () =>
      Response.json({
        total: 230,
        items: [
          { card: card(7, "nova"), lastActivityAt: minutesAgo(2) },
          { card: card(8, "wren"), lastActivityAt: minutesAgo(600) },
        ],
      }),
  });
  const { html, errors } = await draw(online());
  expect(errors).toEqual([]);
  expect(html).toContain(titles.recentlyActive);
  expect(html).toContain('href="/members"');
  expect(html.indexOf("nova")).toBeGreaterThan(-1);
  expect(html.indexOf("nova")).toBeLessThan(html.indexOf("wren"));
  // The backend's total is more than it lists: a comma after each name, then the rest counted.
  expect(html.match(/aria-hidden="true"[^>]*>,</g)).toHaveLength(2);
  expect(html).toContain("and 228 more");
  expect(html).toContain("Total: 230");
  // Names, not pictures.
  expect(html).not.toContain("<img");
  expect(asked).toEqual([RECENT]);
});

test("only the first names are listed, the rest are counted", async () => {
  backend({
    [RECENT]: () =>
      Response.json({
        total: 230,
        items: [
          { card: card(7, "nova"), lastActivityAt: minutesAgo(2) },
          { card: card(8, "wren"), lastActivityAt: minutesAgo(3) },
          { card: card(9, "juniper"), lastActivityAt: minutesAgo(4) },
        ],
      }),
  });
  const { html } = await draw(online({ limit: 2 }));
  expect(html).toContain("nova");
  expect(html).toContain("wren");
  expect(html).not.toContain("juniper");
  // 230 in all, two named.
  expect(html).toContain("and 228 more");
  expect(html).toContain("Total: 230");
  expect(html.match(/aria-hidden="true"[^>]*>,</g)).toHaveLength(2);
  // Everyone named: no tail.
  backend({
    [RECENT]: () =>
      Response.json({
        total: 1,
        items: [{ card: card(7, "nova"), lastActivityAt: minutesAgo(2) }],
      }),
  });
  expect((await draw(online({ limit: 2 }))).html).not.toContain(" more");
});

test("the shorter window lists only those seen in the last 15 minutes, and counts them", async () => {
  backend({
    [RECENT]: () =>
      Response.json({
        total: 40,
        items: [
          { card: card(7, "nova"), lastActivityAt: minutesAgo(3) },
          { card: card(8, "wren"), lastActivityAt: minutesAgo(14) },
          { card: card(9, "juniper"), lastActivityAt: minutesAgo(16) },
        ],
      }),
  });
  const { html } = await draw(online({ window: "15m" }));
  expect(html).toContain(messages.widgets.recentlyActive.nowTitle);
  expect(html).not.toContain(titles.recentlyActive);
  expect(html).toContain("nova");
  expect(html).toContain("wren");
  expect(html).not.toContain("juniper");
  expect(html).toContain("Total: 2");
});

test("a title given to the widget replaces the default", async () => {
  backend({
    [RECENT]: () =>
      Response.json({
        total: 1,
        items: [{ card: card(7, "nova"), lastActivityAt: minutesAgo(1) }],
      }),
  });
  const { html } = await draw({ ...online(), title: "Who is around" });
  expect(html).toContain("Who is around");
  expect(html).not.toContain(titles.recentlyActive);
});

test("nobody online, or a visitor who may not list members, draws nothing and no error", async () => {
  backend({ [RECENT]: () => Response.json({ total: 0, items: [] }) });
  let drawn = await draw(online());
  expect(drawn.errors).toEqual([]);
  expect(drawn.html).not.toContain("<section");
  backend({
    [RECENT]: () =>
      Response.json({
        total: 1,
        items: [{ card: card(7, "nova"), lastActivityAt: minutesAgo(40) }],
      }),
  });
  drawn = await draw(online({ window: "15m" }));
  expect(drawn.html).not.toContain("<section");
  backend({ [RECENT]: refusal });
  drawn = await draw(online());
  expect(drawn.errors).toEqual([]);
  expect(drawn.html).not.toContain(titles.recentlyActive);
});

test("the site totals show threads, messages, members and the newest member", async () => {
  backend({
    [STATS]: () =>
      Response.json({
        threads: 1200,
        posts: 98000,
        members: 67000,
        latestMember: card(7, "nova"),
      }),
  });
  const { html, errors } = await draw(totals);
  expect(errors).toEqual([]);
  expect(html).toContain(titles.siteTotals);
  for (const text of [
    messages.widgets.siteTotals.threads,
    messages.widgets.siteTotals.posts,
    messages.widgets.siteTotals.members,
    messages.widgets.siteTotals.latestMember,
    "1200",
    "98000",
    "67000",
  ])
    expect(html, text).toContain(text);
  expect(html).toContain('href="/members/7"');
  expect(html).toContain("nova");
});

test("the site totals leave out the newest member when the backend gives none, and draw nothing when refused", async () => {
  backend({
    [STATS]: () =>
      Response.json({ threads: 1, posts: 2, members: 3, latestMember: null }),
  });
  let drawn = await draw(totals);
  expect(drawn.html).toContain(messages.widgets.siteTotals.members);
  expect(drawn.html).not.toContain(messages.widgets.siteTotals.latestMember);
  backend({ [STATS]: refusal });
  drawn = await draw(totals);
  expect(drawn.errors).toEqual([]);
  expect(drawn.html).not.toContain(titles.siteTotals);
});

test("both widgets are in the registry", async () => {
  const { WIDGET_ENTRIES } = await import("./registry");
  expect(Object.hasOwn(WIDGET_ENTRIES, "recentlyActive")).toBe(true);
  expect(Object.hasOwn(WIDGET_ENTRIES, "siteTotals")).toBe(true);
});
