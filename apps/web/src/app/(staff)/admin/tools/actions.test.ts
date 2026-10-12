import { afterAll, afterEach, expect, mock, test } from "bun:test";
import { messages } from "@/i18n/messages";
import { translator } from "@/lib/test-intl";
import { fakeBackend, refusal } from "../groups/test-backend";

mock.module("server-only", () => ({}));
const intl = await import("next-intl/server");
mock.module("next-intl/server", () => ({
  getTranslations: async (namespace: string) => {
    const t = translator(namespace);
    // The spam result carries the job number.
    return (key: string, values?: Record<string, unknown>) =>
      t(key).replace(/\{(\w+)\}/g, (_, name) => String(values?.[name]));
  },
}));
mock.module("next/headers", () => ({
  headers: async () => new Headers(),
  cookies: async () => ({ set: () => {} }),
}));

const { runOperation, runSpamCleanup } = await import("./actions");

let backend: ReturnType<typeof fakeBackend> | undefined;
afterEach(() => backend?.restore());
afterAll(() => {
  mock.module("next-intl/server", () => intl);
});

function form(fields: [string, string][]) {
  const data = new FormData();
  for (const [name, value] of fields) data.append(name, value);
  return data;
}

const t = messages.adminTools.maintenance;

test("each queued operation calls its own operation and shows the answer", async () => {
  backend = fakeBackend({
    "credits.recalculate": () => Response.json({ queued: true }),
    "promotions.run": () => Response.json({ queued: true }),
    "awards.run": () => Response.json({ queued: false }),
  });
  expect(await runOperation(null, form([["operation", "credits"]]))).toEqual({
    notice: t.result.queued,
  });
  expect(await runOperation(null, form([["operation", "promotions"]]))).toEqual(
    { notice: t.result.queued },
  );
  expect(await runOperation(null, form([["operation", "awards"]]))).toEqual({
    error: t.result.notQueued,
  });
  expect(backend.asked.map((entry) => entry.operation)).toEqual([
    "credits.recalculate",
    "promotions.run",
    "awards.run",
  ]);
});

test("an operation the form did not offer is refused without a call", async () => {
  backend = fakeBackend({});
  expect(await runOperation(null, form([["operation", "spam"]]))).toEqual({
    error: t.errors.operation,
  });
  expect(backend.asked).toEqual([]);
});

test("the backend's refusal of an operation is shown", async () => {
  backend = fakeBackend({
    "promotions.run": () => refusal(403, "forbidden", "Not allowed."),
  });
  expect(await runOperation(null, form([["operation", "promotions"]]))).toEqual(
    { error: "Not allowed." },
  );
});

test("spam cleanup sends the member and a typed reason, and shows the job", async () => {
  backend = fakeBackend({
    "spamCleanup.start": () => Response.json({ jobId: 42 }),
  });
  expect(
    await runSpamCleanup(
      null,
      form([
        ["userId", "9"],
        ["reason", " Links "],
      ]),
    ),
  ).toEqual({ notice: t.result.spamQueued.replace("{jobId}", "42") });
  expect(backend.asked[0].path).toBe("/api/v1/users/9/spam-cleanup");
  expect(backend.asked[0].body).toEqual({ reason: "Links" });
  await runSpamCleanup(null, form([["userId", "9"]]));
  expect(backend.asked[1].body).toEqual({});
});

test("spam cleanup without a valid member is refused without a call", async () => {
  backend = fakeBackend({});
  expect(await runSpamCleanup(null, form([["userId", "nova"]]))).toEqual({
    error: t.errors.member,
  });
  expect(backend.asked).toEqual([]);
});
