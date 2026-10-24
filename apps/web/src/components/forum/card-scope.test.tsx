import { afterAll, expect, mock, test } from "bun:test";
import type { ReactElement } from "react";
import { renderToReadableStream } from "react-dom/server";
import { withIntl } from "@/lib/test-intl";

mock.module("server-only", () => ({}));
mock.module("next/headers", () => ({
  headers: async () => new Headers(),
  cookies: async () => ({ get: () => undefined, toString: () => "" }),
}));
const navigation = await import("next/navigation");
mock.module("next/navigation", () => ({
  ...navigation,
  usePathname: () => "/",
  useSearchParams: () => new URLSearchParams(),
}));
const intl = { ...(await import("next-intl")) };
// Text does not matter here, and the preview is called as a plain function.
const useTranslations = () => (key: string) => key;
mock.module("next-intl", () => ({
  ...intl,
  useLocale: () => "en",
  useTranslations,
}));
afterAll(() => {
  mock.module("next/navigation", () => navigation);
  mock.module("next-intl", () => intl);
});
const { MemberCard } = await import("./member-card");
const { MemberCardScope } = await import("./member-card-scope");
const { ThreadHoverCard } = await import("./thread-hover-card");
const { UserLink } = await import("./user-link");
const { UserAvatar } = await import("./user-avatar");

const member = {
  id: 3,
  username: "ember",
  avatar: null,
  frame: null,
  nameColor: null,
  nameIcon: null,
  title: "",
  badges: [],
  level: 1,
  restricted: false,
};

// Whether `type` appears below an element of `scope` whose `disabled` is true.
function below(node: unknown, type: unknown, inside = false): boolean {
  if (!node || typeof node !== "object") return false;
  if (Array.isArray(node)) return node.some((n) => below(n, type, inside));
  const el = node as ReactElement<{ children?: unknown; disabled?: boolean }>;
  if (el.type === type) return inside;
  const now =
    inside || (el.type === MemberCardScope && el.props.disabled === true);
  return below(el.props?.children, type, now);
}

test("the thread preview draws its author and last replier without cards", () => {
  const thread = {
    id: 1,
    title: "T",
    prefix: null,
    excerpt: "x",
    createdAt: "2026-01-01T00:00:00.000Z",
    views: 1,
    replyCount: 2,
    coverPicture: null,
    forum: { id: 1, title: "F" },
    author: { member },
    lastPost: { createdAt: "2026-01-02T00:00:00.000Z", author: { member } },
  };
  const tree = ThreadHoverCard({ thread, href: "/threads/1" });
  expect(below(tree, UserAvatar)).toBe(true);
  expect(below(tree, UserLink)).toBe(true);
});

test("the directory's member card draws no card triggers", async () => {
  const stream = await renderToReadableStream(
    withIntl(
      <MemberCard
        user={{
          card: member,
          createdAt: "2026-01-01T00:00:00.000Z",
          postCount: 1,
          reactionScore: 1,
        }}
      />,
    ),
  );
  await stream.allReady;
  const out = await new Response(stream).text();
  expect(out).toContain('href="/members/3"');
  expect(out).not.toContain('role="link"');
});
