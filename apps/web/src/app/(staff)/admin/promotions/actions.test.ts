import { afterAll, afterEach, expect, mock, test } from "bun:test";
import { messages } from "@/i18n/messages";
import { criterionBody } from "@/lib/test-bodies";
import { translator } from "@/lib/test-intl";
import { fakeBackend, refusal } from "../groups/test-backend";

mock.module("server-only", () => ({}));
const intl = await import("next-intl/server");
mock.module("next-intl/server", () => ({
  getTranslations: async (namespace: string) => translator(namespace),
}));
mock.module("next/headers", () => ({
  headers: async () => new Headers(),
  cookies: async () => ({ set: () => {} }),
}));

const { savePromotion, runPromotions } = await import("./actions");

let backend: ReturnType<typeof fakeBackend> | undefined;
afterEach(() => backend?.restore());
afterAll(() => {
  mock.module("next-intl/server", () => intl);
});

const CRITERIA = {
  items: [
    criterionBody("post_count", "atLeast", "count"),
    criterionBody("email_verified", "boolean", "boolean"),
  ],
};

const PROMOTION = {
  id: 5,
  title: "Regulars",
  isActive: true,
  criteria: [{ criterion: "post_count", value: 50 }],
  groupIds: [7],
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

function form(fields: [string, string][]) {
  const data = new FormData();
  for (const [name, value] of fields) data.append(name, value);
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

test("only the criteria the backend lists and the form ticked are sent", async () => {
  backend = fakeBackend({
    "promotions.criteria": () => Response.json(CRITERIA),
    "promotions.create": () => Response.json(PROMOTION),
  });
  const digest = await redirectedTo(() =>
    savePromotion(
      null,
      form([
        ["title", "Regulars"],
        ["isActive", "on"],
        ["use:post_count", "on"],
        ["value:post_count", "50"],
        ["value:email_verified", "1"],
        ["use:invented", "on"],
        ["value:invented", "3"],
        ["groupIds", "7"],
        ["groupIds", "8"],
      ]),
    ),
  );
  expect(digest).toMatch(/;\/admin\/promotions\/5\?notice=created;/);
  expect(backend.asked.at(-1)).toMatchObject({
    operation: "promotions.create",
    body: {
      title: "Regulars",
      isActive: true,
      criteria: [{ criterion: "post_count", value: 50 }],
      groupIds: [7, 8],
    },
  });
});

test("an edited promotion goes to its own address with the ticked groups", async () => {
  backend = fakeBackend({
    "promotions.criteria": () => Response.json(CRITERIA),
    "promotions.update": () => Response.json(PROMOTION),
  });
  await redirectedTo(() =>
    savePromotion(
      null,
      form([
        ["id", "5"],
        ["title", "Regulars"],
        ["groupIds", "7"],
        ["groupIds", "9"],
        ["groupIds", "7"],
      ]),
    ),
  );
  expect(backend.asked.at(-1)?.path).toBe("/api/v1/promotions/5");
  expect(backend.asked.at(-1)?.body).toMatchObject({
    isActive: false,
    criteria: [],
    groupIds: [7, 9],
  });
});

test("a criterion value that is not a number is refused before saving", async () => {
  backend = fakeBackend({
    "promotions.criteria": () => Response.json(CRITERIA),
  });
  expect(
    await savePromotion(
      null,
      form([
        ["title", "R"],
        ["use:post_count", "on"],
        ["value:post_count", "many"],
        ["groupIds", "7"],
      ]),
    ),
  ).toEqual({
    fields: { criteria: messages.adminGroups.errors.criterionValue },
  });
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
    "promotions.criteria": () => Response.json(CRITERIA),
    "promotions.create": () =>
      refusal(403, "forbidden", "The guest group cannot be granted."),
  });
  expect(
    await savePromotion(
      null,
      form([
        ["title", "R"],
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
