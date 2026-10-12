import { afterAll, afterEach, expect, mock, test } from "bun:test";
import { messages } from "@/i18n/messages";
import { translator } from "@/lib/test-intl";
import { fakeBackend, refusal } from "../groups/test-backend";

mock.module("server-only", () => ({}));
const intl = await import("next-intl/server");
const cache = await import("next/cache");
mock.module("next-intl/server", () => ({
  getTranslations: async (namespace: string) => translator(namespace),
}));
mock.module("next/cache", () => ({
  ...cache,
  revalidatePath: () => {},
  revalidateTag: () => {},
  updateTag: () => {},
}));
mock.module("next/headers", () => ({
  headers: async () => new Headers(),
  cookies: async () => ({ set: () => {} }),
}));

import { MEMBER_AWARD } from "../credits/test-fixtures";

let backend: ReturnType<typeof fakeBackend> | undefined;
afterEach(() => backend?.restore());
afterAll(() => {
  mock.module("next-intl/server", () => intl);
  mock.module("next/cache", () => cache);
});

function form(fields: Record<string, string>) {
  const data = new FormData();
  for (const [name, value] of Object.entries(fields)) data.set(name, value);
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

const { grantAward, revokeGrant } = await import("./actions");

test("a grant and a revoke return to the member with a notice", async () => {
  backend = fakeBackend({
    "awards.grant": () => Response.json(MEMBER_AWARD),
    "awards.revoke": () => Response.json({ ok: true }),
  });
  expect(
    await redirectedTo(() =>
      grantAward(
        null,
        form({ userId: "4", awardId: "2", reason: "Well done" }),
      ),
    ),
  ).toMatch(/userId=4&notice=granted/);
  expect(
    await redirectedTo(() =>
      revokeGrant(
        null,
        form({ userId: "4", memberAwardId: "9", reason: "Mistake" }),
      ),
    ),
  ).toMatch(/userId=4&notice=revoked/);
  expect(backend.asked.map((call) => call.body)).toEqual([
    { awardId: 2, reason: "Well done" },
    undefined,
  ]);
});

test("invalid ids are refused and the backend conflict is shown", async () => {
  backend = fakeBackend({
    "awards.grant": () => refusal(409, "conflict", "Already held."),
  });
  const e = messages.adminEconomy.grants.errors;
  expect(await grantAward(null, form({ userId: "4", awardId: "" }))).toEqual({
    fields: { awardId: e.award },
  });
  expect(
    await revokeGrant(null, form({ userId: "4", memberAwardId: "-1" })),
  ).toEqual({ error: e.grant });
  expect(await grantAward(null, form({ userId: "4", awardId: "2" }))).toEqual({
    error: "Already held.",
  });
});
