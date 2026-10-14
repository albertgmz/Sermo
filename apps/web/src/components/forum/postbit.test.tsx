import { afterAll, expect, mock, test } from "bun:test";
import type { ReactNode } from "react";
import { renderToReadableStream } from "react-dom/server";
import type { AuthorView } from "@/lib/sermo/views";
import { withIntl } from "@/lib/test-intl";

mock.module("server-only", () => ({}));
mock.module("next/headers", () => ({
  headers: async () => new Headers(),
  cookies: async () => ({ get: () => undefined, toString: () => "" }),
}));
const navigation = await import("next/navigation");
mock.module("next/navigation", () => ({
  ...navigation,
  usePathname: () => "/threads/1",
  useSearchParams: () => new URLSearchParams(),
}));
// Another suite replaces the translator with one that fills no placeholders: use the real one.
const intl = { ...(await import("next-intl")) };
const { useTranslations } = await import("use-intl");
mock.module("next-intl", () => ({ ...intl, useTranslations }));
afterAll(() => {
  mock.module("next/navigation", () => navigation);
  mock.module("next-intl", () => intl);
});
const { Postbit } = await import("./postbit");

const author = {
  member: {
    id: 3,
    username: "ember",
    avatar: null,
    frame: null,
    nameColor: null,
    title: "Senior member",
    badges: [],
    level: 2,
  },
  cover: null,
  joinedAt: "2025-03-14T10:00:00.000Z",
  postCount: 1280,
  reactionScore: 940,
  xp: 150,
  currentLevelXp: 100,
  nextLevelXp: 300,
  awards: [],
  signatureHtml: null,
} as unknown as AuthorView;

async function html(node: ReactNode) {
  const stream = await renderToReadableStream(withIntl(node));
  await stream.allReady;
  return new Response(stream).text();
}

test("the column draws the name, the title and the facts", async () => {
  const out = await html(<Postbit author={author} layout="column" />);
  expect(out).toContain("ember");
  expect(out).toContain("Senior member");
  for (const label of ["Joined", "Posts", "Reactions"]) {
    expect(out).toContain(`>${label}</dt>`);
  }
  expect(out).toContain('dateTime="2025-03-14T10:00:00.000Z"');
  expect(out).toContain(">1.3K<");
  expect(out).toContain(">940<");
});

test("the compact header has no list of facts and keeps the counts on one line", async () => {
  const out = await html(<Postbit author={author} layout="compact" />);
  expect(out).not.toContain("<dl");
  expect(out).toContain("Senior member");
  expect(out).toContain("Messages");
  expect(out).toContain('data-layout="compact"');
});

test("the responsive layout draws both arrangements and hides each at its breakpoint", async () => {
  const out = await html(<Postbit author={author} />);
  expect(out).toContain('data-layout="responsive"');
  expect(out).toContain("<dl");
  expect(out).toContain("md:hidden");
  expect(out).toContain("hidden md:flex");
});

test("the profile is linked from the avatar and the name, with no button", async () => {
  const out = await html(<Postbit author={author} layout="column" />);
  expect(out).toContain('href="/members/3"');
  expect(out).not.toContain("<button");
});

test("the actions slot is drawn only when given", async () => {
  expect(await html(<Postbit author={author} layout="column" />)).not.toContain(
    "postbit-actions",
  );
  const out = await html(
    <Postbit author={author} actions={<i data-mark="follow" />} />,
  );
  expect(out).toContain("postbit-actions");
  expect(out).toContain('data-mark="follow"');
});
