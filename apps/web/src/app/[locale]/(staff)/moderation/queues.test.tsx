import { afterAll, afterEach, expect, mock, test } from "bun:test";
import { renderToReadableStream } from "react-dom/server";
import { messages } from "@/i18n/messages";
import { withIntl } from "@/lib/test-intl";
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
  getTranslations: async (namespace: string) => {
    const t = (key: string, values?: Record<string, string | number>) => {
      let value: unknown = messages;
      for (const part of `${namespace}.${key}`.split(".")) {
        value = (value as Record<string, unknown> | undefined)?.[part];
      }
      if (typeof value !== "string") return key;
      return value.replace(/\{(\w+)\}/g, (whole, name: string) =>
        values && name in values ? String(values[name]) : whole,
      );
    };
    return Object.assign(t, { has: (key: string) => t(key) !== key });
  },
}));

const { ReportList } = await import("./reports/report-list");
const { ApprovalList } = await import("./approvals/approval-list");

afterEach(() => {
  globalThis.fetch = realFetch;
});
afterAll(() => {
  mock.module("next-intl/server", () => intl);
});

const ROWS = 20;
const at = "2026-01-01T00:00:00.000Z";
const THREAD_PLACE = { kind: "thread", id: 7, title: "Garden tips" } as const;
const PROFILE_PLACE = { kind: "profile", id: 4, title: "Wren" } as const;

// The place and excerpt rows carry: threads and profiles, and a row with none (a message of a
// conversation, which the queues never show).
function context(index: number) {
  if (index % 4 === 3) return { excerpt: "", where: null };
  return {
    excerpt: `Excerpt ${index}`,
    where: index % 4 === 2 ? PROFILE_PLACE : THREAD_PLACE,
  };
}

const TARGETS = [
  "post",
  "post",
  "profile_post",
  "conversation_message",
] as const;

// A backend that answers the two queues and counts every request it gets. Anything that names one
// piece of content is answered "not found" (it still counts), so a page that reads content row
// by row shows it in the count.
function backend(staff: Record<string, unknown> = {}, nodes: unknown[] = []) {
  const asked: string[] = [];
  globalThis.fetch = (async (input: string) => {
    const { pathname } = new URL(input);
    // The visitor is read once per render by the page's layout too, so it is not counted here.
    if (pathname === "/api/v1/me") {
      const viewer = viewerBody(true);
      return Response.json({ ...viewer, staff: { ...viewer.staff, ...staff } });
    }
    asked.push(pathname);
    const group = /^\/api\/v1\/reports\/(\d+)$/.exec(pathname);
    if (pathname === "/api/v1/reports") {
      return Response.json({
        items: Array.from({ length: ROWS }, (_, index) => ({
          id: index + 1,
          targetType: TARGETS[index % 4],
          targetId: 100 + index,
          state: "open",
          assignedToId: null,
          reportCount: 1,
          createdAt: at,
          updatedAt: at,
          resolvedAt: null,
          ...context(index),
        })),
        nextCursor: null,
      });
    }
    if (group) {
      return Response.json({
        id: Number(group[1]),
        targetType: "post",
        targetId: 100,
        state: "open",
        assignedToId: null,
        reportCount: 1,
        createdAt: at,
        updatedAt: at,
        resolvedAt: null,
        reports: [{ id: 1, reporterId: 9, reason: "Spam", createdAt: at }],
      });
    }
    if (pathname === "/api/v1/approval-queue") {
      return Response.json({
        items: Array.from({ length: ROWS }, (_, index) => ({
          type: (
            ["thread", "post", "profile_post", "conversation_message"] as const
          )[index % 4],
          id: 100 + index,
          authorId: 9,
          createdAt: at,
          ...context(index),
        })),
        nextCursor: null,
      });
    }
    if (pathname === "/api/v1/nodes") return Response.json({ items: nodes });
    if (
      pathname === "/api/v1/member-cards" ||
      pathname === "/api/v1/member-authors"
    ) {
      return Response.json({ items: [] });
    }
    return Response.json(
      { error: { code: "not_found", message: "Not found." } },
      { status: 404 },
    );
  }) as unknown as typeof fetch;
  return asked;
}

async function html(page: Promise<React.ReactNode>) {
  const stream = await renderToReadableStream(withIntl(await page));
  await stream.allReady;
  return (await new Response(stream).text()).replaceAll("&#x27;", "'");
}

const IN_THREAD = messages.moderation.common.where.threadTitled.replace(
  "{title}",
  "Garden tips",
);
const CONTENT = /\/(posts|threads|profile-posts|profile-comments)\//;

test("a page of 20 reports shows each excerpt and place from the list and reads no content", async () => {
  const asked = backend();
  const page = await html(ReportList({ searchParams: Promise.resolve({}) }));
  console.info(`reports page, ${ROWS} rows: ${asked.length} requests`);
  expect(asked.filter((path) => CONTENT.test(path))).toEqual([]);
  expect(page).toContain("Excerpt 0");
  expect(page).toContain("Excerpt 2");
  expect(page).toContain(IN_THREAD);
  expect(page).toContain(
    messages.moderation.common.where.wall.replace("{name}", "Wren"),
  );
  // The rows with no place say so, without a link: five of the twenty.
  expect(page.split(messages.moderation.common.where.hidden)).toHaveLength(6);
  // The list, the forums, the names, and one read of each report for who reported it.
  expect(asked.length).toBeLessThanOrEqual(ROWS + 3);
  expect(asked.filter((path) => /\/reports\/\d+$/.test(path))).toHaveLength(
    ROWS,
  );
});

test("a page of 20 approvals shows each excerpt and place from the list and reads no content", async () => {
  const asked = backend();
  const page = await html(ApprovalList({ searchParams: Promise.resolve({}) }));
  console.info(`approvals page, ${ROWS} rows: ${asked.length} requests`);
  expect(asked.filter((path) => CONTENT.test(path))).toEqual([]);
  expect(page).toContain("Excerpt 1");
  expect(page).toContain(IN_THREAD);
  expect(page.split(messages.moderation.common.where.hidden)).toHaveLength(6);
  // The list, the forums and the names: nothing per row.
  expect(asked.length).toBeLessThanOrEqual(3);
});

const forum = (id: number, title: string) => ({
  id,
  parentId: null,
  type: "forum",
  title,
  description: "",
  position: id,
  depth: 0,
  tabId: null,
  icon: null,
  iconKey: null,
  cover: null,
  threadCount: 0,
  postCount: 0,
  lastPost: null,
  permissions: { canPost: false, canModerate: true },
  settings: {
    requireThreadApproval: false,
    requireReplyApproval: false,
    isReadOnly: false,
    countsPosts: true,
    minAccountAgeDays: 0,
    minPostCount: 0,
  },
});

test("a moderator of one forum is offered that forum in the report filter, not the others", async () => {
  backend({ moderatedNodeIds: [2] }, [
    forum(1, "Growing"),
    forum(2, "Cooking"),
  ]);
  const page = await html(ReportList({ searchParams: Promise.resolve({}) }));
  expect(page).toContain("Cooking");
  expect(page).not.toContain("Growing");
});

test("a moderator of every forum, or one whose list was cut short, is offered all of them", async () => {
  for (const staff of [
    { moderatesEverywhere: true },
    { moderatedNodesTruncated: true },
  ]) {
    backend(staff, [forum(1, "Growing"), forum(2, "Cooking")]);
    const page = await html(ReportList({ searchParams: Promise.resolve({}) }));
    expect(page).toContain("Cooking");
    expect(page).toContain("Growing");
  }
});
