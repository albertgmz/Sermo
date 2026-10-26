import { afterAll, afterEach, expect, mock, test } from "bun:test";
import { messages } from "@/i18n/messages";
import { translator } from "@/lib/test-intl";
import { fakeBackend, refusal } from "../groups/test-backend";

mock.module("server-only", () => ({}));
const intl = await import("next-intl/server");
const cache = await import("next/cache");
mock.module("next-intl/server", () => ({
  getLocale: async () => "en",
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

import { TRANSACTION } from "./test-fixtures";

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

const { adjustCredits, previewTax } = await import("./actions");

test("an adjustment sends the member, the signed amount and the reason", async () => {
  backend = fakeBackend({ "credits.adjust": () => Response.json(TRANSACTION) });
  const digest = await redirectedTo(() =>
    adjustCredits(null, form({ userId: "4", amount: "-30", reason: "Refund" })),
  );
  expect(digest).toMatch(
    /;\/admin\/credits\?userId=4&notice=adjusted&balance=5;/,
  );
  expect(backend.asked[0].body).toEqual({
    amount: -30,
    reason: "Refund",
  });
});

test("a bad member or amount is refused before the backend; its refusal is shown", async () => {
  backend = fakeBackend({
    "credits.adjust": () => refusal(403, "forbidden", "Not allowed."),
  });
  const e = messages.adminEconomy.adjust.errors;
  expect(
    await adjustCredits(null, form({ userId: "x", amount: "1", reason: "r" })),
  ).toEqual({ error: e.member });
  expect(
    await adjustCredits(
      null,
      form({ userId: "4", amount: "1e3", reason: "r" }),
    ),
  ).toEqual({ fields: { amount: e.amount } });
  expect(backend.asked).toEqual([]);
  expect(
    await adjustCredits(null, form({ userId: "4", amount: "5", reason: "r" })),
  ).toEqual({ error: "Not allowed." });
});

test("a tax preview is started, and the backend's refusal of one is shown", async () => {
  const run = {
    id: 1,
    kind: "preview",
    chargeOn: "2026-11-01",
    state: "running",
    fee: 50,
    minimum: 1000,
    step: 2,
    progress: 0,
    members: 0,
    credits: 0,
    top: [],
    startedAt: "2026-10-26T10:00:00.000Z",
    finishedAt: null,
  };
  backend = fakeBackend({ "credits.taxPreview": () => Response.json(run) });
  expect(await previewTax()).toEqual({
    notice: messages.adminEconomy.tax.previewQueued,
  });
  expect(backend.asked.map((entry) => entry.operation)).toEqual([
    "credits.taxPreview",
  ]);
  backend.restore();
  backend = fakeBackend({
    "credits.taxPreview": () =>
      refusal(409, "conflict", "A preview of the credit tax is under way."),
  });
  expect(await previewTax()).toEqual({
    error: "A preview of the credit tax is under way.",
  });
});
