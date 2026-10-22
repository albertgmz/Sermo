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
const renewed: string[] = [];
mock.module("next/cache", () => ({
  ...cache,
  revalidatePath: (path: string) => renewed.push(path),
  revalidateTag: () => {},
  updateTag: () => {},
}));
mock.module("next/headers", () => ({
  headers: async () => new Headers(),
  cookies: async () => ({ set: () => {} }),
}));

import { AWARD } from "../credits/test-fixtures";

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

const {
  countUnqualified,
  deleteAward,
  previewRebuild,
  rebuildLevelsAndAwards,
  stopRebuild,
  revokeUnqualified,
  runAwards,
  saveAward,
} = await import("./actions");

const base = {
  name: "Hero",
  description: "",
  icon: "",
  tier: "gold",
  xp: "50",
  credits: "0",
};

const RULE = {
  match: "any",
  conditions: [
    { criterion: "post_count", value: 10 },
    { criterion: "post_count", value: 100 },
    { criterion: "in_group", ids: [3] },
  ],
};

test("an award sends the rule as the builder wrote it, duplicates and all, and attaches its picture", async () => {
  backend = fakeBackend({
    "awards.create": () => Response.json(AWARD),
    "images.setAwardImage": () => Response.json(null),
  });
  const digest = await redirectedTo(() =>
    saveAward(
      null,
      form({
        ...base,
        fileId: "9",
        rule: JSON.stringify(RULE),
        isStackable: "on",
      }),
    ),
  );
  expect(digest).toMatch(/;\/admin\/awards\?notice=created;/);
  expect(backend.asked.map((call) => [call.operation, call.body])).toEqual([
    [
      "awards.create",
      {
        name: "Hero",
        description: "",
        icon: "",
        tier: "gold",
        categoryId: null,
        xp: 50,
        credits: 0,
        isStackable: true,
        isActive: false,
        rule: RULE,
      },
    ],
    ["images.setAwardImage", { fileId: 9 }],
  ]);
});

test("the award's category is sent as chosen, none as null", async () => {
  backend = fakeBackend({ "awards.update": () => Response.json(AWARD) });
  const none = JSON.stringify({ match: "all", conditions: [] });
  for (const categoryId of ["4", ""])
    await redirectedTo(() =>
      saveAward(null, form({ ...base, id: "7", categoryId, rule: none })),
    );
  expect(
    backend.asked.map(
      (call) => (call.body as { categoryId?: unknown }).categoryId,
    ),
  ).toEqual([4, null]);
  expect(
    await saveAward(null, form({ ...base, categoryId: "x", rule: none })),
  ).toEqual({
    fields: { categoryId: messages.adminEconomy.awards.errors.category },
  });
});

test("a bad tier, number or rule is refused; the backend answer is shown", async () => {
  backend = fakeBackend({
    "awards.update": () => refusal(409, "conflict", "Held more than once."),
  });
  const e = messages.adminEconomy.awards.errors;
  expect(await saveAward(null, form({ ...base, tier: "mythic" }))).toEqual({
    fields: { tier: e.tier },
  });
  expect(await saveAward(null, form({ ...base, xp: "x" }))).toEqual({
    fields: { xp: e.number },
  });
  const unread = messages.adminGroups.errors.rule;
  for (const rule of ["", "{broken", "[]"])
    expect(await saveAward(null, form({ ...base, rule }))).toEqual({
      fields: { rule: unread },
    });
  // A rule over a limit is told apart from a form that sent nothing readable.
  expect(
    await saveAward(
      null,
      form({ ...base, rule: '{"match":"some","conditions":[]}' }),
    ),
  ).toEqual({ fields: { rule: messages.adminGroups.errors.ruleLimits } });
  const none = JSON.stringify({ match: "all", conditions: [] });
  expect(await saveAward(null, form({ ...base, id: "7", rule: none }))).toEqual(
    {
      error: "Held more than once.",
    },
  );
});

test("delete shows the backend refusal and the sweep shows its answer", async () => {
  backend = fakeBackend({
    "awards.delete": () => refusal(409, "conflict", "It was granted."),
    "awards.run": () => Response.json({ queued: true }),
  });
  expect(await deleteAward(null, form({ id: "7" }))).toEqual({
    error: "It was granted.",
  });
  expect(await runAwards(null)).toEqual({
    notice: messages.adminEconomy.awards.runQueued,
  });
});

test("the count and the run that takes awards back start the backend run with their own apply, and refresh the page", async () => {
  const words = messages.adminEconomy.awards.revoke;
  backend = fakeBackend({
    "awards.revokeUnqualified": () => Response.json({ queued: true }),
  });
  renewed.length = 0;
  expect(await countUnqualified(null)).toEqual({ notice: words.countQueued });
  expect(await revokeUnqualified(null)).toEqual({ notice: words.revokeQueued });
  expect(backend.asked.map((call) => call.body)).toEqual([
    { apply: false },
    { apply: true },
  ]);
  expect(renewed).toEqual(["/[locale]/admin/awards", "/[locale]/admin/awards"]);
});

test("a run already under way is told so, and the backend's refusal is shown", async () => {
  backend = fakeBackend({
    "awards.revokeUnqualified": () => Response.json({ queued: false }),
  });
  renewed.length = 0;
  expect(await revokeUnqualified(null)).toEqual({
    error: messages.adminEconomy.awards.revoke.notQueued,
  });
  expect(renewed).toEqual([]);
  backend.restore();
  backend = fakeBackend({
    "awards.revokeUnqualified": () => refusal(403, "forbidden", "Not allowed."),
  });
  expect(await countUnqualified(null)).toEqual({ error: "Not allowed." });
});

test("the rebuild asks for the password first, sends it, refreshes the page and says when a run is under way", async () => {
  const words = messages.adminEconomy.awards.rebuild;
  backend = fakeBackend({
    "awards.rebuild": () => Response.json({ queued: true }),
  });
  renewed.length = 0;
  expect(await rebuildLevelsAndAwards(null, form({}))).toEqual({
    fields: { actorPassword: messages.adminGroups.errors.password },
  });
  expect(backend.asked).toEqual([]);
  expect(
    await rebuildLevelsAndAwards(null, form({ actorPassword: "secret" })),
  ).toEqual({
    notice: words.queued,
  });
  expect(backend.asked.map((call) => call.body)).toEqual([
    { actorPassword: "secret" },
  ]);
  expect(renewed).toEqual(["/[locale]/admin/awards"]);
  backend.restore();
  backend = fakeBackend({
    "awards.rebuild": () => Response.json({ queued: false }),
  });
  expect(
    await rebuildLevelsAndAwards(null, form({ actorPassword: "secret" })),
  ).toEqual({
    error: words.notQueued,
  });
});

test("the preview asks for no password and sends dryRun, and the stop reports whether a run was under way", async () => {
  const words = messages.adminEconomy.awards.rebuild;
  backend = fakeBackend({
    "awards.rebuild": () => Response.json({ queued: true }),
    "awards.rebuildStop": () => Response.json({ stopped: true }),
  });
  expect(await previewRebuild(null)).toEqual({ notice: words.previewQueued });
  expect(backend.asked.map((call) => call.body)).toEqual([{ dryRun: true }]);
  expect(await stopRebuild(null)).toEqual({ notice: words.stopRequested });
  backend.restore();
  backend = fakeBackend({
    "awards.rebuildStop": () => Response.json({ stopped: false }),
  });
  expect(await stopRebuild(null)).toEqual({ error: words.nothingToStop });
});
