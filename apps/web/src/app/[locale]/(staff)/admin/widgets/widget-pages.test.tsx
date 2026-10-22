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
    list: (items: string[]) => items.join(" and "),
  }),
  getTranslations: async (namespace: string) => translator(namespace, true),
}));

// What the site draws is fixed here, so that the types and positions it learns to draw later do not
// change what these tests say is "not shown yet". The real lists are held by the widget tests.
const body = () => null;
mock.module("@/components/widgets/registry", () => ({
  WIDGET_ENTRIES: {
    forumStats: { Body: body },
    rankedThreads: { Body: body },
    suggestedMembers: { Body: body },
  },
}));
const DRAWN_PAGES = {
  home: [
    "overview_top",
    "forum_list_above",
    "forum_list_sidebar",
    "sidebar_top",
    "sidebar_bottom",
  ],
  novedades: [
    "overview_top",
    "novedades_above",
    "sidebar_top",
    "novedades_sidebar",
    "sidebar_bottom",
  ],
  // A page with no address of its own.
  forum: ["forum_view_sidebar"],
};
mock.module("@/components/widgets/widget-area", () => ({
  DRAWN_PAGES,
  DRAWN_POSITIONS: [...new Set(Object.values(DRAWN_PAGES).flat())],
}));

const { WidgetList } = await import("./widget-list");
const NewWidgetPage = (await import("./new/page")).default;
const EditWidgetPage = (await import("./[id]/page")).default;
const SortWidgetsPage = (await import("./sort/page")).default;

let backend: ReturnType<typeof fakeBackend> | undefined;
afterEach(() => backend?.restore());
afterAll(() => {
  mock.module("next-intl/server", () => intl);
  mock.module("next-intl", () => nextIntl);
});

const NO_RULE = { match: "all", conditions: [] };
const base = {
  displayOrder: 0,
  title: null,
  phones: true,
  isEnabled: true,
  rule: NO_RULE,
  createdAt: "2026-04-01T00:00:00.000Z",
  updatedAt: "2026-04-01T00:00:00.000Z",
};
const STATS = {
  ...base,
  id: 1,
  type: "forumStats",
  position: "forum_list_above",
  options: { limit: 12, topPosters: true },
};
const RANKED = {
  ...base,
  id: 2,
  type: "rankedThreads",
  position: "novedades_sidebar",
  displayOrder: 0,
  options: { by: "mostReplied", limit: 5 },
};
const MEMBERS = {
  ...base,
  id: 3,
  type: "suggestedMembers",
  position: "novedades_sidebar",
  displayOrder: 1,
  title: "Who to follow",
  phones: false,
  isEnabled: false,
  rule: { match: "all", conditions: [{ criterion: "is_guest", value: 0 }] },
  options: { limit: 4 },
};
// A type and a position the site does not draw yet.
const CARD = {
  ...base,
  id: 4,
  type: "visitorCard",
  position: "members_sidenav",
  options: {},
};
const TEXT = {
  ...base,
  id: 5,
  type: "text",
  position: "sidebar_top",
  options: { body: "Welcome" },
  bodyHtml: "<p>Welcome</p>",
};

