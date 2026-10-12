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

const { decideContent, viewApprovalMessage } = await import("./actions");

let backend: ReturnType<typeof fakeBackend> | undefined;
afterEach(() => backend?.restore());
afterAll(() => {
  mock.module("next-intl/server", () => intl);
});

function form(fields: [string, string][]) {
  const data = new FormData();
  for (const [name, value] of fields) data.append(name, value);
  return data;
}

async function redirectedTo(run: () => Promise<unknown>) {
  try {
    await run();
  } catch (error) {
    return String((error as { digest?: unknown }).digest);
  }
  return undefined;
}

test("approving makes the content visible and returns to the queue with a notice", async () => {
  backend = fakeBackend({
    "moderation.setState": () => Response.json({ changed: true }),
  });
  const digest = await redirectedTo(() =>
    decideContent(
      null,
      form([
        ["type", "post"],
        ["id", "12"],
        ["decision", "approve"],
        ["notify", "on"],
      ]),
    ),
  );
  expect(digest).toMatch(/;\/moderation\/approvals\?notice=approved;/);
  expect(backend.asked.at(-1)?.body).toMatchObject({
    target: { type: "post", id: 12 },
    state: "visible",
    notify: true,
  });
});

test("rejecting deletes the content with the reason", async () => {
  backend = fakeBackend({
    "moderation.setState": () => Response.json({ changed: true }),
  });
  const digest = await redirectedTo(() =>
    decideContent(
      null,
      form([
        ["type", "thread"],
        ["id", "5"],
        ["decision", "reject"],
        ["reason", "Spam"],
      ]),
    ),
  );
  expect(digest).toMatch(/;\/moderation\/approvals\?notice=rejected;/);
  expect(backend.asked.at(-1)?.body).toMatchObject({
    target: { type: "thread", id: 5 },
    state: "deleted",
    reason: "Spam",
    notify: false,
  });
});

test("a kind of content, a decision or an id the form did not offer is refused", async () => {
  backend = fakeBackend({});
  expect(
    await decideContent(
      null,
      form([
        ["type", "user"],
        ["id", "1"],
        ["decision", "approve"],
      ]),
    ),
  ).toEqual({ error: messages.moderation.errors.type });
  expect(
    await decideContent(
      null,
      form([
        ["type", "post"],
        ["id", "1"],
        ["decision", "restore"],
      ]),
    ),
  ).toEqual({ error: messages.moderation.errors.decision });
  expect(
    await decideContent(
      null,
      form([
        ["type", "post"],
        ["id", "-1"],
        ["decision", "approve"],
      ]),
    ),
  ).toEqual({ error: messages.moderation.errors.id });
  expect(backend.asked).toEqual([]);
});

test("the backend's refusal of a decision is shown", async () => {
  backend = fakeBackend({
    "moderation.setState": () => refusal(403, "forbidden", "Not allowed."),
  });
  expect(
    await decideContent(
      null,
      form([
        ["type", "post"],
        ["id", "1"],
        ["decision", "approve"],
      ]),
    ),
  ).toEqual({ error: "Not allowed." });
});

test("a confirmed preview reads the message once and an invalid id reads nothing", async () => {
  backend = fakeBackend({
    "approvals.viewConversationMessage": () =>
      Response.json({
        conversationId: 3,
        title: "Between two",
        messages: [
          {
            id: 8,
            author: { id: 2, username: "ember" },
            bodyHtml: "<p>hi</p>",
            createdAt: "2026-01-01T00:00:00.000Z",
            isTarget: true,
          },
        ],
      }),
  });
  expect(
    (await viewApprovalMessage(null, form([["id", "8"]])))?.view,
  ).toBeTruthy();
  expect(backend.asked).toHaveLength(1);
  expect(backend.asked[0].body).toEqual({ messageId: 8 });
  expect(await viewApprovalMessage(null, form([["id", "eight"]]))).toEqual({
    error: messages.moderation.errors.id,
  });
  expect(backend.asked).toHaveLength(1);
});
