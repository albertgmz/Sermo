import { afterEach, beforeEach, expect, mock, test } from "bun:test";
import { viewerBody } from "@/lib/test-viewer";

const realFetch = globalThis.fetch;
mock.module("server-only", () => ({}));
mock.module("next/headers", () => ({
  headers: async () => new Headers({ cookie: "sermo.session_token=abc" }),
  cookies: async () => ({ get: () => undefined, toString: () => "" }),
}));
mock.module("next-intl/server", () => ({
  getLocale: async () => "en",
  getTranslations: async () => (key: string) => key,
}));
const { viewerOfRequest } = await import("@/lib/sermo/client");
const { pollMessages } = await import("./poll-messages");

beforeEach(() => {
  mock.module("@/lib/sermo/session", () => ({ getViewer: viewerOfRequest }));
});
afterEach(() => {
  globalThis.fetch = realFetch;
});

const held = { id: 20, mark: 20 };

const message = (id: number) => ({
  id,
  conversationId: 4,
  author: { kind: "member", id: 3, username: "ember" },
  state: "visible",
  createdAt: "2026-01-01T00:00:00.000Z",
  editedAt: null,
  bodyHtml: "<p>hi</p>",
  attachmentCount: 0,
  attachments: [],
  reactions: { counts: {}, total: 0, mine: null },
  canEdit: false,
  canDelete: false,
  canHardDelete: false,
  canReport: true,
  deletion: null,
});

function backend(messages: Response) {
  const asked: { method: string; path: string; search: string }[] = [];
  globalThis.fetch = (async (url: string, init: RequestInit) => {
    const { pathname, search } = new URL(url);
    asked.push({ method: init.method ?? "GET", path: pathname, search });
    if (pathname === "/api/v1/conversations/4/messages")
      return messages.clone();
    if (pathname === "/api/v1/me") return Response.json(viewerBody(true));
    if (pathname === "/api/v1/reaction-types")
      return Response.json({ items: [] });
    if (pathname === "/api/v1/member-authors")
      return Response.json({ items: [] });
    if (pathname === "/api/v1/conversations/4/read") {
      return Response.json({ ok: true });
    }
    return Response.json(
      { error: { code: "not_found", message: pathname } },
      { status: 404 },
    );
  }) as unknown as typeof fetch;
  return asked;
}

const refusal = (status: number, code: string) =>
  Response.json({ error: { code, message: code } }, { status });

test("a poll with nothing new is one backend request, after the newest message held", async () => {
  const asked = backend(
    Response.json({ items: [], nextCursor: null, total: null }),
  );
  expect(await pollMessages(4, held)).toEqual({ rows: [] });
  expect(asked).toEqual([
    {
      method: "GET",
      path: "/api/v1/conversations/4/messages",
      search: "?afterMessageId=20",
    },
  ]);
});

test("new messages are drawn as rows in id order and the conversation is marked read", async () => {
  const asked = backend(
    Response.json({
      items: [message(21), message(22)],
      nextCursor: null,
      total: null,
    }),
  );
  const answer = await pollMessages(4, held);
  expect(
    "rows" in answer && answer.rows.map((row) => [row.key, row.id, row.mark]),
  ).toEqual([
    ["message-21", 21, 21],
    ["message-22", 22, 22],
  ]);
  expect(
    asked.some((request) => request.path === "/api/v1/conversations/4/read"),
  ).toBe(true);
});

test("a conversation the member left, or a session that ended, stops polling", async () => {
  backend(refusal(404, "not_found"));
  expect(await pollMessages(4, held)).toEqual({ stop: true });
  backend(refusal(401, "unauthenticated"));
  expect(await pollMessages(4, held)).toEqual({ stop: true });
});

test("a rate limit is raised, so the poll backs off", async () => {
  backend(refusal(429, "rate_limited"));
  await expect(pollMessages(4, held)).rejects.toThrow();
});

test("an id that cannot be a record never reaches the backend", async () => {
  const asked = backend(
    Response.json({ items: [], nextCursor: null, total: null }),
  );
  await expect(pollMessages(0, held)).rejects.toThrow();
  await expect(pollMessages(4, { id: 0, mark: 0 })).rejects.toThrow();
  expect(asked).toHaveLength(0);
});
