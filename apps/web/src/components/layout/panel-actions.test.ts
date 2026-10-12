import { afterEach, expect, mock, test } from "bun:test";
import type { ReactElement } from "react";

const realFetch = globalThis.fetch;

mock.module("server-only", () => ({}));
mock.module("next/headers", () => ({
  headers: async () => new Headers({ cookie: "sermo.session_token=live" }),
  cookies: async () => ({ set: () => {} }),
}));
// The rows are drawn elsewhere; what matters here is which rows the action hands them.
mock.module("@/components/layout/panel-rows", () => ({
  MessageRows: () => null,
  AlertRows: () => null,
}));

const { loadAlerts, loadConversations } = await import("./panel-actions");

afterEach(() => {
  globalThis.fetch = realFetch;
});

const member = {
  user: {
    id: 1,
    username: "ann",
    email: "ann@example.test",
    groupId: 2,
    createdAt: "2026-01-01T00:00:00.000Z",
    displayGroup: null,
  },
  permissions: {
    isAdmin: false,
    isModerator: false,
    canViewProfiles: true,
    canPostProfile: false,
    canStartConversations: false,
    canReact: false,
  },
  resolvedPermissions: {},
  staff: { panel: false, moderatesEverywhere: false, moderatedNodeIds: [] },
};

const conversation = {
  id: 5,
  title: "Seed swap",
  starter: { id: 1, username: "ann" },
  createdAt: "2026-01-01T00:00:00.000Z",
  lastMessage: {
    messageId: 1,
    sentAt: "2026-01-01T00:00:00.000Z",
    user: { id: 1, username: "ann" },
  },
  messageCount: 1,
  participantCount: 2,
  isUnread: true,
  participants: [],
  canReply: true,
};

function backend(list: Response) {
  globalThis.fetch = (async (url: string) => {
    if (url.endsWith("/me")) return Response.json(member);
    if (url.includes("/member-cards")) return Response.json({ items: [] });
    return list.clone();
  }) as unknown as typeof fetch;
}

test("opening the messages panel hands the listed conversations to its rows", async () => {
  backend(Response.json({ items: [conversation], nextCursor: null }));
  const rows = (await loadConversations()) as ReactElement<{
    conversations: unknown[];
  }>;
  expect(rows.props.conversations).toHaveLength(1);
});

test("a refused list leaves the panel empty instead of failing", async () => {
  backend(
    Response.json(
      { error: { code: "rate_limited", message: "Slow down" } },
      { status: 429 },
    ),
  );
  const messages = (await loadConversations()) as ReactElement<{
    conversations: unknown[];
  }>;
  expect(messages.props.conversations).toEqual([]);
  const alerts = (await loadAlerts()) as ReactElement<{
    notifications: unknown[];
  }>;
  expect(alerts.props.notifications).toEqual([]);
});
