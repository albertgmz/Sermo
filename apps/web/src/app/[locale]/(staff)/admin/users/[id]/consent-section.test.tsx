import { afterAll, afterEach, expect, mock, test } from "bun:test";
import { messages } from "@/i18n/messages";
import { translator } from "@/lib/test-intl";
import { textOfTree } from "@/lib/test-tree";
import { fakeBackend, refusal } from "../../groups/test-backend";

mock.module("server-only", () => ({}));
const intl = await import("next-intl/server");
mock.module("next-intl/server", () => ({
  getLocale: async () => "en",
  getTranslations: async (namespace: string) => translator(namespace, true),
}));
mock.module("next/headers", () => ({
  headers: async () => new Headers(),
  cookies: async () => ({ get: () => undefined }),
}));
const { ConsentSection } = await import("./consent-section");

afterAll(() => {
  mock.module("next-intl/server", () => intl);
});

let backend: ReturnType<typeof fakeBackend> | undefined;
afterEach(() => backend?.restore());

const textOf = (node: unknown) => textOfTree(node);
const shown = async () => textOf(await ConsentSection({ userId: 9 }));
const consent = messages.adminUsers.identity.consent;
const categories = messages.cookies.banner.categories;

test("staff see the categories a member accepted, read only", async () => {
  backend = fakeBackend({
    "users.consent": () =>
      Response.json({
        record: {
          categories: ["referrals", "embeds"],
          policyVersion: 3,
          decidedAt: "2026-10-02T10:00:00.000Z",
        },
      }),
  });
  const text = await shown();
  expect(text).toContain(consent.heading);
  expect(text).toContain(
    consent.accepted.replace(
      "{categories}",
      `${categories.referrals.title}, ${categories.embeds.title}`,
    ),
  );
  expect(text).toContain("3");
  expect(backend.asked).toEqual([
    {
      operation: "users.consent",
      path: "/api/v1/admin/users/9/consent",
      body: undefined,
    },
  ]);
});

test("a member who refused everything, and one who never chose, are told apart", async () => {
  backend = fakeBackend({
    "users.consent": () =>
      Response.json({
        record: {
          categories: [],
          policyVersion: 1,
          decidedAt: "2026-10-02T10:00:00.000Z",
        },
      }),
  });
  expect(await shown()).toContain(consent.refusedAll);
  backend.restore();
  backend = fakeBackend({
    "users.consent": () => Response.json({ record: null }),
  });
  expect(await shown()).toContain(consent.none);
});

test("a viewer the backend refuses sees no such section, and the page still renders", async () => {
  backend = fakeBackend({
    "users.consent": () => refusal(403, "forbidden", "Not allowed."),
  });
  expect(await shown()).toBe("");
});
