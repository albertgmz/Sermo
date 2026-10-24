import { afterAll, afterEach, beforeEach, expect, mock, test } from "bun:test";
import { renderToReadableStream } from "react-dom/server";
import { fakeBackend } from "@/app/[locale]/(staff)/admin/groups/test-backend";
import { postBody } from "@/lib/test-bodies";
import { translator, withIntl } from "@/lib/test-intl";
import { viewerBody } from "@/lib/test-viewer";

mock.module("server-only", () => ({}));
const intl = await import("next-intl/server");
mock.module("next-intl/server", () => ({
  ...intl,
  getLocale: async () => "en",
  getNow: async () => new Date("2026-02-01T00:00:00.000Z"),
  getFormatter: async () => ({ relativeTime: () => "1 month ago" }),
  getTranslations: async (namespace: string) => translator(namespace),
}));
mock.module("next/headers", () => ({
  headers: async () => new Headers(),
  cookies: async () => ({ get: () => undefined, toString: () => "" }),
}));
const navigation = await import("next/navigation");
mock.module("next/navigation", () => ({
  ...navigation,
  usePathname: () => "/members/5",
  useRouter: () => ({ refresh() {}, push() {}, replace() {}, prefetch() {} }),
}));

const { viewerOfRequest } = await import("@/lib/sermo/client");
const { ActivityTab } = await import("./activity");
const { activityPageAction } = await import("./activity-page-action");

afterAll(() => {
  mock.module("next/navigation", () => navigation);
  mock.module("next-intl/server", () => intl);
});
beforeEach(() => {
  mock.module("@/lib/sermo/session", () => ({ getViewer: viewerOfRequest }));
});
let backend: ReturnType<typeof fakeBackend> | undefined;
afterEach(() => backend?.restore());

const when = "2026-01-01T00:00:00.000Z";
const author = { id: 5, username: "ann" };
const profile = { id: 5, username: "ann", card: author } as never;
// The author of the threads and posts, as their contracts give it.
const writer = { kind: "member" as const, ...author };
const thread = (id: number, title: string) => ({
  id,
  nodeId: 2,
  node: { id: 2, title: "General" },
  title,
  prefix: null,
  excerpt: "",
  cover: null,
  highlightedUntil: null,
  bumpedAt: null,
  author: writer,
  state: "visible",
  isSticky: false,
  isLocked: false,
  createdAt: when,
  replyCount: 0,
  viewCount: 1,
  firstPostId: 30,
  lastPost: { postId: 30, position: 0, postedAt: when, user: writer },
  readPosition: null,
  isUnread: false,
  pollKind: null,
  isAdult: false,
  adultByForum: false,
});
const entry = (id: number, title: string) => ({
  post: postBody({
    id,
    threadId: id,
    position: 0,
    author: writer,
    bodyHtml: "<p>Body</p>",
  }),
  thread: thread(id, title),
});

// A member with 45 posts and 45 threads (three pages of 20 each), the page asked for on screen.
function member(posts: unknown[], threads: unknown[]) {
  backend = fakeBackend({
    "auth.me": () => Response.json(viewerBody(false)),
    "posts.byAuthor": () =>
      Response.json({ items: posts, nextCursor: null, total: 45 }),
    "threads.byAuthor": () =>
      Response.json({ items: threads, nextCursor: null, total: 45 }),
  });
}

async function html(element: unknown) {
  const stream = await renderToReadableStream(withIntl(element as never));
  await stream.allReady;
  return new Response(stream).text();
}

for (const [tab, label] of [
  ["posts", "Posts on page two"],
  ["threads", "Threads on page two"],
] as const) {
  test(`a member's ${tab} are numbered pages whose links keep the tab`, async () => {
    member([entry(8, label)], [thread(8, label)]);
    const page = await html(await ActivityTab({ tab, profile, page: 2 }));
    expect(page).toContain(label);
    expect(page).toContain('aria-current="page"');
    expect(page).toContain(`href="/members/5?tab=${tab}&amp;page=3"`);
    expect(page).toContain(`href="/members/5?tab=${tab}"`);
    expect(page).not.toContain("cursor=");
  });

  test(`a page of a member's ${tab} past the last one goes to the last one`, async () => {
    member([], []);
    const error = await ActivityTab({ tab, profile, page: 9 }).catch(
      (thrown: unknown) => thrown,
    );
    expect(String((error as { digest?: string }).digest)).toContain(
      `;/members/5?tab=${tab}&page=3;`,
    );
  });

  test(`the in-place switch gets a page of a member's ${tab} drawn, null when none`, async () => {
    member([entry(8, label)], [thread(8, label)]);
    const drawn = await html(await activityPageAction(tab, 5, 2));
    expect(drawn).toContain(label);
    expect(drawn).toContain(`href="/members/5?tab=${tab}&amp;page=3"`);
    member([], []);
    expect(await activityPageAction(tab, 5, 5)).toBeNull();
  });
}

test("the in-place switch refuses a tab that is neither posts nor threads", async () => {
  member([], []);
  expect(await activityPageAction("wall" as never, 5, 2)).toBeNull();
  expect(backend?.asked).toEqual([]);
});
