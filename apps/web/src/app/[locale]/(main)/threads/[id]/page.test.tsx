import { afterAll, afterEach, expect, mock, test } from "bun:test";
import { renderToReadableStream } from "react-dom/server";
import { fakeBackend } from "@/app/[locale]/(staff)/admin/groups/test-backend";
import { siteBody } from "@/lib/test-bodies";
import { translator, withIntl } from "@/lib/test-intl";
import { viewerBody } from "@/lib/test-viewer";

// The reply box a guest is offered under a thread: the guest form where the forum lets guests
// reply, the sign-in prompt everywhere else.

mock.module("server-only", () => ({}));
const intl = await import("next-intl/server");
const nextCache = await import("next/cache");
mock.module("next/cache", () => ({
  ...nextCache,
  cacheLife: () => {},
  cacheTag: () => {},
}));
mock.module("next-intl/server", () => ({
  getLocale: async () => "en",
  getTranslations: async (namespace: string) => translator(namespace),
}));
mock.module("next/headers", () => ({
  headers: async () => new Headers(),
  cookies: async () => ({ get: () => undefined, toString: () => "" }),
}));
// The posts, the toolbar and the page's frame are other suites' business.
const none = () => null;
mock.module("@/components/layout/page-layout", () => ({
  PageLayout: ({ children }: { children: React.ReactNode }) => children,
}));
mock.module("@/app/[locale]/(main)/threads/[id]/thread-posts", () => ({
  PostsRegion: none,
  readPosts: async () => [],
  tailKey: (id: number) => `thread:${id}`,
  postsContext: () => ({ may: {}, contentOpen: true, selecting: false }),
}));
mock.module("@/app/[locale]/(main)/threads/[id]/thread-tools", () => ({
  ThreadTools: none,
}));
mock.module("@/app/[locale]/(main)/threads/[id]/thread-heading", () => ({
  ThreadHeading: none,
}));
mock.module("@/app/[locale]/(main)/threads/[id]/moderation", () => ({
  SplitPanel: none,
}));
mock.module("@/app/[locale]/(main)/threads/[id]/posts-page", () => ({
  postsPage: async () => null,
}));
mock.module("@/app/[locale]/(main)/threads/[id]/reply-composer", () => ({
  ReplyComposer: () => "member reply box",
}));
mock.module("@/app/[locale]/(main)/threads/actions", () => ({
  replyAction: async () => ({}),
}));
mock.module("@/app/[locale]/(main)/threads/reply-in-place", () => ({
  replyInPlace: async () => ({}),
}));
mock.module("@/components/forum/page-switch", () => ({
  PageSwitch: none,
}));
mock.module("@/components/forum/guest-lazy", () => ({
  LazyGuestReplyForm: (props: { threadId: number; turnstileKey: string }) =>
    `guest reply box for ${props.threadId} with ${props.turnstileKey}`,
}));
const nextIntl = { ...(await import("next-intl")) };
const { useTranslations } = await import("use-intl");
mock.module("next-intl", () => ({ ...nextIntl, useTranslations }));

const { default: ThreadPage } = await import("./page");

afterAll(() => {
  mock.module("next-intl/server", () => intl);
  mock.module("next-intl", () => nextIntl);
});
let backend: ReturnType<typeof fakeBackend> | undefined;
afterEach(() => backend?.restore());

const when = "2026-01-01T00:00:00.000Z";
const seo = {
  title: "A thread",
  description: "",
  canonical: "http://localhost/threads/7",
  robots: "noindex,follow",
  redirect: false,
  jsonLd: [],
};

