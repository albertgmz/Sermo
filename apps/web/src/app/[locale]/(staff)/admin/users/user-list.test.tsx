import { afterAll, afterEach, expect, mock, test } from "bun:test";
import { renderToReadableStream } from "react-dom/server";
import { groupBody } from "@/lib/test-bodies";
import { translator, withIntl } from "@/lib/test-intl";
import { fakeBackend } from "../groups/test-backend";

mock.module("server-only", () => ({}));
mock.module("next/headers", () => ({
  headers: async () => new Headers(),
  cookies: async () => ({ get: () => undefined, set: () => {} }),
}));
const intl = await import("next-intl/server");
mock.module("next-intl/server", () => ({
  getLocale: async () => "en",
  getTranslations: async (namespace: string) => translator(namespace, true),
  getFormatter: async () => ({
    dateTime: (date: Date) => date.toISOString().slice(0, 10),
    number: (value: number) => String(value),
  }),
}));

const { UserList } = await import("./user-list");

let backend: ReturnType<typeof fakeBackend> | undefined;
afterEach(() => backend?.restore());
afterAll(() => {
  mock.module("next-intl/server", () => intl);
});

const member = (id: number, username: string, over = {}) => ({
  card: {
    id,
    username,
    avatar: null,
    frame: null,
    nameColor: null,
    nameIcon: null,
    title: "",
    badges: [{ label: "Writers", color: null, style: "default" }],
    level: 1,
    restricted: false,
  },
  email: `${username}@example.test`,
  emailVerified: true,
  state: "valid",
  erasedAt: null,
  createdAt: "2026-01-02T10:00:00.000Z",
  lastActivityAt: null,
  usernameChangedAt: null,
  postCount: 12,
  credits: 340,
  canEdit: true,
  isSuperAdmin: false,
  canSetSuperAdmin: false,
  ...over,
});

// Async server components settle in a stream: wait for all of it, then read the markup.
const draw = async (params: Record<string, string> = {}) => {
  const stream = await renderToReadableStream(
    withIntl(await UserList({ searchParams: Promise.resolve(params) })),
  );
  await stream.allReady;
  return new Response(stream).text();
};

test("every member is a row with their details, both ways in, and the filters stay in the address", async () => {
  backend = fakeBackend({
    "groups.list": () => Response.json({ items: [groupBody()] }),
    "users.adminList": () =>
      Response.json({
        items: [member(5, "ada"), member(6, "bob", { state: "banned" })],
        nextCursor: "after-bob",
      }),
  });
  const html = await draw({ state: "valid", group: "7", q: "a" });
  expect(
    backend.asked.find((a) => a.operation === "users.adminList"),
  ).toBeDefined();
  expect(html).toContain('href="/members/5"');
  expect(html).toContain('aria-label="Open ada"');
  expect(html).toContain('href="/admin/users/5"');
  expect(html).toContain("ada@example.test");
  expect(html).toContain("Writers");
  expect(html).toContain("12");
  expect(html).toContain("340");
  // The three filters are still the form's fields.
  expect(html).toContain('name="q"');
  expect(html).toContain('name="state"');
  expect(html).toContain('name="group"');
  expect(html).toContain(
    'href="/admin/users?state=valid&amp;group=7&amp;q=a&amp;cursor=after-bob"',
  );
});
