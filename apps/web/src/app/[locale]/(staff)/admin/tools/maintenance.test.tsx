import { afterAll, afterEach, expect, mock, test } from "bun:test";
import { renderToReadableStream } from "react-dom/server";
import { messages } from "@/i18n/messages";
import { formattedTranslator, withIntl } from "@/lib/test-intl";
import { viewerBody } from "@/lib/test-viewer";

const realFetch = globalThis.fetch;
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
  getTranslations: async (namespace: string) => formattedTranslator(namespace),
}));

const { Maintenance } = await import("./maintenance");

afterEach(() => {
  globalThis.fetch = realFetch;
});
afterAll(() => {
  mock.module("next-intl/server", () => intl);
});

function backend(held: Record<string, boolean>) {
  globalThis.fetch = (async (input: string) => {
    const { pathname } = new URL(input);
    if (pathname === "/api/v1/me") {
      const viewer = viewerBody(true);
      return Response.json({
        ...viewer,
        resolvedPermissions: held,
        staff: { ...viewer.staff, panel: true },
      });
    }
    return Response.json(
      { error: { code: "not_found", message: "Not found." } },
      { status: 404 },
    );
  }) as unknown as typeof fetch;
}

async function html(searchParams: Record<string, string> = {}) {
  const page = await Maintenance({
    searchParams: Promise.resolve(searchParams),
  });
  const stream = await renderToReadableStream(withIntl(page));
  await stream.allReady;
  return (await new Response(stream).text()).replaceAll("&#x27;", "'");
}

const m = messages.adminTools.maintenance;

test("each operation the viewer holds the permission for is a row with its own confirm step, and no other", async () => {
  backend({ "credits.adjust": true, "admin.awards": true });
  const page = await html();
  expect(page).toContain(m.credits.heading);
  expect(page).toContain(m.awards.heading);
  expect(page).not.toContain(m.promotions.heading);
  expect(page).not.toContain(m.spam.heading);
  expect(page).toContain('name="operation" value="credits"');
  expect(page).toContain('name="operation" value="awards"');
  expect(page).toContain(m.credits.warning);
  expect(page).toContain("Showing 2 entries");
});

test("the spam cleanup row asks to pick a member, and offers the search for one", async () => {
  backend({ "member.spamCleanup": true });
  const page = await html();
  expect(page).toContain(m.spam.heading);
  expect(page).toContain(m.spam.pick);
  expect(page).toContain('id="spam"');
  expect(page).toContain('id="spam-search"');
  expect(page).not.toContain('name="reason"');
});

test("a viewer who holds none of the permissions sees the empty state", async () => {
  backend({});
  const page = await html();
  expect(page).toContain(m.empty);
  expect(page).not.toContain('name="operation"');
});
