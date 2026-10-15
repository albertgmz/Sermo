import { afterAll, expect, mock, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { withIntl } from "@/lib/test-intl";

mock.module("server-only", () => ({}));
const navigation = { ...(await import("next/navigation")) };
const intl = { ...(await import("next-intl")) };
const { useTranslations } = await import("use-intl");
const actions = { ...(await import("@/app/[locale]/(main)/actions")) };
const wallActions = {
  ...(await import("@/app/[locale]/(main)/members/actions")),
};
const mediaActions = {
  ...(await import("@/app/[locale]/(main)/_feed/media-actions")),
};
const control = { ...(await import("@/components/forum/reaction-control")) };
const composer = { ...(await import("@/components/forum/line-composer")) };

// What the actions were called with: the viewer binds the page's own actions, which are the
// existing operations (a reaction, a reply to the thread, a comment on the wall post).
const calls: unknown[][] = [];
const record =
  (name: string) =>
  async (...args: unknown[]) => {
    calls.push([name, ...args]);
    return {};
  };
let search = "";
const reactionProps: { action?: (typeId: number | null) => Promise<unknown> } =
  {};
const composerProps: {
  action?: (previous: object, form: FormData) => Promise<unknown>;
  placeholder?: string;
} = {};

mock.module("next/navigation", () => ({
  ...navigation,
  usePathname: () => "/",
  useSearchParams: () => new URLSearchParams(search),
  useRouter: () => ({ push() {}, replace() {}, refresh() {}, back() {} }),
}));
mock.module("next-intl", () => ({
  ...intl,
  useLocale: () => "en",
  useTranslations,
}));
mock.module("@/app/[locale]/(main)/actions", () => ({
  ...actions,
  react: record("react"),
  replyFromFeed: record("replyFromFeed"),
}));
mock.module("@/app/[locale]/(main)/members/actions", () => ({
  ...wallActions,
  commentOnWallPost: record("commentOnWallPost"),
}));
mock.module("@/app/[locale]/(main)/_feed/media-actions", () => ({
  loadPicture: async () => ({ status: "gone" }),
}));
mock.module("@/components/forum/reaction-control", () => ({
  ...control,
  ReactionControl: (props: typeof reactionProps) => {
    Object.assign(reactionProps, props);
    return <i data-mark="reactions" />;
  },
}));
mock.module("@/components/forum/line-composer", () => ({
  ...composer,
  LineComposer: (props: typeof composerProps) => {
    Object.assign(composerProps, props);
    return <i data-mark="composer" />;
  },
}));
afterAll(() => {
  mock.module("next/navigation", () => navigation);
  mock.module("next-intl", () => intl);
  mock.module("@/app/[locale]/(main)/actions", () => actions);
  mock.module("@/app/[locale]/(main)/members/actions", () => wallActions);
  mock.module("@/app/[locale]/(main)/_feed/media-actions", () => mediaActions);
  mock.module("@/components/forum/reaction-control", () => control);
  mock.module("@/components/forum/line-composer", () => composer);
});
const { Panel } = await import("./picture-lightbox");

import type { PictureDetails, PictureResult } from "./picture-types";

const reactions = {
  target: "post" as const,
  id: 31,
  authorId: 3,
  total: 0,
  mine: null,
  view: { total: 0, byType: [], viewerTypeId: null },
  picker: [],
  offered: [],
  viewList: true,
};
const post = (over: Partial<PictureDetails> = {}): PictureResult => ({
  status: "ready",
  details: {
    author: { id: 3, username: "ember" },
    createdAt: "2026-01-01T00:00:00.000Z",
    where: { kind: "post", href: "/threads/7#post-31", label: "Tomatoes" },
    picture: { url: null, width: null, height: null },
    viewerId: 1,
    reactions,
    reply: { kind: "post", threadId: 7 },
    ...over,
  },
});

const draw = (result: PictureResult | "loading") =>
  renderToStaticMarkup(
    withIntl(
      <Panel pictureKey="post-31-7" result={result} onRetry={() => {}} />,
    ),
  );

test("the details show who posted the picture and where it is, with links to both", () => {
  const html = draw(post());
  expect(html).toContain('href="/members/3"');
  expect(html).toContain(">ember<");
  expect(html).toContain('href="/threads/7#post-31"');
  expect(html).toContain("In Tomatoes");
  expect(html).toContain('data-mark="reactions"');
  expect(html).toContain('data-mark="composer"');
});

test("a wall post's picture says it is on a wall and asks for a comment", () => {
  const html = draw(
    post({
      where: { kind: "wall", href: "/members/9?post=12", label: null },
      reply: { kind: "wall", profilePostId: 12 },
    }),
  );
  expect(html).toContain("On a profile wall");
  expect(composerProps.placeholder).toBe("Write a comment…");
});

test("the reaction is the page's own action on the post, and the reply is its reply to the thread", async () => {
  calls.length = 0;
  draw(post());
  await reactionProps.action?.(2);
  expect(calls.at(-1)).toEqual(["react", "post", 31, 2]);
  expect(composerProps.placeholder).toBe("Reply to this thread…");
  const form = new FormData();
  await composerProps.action?.({}, form);
  expect(calls.at(-1)).toEqual(["replyFromFeed", 7, {}, form]);
});

test("a comment on a wall post is the page's own comment action", async () => {
  calls.length = 0;
  draw(
    post({
      where: { kind: "wall", href: "/members/9?post=12", label: null },
      reactions: { ...reactions, target: "profilePost", id: 12 },
      reply: { kind: "wall", profilePostId: 12 },
    }),
  );
  await reactionProps.action?.(null);
  expect(calls.at(-1)).toEqual(["react", "profilePost", 12, null]);
  const form = new FormData();
  await composerProps.action?.({}, form);
  expect(calls.at(-1)).toEqual(["commentOnWallPost", 12, undefined, {}, form]);
});

test("a viewer who may not answer has no composer, and a guest is asked to sign in", () => {
  const closed = draw(post({ reply: null }));
  expect(closed).not.toContain('data-mark="composer"');
  expect(closed).not.toContain("/login");
  search = "tab=media&picture=post-31-7";
  const guest = draw(post({ reply: null, viewerId: null }));
  expect(guest).toContain(
    `href="/login?next=${encodeURIComponent("/?tab=media&picture=post-31-7")}"`,
  );
  expect(guest).toContain("Sign in to react or comment");
  search = "";
});

test("a picture that is gone, or whose details failed, says so and does not crash", () => {
  expect(draw({ status: "gone" })).toContain(
    "This picture is no longer available.",
  );
  const failed = draw({ status: "failed" });
  expect(failed).toContain('role="alert"');
  expect(failed).toContain("Try again");
  expect(draw("loading")).toContain('role="status"');
});
