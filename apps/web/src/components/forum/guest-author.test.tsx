import { afterAll, expect, mock, test } from "bun:test";
import type { ReactNode } from "react";
import { renderToReadableStream } from "react-dom/server";
import { withIntl } from "@/lib/test-intl";

// A guest author is drawn one way wherever content shows its author: "<name> · Guest", or "Guest"
// alone when no name was kept, with no link to a profile, no member card and no facts.

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
const intl = { ...(await import("next-intl")) };
const { useTranslations } = await import("use-intl");
mock.module("next-intl", () => ({
  ...intl,
  useLocale: () => "en",
  useTranslations,
}));
afterAll(() => {
  mock.module("next/navigation", () => navigation);
  mock.module("next-intl", () => intl);
});
const { Postbit } = await import("./postbit");
const { UserAvatar } = await import("./user-avatar");
const { UserLink } = await import("./user-link");
const { authorsFor, membersFor } = await import("@/lib/sermo/members");

async function html(node: ReactNode) {
  const stream = await renderToReadableStream(withIntl(node));
  await stream.allReady;
  return new Response(stream).text();
}
const textOf = (markup: string) => markup.replace(/<[^>]*>/g, "");

const named = { kind: "guest", name: "Wanderer" } as const;
const unnamed = { kind: "guest", name: null } as const;

test("a named guest is the name and Guest, and one with no name is Guest, in a link's place", async () => {
  const member = await membersFor([named, unnamed]);
  const withName = await html(<UserLink user={member(named)} />);
  expect(textOf(withName)).toBe("Wanderer · Guest");
  const without = await html(<UserLink user={member(unnamed)} />);
  expect(textOf(without)).toBe("Guest");
  for (const out of [withName, without]) {
    expect(out).not.toContain("<a");
    expect(out).not.toContain("/members/");
  }
});

test("a guest's avatar is the initials of the name, linked to nothing", async () => {
  const member = await membersFor([named, unnamed]);
  const out = await html(<UserAvatar user={member(named)} size="lg" />);
  expect(out).toContain('data-initials="Wa"');
  expect(out).not.toContain("<a");
  expect(out).not.toContain("/members/");
  expect(await html(<UserAvatar user={member(unnamed)} />)).toContain(
    'data-initials="?"',
  );
});

for (const layout of ["column", "compact", "responsive"] as const) {
  test(`${layout}: a guest's postbit has the guest name, no member link and no facts`, async () => {
    const author = await authorsFor([named]);
    const out = await html(<Postbit author={author(named)} layout={layout} />);
    expect(textOf(out)).toContain("Wanderer · Guest");
    expect(out).not.toContain("/members/");
    expect(out).not.toContain("<a");
    expect(out).not.toContain("<dl");
    expect(out).not.toContain("Joined");
  });
}