async function visit(options: {
  forum?: Record<string, boolean | number>;
  guestPost?: boolean;
  locked?: boolean;
  member?: boolean;
  registrationOpen?: boolean;
}) {
  backend = fakeBackend({
    "auth.me": () => Response.json(viewerBody(options.member ?? false)),
    "site.get": () =>
      Response.json(
        siteBody({
          turnstile: { siteKey: "0x4AAA-site", forms: ["guestPost"] },
          registration: {
            open: options.registrationOpen ?? true,
            approval: false,
            minimumAge: 0,
            fields: [],
          },
        }),
      ),
    "threads.get": () =>
      Response.json({
        thread: {
          id: 7,
          nodeId: 3,
          node: { id: 3, title: "General" },
          title: "A thread",
          prefix: null,
          excerpt: "",
          cover: null,
          highlightedUntil: null,
          bumpedAt: null,
          author: { kind: "member", id: 4, username: "ana" },
          state: "visible",
          isSticky: false,
          isLocked: options.locked ?? false,
          createdAt: when,
          replyCount: 0,
          viewCount: 1,
          firstPostId: 30,
          lastPost: {
            postId: 30,
            position: 0,
            postedAt: when,
            user: { kind: "member", id: 4, username: "ana" },
          },
          readPosition: null,
          isUnread: false,
          pollKind: null,
          isAdult: false,
          adultByForum: false,
        },
        tags: [],
        poll: { exists: false, canAdd: false },
        featured: null,
        seo,
        node: { id: 3, title: "General" },
        watching: null,
        permissions: {
          canReply: false,
          canEditTitle: false,
          canEditTags: false,
          canModerate: false,
          canDelete: false,
          canLock: false,
          canHardDelete: false,
          canReport: false,
          canRemoveCover: false,
          canWatch: false,
        },
        resolvedPermissions: { "forum.guestPost": options.guestPost ?? true },
      }),
    "seo.thread": () => Response.json(seo),
    "nodes.get": () =>
      Response.json({
        node: {
          id: 3,
          parentId: null,
          type: "forum",
          title: "General",
          description: "",
          position: 1,
          depth: 0,
          tabId: null,
          icon: null,
          iconKey: null,
          cover: null,
          threadCount: 0,
          postCount: 0,
          lastPost: null,
          permissions: { canPost: false, canModerate: false },
          settings: {
            requireThreadApproval: false,
            requireReplyApproval: false,
            isReadOnly: false,
            countsPosts: true,
            minAccountAgeDays: 0,
            minPostCount: 0,
            requirePrefix: false,
            ...options.forum,
            isAdult: false,
          },
          adultByParent: false,
        },
        watching: null,
        seo,
        breadcrumbs: [],
        resolvedPermissions: {},
      }),
  });
  const page = await ThreadPage({
    params: Promise.resolve({ id: "7" }),
    searchParams: Promise.resolve({}),
  } as never);
  const stream = await renderToReadableStream(withIntl(page));
  await stream.allReady;
  return new Response(stream).text();
}

test("a guest where guests may reply gets the guest reply box", async () => {
  expect(await visit({})).toContain("guest reply box for 7 with 0x4AAA-site");
});

test("a guest gets the sign-in prompt in a read-only forum, one that asks an account's age or posts, or without the permission", async () => {
  const prompt = translator("threads.page")("replyTitle");
  const cases: Parameters<typeof visit>[0][] = [
    { forum: { isReadOnly: true } },
    { forum: { minAccountAgeDays: 3 } },
    { forum: { minPostCount: 5 } },
    { guestPost: false },
  ];
  for (const options of cases) {
    const html = await visit(options);
    expect(html, JSON.stringify(options)).toContain(prompt);
    expect(html, JSON.stringify(options)).not.toContain("guest reply box");
  }
});

// The invitation to create an account at the end of the page: for guests only, worded for a forum
// where guests may reply too, and without "Create account" where registration is closed.
const invite = translator("forum.signupInvite");
const page = translator("threads.page");

test("a guest where guests may reply is invited to reply with an account, above the guest box", async () => {
  const html = await visit({});
  expect(html).toContain(invite("guestReply.title"));
  expect(html).toContain('href="/register"');
  expect(html).toContain('href="/login?next=%2Fthreads%2F7"');
  expect(html.indexOf(invite("guestReply.title"))).toBeLessThan(
    html.indexOf("guest reply box"),
  );
});

test("a guest who may not reply is invited to create an account or log in", async () => {
  const html = await visit({ guestPost: false });
  expect(html).toContain(page("replyDescription"));
  expect(html).toContain('href="/register"');
  expect(html).toContain('href="/login?next=%2Fthreads%2F7"');
  expect(html).toContain("data-signup-invite");
});

test("where registration is closed a guest is only offered to log in", async () => {
  const guestPosting = await visit({ registrationOpen: false });
  expect(guestPosting).not.toContain(invite("guestReply.title"));
  expect(guestPosting).toContain("guest reply box");
  const closed = await visit({ guestPost: false, registrationOpen: false });
  expect(closed).toContain(page("replyDescriptionClosed"));
  expect(closed).not.toContain('href="/register"');
  expect(closed).toContain('href="/login?next=%2Fthreads%2F7"');
});

test("a member is never invited", async () => {
  const html = await visit({ member: true, guestPost: false });
  expect(html).not.toContain("data-signup-invite");
  expect(html).not.toContain('href="/register"');
});

test("a guest on a locked thread is told it is locked, not invited to sign up to reply", async () => {
  for (const guestPost of [true, false]) {
    const html = await visit({ locked: true, guestPost });
    expect(html).toContain(page("locked"));
    expect(html).not.toContain("data-signup-invite");
    expect(html).not.toContain('href="/register"');
    expect(html).not.toContain("guest reply box");
  }
});
