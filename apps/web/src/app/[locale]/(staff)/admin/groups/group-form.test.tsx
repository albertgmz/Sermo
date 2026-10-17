import { afterAll, afterEach, expect, mock, test } from "bun:test";
import { renderToReadableStream } from "react-dom/server";
import { groupBody } from "@/lib/test-bodies";
import { translator, withIntl } from "@/lib/test-intl";
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
  getTranslations: async (namespace: string) => translator(namespace),
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
const { GroupForm } = await import("./group-form");

afterEach(() => {
  globalThis.fetch = realFetch;
});
afterAll(() => {
  mock.module("next-intl", () => nextIntl);
  mock.module("next-intl/server", () => intl);
});

async function form(group?: Parameters<typeof GroupForm>[0]["group"]) {
  globalThis.fetch = (async (input: string) => {
    const url = new URL(input);
    if (url.pathname === "/api/v1/appearance/colors")
      return Response.json({ items: [] });
    return Response.json(viewerBody(false));
  }) as unknown as typeof fetch;
  const stream = await renderToReadableStream(
    withIntl(await GroupForm({ group })),
  );
  await stream.allReady;
  return new Response(stream).text();
}

const names = (html: string) =>
  [...html.matchAll(/<(?:input|textarea)[^>]*? name="([^"]+)"/g)].map(
    (match) => match[1],
  );

test("the group form sends every field the save action reads", async () => {
  const html = await form(
    groupBody({ id: 7, builtin: false, nameColorId: null }) as never,
  );
  for (const name of [
    "id",
    "title",
    "description",
    "rank",
    "userTitle",
    "badge",
    "nameColorId",
    "isStaff",
    "actorPassword",
  ])
    expect(names(html), name).toContain(name);
  expect(html).toContain('name="id" value="7"');
});

test("a new group carries no id and may leave its rank empty", async () => {
  const html = await form();
  expect(names(html)).not.toContain("id");
  expect(html).not.toMatch(/<input[^>]*id="group-rank"[^>]*required/);
  expect(html).toContain("Create group");
});

test("the rank of a group being edited is required", async () => {
  const html = await form(
    groupBody({ id: 7, builtin: false, nameColorId: null }) as never,
  );
  expect(html).toMatch(/<input[^>]*id="group-rank"[^>]*required/);
});
