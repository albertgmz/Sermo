import { afterAll, afterEach, expect, mock, test } from "bun:test";
import { messages } from "@/i18n/messages";
import { creditRulesBody } from "@/lib/test-bodies";
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

const { saveRule, deleteRule } = await import("./actions");

const RULE = {
  id: 1,
  title: "Posting pays 5",
  trigger: "reply_posted",
  amount: 5,
  isActive: true,
  limit: null,
  nodeIds: [],
  filters: {
    createdFrom: null,
    createdUntil: null,
    minLength: null,
    maxLength: null,
  },
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

test("a new rule sends the trigger, the limit and the forums ticked", async () => {
  backend = fakeBackend({
    "creditRules.list": () => Response.json(creditRulesBody()),
    "creditRules.create": () => Response.json(RULE),
  });
  const data = form({
    title: "Posting pays 5",
    trigger: "reply_posted",
    amount: "5",
    limitCount: "10",
    limitHours: "24",
    isActive: "on",
  });
  data.append("nodeIds", "3");
  data.append("nodeIds", "4");
  const digest = await redirectedTo(() => saveRule(null, data));
  expect(digest).toMatch(/;\/admin\/credit-rules\?notice=created;/);
  expect(backend.asked[1].body).toEqual({
    title: "Posting pays 5",
    trigger: "reply_posted",
    amount: 5,
    isActive: true,
    limit: { count: 10, windowHours: 24 },
    nodeIds: [3, 4],
  });
});

test("a trigger that takes no forums sends none, and an edit sends no trigger", async () => {
  backend = fakeBackend({
    "creditRules.list": () => Response.json(creditRulesBody()),
    "creditRules.create": () => Response.json(RULE),
    "creditRules.update": () => Response.json(RULE),
  });
  await redirectedTo(() =>
    saveRule(null, form({ title: "T", trigger: "registered", amount: "2" })),
  );
  await redirectedTo(() =>
    saveRule(
      null,
      form({ id: "1", title: "T", trigger: "registered", amount: "-2" }),
    ),
  );
  expect(
    backend.asked
      .filter((call) => call.operation !== "creditRules.list")
      .map((call) => call.body),
  ).toEqual([
    {
      title: "T",
      trigger: "registered",
      amount: 2,
      isActive: false,
      limit: null,
    },
    { title: "T", amount: -2, isActive: false, limit: null },
  ]);
});

test("a bad trigger, amount, half a limit or an id is refused before the backend", async () => {
  backend = fakeBackend({});
  const e = messages.adminEconomy.rules.errors;
  expect(
    await saveRule(null, form({ title: "T", trigger: "x", amount: "1" })),
  ).toEqual({ fields: { trigger: e.trigger } });
  expect(
    await saveRule(
      null,
      form({ title: "T", trigger: "followed", amount: "1.5" }),
    ),
  ).toEqual({ fields: { amount: e.amount } });
  expect(
    await saveRule(
      null,
      form({ title: "T", trigger: "followed", amount: "1", limitCount: "3" }),
    ),
  ).toEqual({ fields: { limit: e.limit } });
  expect(
    await saveRule(
      null,
      form({ id: "0x1", title: "T", trigger: "followed", amount: "1" }),
    ),
  ).toEqual({ error: e.id });
  expect(backend.asked).toEqual([]);
});

test("the backend refusal is shown, and a delete ends in a notice", async () => {
  backend = fakeBackend({
    "creditRules.list": () => Response.json(creditRulesBody()),
    "creditRules.create": () =>
      refusal(422, "validation", "The amount cannot be 0."),
    "creditRules.delete": () => Response.json({ ok: true }),
  });
  expect(
    await saveRule(
      null,
      form({ title: "T", trigger: "followed", amount: "0" }),
    ),
  ).toEqual({ error: "The amount cannot be 0." });
  expect(await redirectedTo(() => deleteRule(null, form({ id: "1" })))).toMatch(
    /notice=deleted/,
  );
});

test("which triggers take forums is what the backend lists, not a list of ours", async () => {
  backend = fakeBackend({
    "creditRules.list": () => Response.json(creditRulesBody([], ["followed"])),
    "creditRules.create": () => Response.json(RULE),
  });
  const data = (trigger: string) => {
    const fields = form({ title: "T", trigger, amount: "1" });
    fields.append("nodeIds", "3");
    return fields;
  };
  await redirectedTo(() => saveRule(null, data("followed")));
  await redirectedTo(() => saveRule(null, data("reply_posted")));
  const sent = backend.asked.filter(
    (call) => call.operation === "creditRules.create",
  );
  expect(sent[0].body).toMatchObject({ nodeIds: [3] });
  expect(sent[1].body).not.toHaveProperty("nodeIds");
});

test("unticking every forum clears the restriction of a trigger that takes forums", async () => {
  backend = fakeBackend({
    "creditRules.list": () => Response.json(creditRulesBody()),
    "creditRules.update": () => Response.json(RULE),
  });
  await redirectedTo(() =>
    saveRule(
      null,
      form({ id: "1", title: "T", trigger: "reply_posted", amount: "1" }),
    ),
  );
  expect(backend.asked.at(-1)?.body).toMatchObject({ nodeIds: [] });
});

const FILTERABLE = ["reply_posted", "profile_post_created"];

test("a trigger that accepts filters sends the dates and lengths typed, empty ones as null", async () => {
  backend = fakeBackend({
    "creditRules.list": () =>
      Response.json(creditRulesBody([], [], FILTERABLE)),
    "creditRules.create": () => Response.json(RULE),
    "creditRules.update": () => Response.json(RULE),
  });
  await redirectedTo(() =>
    saveRule(
      null,
      form({
        title: "T",
        trigger: "reply_posted",
        amount: "1",
        createdFrom: "2020-01-01",
        createdUntil: "",
        minLength: "20",
        maxLength: "",
      }),
    ),
  );
  await redirectedTo(() =>
    saveRule(
      null,
      form({ id: "1", title: "T", trigger: "reply_posted", amount: "1" }),
    ),
  );
  const sent = backend.asked.filter(
    (call) => call.operation !== "creditRules.list",
  );
  expect(sent[0].body).toMatchObject({
    filters: {
      createdFrom: "2020-01-01",
      createdUntil: null,
      minLength: 20,
      maxLength: null,
    },
  });
  expect(sent[1].body).toMatchObject({
    filters: {
      createdFrom: null,
      createdUntil: null,
      minLength: null,
      maxLength: null,
    },
  });
});

test("a trigger that accepts no filters sends none", async () => {
  backend = fakeBackend({
    "creditRules.list": () =>
      Response.json(creditRulesBody([], [], FILTERABLE)),
    "creditRules.create": () => Response.json(RULE),
  });
  await redirectedTo(() =>
    saveRule(
      null,
      form({ title: "T", trigger: "followed", amount: "1", minLength: "20" }),
    ),
  );
  expect(backend.asked.at(-1)?.body).not.toHaveProperty("filters");
});

test("a bad date or length is refused before the backend", async () => {
  backend = fakeBackend({
    "creditRules.list": () =>
      Response.json(creditRulesBody([], [], FILTERABLE)),
  });
  const e = messages.adminEconomy.rules.errors;
  for (const bad of [
    { createdFrom: "01/02/2020" },
    { minLength: "ten" },
  ] as Record<string, string>[])
    expect(
      await saveRule(
        null,
        form({ title: "T", trigger: "reply_posted", amount: "1", ...bad }),
      ),
    ).toEqual({ fields: { filters: e.filters } });
});
