import { afterAll, afterEach, expect, mock, test } from "bun:test";
import { viewerBody } from "@/lib/test-viewer";

const realFetch = globalThis.fetch;

mock.module("server-only", () => ({}));
const intl = await import("next-intl/server");
mock.module("next-intl/server", () => ({
  getLocale: async () => "en",
  getTranslations: async () => (key: string) => key,
}));
mock.module("next/headers", () => ({
  headers: async () => new Headers(),
  cookies: async () => ({ get: () => undefined, toString: () => "" }),
}));

const { default: MessagePage } = await import("./page");
const { default: ConversationUnreadPage } = await import(
  "../../[id]/unread/page"
);
const { default: ThreadUnreadPage } = await import(
  "../../../threads/[id]/unread/page"
);

afterAll(() => {
  mock.module("next-intl/server", () => intl);
});
afterEach(() => {
  globalThis.fetch = realFetch;
});

// The backend: message 9 is in conversation 5, whose first unread is 61; thread 7 picks up at the
// post 90, on its third page. Anything else is not found.
function backend() {
  globalThis.fetch = (async (url: string) => {
    const { pathname } = new URL(url);
    if (pathname === "/api/v1/me") return Response.json(viewerBody(true));
    if (pathname === "/api/v1/conversation-messages/9/location")
      return Response.json({ conversationId: 5, messageId: 9, cursor: "x" });
    if (pathname === "/api/v1/conversations/5/unread")
      return Response.json({ conversationId: 5, messageId: 61, cursor: null });
    if (pathname === "/api/v1/threads/7/unread")
      return Response.json({ threadId: 7, postId: 90, position: 45 });
    return Response.json(
      { error: { code: "not_found", message: "Not found." } },
      { status: 404 },
    );
  }) as unknown as typeof fetch;
}

async function digestOf(page: Promise<unknown>) {
  try {
    await page;
  } catch (error) {
    return (error as { digest?: string }).digest;
  }
  throw new Error("the page answered with a page");
}

const props = (id: string) =>
  ({ params: Promise.resolve({ locale: "en", id }) }) as never;
const redirectTo = (path: string) => `NEXT_REDIRECT;replace;${path};307;`;
const NOT_FOUND = "NEXT_HTTP_ERROR_FALLBACK;404";

test("a message's address goes to its conversation, at the message", async () => {
  backend();
  expect(await digestOf(MessagePage(props("9")))).toBe(
    redirectTo("/conversations/5?message=9#message-9"),
  );
  expect(await digestOf(MessagePage(props("10")))).toBe(NOT_FOUND);
  expect(await digestOf(MessagePage(props("x")))).toBe(NOT_FOUND);
});

test("a conversation and a thread are picked up at the first unread message or post", async () => {
  backend();
  expect(await digestOf(ConversationUnreadPage(props("5")))).toBe(
    redirectTo("/conversations/5?message=61#message-61"),
  );
  expect(await digestOf(ThreadUnreadPage(props("7-a-thread")))).toBe(
    redirectTo("/threads/7?page=3#post-90"),
  );
  expect(await digestOf(ThreadUnreadPage(props("8")))).toBe(NOT_FOUND);
});