function serve(items: unknown[] = [STATS, RANKED, MEMBERS, CARD, TEXT]) {
  backend = fakeBackend({
    "auth.me": () => Response.json(viewerBody(true)),
    "widgets.list": () => Response.json({ items }),
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

// The tag of the control named `name`; the attributes come in any order.
const control = (html: string, name: string) =>
  new RegExp(`<(?:input|textarea|select)[^>]*name="${name}"[^>]*>`).exec(
    html,
  )?.[0] ?? "";

const listed = () =>
  draw(<WidgetList searchParams={Promise.resolve({})} />).then(
    ({ html }) => html,
  );

test("the widgets are listed under their position, each leading to its edit page", async () => {
  serve();
  const html = await listed();
  for (const id of [1, 2, 3, 4, 5])
    expect(html).toContain(`href="/admin/widgets/${id}"`);
  // The position's heading comes before its widgets, and the positions in the backend's order.
  const at = (text: string) => html.indexOf(text);
  expect(at("Above the forum list")).toBeGreaterThan(-1);
  expect(at("Above the forum list")).toBeLessThan(at("Forum statistics"));
  expect(at("What's new sidebar")).toBeLessThan(at("Most replied"));
  expect(at("Most replied")).toBeLessThan(at("Who to follow"));
  expect(at("Above the forum list")).toBeLessThan(at("What's new sidebar"));
  expect(html).toContain("Shown on: Home");
  expect(html).toContain("Shown on: What&#x27;s new".replace("&#x27;", "'"));
});

// The row of the list that holds `text`.
// The card (a section) of the list that holds `text`.
const rowOfCard = (html: string, text: string) =>
  html
    .split("<section")
    .find((card) => new RegExp(`<h2[^>]*>${text}`).test(card)) ?? "";

// The headings of the position cards, in the order they come.
const headings = (html: string) =>
  [...html.matchAll(/<h2[^>]*>(.*?)<\/h2>/g)].map(([, heading]) => heading);

const rowOf = (html: string, text: string) =>
  html.split("<li").find((row) => row.includes(text)) ?? "";

test("a widget with a title of its own names its type, its audience and its state", async () => {
  serve();
  const html = await listed();
  const row = rowOf(html, "Who to follow");
  expect(row).toContain("Members to follow");
  expect(row).toContain("Members");
  expect(row).toContain("Off");
  expect(row).toContain("Hidden on phones");
  // One with the default title says only its audience, and has no state badge.
  const plain = rowOf(html, "Forum statistics");
  expect(plain).toContain("Everyone");
  expect(plain).not.toContain("Off");
  expect(plain).not.toContain("Hidden on phones");
});

test("a thread list is named after the list it shows", async () => {
  serve();
  const html = await listed();
  expect(html).toContain("Most replied");
});

test("a type or a position the site does not draw yet is listed, marked as not shown", async () => {
  serve();
  const html = await listed();
  // One badge for the members column position and the visitor card in it; the drawn ones have none.
  expect(rowOf(html, "Visitor card")).toContain("Not shown yet");
  expect(rowOf(html, "Forum statistics")).not.toContain("Not shown yet");
  expect(rowOf(html, "Most replied")).not.toContain("Not shown yet");
  // The text widget is drawn by no entry yet, though its position is.
  expect(rowOf(html, "Text")).toContain("Not shown yet");
});

test("each widget can be edited, duplicated into a position and deleted from its row", async () => {
  serve([STATS]);
  const html = await listed();
  expect(html).toContain("Edit Forum statistics");
  expect(html).toContain("Duplicate");
  expect(html).toMatch(/<input[^>]*name="id"[^>]*value="1"/);
  expect(html).toContain('name="position"');
  expect(html).toContain("Delete");
  expect(html).toContain("Delete “Forum statistics”?");
});

test("a position with two or more widgets offers its order, and every position offers an add", async () => {
  serve();
  const html = await listed();
  expect(html).toContain(
    'href="/admin/widgets/sort?position=novedades_sidebar"',
  );
  expect(html).not.toContain(
    'href="/admin/widgets/sort?position=forum_list_above"',
  );
  expect(html).toContain('href="/admin/widgets/new?position=forum_list_above"');
});

test("the positions with no widget are rows of their own, to add the first", async () => {
  serve([STATS]);
  const html = await listed();
  expect(html).toContain("Positions with no widgets");
  expect(html).toContain('aria-label="Add a widget to Top of the page"');
  expect(html).toContain('href="/admin/widgets/new?position=overview_top"');
  expect(html).toContain('href="/admin/widgets/new?position=sidebar_bottom"');
  // The position that has a widget is a list of its own, not a row among the empty ones.
  expect(html).not.toContain(
    'aria-label="Add a widget to Above the forum list"',
  );
});

test("the new page first asks for a type, each a link carrying the position", async () => {
  serve();
  const { html } = await draw(
    <NewWidgetPage
      params={Promise.resolve({ locale: "en" })}
      searchParams={Promise.resolve({ position: "sidebar_top" })}
    />,
  );
  expect(html).toContain("Choose a type");
  expect(html).toContain(
    'href="/admin/widgets/new?type=forumStats&amp;position=sidebar_top"',
  );
  expect(html).toContain(
    'href="/admin/widgets/new?type=text&amp;position=sidebar_top"',
  );
  // A type the site cannot draw yet is offered, marked.
  const card =
    html.split("<li").find((row) => row.includes("Visitor card")) ?? "";
  expect(card).toContain("Not shown yet");
  expect(html).not.toContain('name="rule"');
});

test("with a type the new page is the form of that type, at the position asked for", async () => {
  serve();
  const { html } = await draw(
    <NewWidgetPage
      params={Promise.resolve({ locale: "en" })}
      searchParams={Promise.resolve({
        type: "forumStats",
        position: "overview_top",
      })}
    />,
  );
  expect(html).toMatch(/<input[^>]*name="type"[^>]*value="forumStats"/);
  expect(html).not.toContain('name="id"');
  expect(html).toMatch(/<option value="overview_top" selected/);
  // The options of the type, with the backend's range and defaults; the phone switch is on.
  const limit = control(html, "option.limit");
  expect(limit).toContain('min="5"');
  expect(limit).toContain('max="20"');
  expect(limit).toContain('value="10"');
  // It has a default, so it may be left empty and shows the default as its hint.
  expect(limit).not.toContain("required");
  expect(limit).toContain('placeholder="10"');
  expect(html).toContain('name="option.topPosters"');
  expect(control(html, "phones")).toContain("checked");
  expect(html).toContain('name="rule"');
  expect(html).toContain('name="title"');
});

test("an unknown type or position falls back to the choice and to no preselection", async () => {
  serve();
  const choice = await draw(
    <NewWidgetPage
      params={Promise.resolve({ locale: "en" })}
      searchParams={Promise.resolve({ type: "nope" })}
    />,
  );
  expect(choice.html).toContain("Choose a type");
  const form = await draw(
    <NewWidgetPage
      params={Promise.resolve({ locale: "en" })}
      searchParams={Promise.resolve({ type: "featured", position: "nowhere" })}
    />,
  );
  expect(form.html).toContain("Choose a position");
  expect(form.html).not.toContain('name="option.');
});

test("the visitor card starts off on phones", async () => {
  serve();
  const { html } = await draw(
    <NewWidgetPage
      params={Promise.resolve({ locale: "en" })}
      searchParams={Promise.resolve({ type: "visitorCard" })}
    />,
  );
  expect(control(html, "phones")).not.toContain("checked");
});

const edit = (id: string) =>
  draw(
    <EditWidgetPage
      params={Promise.resolve({ locale: "en", id })}
      searchParams={Promise.resolve({})}
    />,
  );

test("the edit page links to the page that draws the widget, and to none that has no address of its own", async () => {
  serve([{ ...RANKED, id: 8, position: "forum_view_sidebar" }]);
  const { html } = await edit("8");
  expect(html).not.toContain("View Forum pages");
  expect(html).not.toMatch(/<a[^>]*href="\/"/);
});

test("the edit page holds the widget's values, its id, its type and the steps", async () => {
  serve();
  const { html } = await edit("3");
  expect(html).toMatch(/<input[^>]*name="id"[^>]*value="3"/);
  expect(html).toMatch(/<input[^>]*name="type"[^>]*value="suggestedMembers"/);
  expect(html).toMatch(/<input[^>]*name="title"[^>]*value="Who to follow"/);
  expect(html).toMatch(/<option value="novedades_sidebar" selected/);
  expect(html).toMatch(/<input[^>]*name="option.limit"[^>]*value="4"/);
  expect(html).not.toMatch(/<input[^>]*name="phones"[^>]*checked/);
  expect(html).not.toMatch(/<input[^>]*name="isEnabled"[^>]*checked/);
  expect(html).toContain("Duplicate");
  expect(html).toContain("Delete widget");
  expect(html).toContain('href="/novedades"');
});

test("a text widget is edited through its source", async () => {
  serve();
  const { html } = await edit("5");
  expect(html).toMatch(
    /<textarea[^>]*name="option.body"[^>]*>Welcome<\/textarea>/,
  );
});

test("a widget of a type or in a position the site does not draw says it is kept", async () => {
  serve();
  const { html } = await edit("4");
  expect(html).toContain("does not draw this type of widget yet");
  expect(html).toContain("does not draw this position yet");
  expect(html).not.toContain('href="/novedades"');
  const drawn = await edit("1");
  expect(drawn.html).not.toContain("does not draw");
});

test("a widget that does not exist is a 404", async () => {
  serve();
  const { failures } = await edit("99");
  expect(
    failures.map((error) => String((error as { digest?: unknown }).digest)),
  ).toContain("NEXT_HTTP_ERROR_FALLBACK;404");
});

test("the sort page orders each position with several widgets, and one position when asked", async () => {
  serve([STATS, { ...STATS, id: 6, displayOrder: 1 }, RANKED, MEMBERS]);
  const all = await draw(
    <SortWidgetsPage
      params={Promise.resolve({ locale: "en" })}
      searchParams={Promise.resolve({})}
    />,
  );
  expect(all.html).toContain("Above the forum list");
  expect(all.html).toContain("What's new sidebar");
  expect(all.html).toMatch(/<input[^>]*name="order.1"/);
  expect(all.html).toMatch(/<input[^>]*name="order.3"/);
  expect(all.html).toMatch(
    /<input[^>]*name="position"[^>]*value="novedades_sidebar"/,
  );
  const one = await draw(
    <SortWidgetsPage
      params={Promise.resolve({ locale: "en" })}
      searchParams={Promise.resolve({ position: "novedades_sidebar" })}
    />,
  );
  expect(one.html).toContain("What's new sidebar");
  expect(one.html).not.toContain("Above the forum list");
  // The arrows are buttons, so the order can be changed with the keyboard alone.
  expect(one.html).toContain("Move Who to follow up");
});

test("with no position that has two widgets the sort page says there is nothing to order", async () => {
  serve([STATS, RANKED]);
  const { html } = await draw(
    <SortWidgetsPage
      params={Promise.resolve({ locale: "en" })}
      searchParams={Promise.resolve({})}
    />,
  );
  expect(html).toContain("No position has more than one widget");
});

test("a position says which pages draw it, the global sidebars only the two that do", async () => {
  serve();
  const html = await listed();
  // Only the card's header: its rows are the widgets in it.
  const header = (card: string) => card.slice(0, card.indexOf("<ul"));
  const top = header(rowOfCard(html, "Top of every sidebar"));
  expect(top).toContain(
    "Shown on: Home and What&#x27;s new".replace("&#x27;", "'"),
  );
  expect(top).not.toContain("Forum pages");
  expect(top).not.toContain("Members pages");
  expect(top).not.toContain("Not shown yet");
  // A position no page draws yet says where it is planned and is marked.
  const card = header(rowOfCard(html, "Members side column"));
  expect(card).toContain("Planned for: Members pages");
  expect(card).toContain("Not shown yet");
});

test("the positions come in the order the pages draw them, those no page draws last", async () => {
  serve([STATS, RANKED, CARD, TEXT]);
  const order = headings(await listed()).map((heading) =>
    heading.replace(/<.*/, ""),
  );
  expect(order.slice(0, 4)).toEqual([
    "Above the forum list",
    "Top of every sidebar",
    "What&#x27;s new sidebar".replace("&#x27;", "'"),
    "Members side column",
  ]);
});
