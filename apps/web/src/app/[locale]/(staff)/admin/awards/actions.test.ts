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

const { saveAward, deleteAward, runAwards } = await import("./actions");

const CRITERIA = {
  items: [
    {
      id: "post_count",
      label: "l",
      description: "d",
      title: "t",
      help: "h",
      kind: "atLeast",
      unit: "count",
    },
    {
      id: "has_avatar",
      label: "l",
      description: "d",
      title: "t",
      help: "h",
      kind: "boolean",
      unit: "boolean",
    },
  ],
};
const base = {
  name: "Hero",
  description: "",
  icon: "",
  tier: "gold",
  xp: "50",
  credits: "0",
};

test("an award sends the criteria ticked, ignores unknown ones, and attaches its picture", async () => {
  backend = fakeBackend({
    "awards.criteria": () => Response.json(CRITERIA),
    "awards.create": () => Response.json(AWARD),
    "images.setAwardImage": () => Response.json(null),
  });
  const digest = await redirectedTo(() =>
    saveAward(
      null,
      form({
        ...base,
        fileId: "9",
        "use:post_count": "on",
        "value:post_count": "10",
        "use:invented": "on",
        "value:invented": "1",
        "value:has_avatar": "1",
        isStackable: "on",
      }),
    ),
  );
  expect(digest).toMatch(/;\/admin\/awards\?notice=created;/);
  expect(backend.asked.map((call) => [call.operation, call.body])).toEqual([
    ["awards.criteria", undefined],
    [
      "awards.create",
      {
        name: "Hero",
        description: "",
        icon: "",
        tier: "gold",
        xp: 50,
        credits: 0,
        isStackable: true,
        isActive: false,
        criteria: [{ criterion: "post_count", value: 10 }],
      },
    ],
    ["images.setAwardImage", { fileId: 9 }],
  ]);
});

test("a bad tier, number or criterion value is refused; the backend answer is shown", async () => {
  backend = fakeBackend({
    "awards.criteria": () => Response.json(CRITERIA),
    "awards.update": () => refusal(409, "conflict", "Held more than once."),
  });
  const e = messages.adminEconomy.awards.errors;
  expect(await saveAward(null, form({ ...base, tier: "mythic" }))).toEqual({
    fields: { tier: e.tier },
  });
  expect(await saveAward(null, form({ ...base, xp: "x" }))).toEqual({
    fields: { xp: e.number },
  });
  expect(
    await saveAward(
      null,
      form({ ...base, "use:post_count": "on", "value:post_count": "" }),
    ),
  ).toEqual({ fields: { criteria: e.criterionValue } });
  expect(await saveAward(null, form({ ...base, id: "7" }))).toEqual({
    error: "Held more than once.",
  });
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
