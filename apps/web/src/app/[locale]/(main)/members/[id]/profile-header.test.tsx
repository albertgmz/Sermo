import { afterAll, expect, mock, test } from "bun:test";
import { createElement } from "react";
import { renderToReadableStream } from "react-dom/server";
import { translator, withIntl } from "@/lib/test-intl";

mock.module("server-only", () => ({}));
const intl = await import("next-intl/server");
mock.module("next-intl/server", () => ({
  getLocale: async () => "en",
  getTranslations: async (namespace: string) => translator(namespace),
}));
mock.module("next/headers", () => ({
  headers: async () => new Headers(),
  cookies: async () => ({ get: () => undefined, toString: () => "" }),
}));

const { ProfileHeader } = await import("./profile-header");

afterAll(() => {
  mock.module("next-intl/server", () => intl);
});

const profile = (
  socials: Record<string, string>,
  lastActivityAt: string | null = null,
) =>
  ({
    id: 5,
    username: "wren",
    cover: null,
    card: {
      id: 5,
      username: "wren",
      avatar: null,
      frame: null,
      nameColor: null,
      nameIcon: null,
      title: "Newcomer",
      badges: [],
      level: 1,
    },
    customTitle: null,
    groupTitle: "Members",
    createdAt: "2026-01-01T00:00:00.000Z",
    location: "",
    website: "",
    birthday: null,
    socials: { discord: "", telegram: "", x: "", ...socials },
    postCount: 0,
    reactionScore: 0,
    followerCount: 0,
    followingCount: 0,
    credits: 0,
    referralCount: 0,
    lastActivityAt,
    viewer: { isFollowing: false, isIgnoring: false },
    canPostOnWall: false,
  }) as never;

async function header(
  socials: Record<string, string>,
  lastActivityAt: string | null = null,
) {
  return new Response(
    await renderToReadableStream(
      withIntl(
        createElement(ProfileHeader, {
          profile: profile(socials, lastActivityAt),
          viewerId: null,
          canMessage: false,
        }),
      ),
    ),
  ).text();
}

test("a Discord name is a button that copies it, never a link to nowhere", async () => {
  const html = await header({ discord: "wren#42", x: "wren_x" });
  expect(html).not.toContain('href="#"');
  expect(html).toMatch(
    /<button[^>]*aria-label="Copy the Discord name wren#42"/,
  );
  expect(html).toContain('href="https://x.com/wren_x"');
});

test("the last activity shows only when the backend gives it", async () => {
  expect(await header({}, "2026-01-02T00:00:00.000Z")).toContain("Last seen");
  // Null for a member who hides their online status (or was never seen): no "last seen" at all.
  const hidden = await header({});
  expect(hidden).not.toContain("Last seen");
  expect(hidden).not.toContain('<time datetime="2026-01-02');
});

test("the last seen line names the page the member viewed within the hour, and marks a hidden status", async () => {
  const html = await new Response(
    await renderToReadableStream(
      withIntl(
        createElement(ProfileHeader, {
          profile: profile({}, "2026-01-02T00:00:00.000Z"),
          viewerId: null,
          canMessage: false,
          activity: {
            at: "2026-01-02T00:00:00.000Z",
            hidden: true,
            place: { kind: "thread", target: { id: 9, title: "News" } },
          },
        }),
      ),
    ),
  ).text();
  expect(html).toContain("Last seen");
  expect(html).toMatch(
    /Viewing thread “<a[^>]*href="\/threads\/9"[^>]*>News<\/a>”/,
  );
  expect(html).toContain("(hidden)");
});
