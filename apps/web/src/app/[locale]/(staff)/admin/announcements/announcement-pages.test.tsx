import { afterAll, afterEach, expect, mock, test } from "bun:test";
import { renderToReadableStream } from "react-dom/server";
import { groupBody } from "@/lib/test-bodies";
import { translator, withIntl } from "@/lib/test-intl";
import { viewerBody } from "@/lib/test-viewer";
import { fakeBackend } from "../groups/test-backend";

const intl = await import("next-intl/server");
// The rows read their words through the library's hook and the provider of `withIntl`, whatever
// stand-in another suite left in place for it.
const nextIntl = await import("next-intl");
const useIntl = await import("use-intl");
mock.module("next-intl", () => ({
  ...nextIntl,
  useLocale: () => "en",
  useTranslations: useIntl.useTranslations,
}));
mock.module("server-only", () => ({}));
mock.module("next/headers", () => ({
  headers: async () => new Headers(),
  cookies: async () => ({ get: () => undefined, toString: () => "" }),
}));
mock.module("next-intl/server", () => ({
  getLocale: async () => "en",
  getFormatter: async () => ({
    dateTime: (date: Date) => date.toISOString().slice(0, 10),
  }),
  getTranslations: async (namespace: string) => translator(namespace, true),
}));

const { AnnouncementList } = await import("./announcement-list");
const NewAnnouncementPage = (await import("./new/page")).default;

let backend: ReturnType<typeof fakeBackend> | undefined;
afterEach(() => backend?.restore());
afterAll(() => {
  mock.module("next-intl/server", () => intl);
  mock.module("next-intl", () => nextIntl);
});

const SENT = {
  id: 2,
  title: "New rules",
  bodyHtml: "<p>Please read them.</p>",
  url: "/rules",
  audience: { kind: "users", usernames: ["wren", "ember"] },
  author: { id: 1, username: "ember" },
  createdAt: "2026-02-03T10:00:00.000Z",
};

function serve(nextCursor: string | null = null, groups = true) {
  backend = fakeBackend({
    "auth.me": () => Response.json(viewerBody(true)),
    "announcements.list": () => Response.json({ items: [SENT], nextCursor }),
    "groups.list": () =>
      groups
        ? Response.json({ items: [groupBody({ id: 3, title: "Writers" })] })
        : Response.json(
            { error: { code: "forbidden", message: "No." } },
            { status: 403 },
          ),
  });
}

async function draw(element: React.ReactNode) {
  const stream = await renderToReadableStream(withIntl(element));
  await stream.allReady;
  return (await new Response(stream).text()).replaceAll("&#x27;", "'");
}

test("a sent alert shows who sent it, to whom and its link, and has no edit link", async () => {
  serve("next-page");
  const html = await draw(
    <AnnouncementList
      searchParams={Promise.resolve({})}
      addAction={<a href="/admin/announcements/new">New alert</a>}
    />,
  );
  expect(html).toContain("New rules");
  expect(html).toContain("Sent by ember on 2026-02-03");
  expect(html).toContain("Sent to wren, ember");
  expect(html).toContain("Opens /rules");
  expect(html).toContain("Show the text");
  expect(html).toContain("Please read them.");
  expect(html).not.toContain("/admin/announcements/2");
  expect(html).toContain('href="/admin/announcements?cursor=next-page"');
});

test("the new page keeps every field of the alert and the confirmation", async () => {
  serve();
  const html = await draw(<NewAnnouncementPage />);
  for (const name of [
    "title",
    "body",
    "url",
    "audience",
    "groupId",
    "usernames",
    "confirm",
  ]) {
    expect(html).toContain(`name="${name}"`);
  }
  expect(html).toContain("Send alert");
  expect(html).toContain('<option value="3">Writers</option>');
});

test("without the right to list groups the alert goes to everyone or to named members", async () => {
  serve(null, false);
  const html = await draw(<NewAnnouncementPage />);
  expect(html).not.toContain('name="groupId"');
  expect(html).not.toContain('value="group"');
  expect(html).toContain('value="users"');
});
