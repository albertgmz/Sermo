import { afterAll, afterEach, expect, mock, test } from "bun:test";
import { renderToReadableStream } from "react-dom/server";
import { fakeBackend } from "@/app/[locale]/(staff)/admin/groups/test-backend";
import { siteBody } from "@/lib/test-bodies";
import { translator, withIntl } from "@/lib/test-intl";
import { viewerBody } from "@/lib/test-viewer";

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
// The page's frame and the composers are other suites' business: only which one is drawn matters.
mock.module("@/components/layout/page-layout", () => ({
  PageLayout: ({ children }: { children: React.ReactNode }) => children,
}));
mock.module("@/components/forum/guest-lazy", () => ({
  LazyGuestThreadComposer: (props: { forumId: number; turnstileKey: string }) =>
    `guest composer for ${props.forumId} with ${props.turnstileKey}`,
}));
mock.module("@/components/forum/thread-composer", () => ({
  ThreadComposer: () => "member composer",
}));
const nextIntl = { ...(await import("next-intl")) };
const { useTranslations } = await import("use-intl");
mock.module("next-intl", () => ({ ...nextIntl, useTranslations }));
const navigation = await import("next/navigation");
mock.module("next/navigation", () => ({
  ...navigation,
  redirect: (to: string) => {
    throw new Error(`redirect:${to}`);
  },
}));

const { default: NewThreadPage } = await import("./page");

afterAll(() => {
  mock.module("next-intl/server", () => intl);
  mock.module("next-intl", () => nextIntl);
  mock.module("next/navigation", () => navigation);
});
let backend: ReturnType<typeof fakeBackend> | undefined;
afterEach(() => backend?.restore());

const node = (canPost: boolean) => ({
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
  permissions: { canPost, canModerate: false },
  settings: {
    requireThreadApproval: false,
    requireReplyApproval: false,
    isReadOnly: false,
    countsPosts: true,
    minAccountAgeDays: 0,
    minPostCount: 0,
    requirePrefix: false,
  },
});

async function visit(options: {
  signedIn: boolean;
  canPost?: boolean;
  guestPost?: boolean;
  guarded?: boolean;
}) {
  backend = fakeBackend({
    "auth.me": () => Response.json(viewerBody(options.signedIn)),
    "site.get": () =>
      Response.json(
        siteBody({
          turnstile: options.guarded
            ? { siteKey: "0x4AAA-site", forms: ["guestPost"] }
            : null,
        }),
      ),
    "nodes.get": () =>
      Response.json({
        node: node(options.canPost ?? false),
        watching: null,
        seo: {
          title: "General",
          description: "",
          canonical: "http://localhost/forums/3",
          robots: "noindex,follow",
          redirect: false,
          jsonLd: [],
        },
        breadcrumbs: [],
        resolvedPermissions: { "forum.guestPost": options.guestPost ?? false },
      }),
    "threadPrefixes.list": () => Response.json({ items: [] }),
    "nodes.list": () => Response.json({ items: [] }),
    "preferences.get": () =>
      Response.json({
        watchOnCreate: "watch",
        watchOnReply: "watch",
        language: null,
        profileViewPrivacy: "everyone",
        profilePostPrivacy: "members",
        keyboardShortcuts: true,
        homeTab: null,
        feedView: "compact",
        theme: null,
        showOnline: true,
      }),
  });
  const page = await NewThreadPage({
    params: Promise.resolve({ id: "3" }),
  } as never);
  const stream = await renderToReadableStream(withIntl(page));
  await stream.allReady;
  return new Response(stream).text();
}

test("a guest where guests may post gets the guest composer with the site's key", async () => {
  const html = await visit({
    signedIn: false,
    guestPost: true,
    guarded: true,
  });
  expect(html).toContain("guest composer for 3 with 0x4AAA-site");
});

test("a guest where guests may not post is sent to sign in, as ever", async () => {
  const to = `redirect:/login?next=${encodeURIComponent("/forums/3/new")}`;
  await expect(visit({ signedIn: false })).rejects.toThrow(to);
  // The permission without the Turnstile guard on the form is no permission the backend takes.
  await expect(visit({ signedIn: false, guestPost: true })).rejects.toThrow(to);
});

test("a member who may post gets the member's composer, and one who may not is told so", async () => {
  expect(await visit({ signedIn: true, canPost: true })).toContain(
    "member composer",
  );
  const html = await visit({ signedIn: true, canPost: false, guestPost: true });
  expect(html).not.toContain("composer");
  expect(html).toContain(messagesText("cannotPostTitle"));
});

function messagesText(key: string) {
  return translator("forums.new")(key);
}

test("the new-thread form is kept out of search engines", async () => {
  const { generateMetadata } = await import("./page");
  expect((await generateMetadata()).robots).toEqual({
    index: false,
    follow: false,
  });
});
