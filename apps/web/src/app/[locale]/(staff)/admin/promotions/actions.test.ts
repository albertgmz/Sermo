import { afterAll, afterEach, expect, mock, test } from "bun:test";
import { messages } from "@/i18n/messages";
import { translator } from "@/lib/test-intl";
import {
  fakeBackend,
  refusal,
  tooManyWrongPasswords,
  wrongPassword,
} from "../groups/test-backend";

mock.module("server-only", () => ({}));
const intl = await import("next-intl/server");
mock.module("next-intl/server", () => ({
  getLocale: async () => "en",
  getTranslations: async (namespace: string) => translator(namespace),
}));
mock.module("next/headers", () => ({
  headers: async () => new Headers(),
  cookies: async () => ({ set: () => {} }),
}));

const { savePromotion, deletePromotion, runPromotions } = await import(
  "./actions"
);

let backend: ReturnType<typeof fakeBackend> | undefined;
afterEach(() => backend?.restore());
afterAll(() => {
  mock.module("next-intl/server", () => intl);
});

const RULE = {
  match: "any",
  conditions: [
    { criterion: "post_count", value: 50 },
    { criterion: "post_count", value: 500 },
    { criterion: "in_group", ids: [3, 4] },
  ],
};
const rule = JSON.stringify(RULE);

const PROMOTION = {
  id: 5,
  title: "Regulars",
  isActive: true,
  rule: { match: "all", conditions: [{ criterion: "post_count", value: 50 }] },
  groupIds: [7],
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

function form(fields: [string, string][], password: string | null = "secret") {
  const data = new FormData();
  for (const [name, value] of fields) data.append(name, value);
  if (password !== null) data.append("actorPassword", password);
  return data;
}

async function redirectedTo(run: () => Promise<unknown>) {
  try {
    await run();
  } catch (error) {
    return String((error as { digest?: unknown }).digest);
  }
  return undefined;
}

test("the rule the builder wrote is sent as it is, with the ticked groups", async () => {
  backend = fakeBackend({
    "promotions.create": () => Response.json(PROMOTION),
  });
  const digest = await redirectedTo(() =>
    savePromotion(
      null,
      form([
        ["title", "Regulars"],
        ["isActive", "on"],
        ["rule", rule],
        ["groupIds", "7"],
        ["groupIds", "8"],
      ]),
    ),
  );
  expect(digest).toMatch(/;\/admin\/promotions\/5\?notice=created;/);
  expect(backend.asked.at(-1)).toMatchObject({
    operation: "promotions.create",
    body: {
      actorPassword: "secret",
      title: "Regulars",
      isActive: true,
      rule: RULE,
      groupIds: [7, 8],
    },
  });
});

test("an edited promotion goes to its own address with the ticked groups", async () => {
  backend = fakeBackend({
    "promotions.update": () => Response.json(PROMOTION),
  });
  await redirectedTo(() =>
    savePromotion(
      null,
      form([
        ["id", "5"],
        ["title", "Regulars"],
        ["rule", rule],
        ["groupIds", "7"],
        ["groupIds", "9"],
        ["groupIds", "7"],
      ]),
    ),
  );
  expect(backend.asked.at(-1)?.path).toBe("/api/v1/promotions/5");
  expect(backend.asked.at(-1)?.body).toMatchObject({
    isActive: false,
    rule: RULE,
    groupIds: [7, 9],
  });
});

test("a rule that is not one is refused before saving", async () => {
  backend = fakeBackend({});
  for (const bad of [
    undefined,
    "{broken",
    "[]",
    '{"match":"all","conditions":[{"value":3}]}',
  ])
    expect(
      await savePromotion(
        null,
        form([
          ["title", "R"],
          ...(bad === undefined ? [] : ([["rule", bad]] as [string, string][])),
          ["groupIds", "7"],
        ]),
      ),
    ).toEqual({ fields: { rule: messages.adminGroups.errors.rule } });
  expect(backend.asked).toEqual([]);
});

test("group ids that are not ids are refused", async () => {
  backend = fakeBackend({});
  expect(
    await savePromotion(
      null,
      form([
        ["title", "R"],
        ["groupIds", "x"],
      ]),
    ),
  ).toEqual({ fields: { groupIds: messages.adminGroups.errors.groupIds } });
  expect(backend.asked).toEqual([]);
});

test("the refusal of a group is shown at the top", async () => {
  backend = fakeBackend({
    "promotions.create": () =>
      refusal(403, "forbidden", "The guest group cannot be granted."),
  });
  expect(
    await savePromotion(
      null,
      form([
        ["title", "R"],
        ["rule", rule],
        ["groupIds", "1"],
      ]),
    ),
  ).toEqual({ error: "The guest group cannot be granted." });
});

test("running the promotions reports the answer of the queue", async () => {
  backend = fakeBackend({
    "promotions.run": () => Response.json({ queued: true }),
  });
  expect(await runPromotions(null)).toEqual({
    notice: messages.adminGroups.promotions.runQueued,
  });
  backend.restore();
  backend = fakeBackend({
    "promotions.run": () => refusal(403, "forbidden", "Not allowed."),
  });
  expect(await runPromotions(null)).toEqual({ error: "Not allowed." });
});

test("a promotion is not written when the password is missing or wrong", async () => {
  const fields: [string, string][] = [
    ["id", "5"],
    ["title", "Regulars"],
    ["rule", rule],
    ["groupIds", "7"],
  ];
  backend = fakeBackend({
    "promotions.update": () => Response.json(PROMOTION),
  });
  expect(await savePromotion(null, form(fields, null))).toEqual({
    fields: { actorPassword: messages.adminGroups.errors.password },
  });
  expect(backend.asked).toEqual([]);
  backend.restore();
  backend = fakeBackend({
    "promotions.update": () => wrongPassword(),
  });
  expect(await savePromotion(null, form(fields, "wrong"))).toEqual({
    fields: { actorPassword: "That is not your password." },
  });
  // The password goes with the write itself: no call of its own before it.
  expect(backend.asked.map((call) => call.operation)).toEqual([
    "promotions.update",
  ]);
  expect(backend.asked[0].body).toMatchObject({ actorPassword: "wrong" });
});

test("a promotion is deleted with the password in the write, and a refused one shows on the field", async () => {
  backend = fakeBackend({
    "promotions.delete": () => tooManyWrongPasswords(),
  });
  expect(await deletePromotion(null, form([["id", "5"]]))).toEqual({
    fields: { actorPassword: "Too many wrong passwords. Try again later." },
  });
  backend.restore();
  backend = fakeBackend({
    "promotions.delete": () => Response.json({ ok: true }),
  });
  const digest = await redirectedTo(() =>
    deletePromotion(null, form([["id", "5"]])),
  );
  expect(digest).toMatch(/;\/admin\/promotions\?notice=deleted;/);
  expect(backend.asked.map((call) => call.operation)).toEqual([
    "promotions.delete",
  ]);
  expect(backend.asked[0].body).toEqual({ actorPassword: "secret" });
  backend.restore();
  backend = fakeBackend({});
  expect(await deletePromotion(null, form([["id", "5"]], null))).toEqual({
    fields: { actorPassword: messages.adminGroups.errors.password },
  });
  expect(backend.asked).toEqual([]);
});
