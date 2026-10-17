import { afterAll, expect, mock, test } from "bun:test";
import { renderToReadableStream } from "react-dom/server";
import type { MemberView } from "@/lib/sermo/views";
import { translator, withIntl } from "@/lib/test-intl";

mock.module("server-only", () => ({}));
mock.module("next/headers", () => ({
  headers: async () => new Headers(),
  cookies: async () => ({ get: () => undefined, toString: () => "" }),
}));
const serverIntl = await import("next-intl/server");
mock.module("next-intl/server", () => ({
  ...serverIntl,
  getTranslations: async (namespace: string) => translator(namespace),
}));
const navigation = await import("next/navigation");
mock.module("next/navigation", () => ({
  ...navigation,
  usePathname: () => "/admin/staff/moderators",
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
  mock.module("next-intl/server", () => serverIntl);
  mock.module("next-intl", () => intl);
});
const { StaffList } = await import("./staff-list");

const card = (id: number, username: string): MemberView => ({
  id,
  username,
  avatar: null,
  frame: null,
  nameColor: null,
  nameIcon: null,
  title: "Moderator",
  badges: [],
  level: 1,
  restricted: false,
});

async function draw(items: { card: MemberView }[]) {
  const stream = await renderToReadableStream(
    withIntl(
      <StaffList
        items={items}
        heading="Moderators"
        permissions={(name) => `Permissions of ${name}`}
        empty={{ title: "Nobody", description: "No one here." }}
        detail={(item) => <p>{`about ${item.card.username}`}</p>}
      />,
    ),
  );
  await stream.allReady;
  return new Response(stream).text();
}

test("each member's row links to their permissions and shows what the page says about them", async () => {
  const html = await draw([{ card: card(5, "ana") }, { card: card(6, "bo") }]);
  expect(html).toContain('href="/admin/permissions/members/5"');
  expect(html).toContain('href="/admin/permissions/members/6"');
  expect(html).toContain('aria-label="Permissions of ana"');
  expect(html).toContain("about ana");
  expect(html).toContain("about bo");
  // The member's name still leads to their profile.
  expect(html).toContain('href="/members/5"');
});

test("nobody listed shows the empty state", async () => {
  const html = await draw([]);
  expect(html).toContain("Nobody");
  expect(html).toContain("No one here.");
});
