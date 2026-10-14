import { afterAll, expect, mock, test } from "bun:test";
import type { ReactNode } from "react";
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
  usePathname: () => "/threads/1",
  useSearchParams: () => new URLSearchParams(),
}));
// Another suite replaces the translator with one that fills no placeholders: use the real one.
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
const { MemberCardTrigger } = await import("./member-card-trigger");
const { MemberCardScope } = await import("./member-card-scope");
const { UserAvatar } = await import("./user-avatar");

async function html(node: ReactNode) {
  const stream = await renderToReadableStream(withIntl(node));
  await stream.allReady;
  return new Response(stream).text();
}

const HIT_AREA = "after:-inset-y-3";

test("inside a disabled scope the trigger is the plain link with the same classes", async () => {
  const out = await html(
    <MemberCardScope disabled>
      <MemberCardTrigger id={3} href="/members/3" name="ember" className="x-y">
        ember
      </MemberCardTrigger>
    </MemberCardScope>,
  );
  expect(out).toContain('href="/members/3"');
  expect(out).toContain("x-y");
  expect(out).toContain(HIT_AREA);
  expect(out).not.toContain('role="link"');
  expect(out).not.toContain("data-slot");
});

test("outside a scope a name is a card trigger with the hit area around its line", async () => {
  const out = await html(
    <MemberCardTrigger id={3} href="/members/3" name="ember">
      ember
    </MemberCardTrigger>,
  );
  expect(out).toContain('role="link"');
  expect(out).toContain('href="/members/3"');
  expect(out).toContain(HIT_AREA);
});

test("an avatar trigger keeps the href and the label and draws no hit area", async () => {
  const out = await html(
    <MemberCardTrigger
      avatar
      id={3}
      href="/members/3"
      name="ember"
      aria-label="ember"
      className="shrink-0 rounded-full"
    >
      pic
    </MemberCardTrigger>,
  );
  expect(out).toContain('role="link"');
  expect(out).toContain('href="/members/3"');
  expect(out).toContain('aria-label="ember"');
  expect(out).toContain("shrink-0 rounded-full");
  expect(out).not.toContain(HIT_AREA);
  expect(out).not.toContain("relative");
  expect(out).not.toContain("aria-haspopup");
  expect(out).not.toContain("aria-expanded");
});

const user = { id: 3, username: "ember", avatar: null, frame: null };

test("a linked avatar is a trigger, a plain one is the picture alone", async () => {
  const linked = await html(await UserAvatar({ user, size: "md" }));
  expect(linked).toContain('role="link"');
  expect(linked).toContain('href="/members/3"');
  expect(linked).toContain('aria-label="ember"');
  const plain = await html(await UserAvatar({ user, link: false }));
  expect(plain).not.toContain("<a");
  const anonymous = await html(
    await UserAvatar({ user: { ...user, id: undefined } }),
  );
  expect(anonymous).not.toContain("<a");
});

test("inside a disabled scope a linked avatar is the plain link", async () => {
  const out = await html(
    <MemberCardScope disabled>{await UserAvatar({ user })}</MemberCardScope>,
  );
  expect(out).toContain('href="/members/3"');
  expect(out).toContain('aria-label="ember"');
  expect(out).not.toContain('role="link"');
});
