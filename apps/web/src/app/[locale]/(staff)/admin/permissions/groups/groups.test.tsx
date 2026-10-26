import { afterAll, afterEach, expect, mock, test } from "bun:test";
import { renderToReadableStream } from "react-dom/server";
import { groupBody } from "@/lib/test-bodies";
import { translator, withIntl } from "@/lib/test-intl";
import { viewerBody } from "@/lib/test-viewer";
import { fakeBackend } from "../../groups/test-backend";

mock.module("next/headers", () => ({
  headers: async () => new Headers(),
  cookies: async () => ({ get: () => undefined, toString: () => "" }),
}));
const intl = await import("next-intl/server");
const nextIntl = await import("next-intl");
const useIntl = await import("use-intl");
mock.module("next-intl", () => ({
  ...nextIntl,
  useLocale: () => "en",
  useTranslations: useIntl.useTranslations,
}));
mock.module("next-intl/server", () => ({
  getLocale: async () => "en",
  getTranslations: async (namespace: string) => translator(namespace),
}));

const { default: PermissionGroupsPage } = await import("./page");

let backend: ReturnType<typeof fakeBackend> | undefined;
afterEach(() => backend?.restore());
afterAll(() => {
  mock.module("next-intl/server", () => intl);
  mock.module("next-intl", () => nextIntl);
});

async function page(params: Record<string, string>) {
  backend = fakeBackend({
    "auth.me": () => Response.json(viewerBody(true)),
    "groups.list": () => Response.json({ items: [groupBody({ id: 4 })] }),
  });
  const props = {
    params: Promise.resolve({ locale: "en" }),
    searchParams: Promise.resolve(params),
  } as Parameters<typeof PermissionGroupsPage>[0];
  const tree = <PermissionGroupsPage {...props} />;
  return new Response(await renderToReadableStream(withIntl(tree))).text();
}

test("a group's link carries the permission a search result led to, on to its matrix", async () => {
  expect(await page({ permission: "conversation.start" })).toContain(
    'href="/admin/permissions/groups/4?permission=conversation.start"',
  );
  const plain = await page({});
  expect(plain).toContain('href="/admin/permissions/groups/4"');
  expect(plain).not.toContain("permission=");
});
