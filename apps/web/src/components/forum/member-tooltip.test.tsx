import { afterAll, expect, mock, test } from "bun:test";
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
mock.module("next-intl", () => ({
  ...intl,
  useLocale: () => "en",
  useTranslations,
}));
afterAll(() => {
  mock.module("next/navigation", () => navigation);
  mock.module("next-intl", () => intl);
});
const { MemberTooltip } = await import("./member-tooltip");
const { plainAuthor } = await import("@/lib/sermo/members");

const author: AuthorView = {
  ...plainAuthor({ id: 3, username: "ember" }),
  member: {
    ...plainAuthor({ id: 3, username: "ember" }).member,
    restricted: false,
  },
  joinedAt: "2025-03-14T10:00:00.000Z",
};

async function html(view: AuthorView) {
  const stream = await renderToReadableStream(
    withIntl(<MemberTooltip author={view} />),
  );
  await stream.allReady;
  return new Response(stream).text();
}

test("the card names the device of the latest sign-in beside when the member joined", async () => {
  const out = await html({
    ...author,
    device: { type: "phone", os: "Android", browser: "Chrome" },
  });
  expect(out).toContain(">Device</dt>");
  expect(out).toContain('aria-label="Phone"');
  expect(out).toContain('aria-label="Android · Chrome"');
});

test("a member with no known device: no device line", async () => {
  const out = await html(author);
  expect(out).toContain(">Joined</dt>");
  expect(out).not.toContain(">Device</dt>");
  expect(out).not.toContain('data-slot="device-icons"');
});
