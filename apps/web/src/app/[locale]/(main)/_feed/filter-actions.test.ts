import { afterEach, expect, mock, test } from "bun:test";

const realFetch = globalThis.fetch;
mock.module("server-only", () => ({}));
mock.module("next/headers", () => ({
  headers: async () =>
    new Headers({
      cookie: "sermo.session_token=abc",
      host: "forum.test",
      referer: "http://forum.test/?tab=latest",
    }),
  cookies: async () => ({ get: () => undefined, toString: () => "" }),
}));
mock.module("next-intl/server", () => ({
  getLocale: async () => "en",
  getTranslations: async () => (key: string) => key,
}));
const { feedFilterOptions, saveFeedFilter, deleteFeedFilter, hideFeedForum } =
  await import("./filter-actions");
const { viewerBody } = await import("@/lib/test-viewer");

afterEach(() => {
  globalThis.fetch = realFetch;
});

type Asked = { method: string; path: string; body: unknown };

// Answers by path; a request for anything else fails the test.
function backend(answers: Record<string, () => Response>) {
  const asked: Asked[] = [];
  globalThis.fetch = (async (url: string, init?: RequestInit) => {
    const { pathname } = new URL(url);
    // Every call settles the visitor first.
    if (pathname === "/api/v1/me") return Response.json(viewerBody(true));
    const answer = answers[pathname];
    if (!answer) throw new Error(`Unexpected ${pathname}`);
    asked.push({
      method: init?.method ?? "GET",
      path: pathname,
      body: init?.body ? JSON.parse(String(init.body)) : undefined,
    });
    return answer();
  }) as unknown as typeof fetch;
  return asked;
}

const when = "2026-01-01T00:00:00.000Z";
const saved = {
  id: 5,
  name: "Quiet corner",
  scope: "following",
  filter: { forumIds: [3], unread: true },
  createdAt: when,
};
const options = {
  excludedForumIds: [8],
  hiddenForumIds: [3],
  filters: [saved],
  filterLimit: 10,
};

test("the sheet's options are three reads, shaped for the sheet", async () => {
  const asked = backend({
    "/api/v1/feed/options": () => Response.json(options),
    "/api/v1/nodes": () =>
      Response.json({
        items: [
          {
            id: 3,
            parentId: null,
            type: "forum",
            title: "General",
            description: "",
            icon: null,
            iconKey: null,
            cover: null,
            position: 1,
            tabId: null,
            depth: 0,
            threadCount: 1,
            postCount: 1,
            lastPost: null,
            permissions: { canPost: true, canModerate: false },
            settings: {
              requireThreadApproval: false,
              requireReplyApproval: false,
              isReadOnly: false,
              countsPosts: true,
              minAccountAgeDays: 0,
              minPostCount: 0,
              requirePrefix: false,
              isAdult: false,
            },
            adultByParent: false,
          },
        ],
      }),
    "/api/v1/thread-prefixes": () =>
      Response.json({
        items: [
          {
            id: 2,
            label: "Solved",
            color: "#00aa00",
            colorId: 1,
            icon: "",
            position: 0,
            isActive: true,
            createdAt: when,
            updatedAt: when,
          },
        ],
      }),
  });
  const answer = await feedFilterOptions();
  expect(answer.ok).toBe(true);
  if (!answer.ok) return;
  expect(answer.value).toEqual({
    signedIn: true,
    forums: [{ id: 3, title: "General", depth: 0 }],
    prefixes: [{ id: 2, label: "Solved" }],
    saved: [
      {
        id: 5,
        name: "Quiet corner",
        scope: "following",
        filter: { forumIds: [3], unread: true },
      },
    ],
    hiddenForumIds: [3],
    excludedForumIds: [8],
    filterLimit: 10,
  });
  expect(asked.filter((entry) => entry.method !== "GET")).toEqual([]);
});

test("saving sends the name, the tab and the filter, and returns the member's list", async () => {
  const asked = backend({
    "/api/v1/feed/filters": () => Response.json(saved, { status: 201 }),
    "/api/v1/feed/options": () => Response.json(options),
  });
  const answer = await saveFeedFilter("Quiet corner", "following", {
    forumIds: [3],
    unread: true,
  });
  expect(answer).toMatchObject({ ok: true });
  expect(asked[0]).toEqual({
    method: "POST",
    path: "/api/v1/feed/filters",
    body: {
      name: "Quiet corner",
      scope: "following",
      filter: { forumIds: [3], unread: true },
    },
  });
  // A tab that is not a feed tab is Latest, never passed on.
  await saveFeedFilter("Odd", "forums", {});
  expect(asked.filter((entry) => entry.method === "POST").at(-1)?.body).toEqual(
    {
      name: "Odd",
      scope: "latest",
      filter: {},
    },
  );
});

test("a refusal of the backend comes back as its message, a cap included", async () => {
  backend({
    "/api/v1/feed/filters": () =>
      Response.json(
        {
          error: {
            code: "conflict",
            message: "You can keep 10 saved filters.",
          },
        },
        { status: 409 },
      ),
  });
  expect(await saveFeedFilter("Eleven", "latest", {})).toEqual({
    ok: false,
    error: "You can keep 10 saved filters.",
  });
});

test("a guest who saves is told where to sign in, not redirected mid-sheet", async () => {
  backend({
    "/api/v1/feed/filters": () =>
      Response.json(
        { error: { code: "unauthenticated", message: "Sign in." } },
        { status: 401 },
      ),
  });
  expect(await saveFeedFilter("Mine", "latest", {})).toMatchObject({
    ok: false,
    signIn: "/login?next=%2F%3Ftab%3Dlatest",
  });
});

test("deleting and hiding name one record, and a forged id never reaches the backend", async () => {
  const asked = backend({
    "/api/v1/feed/filters/5": () => Response.json({ deleted: true }),
    "/api/v1/feed/hidden-forums/3": () => Response.json({ hidden: true }),
    "/api/v1/feed/options": () => Response.json(options),
  });
  expect(await deleteFeedFilter(5)).toMatchObject({ ok: true });
  expect(await hideFeedForum(3, true)).toEqual({ ok: true, value: [3] });
  expect(asked.filter((entry) => entry.method !== "GET")).toEqual([
    { method: "DELETE", path: "/api/v1/feed/filters/5", body: undefined },
    {
      method: "PUT",
      path: "/api/v1/feed/hidden-forums/3",
      body: { hidden: true },
    },
  ]);
  await expect(deleteFeedFilter(-1)).rejects.toThrow();
  await expect(hideFeedForum(0, true)).rejects.toThrow();
  await expect(
    deleteFeedFilter("5; drop" as unknown as number),
  ).rejects.toThrow();
  expect(asked.filter((entry) => entry.method !== "GET")).toHaveLength(2);
});
