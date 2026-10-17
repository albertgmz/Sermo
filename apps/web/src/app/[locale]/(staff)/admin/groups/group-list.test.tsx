import { afterAll, afterEach, expect, mock, test } from "bun:test";
import { renderToReadableStream } from "react-dom/server";
import { messages } from "@/i18n/messages";
import { groupBody } from "@/lib/test-bodies";
import { withIntl } from "@/lib/test-intl";
import { viewerBody } from "@/lib/test-viewer";

const realFetch = globalThis.fetch;
const intl = await import("next-intl/server");
mock.module("server-only", () => ({}));
mock.module("next/headers", () => ({
  headers: async () => new Headers(),
  cookies: async () => ({ get: () => undefined, toString: () => "" }),
}));
mock.module("next-intl/server", () => ({
  getLocale: async () => "en",
  getTranslations: async (namespace: string) => (key: string) => {
    let value: unknown = messages;
    for (const part of `${namespace}.${key}`.split(".")) {
      value = (value as Record<string, unknown> | undefined)?.[part];
    }
    return typeof value === "string" ? value : key;
  },
}));

// Another suite may leave a stand-in for `useTranslations` in place: the client components here
// read the real messages.
const nextIntl = { ...(await import("next-intl")) };
const useIntl = await import("use-intl");
mock.module("next-intl", () => ({
  ...nextIntl,
  useLocale: () => "en",
  useTranslations: useIntl.useTranslations,
}));
const { GroupList } = await import("./group-list");
const { getGroups, groupsIfAllowed } = await import("./data");

afterEach(() => {
  globalThis.fetch = realFetch;
});
afterAll(() => {
  mock.module("next-intl", () => nextIntl);
  mock.module("next-intl/server", () => intl);
});

function backend(memberCount: number | null, mayOpenPermissions = false) {
  const asked: string[] = [];
  globalThis.fetch = (async (input: string) => {
    asked.push(input);
    const url = new URL(input);
    if (url.pathname === "/api/v1/groups")
      return Response.json({ items: [groupBody({ memberCount })] });
    if (url.pathname === "/api/v1/appearance/colors")
      return Response.json({ items: [] });
    return Response.json({
      ...viewerBody(false),
      resolvedPermissions: { "admin.permissions": mayOpenPermissions },
    });
  }) as unknown as typeof fetch;
  return asked;
}

async function page() {
  const stream = await renderToReadableStream(
    withIntl(await GroupList({ searchParams: Promise.resolve({}) })),
  );
  await stream.allReady;
  return new Response(stream).text();
}

test("the groups screen asks for the member counts and shows them", async () => {
  const asked = backend(4);
  const html = await page();
  expect(asked.find((url) => url.includes("/api/v1/groups"))).toContain(
    "counts=true",
  );
  expect(html).toContain(`<dt>${messages.adminGroups.list.members}</dt>`);
});

test("a group listed without a count shows no member count", async () => {
  backend(null);
  expect(await page()).not.toContain(
    `<dt>${messages.adminGroups.list.members}</dt>`,
  );
});

test("the pickers and filters list the groups without counting their members", async () => {
  const asked = backend(null);
  await getGroups();
  await groupsIfAllowed();
  const groupRequests = asked.filter((url) => url.includes("/api/v1/groups"));
  expect(groupRequests.length).toBeGreaterThan(0);
  for (const url of groupRequests) expect(url).not.toContain("counts");
});

test("each group's row leads to its edit page, and to its permissions when the viewer may open them", async () => {
  backend(4, true);
  const html = await page();
  expect(html).toContain('href="/admin/groups/7"');
  expect(html).toContain('href="/admin/permissions/groups/7"');
  backend(4, false);
  expect(await page()).not.toContain("/admin/permissions/groups/7");
});
