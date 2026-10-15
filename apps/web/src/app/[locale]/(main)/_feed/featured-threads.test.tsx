import { afterAll, afterEach, expect, mock, test } from "bun:test";
import type { ReactNode } from "react";
import { renderToReadableStream } from "react-dom/server";
import { fakeBackend } from "@/app/[locale]/(staff)/admin/groups/test-backend";
import { translator, withIntl } from "@/lib/test-intl";
import { viewerBody } from "@/lib/test-viewer";

mock.module("server-only", () => ({}));
mock.module("next/headers", () => ({
  headers: async () => new Headers(),
  cookies: async () => ({ get: () => undefined, toString: () => "" }),
}));
const intlServer = await import("next-intl/server");
mock.module("next-intl/server", () => ({
  getLocale: async () => "en",
  getTranslations: async (namespace: string) => translator(namespace),
}));
const navigation = await import("next/navigation");
mock.module("next/navigation", () => ({
  ...navigation,
  usePathname: () => "/",
  useSearchParams: () => new URLSearchParams(),
  useRouter: () => ({
    push() {},
    replace() {},
    refresh() {},
    back() {},
    prefetch() {},
  }),
}));
const intl = { ...(await import("next-intl")) };
const { useTranslations, useFormatter } = await import("use-intl");
mock.module("next-intl", () => ({
  ...intl,
  useLocale: () => "en",
  useTranslations,
  useFormatter,
}));

afterAll(() => {
  mock.module("next-intl/server", () => intlServer);
  mock.module("next/navigation", () => navigation);
  mock.module("next-intl", () => intl);
});
afterEach(() => backend?.restore());
let backend: ReturnType<typeof fakeBackend> | undefined;
const { FeaturedThreads } = await import("./featured-threads");

const when = "2026-01-01T00:00:00.000Z";
const featured = (id: number, kind: "staff" | "paid", title: string) => ({
  kind,
  startedAt: when,
  endsAt: kind === "paid" ? when : null,
  thread: {
    id,
    nodeId: 2,
    node: { id: 2, title: "General" },
    title,
    prefix: null,
    excerpt: "how it started",
    cover: null,
    highlightedUntil: null,
    bumpedAt: null,
    author: { id: 4, username: "member4" },
    state: "visible",
    isSticky: false,
    isLocked: false,
    createdAt: when,
    replyCount: 4,
    viewCount: 10,
    firstPostId: 30,
    lastPost: {
      postId: 31,
      position: 4,
      postedAt: when,
      user: { id: 3, username: "member3" },
    },
    readPosition: null,
    isUnread: false,
  },
});

async function html(node: ReactNode) {
  const stream = await renderToReadableStream(withIntl(node));
  await stream.allReady;
  return new Response(stream).text();
}

const serve = (items: unknown[]) =>
  fakeBackend({
    "auth.me": () => Response.json(viewerBody(false)),
    "threads.featured": () => Response.json({ items }),
    "users.cards": () => Response.json({ items: [] }),
  });

test("the home block lists the featured threads with their mark, and asks for a few", async () => {
  backend = serve([
    featured(8, "paid", "Promoted thread"),
    featured(7, "staff", "Picked thread"),
  ]);
  const text = await html(await FeaturedThreads());
  expect(
    backend.asked.find((call) => call.operation === "threads.featured")?.path,
  ).toBe("/api/v1/featured-threads");
  expect(text).toContain("Featured");
  expect(text).toContain("Promoted thread");
  expect(text).toContain("Picked thread");
  expect(text.indexOf("Promoted thread")).toBeLessThan(
    text.indexOf("Picked thread"),
  );
  // Each row says why it is there.
  expect(text).toContain("Promoted");
  expect(text).toContain('href="/threads/7"');
});

test("nothing is drawn when nothing is featured", async () => {
  backend = serve([]);
  expect(await FeaturedThreads()).toBeNull();
});
