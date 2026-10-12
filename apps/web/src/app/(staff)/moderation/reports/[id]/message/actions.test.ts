import { afterAll, afterEach, expect, mock, test } from "bun:test";
import { messages } from "@/i18n/messages";
import { translator } from "@/lib/test-intl";
import { fakeBackend, refusal } from "../../../../admin/groups/test-backend";

mock.module("server-only", () => ({}));
const intl = await import("next-intl/server");
mock.module("next-intl/server", () => ({
  getTranslations: async (namespace: string) => translator(namespace),
}));
// The view is a server-rendered element; the action only builds it.
mock.module("../../../conversation-context", () => ({
  ConversationContext: () => null,
}));
mock.module("next/headers", () => ({
  headers: async () => new Headers(),
  cookies: async () => ({ set: () => {} }),
}));

const { viewReportedMessage } = await import("./actions");

let backend: ReturnType<typeof fakeBackend> | undefined;
afterEach(() => backend?.restore());
afterAll(() => {
  mock.module("next-intl/server", () => intl);
});

const VIEW = {
  conversationId: 3,
  title: "Between two",
  messages: [
    {
      id: 11,
      authorId: 2,
      authorUsername: "ember",
      bodyHtml: "<p>hi</p>",
      createdAt: "2026-01-01T00:00:00.000Z",
      reported: true,
    },
  ],
};

function form(fields: [string, string][]) {
  const data = new FormData();
  for (const [name, value] of fields) data.append(name, value);
  return data;
}

test("a confirmed view makes exactly one read and returns the view", async () => {
  backend = fakeBackend({
    "reports.viewConversationMessage": () => Response.json(VIEW),
  });
  const state = await viewReportedMessage(null, form([["id", "4"]]));
  expect(state?.view).toBeTruthy();
  expect(state?.error).toBeUndefined();
  expect(backend.asked).toHaveLength(1);
  expect(backend.asked[0]).toMatchObject({
    operation: "reports.viewConversationMessage",
    path: "/api/v1/reports/4/conversation-message",
  });
});

test("an id that is not a record is refused without a read", async () => {
  backend = fakeBackend({});
  expect(await viewReportedMessage(null, form([["id", "x"]]))).toEqual({
    error: messages.moderation.errors.id,
  });
  expect(backend.asked).toEqual([]);
});

test("the backend's refusal is shown and no view is returned", async () => {
  backend = fakeBackend({
    "reports.viewConversationMessage": () =>
      refusal(403, "forbidden", "Not allowed."),
  });
  expect(await viewReportedMessage(null, form([["id", "4"]]))).toEqual({
    error: "Not allowed.",
  });
});
