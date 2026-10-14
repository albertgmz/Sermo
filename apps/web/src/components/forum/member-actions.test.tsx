import { afterAll, expect, mock, test } from "bun:test";
import type { ReactNode } from "react";
import { renderToReadableStream } from "react-dom/server";
import { withIntl } from "@/lib/test-intl";

mock.module("server-only", () => ({}));
mock.module("next/headers", () => ({
  headers: async () => new Headers(),
  cookies: async () => ({ set: () => {}, toString: () => "" }),
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
  mock.module("next-intl", () => intl);
});
const { MemberActions, memberActionsOf } = await import("./member-actions");
const { hasMemberActions } = await import("./member-actions-view");

const ember = { id: 3, username: "ember", restricted: false };
const ALL = { following: false, canFollow: true, canMessage: true };

async function html(node: ReactNode) {
  const stream = await renderToReadableStream(withIntl(node));
  await stream.allReady;
  return new Response(stream).text();
}

test("not following: a follow button and a message link", async () => {
  const out = await html(<MemberActions member={ember} relation={ALL} />);
  expect(out).toContain('aria-label="Follow ember"');
  expect(out).toContain("Follow");
  expect(out).toContain('aria-label="Start a private conversation with ember"');
  expect(out).toContain('href="/conversations/new?to=ember"');
});

test("following: the button offers to unfollow", async () => {
  const out = await html(
    <MemberActions member={ember} relation={{ ...ALL, following: true }} />,
  );
  expect(out).toContain('aria-label="Unfollow ember"');
  expect(out).not.toContain('aria-label="Follow ember"');
  expect(out).toContain("Following");
});

test("the username is encoded in the conversation address", async () => {
  const out = await html(
    <MemberActions
      member={{ ...ember, username: "a b&c" }}
      relation={{ ...ALL, canFollow: false }}
    />,
  );
  expect(out).toContain("/conversations/new?to=a%20b%26c");
});

test("message only, follow only", async () => {
  const messageOnly = await html(
    <MemberActions member={ember} relation={{ ...ALL, canFollow: false }} />,
  );
  expect(messageOnly).not.toContain("Follow ember");
  expect(messageOnly).toContain("/conversations/new");
  const followOnly = await html(
    <MemberActions member={ember} relation={{ ...ALL, canMessage: false }} />,
  );
  expect(followOnly).toContain("Follow ember");
  expect(followOnly).not.toContain("/conversations/new");
});

test("nothing at all for a guest, yourself, a restricted member or when nothing is allowed", async () => {
  const none = { following: false, canFollow: false, canMessage: false };
  for (const [member, relation] of [
    [ember, null],
    [ember, none],
    [{ ...ember, restricted: true }, ALL],
  ] as const) {
    expect(
      await html(<MemberActions member={member} relation={relation} />),
    ).toBe("");
    expect(hasMemberActions(member, relation)).toBe(false);
    expect(memberActionsOf(member, relation)).toBeUndefined();
  }
  expect(memberActionsOf(ember, ALL)).toBeDefined();
});

test("there is no profile button", async () => {
  const out = await html(<MemberActions member={ember} relation={ALL} />);
  expect(out).not.toContain("/members/");
});

test("the forms: icons with hidden text, text below md only, or text always", async () => {
  const compact = await html(
    <MemberActions member={ember} relation={ALL} form="compact" />,
  );
  expect(compact).toContain('data-form="compact"');
  expect(compact).toContain("relative");
  expect(compact).toContain("size-10");
  expect(compact).toContain('class="sr-only"');
  const responsive = await html(
    <MemberActions member={ember} relation={ALL} />,
  );
  expect(responsive).toContain('data-form="responsive"');
  expect(responsive).toContain("max-md:size-10");
  expect(responsive).toContain("max-md:sr-only");
  const labelled = await html(
    <MemberActions member={ember} relation={ALL} form="labelled" />,
  );
  expect(labelled).toContain('data-form="labelled"');
  expect(labelled).not.toContain("sr-only");
});

test("a member already followed can be unfollowed without permission to follow", async () => {
  const relation = { following: true, canFollow: false, canMessage: false };
  const out = await html(<MemberActions member={ember} relation={relation} />);
  expect(out).toContain('aria-label="Unfollow ember"');
  expect(memberActionsOf(ember, relation)).toBeDefined();
  const none = { following: false, canFollow: false, canMessage: false };
  expect(await html(<MemberActions member={ember} relation={none} />)).toBe("");
});
