import { afterAll, afterEach, beforeEach, expect, mock, test } from "bun:test";
import { renderToReadableStream } from "react-dom/server";
import { fakeBackend } from "@/app/[locale]/(staff)/admin/groups/test-backend";
import { siteBody } from "@/lib/test-bodies";
import { translator, withIntl } from "@/lib/test-intl";
import { viewerBody } from "@/lib/test-viewer";

mock.module("server-only", () => ({}));
const intl = await import("next-intl/server");
mock.module("next-intl/server", () => ({
  getLocale: async () => "en",
  getTranslations: async (namespace: string) => translator(namespace),
}));
const nextCache = await import("next/cache");
mock.module("next/cache", () => ({
  ...nextCache,
  cacheLife: () => {},
  cacheTag: () => {},
}));
mock.module("next/headers", () => ({
  headers: async () => new Headers(),
  cookies: async () => ({ get: () => undefined, toString: () => "" }),
}));
const navigation = await import("next/navigation");
mock.module("next/navigation", () => ({
  ...navigation,
  usePathname: () => "/conversations/5",
  useSearchParams: () => new URLSearchParams(),
  useRouter: () => ({
    push() {},
    replace() {},
    refresh() {},
    back() {},
    prefetch() {},
  }),
}));
// The end of the conversation that goes on, marked so the page shows where it is drawn.
const liveTail = await import("@/components/forum/live-tail");
mock.module("@/components/forum/live-tail", () => ({
  ...liveTail,
  LiveTail: () => <li data-goes-on="" />,
}));

const { viewerOfRequest } = await import("@/lib/sermo/client");
const { MessagesRegion, readMessages } = await import("./messages-region");
const { messagesPage } = await import("./messages-page");
const { read } = await import("@/lib/sermo/client");

afterAll(() => {
  mock.module("next-intl/server", () => intl);
  mock.module("next/cache", () => nextCache);
  mock.module("@/components/forum/live-tail", () => liveTail);
  mock.module("next/navigation", () => navigation);
});
beforeEach(() => {
  mock.module("@/lib/sermo/session", () => ({
    getViewer: viewerOfRequest,
    getMember: viewerOfRequest,
  }));
});
let backend: ReturnType<typeof fakeBackend> | undefined;
afterEach(() => backend?.restore());

const when = "2026-01-01T00:00:00.000Z";
const user = { id: 3, username: "ember" };
const message = (id: number) => ({
  id,
  conversationId: 5,
  author: user,
  state: "visible",
  createdAt: when,
  editedAt: null,
  bodyHtml: `<p>Message ${id}.</p>`,
  attachmentCount: 0,
  attachments: [],
  reactions: { counts: {}, total: 0, mine: null },
  canEdit: false,
  canDelete: false,
  canReport: true,
});
const conversation = {
  id: 5,
  title: "Long",
  starter: user,
  createdAt: when,
  lastMessage: { messageId: 50, sentAt: when, user },
  messageCount: 50,
  participantCount: 2,
  isUnread: false,
  participants: [{ user, state: "active" }],
  canReply: true,
  canInvite: false,
  canRename: false,
  isLocked: false,
  canLock: false,
};

// Fifty messages, twenty to a page: three pages, page 1 the oldest.
function talk(items: unknown[]) {
  backend = fakeBackend({
    "auth.me": () => Response.json(viewerBody(true)),
    "auth.counters": () =>
      Response.json({ notifications: 0, conversations: 0 }),
    "site.get": () => Response.json(siteBody({})),
    "reactionTypes.list": () => Response.json({ items: [] }),
    "users.cards": () => Response.json({ items: [] }),
    "users.authors": () => Response.json({ items: [] }),
    "smilies.list": () => Response.json({ items: [] }),
    "conversations.get": () => Response.json(conversation),
    "conversations.listMessages": () =>
      Response.json({ items, nextCursor: null, total: 50 }),
  });
}

async function html(node: React.ReactNode) {
  const stream = await renderToReadableStream(withIntl(node));
  await stream.allReady;
  return new Response(stream).text();
}

const context = { conversation, canReact: false, viewList: true } as never;

test("a middle page links its neighbours by number and does not go on", async () => {
  talk([message(21), message(22)]);
  const list = await readMessages(5, 2, read);
  const drawn = await html(await MessagesRegion({ context, page: 2, list }));
  expect(drawn).toContain("Message 21.");
  expect(drawn).toContain('href="/conversations/5"');
  expect(drawn).toContain('href="/conversations/5?page=3"');
  expect(drawn).not.toContain("data-goes-on");
});

test("the last page goes on: new messages arrive at its end", async () => {
  talk([message(41), message(50)]);
  const list = await readMessages(5, 3, read);
  const drawn = await html(await MessagesRegion({ context, page: 3, list }));
  expect(drawn).toContain("Message 50.");
  expect(drawn).toContain("data-goes-on");
});

test("the in-place switch gets the page drawn, and nothing for a page past the end", async () => {
  talk([message(21)]);
  const drawn = await messagesPage(5, 2);
  expect(await html(drawn)).toContain("Message 21.");
  talk([]);
  expect(await messagesPage(5, 9)).toBeNull();
});
