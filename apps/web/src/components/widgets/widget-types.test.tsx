import {
  afterAll,
  afterEach,
  beforeEach,
  expect,
  mock,
  spyOn,
  test,
} from "bun:test";
import { renderToReadableStream } from "react-dom/server";
import { createFormatter } from "use-intl";
import { messages } from "@/i18n/messages";
import { widgetBody } from "@/lib/test-bodies";
import { formattedTranslator, withIntl } from "@/lib/test-intl";
import { viewerBody } from "@/lib/test-viewer";

const realFetch = globalThis.fetch;
const realPublicUrl = process.env.SERMO_PUBLIC_URL;

mock.module("server-only", () => ({}));
mock.module("next/headers", () => ({
  headers: async () => new Headers(),
  cookies: async () => ({ get: () => undefined, toString: () => "" }),
}));
const intlServer = await import("next-intl/server");
mock.module("next-intl/server", () => ({
  getLocale: async () => "en",
  getFormatter: async () => createFormatter({ locale: "en", timeZone: "UTC" }),
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
beforeEach(() => {
  process.env.SERMO_PUBLIC_URL = "https://forum.example.test";
  mock.module("@/lib/sermo/session", () => ({ getViewer: viewerOfRequest }));
});
afterEach(() => {
  globalThis.fetch = realFetch;
  if (realPublicUrl === undefined) delete process.env.SERMO_PUBLIC_URL;
  else process.env.SERMO_PUBLIC_URL = realPublicUrl;
});

const titles = messages.widgets.widgetArea.titles;
const context = {
  params: {},
  widgets: [],
  href: (query: [string, string][]) =>
    `/?${new URLSearchParams(query).toString()}`,
};

const card = (id: number, username: string) => ({
  id,
  username,
  avatar: null,
  frame: null,
  nameColor: null,
  nameIcon: null,
  title: "Regular",
  badges: [],
  level: 1,
  restricted: false,
});

const listed = (id: number, username: string, referralCount = 0) => ({
  card: card(id, username),
  createdAt: "2026-01-01T00:00:00.000Z",
  postCount: 0,
  reactionScore: 0,
  awardXp: 0,
  credits: 0,
  awardCount: 0,
  referralCount,
});

const author = (id: number, username: string) => ({
  card: card(id, username),
  cover: null,
  createdAt: "2026-01-01T00:00:00.000Z",
  postCount: 1234,
  reactionScore: 56,
  awardXp: 0,
  currentLevelXp: 0,
  nextLevelXp: 100,
  awards: [],
  signatureHtml: null,
});

const entry = (id: number, username: string, points: number) => ({
  card: card(id, username),
  posts: 3,
  reactions: 4,
  referrals: 1,
  points,
});

const standing = (
  year: number,
  month: number,
  items: ReturnType<typeof entry>[],
) => ({
  items,
  nextCursor: null,
  year,
  month,
  scoring: { postPoints: 1, reactionsPerPoint: 10, referralPoints: 20 },
});

type Answer = (search: URLSearchParams) => Response;
const asked: { path: string; search: URLSearchParams }[] = [];

// The viewer is signed in or a guest; each read answers from `answers` by path, anything else with
// an empty list.
function backend(signedIn: boolean, answers: Record<string, Answer> = {}) {
  asked.length = 0;
  globalThis.fetch = (async (url: string) => {
    const { pathname, searchParams } = new URL(url);
    if (pathname === "/api/v1/me") return Response.json(viewerBody(signedIn));
    asked.push({ path: pathname, search: searchParams });
    const answer = answers[pathname];
    if (answer) return answer(searchParams);
    return Response.json({ items: [], nextCursor: null });
  }) as unknown as typeof fetch;
}

const refused = () =>
  Response.json(
    { error: { code: "forbidden", message: "Not for you." } },
    { status: 403 },
  );

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

const at = "forum_list_sidebar" as const;

// How the page writes an apostrophe.
const escaped = (text: string) => text.replaceAll("'", "&#x27;");

// The visitor card -------------------------------------------------------------------------------

const visitorCard = widgetBody({ id: 1, position: at, type: "visitorCard" });

test("the visitor card shows the signed-in member's name, title and counts", async () => {
  backend(true, {
    "/api/v1/member-authors": () =>
      Response.json({ items: [author(1, "ember")] }),
  });
  const { html, errors } = await draw(visitorCard);
  expect(errors).toEqual([]);
  expect(html).toContain("ember");
  expect(html).toContain("Regular");
  expect(html).toContain("1,234");
  expect(html).toContain(messages.widgetTypes.visitorCard.posts);
  expect(html).toContain(messages.widgetTypes.visitorCard.reactions);
  // Asked for the viewer alone.
  expect(
    asked
      .find((call) => call.path === "/api/v1/member-authors")
      ?.search.get("userIds"),
  ).toBe("1");
});

test("the visitor card draws nothing for a guest, and asks for nobody", async () => {
  backend(false);
  const log = spyOn(console, "error").mockImplementation(() => {});
  const { html, errors } = await draw(visitorCard);
  const logged = log.mock.calls.length;
  log.mockRestore();
  expect(errors).toEqual([]);
  expect(logged).toBe(0);
  expect(html).not.toContain("<section");
  expect(asked).toEqual([]);
});

// Birthdays --------------------------------------------------------------------------------------

const birthdays = (limit: number) =>
  widgetBody({ id: 2, position: at, type: "birthdays", options: { limit } });

test("birthdays shows the members of today up to its limit, under its title", async () => {
  backend(false, {
    "/api/v1/members/birthdays": () =>
      Response.json({
        items: [card(3, "ana"), card(4, "ben"), card(5, "cleo")],
      }),
  });
  const { html, errors } = await draw(birthdays(2));
  expect(errors).toEqual([]);
  expect(html).toContain(escaped(titles.birthdays));
  expect(html).toContain("ana");
  expect(html).toContain("ben");
  expect(html).not.toContain("cleo");
});

test("birthdays draws nothing on a day without one, or when listing members is refused", async () => {
  backend(false);
  expect((await draw(birthdays(12))).html).not.toContain("<section");
  backend(false, { "/api/v1/members/birthdays": refused });
  const { html, errors } = await draw(birthdays(12));
  expect(errors).toEqual([]);
  expect(html).not.toContain(escaped(titles.birthdays));
});

// Top referrers ----------------------------------------------------------------------------------

const referrers = (limit = 5) =>
  widgetBody({ id: 3, position: at, type: "topReferrers", options: { limit } });

test("top referrers ranks by referrals at its own size and leaves out members nobody joined through", async () => {
  backend(false, {
    "/api/v1/members": () =>
      Response.json({
        items: [listed(3, "ana", 41), listed(4, "ben", 7), listed(5, "cleo")],
        nextCursor: null,
      }),
  });
  const { html, errors } = await draw(referrers(3));
  expect(errors).toEqual([]);
  const list = asked.find((call) => call.path === "/api/v1/members");
  expect(list?.search.get("sort")).toBe("referrals");
  expect(list?.search.get("limit")).toBe("3");
  expect(html).toContain(titles.topReferrers);
  expect(html).toContain("ana");
  expect(html).toContain("41");
  expect(html).toContain("ben");
  expect(html).not.toContain("cleo");
});

test("top referrers draws nothing when nobody has referrals, or listing members is refused", async () => {
  backend(false, {
    "/api/v1/members": () =>
      Response.json({ items: [listed(5, "cleo")], nextCursor: null }),
  });
  expect((await draw(referrers())).html).not.toContain("<section");
  backend(false, { "/api/v1/members": refused });
  expect((await draw(referrers())).html).not.toContain(titles.topReferrers);
});

// Referral link ----------------------------------------------------------------------------------

const referralLink = widgetBody({ id: 4, position: at, type: "referralLink" });

test("the referral link carries the signed-in member's id and offers to copy, share and explain it", async () => {
  backend(true);
  const { html, errors } = await draw(referralLink);
  expect(errors).toEqual([]);
  expect(html).toContain(titles.referralLink);
  expect(html).toContain('value="https://forum.example.test/register?ref=1"');
  expect(html).toContain(messages.forum.copyButton.copy);
  expect(html).toContain(messages.forum.shareButton.aria.share);
  expect(html).toContain(messages.widgetTypes.referralLink.whatIsThis);
  expect(html).toContain(messages.widgetTypes.referralLink.explanation);
});

test("the referral link draws nothing for a guest", async () => {
  backend(false);
  const log = spyOn(console, "error").mockImplementation(() => {});
  const { html, errors } = await draw(referralLink);
  const logged = log.mock.calls.length;
  log.mockRestore();
  expect(errors).toEqual([]);
  expect(logged).toBe(0);
  expect(html).not.toContain("<section");
});

// Month standings --------------------------------------------------------------------------------

const month = (options: Record<string, unknown> = {}) =>
  widgetBody({ id: 5, position: at, type: "monthStandings", options });

const byMonth =
  (rows: Record<string, ReturnType<typeof standing>>): Answer =>
  (search) =>
    Response.json(rows[search.get("month") ?? "current"]);

test("month standings lists this month with the points and says how they are counted", async () => {
  backend(false, {
    "/api/v1/standings": byMonth({
      current: standing(2026, 10, [entry(3, "ana", 22.5), entry(4, "ben", 9)]),
    }),
  });
  const { html, errors } = await draw(month({ limit: 2 }));
  expect(errors).toEqual([]);
  const read = asked.find((call) => call.path === "/api/v1/standings");
  expect(read?.search.get("month")).toBe("current");
  expect(read?.search.get("limit")).toBe("2");
  expect(html).toContain(titles.monthStandings);
  expect(html).toContain("October 2026");
  expect(html).toContain("ana");
  expect(html).toContain("22.5");
  expect(html).toContain(
    "Points: 1 per post, 1 per 10 reactions received, 20 per referral.",
  );
  // A narrow column: names and points, not the breakdown of each.
  expect(html).not.toContain(messages.forum.standing.parts.reactions);
  // The whole standing of the month is one link away.
  expect(html).toContain('href="/members/month?month=2026-10"');
});

test("the scoring line follows the site's weights, a single reaction included", async () => {
  backend(false, {
    "/api/v1/standings": () =>
      Response.json({
        ...standing(2026, 10, [entry(3, "ana", 5)]),
        scoring: { postPoints: 3, reactionsPerPoint: 1, referralPoints: 0 },
      }),
  });
  const { html } = await draw(month());
  expect(html).toContain(
    "Points: 3 per post, 1 per reaction received, 0 per referral.",
  );
});

test("the picker is a form that opens the standing of the month chosen", async () => {
  backend(false, {
    "/api/v1/standings": byMonth({
      current: standing(2026, 10, [entry(3, "ana", 5)]),
    }),
  });
  const { html } = await draw(month());
  expect(html).toContain('action="/members/month"');
  expect(html).toContain('type="month"');
  expect(html).toContain('name="month"');
  expect(html).toContain('value="2026-10"');
  expect(html).toContain(messages.widgetTypes.monthPicker.submit);
  // Turned off, the standing has no form.
  backend(false, {
    "/api/v1/standings": byMonth({
      current: standing(2026, 10, [entry(3, "ana", 5)]),
    }),
  });
  const without = await draw(month({ picker: false }));
  expect(without.html).not.toContain("<form");
  expect(without.html).toContain("ana");
});

test("before anyone has points in the new month, the last month is listed", async () => {
  backend(false, {
    "/api/v1/standings": byMonth({
      current: standing(2026, 11, []),
      previous: standing(2026, 10, [entry(3, "ana", 5)]),
    }),
  });
  const { html } = await draw(month());
  expect(asked.map((call) => call.search.get("month"))).toEqual([
    "current",
    "previous",
  ]);
  expect(html).toContain("October 2026");
  expect(html).toContain("ana");
});

test("month standings draws nothing when listing members is refused", async () => {
  backend(false, { "/api/v1/standings": refused });
  const { html, errors } = await draw(month());
  expect(errors).toEqual([]);
  expect(html).not.toContain(titles.monthStandings);
});

// Text -------------------------------------------------------------------------------------------

const text = (title: string | null, bodyHtml: string) =>
  widgetBody({
    id: 6,
    position: "overview_top",
    type: "text",
    options: { body: "Hello" },
    title,
    bodyHtml,
  });

test("a text widget draws the stored body, under its title when it has one", async () => {
  backend(false);
  const titled = await draw(text("Welcome", "<p>Join <strong>us</strong></p>"));
  expect(titled.errors).toEqual([]);
  expect(titled.html).toContain("Welcome");
  expect(titled.html).toContain("<p>Join <strong>us</strong></p>");
  // No request is made for it: the body came with the widget.
  expect(asked).toEqual([]);
  const plain = await draw(text(null, "<p>Just this</p>"));
  expect(plain.html).toContain("<p>Just this</p>");
  expect(plain.html).not.toContain(titles.text);
});

test("a text widget with no rendered body draws nothing", async () => {
  backend(false);
  expect((await draw(text("Empty", ""))).html).not.toContain("Empty");
});

// Skeletons --------------------------------------------------------------------------------------

test("while a new widget loads, its skeleton holds the place under a label that names it", async () => {
  const all: [string, ReturnType<typeof widgetBody>][] = [
    ["visitorCard", visitorCard],
    ["birthdays", birthdays(12)],
    ["topReferrers", referrers()],
    ["referralLink", referralLink],
    ["monthStandings", month({ limit: 3 })],
    ["text", text("Welcome", "<p>Hi</p>")],
  ];
  for (const [type, widget] of all) {
    // Nothing answers, so every body stays in its fallback.
    globalThis.fetch = (async () =>
      new Promise(() => {})) as unknown as typeof fetch;
    const controller = new AbortController();
    const stream = await renderToReadableStream(
      withIntl(<WidgetArea widgets={[widget] as never} context={context} />),
      { signal: controller.signal, onError: () => {} },
    );
    controller.abort();
    const shell = await new Response(stream).text();
    const title = widget.title ?? titles[type as keyof typeof titles];
    expect(shell, type).toContain(escaped(`Loading “${title}”…`));
  }
});

test("a widget kept off phones, the visitor card among them, is hidden there", async () => {
  backend(true, {
    "/api/v1/member-authors": () =>
      Response.json({ items: [author(1, "ember")] }),
  });
  const { html } = await draw({ ...visitorCard, phones: false });
  expect(html).toMatch(
    /<div class="empty:hidden max-md:hidden"><!--\$--><section/,
  );
});
