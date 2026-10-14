import { afterAll, expect, mock, test } from "bun:test";
import { createElement } from "react";
import { renderToReadableStream } from "react-dom/server";
import { translator, withIntl } from "@/lib/test-intl";

mock.module("server-only", () => ({}));
const intl = await import("next-intl/server");
mock.module("next-intl/server", () => ({
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

const profile = (socials: Record<string, string>) =>
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
    lastActivityAt: null,
    viewer: { isFollowing: false, isIgnoring: false },
    canPostOnWall: false,
  }) as never;

async function header(socials: Record<string, string>) {
  return new Response(
    await renderToReadableStream(
      withIntl(
        createElement(ProfileHeader, {
          profile: profile(socials),
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
