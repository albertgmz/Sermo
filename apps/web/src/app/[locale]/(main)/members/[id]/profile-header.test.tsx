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
const navigation = await import("next/navigation");
mock.module("next/navigation", () => ({
  ...navigation,
  useRouter: () => ({ push() {}, replace() {}, refresh() {}, prefetch() {} }),
}));

const { ProfileHeader } = await import("./profile-header");

afterAll(() => {
  mock.module("next-intl/server", () => intl);
  mock.module("next/navigation", () => navigation);
});

const profile = (
  socials: Record<string, string>,
  lastActivityAt: string | null = null,
  cover: { url: string } | null = null,
) =>
  ({
    id: 5,
    username: "wren",
    cover,
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
    device: null,
    viewer: { isFollowing: false, isBlocking: false },
    isAdult: false,
    canPostOnWall: false,
  }) as never;

async function header(
  socials: Record<string, string>,
  lastActivityAt: string | null = null,
  cover: { url: string } | null = null,
) {
  return new Response(
    await renderToReadableStream(
      withIntl(
        createElement(ProfileHeader, {
          profile: profile(socials, lastActivityAt, cover),
          viewerId: null,
          relation: null,
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
          relation: null,
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

test("without a cover the header is compact: no empty band above the avatar, which sits beside the name from md", async () => {
  const bare = await header({});
  expect(bare).not.toContain("md:h-56");
  expect(bare).not.toContain("md:pt-44");
  expect(bare).not.toContain("pt-20");
  expect(bare).toMatch(/data-slot="container" class="[^"]*md:flex-row/);
  // With one the band is drawn and the avatar overlaps its foot, as before.
  const covered = await header({}, null, { url: "/covers/a.jpg" });
  expect(covered).toContain("md:h-56");
  expect(covered).toContain("md:pt-44");
});

test("the divider after the name is drawn only when a social link follows it", async () => {
  const divider = 'class="h-5 w-px bg-border"';
  expect(await header({})).not.toContain(divider);
  expect(await header({ x: "wren_x" })).toContain(divider);
});

test("a profile marked +18 carries the mark beside the name when the page says so", async () => {
  const { messages } = await import("@/i18n/messages");
  const drawn = (adult: boolean) =>
    renderToReadableStream(
      withIntl(
        createElement(ProfileHeader, {
          profile: profile({}),
          viewerId: null,
          relation: null,
          adult,
        }),
      ),
    ).then((stream) => new Response(stream).text());
  expect(await drawn(true)).toContain(messages.forum.adultBadge.name);
  expect(await drawn(false)).not.toContain(messages.forum.adultBadge.name);
});

// What another member's profile offers, as `users.relations` says, drawn for a signed-in visitor.
const RELATION = {
  following: false,
  canFollow: true,
  canMessage: true,
  blocking: false,
  canBlock: true,
};
async function asVisitor(
  relation: typeof RELATION,
  viewer = { isFollowing: false, isBlocking: false },
) {
  return new Response(
    await renderToReadableStream(
      withIntl(
        createElement(ProfileHeader, {
          profile: { ...(profile({}) as object), viewer } as never,
          viewerId: 9,
          relation,
        }),
      ),
    ),
  ).text();
}

test("the profile offers Block between follow and the message, and Unblock once blocked", async () => {
  const html = await asVisitor(RELATION);
  const follow = html.indexOf('aria-label="Follow wren"');
  const block = html.indexOf('aria-label="Block wren"');
  const message = html.indexOf('href="/conversations/new?to=wren"');
  expect(follow).toBeGreaterThanOrEqual(0);
  expect(block).toBeGreaterThan(follow);
  expect(message).toBeGreaterThan(block);
  const blocked = await asVisitor(
    { ...RELATION, canFollow: false, canMessage: false, blocking: true },
    { isFollowing: false, isBlocking: true },
  );
  expect(blocked).toContain('aria-label="Unblock wren"');
  // Neither follow nor message is offered across a block.
  expect(blocked).not.toContain('aria-label="Follow wren"');
  expect(blocked).not.toContain("/conversations/new");
});

test("without the right to block, the profile has no Block button", async () => {
  const html = await asVisitor({ ...RELATION, canBlock: false });
  expect(html).not.toContain("Block wren");
  expect(html).toContain('aria-label="Follow wren"');
});

test("the joined line ends with the device of the latest sign-in, and has none without one", async () => {
  const drawn = (device: unknown) =>
    renderToReadableStream(
      withIntl(
        createElement(ProfileHeader, {
          profile: { ...(profile({}) as object), device } as never,
          viewerId: null,
          relation: null,
        }),
      ),
    ).then((stream) => new Response(stream).text());
  const html = await drawn({ type: "phone", os: "Android", browser: "Chrome" });
  expect(html).toContain('aria-label="Phone"');
  expect(html).toContain('aria-label="Android · Chrome"');
  expect(html.indexOf("Joined")).toBeLessThan(
    html.indexOf('data-slot="device-icons"'),
  );
  expect(await drawn(null)).not.toContain('data-slot="device-icons"');
});

test("staff who manage members get a Manage button; everyone else gets none", async () => {
  const drawn = (manage: unknown, viewerId: number | null) =>
    renderToReadableStream(
      withIntl(
        createElement(ProfileHeader, {
          profile: profile({}),
          viewerId,
          relation: null,
          manage,
        } as never),
      ),
    ).then((stream) => new Response(stream).text());
  const tabs = [{ key: "usersEdit", href: "/admin/users/5" }];
  const staff = await drawn(tabs, 9);
  expect(staff).toMatch(/<button[^>]*aria-haspopup="menu"[^>]*>.*Manage/);
  // The member who is staff sees it on their own profile as well.
  expect(await drawn(tabs, 5)).toContain("Manage");
  expect(await drawn([], 9)).not.toContain("Manage");
  expect(await drawn(undefined, 9)).not.toContain("Manage");
});
