import { afterAll, afterEach, expect, mock, test } from "bun:test";
import { renderToReadableStream } from "react-dom/server";
import { withIntl } from "@/lib/test-intl";
import { fakeBackend } from "../groups/test-backend";
import { installIntl } from "../users/intl-stand-ins";

mock.module("server-only", () => ({}));
mock.module("next/headers", () => ({
  headers: async () => new Headers(),
  cookies: async () => ({ get: () => undefined, set: () => {} }),
}));
const restoreIntl = await installIntl();

const { BanList } = await import("./ban-list");

let backend: ReturnType<typeof fakeBackend> | undefined;
afterEach(() => backend?.restore());
afterAll(restoreIntl);

const ban = (id: number, state: string, reason: string) => ({
  id,
  user: { id: 10 + id, username: `member${id}` },
  moderator: { id: 2, username: "mod" },
  reason,
  createdAt: "2026-03-01T10:00:00.000Z",
  expiresAt: null,
  liftedAt: state === "lifted" ? "2026-03-05T10:00:00.000Z" : null,
  state,
});

// Async server components settle in a stream: wait for all of it, then read the markup.
const draw = async (params: Record<string, string> = {}) => {
  const stream = await renderToReadableStream(
    withIntl(await BanList({ searchParams: Promise.resolve(params) })),
  );
  await stream.allReady;
  return new Response(stream).text();
};

test("each ban is a row leading to its member; only a ban in force can be lifted", async () => {
  backend = fakeBackend({
    "bans.list": () =>
      Response.json({
        items: [ban(1, "active", "Spam"), ban(2, "lifted", "")],
        nextCursor: "next-page",
      }),
    "users.cards": () => Response.json({ items: [] }),
  });
  const html = await draw({ state: "active" });
  expect(backend.asked[0]?.operation).toBe("bans.list");
  expect(html).toContain('href="/admin/users/11"');
  expect(html).toContain('href="/admin/users/12"');
  expect(html).toContain('href="/members/11"');
  expect(html).toContain('aria-label="View profile of member1"');
  expect(html).toContain("Spam");
  expect(html).toContain("No reason given");
  // One lift step, for the ban in force, wired to the hidden ban id.
  expect(html.match(/<details/g)).toHaveLength(1);
  expect(html).toContain('name="banId"');
  expect(html).toContain('value="1"');
  // The state filter stays a GET form and the next page keeps it.
  expect(html).toContain('action="/admin/bans"');
  expect(html).toContain(
    'href="/admin/bans?state=active&amp;cursor=next-page"',
  );
});
