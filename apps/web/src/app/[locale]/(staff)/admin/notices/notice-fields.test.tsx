import { afterAll, afterEach, expect, mock, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { translator } from "@/lib/test-intl";
import { viewerBody } from "@/lib/test-viewer";

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

mock.module("server-only", () => ({}));
mock.module("next/headers", () => ({
  headers: async () => new Headers(),
  cookies: async () => ({ get: () => undefined, toString: () => "" }),
}));
const intl = await import("next-intl/server");
mock.module("next-intl/server", () => ({
  getLocale: async () => "en",
  getTranslations: async (namespace: string) => translator(namespace),
}));

const { NoticeFields } = await import("./notice-fields");

afterAll(() => {
  mock.module("next-intl/server", () => intl);
});

const notice = {
  id: 3,
  title: "Mods",
  bodySource: "Hello",
  bodyHtml: "<p>Hello</p>",
  rule: {
    match: "all" as const,
    conditions: [{ criterion: "in_group", ids: [3] }],
  },
  dismissible: true,
  active: true,
  startsAt: null,
  endsAt: null,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

// A viewer who may not list the groups.
function withoutGroupList() {
  globalThis.fetch = (async (input: string) =>
    new URL(input).pathname.endsWith("/me")
      ? Response.json(viewerBody(true))
      : Response.json(
          { error: { code: "forbidden", message: "No." } },
          { status: 403 },
        )) as unknown as typeof fetch;
}

test("without the group list the form keeps the notice's group, so saving it works", async () => {
  withoutGroupList();
  const html = renderToStaticMarkup(
    await NoticeFields({ notice, prefix: "notice" }),
  );
  expect(html).toContain('type="hidden"');
  expect(html).toContain('name="groupId"');
  expect(html).toContain('value="3"');
  expect(html).not.toContain('<select id="notice-group"');
});

test("a new notice has no hidden group", async () => {
  withoutGroupList();
  const html = renderToStaticMarkup(await NoticeFields({ prefix: "new" }));
  expect(html).not.toContain('name="groupId"');
});

test("a rule the form cannot draw is offered as custom and travels in a hidden field", async () => {
  withoutGroupList();
  const rule = {
    match: "any" as const,
    conditions: [{ criterion: "is_member", ids: [4, 5] }],
  };
  const html = renderToStaticMarkup(
    await NoticeFields({ notice: { ...notice, rule }, prefix: "notice" }),
  );
  expect(html).toContain('<option value="custom" selected');
  expect(html).toContain('name="rule"');
  expect(html).toContain(JSON.stringify(rule).replaceAll('"', "&quot;"));
  expect(html).not.toContain('name="groupId"');
});
