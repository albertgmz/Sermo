import { afterAll, afterEach, expect, mock, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { TEST_NOW, translator, withIntl } from "@/lib/test-intl";
import { fakeBackend, refusal } from "../../groups/test-backend";

mock.module("server-only", () => ({}));
mock.module("next/headers", () => ({
  headers: async () => new Headers(),
  cookies: async () => ({ set: () => {} }),
}));
const intl = await import("next-intl/server");
mock.module("next-intl/server", () => ({
  getLocale: async () => "en",
  getNow: async () => TEST_NOW,
  getTranslations: async (namespace: string) => translator(namespace, true),
  getFormatter: async () => ({
    dateTime: (date: Date) => date.toISOString().slice(0, 10),
  }),
}));

const { Acceptances } = await import("./acceptances");

let backend: ReturnType<typeof fakeBackend> | undefined;
afterEach(() => backend?.restore());
afterAll(() => {
  mock.module("next-intl/server", () => intl);
});

const draw = async () =>
  renderToStaticMarkup(withIntl((await Acceptances({ userId: 7 })) ?? <></>));

test("the versions a member accepted are listed with their date and address, and what is missing is said", async () => {
  backend = fakeBackend({
    "users.adminAcceptances": () =>
      Response.json({
        // Newest first, as the backend lists them.
        items: [
          {
            kind: "terms",
            version: 2,
            acceptedAt: "2026-05-04T10:00:00.000Z",
            ip: null,
          },
          {
            kind: "terms",
            version: 1,
            acceptedAt: "2026-02-03T10:00:00.000Z",
            ip: "203.0.113.9",
          },
        ],
        current: { terms: 2, rules: 1 },
      }),
  });
  const markup = await draw();
  expect(backend.asked[0]?.path).toBe("/api/v1/admin/users/7/acceptances");
  expect(markup).toContain("Version 1");
  expect(markup).toContain("Version 2");
  expect(markup).toContain("2026-02-03");
  expect(markup).toContain("203.0.113.9");
  expect(markup).toContain("Not recorded");
  expect(markup).toContain("Accepted at the current version.");
  expect(markup).toContain("Never accepted.");
  expect(markup).not.toContain("<form");
  expect(markup).not.toContain("<input");
});

test("a page that is not published asks nothing", async () => {
  backend = fakeBackend({
    "users.adminAcceptances": () =>
      Response.json({ items: [], current: { terms: null, rules: null } }),
  });
  const markup = await draw();
  expect(markup).not.toContain("Never accepted.");
  expect(markup).toContain("Not published, so nothing is asked.");
});

test("a viewer the backend refuses sees no section", async () => {
  backend = fakeBackend({
    "users.adminAcceptances": () => refusal(403, "forbidden"),
  });
  expect(await Acceptances({ userId: 7 })).toBeNull();
});
