import { afterAll, afterEach, expect, mock, test } from "bun:test";
import { messages } from "@/i18n/messages";
import { translator } from "@/lib/test-intl";
import {
  fakeBackend,
  refusal,
  wrongPassword,
} from "../../admin/groups/test-backend";

mock.module("server-only", () => ({}));
const intl = await import("next-intl/server");
mock.module("next-intl/server", () => ({
  getLocale: async () => "en",
  getTranslations: async (namespace: string) => translator(namespace, true),
}));
mock.module("next/headers", () => ({
  headers: async () => new Headers(),
  cookies: async () => ({ set: () => {} }),
}));

const { decideSignups } = await import("./actions");
const { readResult } = await import("./result");

let backend: ReturnType<typeof fakeBackend> | undefined;
afterEach(() => backend?.restore());
afterAll(() => {
  mock.module("next-intl/server", () => intl);
});

function form(fields: Record<string, string>) {
  const data = new FormData();
  for (const [name, value] of Object.entries(fields)) data.append(name, value);
  return data;
}

// The address a successful decision redirects to, as the query the page reads.
async function redirectedTo(run: () => Promise<unknown>) {
  try {
    await run();
  } catch (error) {
    const digest = String((error as { digest?: unknown }).digest);
    const path = digest.split(";")[2] ?? "";
    return new URL(path, "https://forum.test");
  }
  return undefined;
}

const outcomes = (
  items: {
    userId: number | null;
    name: string;
    status: "done" | "skipped" | "failed";
    message: string | null;
  }[],
) =>
  Response.json({
    items,
    done: items.filter((item) => item.status === "done").length,
    skipped: items.filter((item) => item.status === "skipped").length,
    failed: items.filter((item) => item.status === "failed").length,
  });

const decided = () =>
  outcomes([
    { userId: 7, name: "wren", status: "done", message: null },
    { userId: 8, name: "robin", status: "done", message: null },
  ]);

const sent = () =>
  backend?.asked.filter((entry) => entry.operation === "signups.decide");

test("approving sends the ids and the decision and ends in a redirect with the counts", async () => {
  backend = fakeBackend({ "signups.decide": decided });
  const to = await redirectedTo(() =>
    decideSignups(null, form({ decision: "approve", userIds: "7,8" })),
  );
  expect(sent()).toHaveLength(1);
  expect(sent()?.[0]?.body).toEqual({ userIds: [7, 8], decision: "approve" });
  expect(to?.pathname).toBe("/moderation/signups");
  expect(readResult(Object.fromEntries(to?.searchParams ?? []))).toEqual({
    decision: "approve",
    done: 2,
    skipped: 0,
    failed: 0,
    lines: [],
  });
});

test("rejecting erases the account by default and sends the password and the reason", async () => {
  backend = fakeBackend({ "signups.decide": decided });
  await redirectedTo(() =>
    decideSignups(
      null,
      form({
        decision: "reject",
        userIds: "7",
        reason: "  Spam  ",
        mode: "delete",
        actorPassword: "secret",
      }),
    ),
  );
  expect(sent()?.[0]?.body).toEqual({
    userIds: [7],
    decision: "reject",
    reason: "Spam",
    mode: "delete",
    actorPassword: "secret",
  });
});

test("a rejection names what it does: an unknown or missing mode is refused without a call", async () => {
  backend = fakeBackend({ "signups.decide": decided });
  for (const fields of [
    {} as Record<string, string>,
    { mode: "erase" },
    { mode: "" },
  ]) {
    expect(
      await decideSignups(
        null,
        form({
          decision: "reject",
          userIds: "7",
          actorPassword: "secret",
          ...fields,
        }),
      ),
    ).toEqual({ error: messages.moderation.errors.signupsMode });
  }
  expect(backend.asked).toEqual([]);
});

test("rejecting by a ban sends its length and no password", async () => {
  backend = fakeBackend({ "signups.decide": decided });
  await redirectedTo(() =>
    decideSignups(
      null,
      form({
        decision: "reject",
        userIds: "7,8",
        mode: "ban",
        duration: "days",
        banDays: "14",
        actorPassword: "left over in the form",
      }),
    ),
  );
  await redirectedTo(() =>
    decideSignups(
      null,
      form({
        decision: "reject",
        userIds: "7",
        mode: "ban",
        duration: "forever",
        banDays: "14",
      }),
    ),
  );
  expect(sent()?.[0]?.body).toEqual({
    userIds: [7, 8],
    decision: "reject",
    reason: "",
    mode: "ban",
    banDays: 14,
  });
  // For good is a null length.
  expect(sent()?.[1]?.body).toEqual({
    userIds: [7],
    decision: "reject",
    reason: "",
    mode: "ban",
    banDays: null,
  });
});

test("a ban with no usable length is refused without a call", async () => {
  backend = fakeBackend({ "signups.decide": decided });
  for (const banDays of ["", "0", "3651", "x", "1.5"]) {
    expect(
      await decideSignups(
        null,
        form({
          decision: "reject",
          userIds: "7",
          mode: "ban",
          duration: "days",
          banDays,
        }),
      ),
    ).toEqual({ error: messages.moderation.errors.signupsDays });
  }
  expect(backend.asked).toEqual([]);
});

test("rejecting to delete without the password is refused before any call", async () => {
  backend = fakeBackend({ "signups.decide": decided });
  expect(
    await decideSignups(
      null,
      form({ decision: "reject", userIds: "7", mode: "delete" }),
    ),
  ).toEqual({ error: messages.moderation.errors.signupsPassword });
  expect(backend.asked).toEqual([]);
});

test("nothing selected, a bad id, a bad decision and too many ids are refused without a call", async () => {
  backend = fakeBackend({ "signups.decide": decided });
  expect(
    await decideSignups(null, form({ decision: "approve", userIds: "" })),
  ).toEqual({ error: messages.moderation.errors.signupsNone });
  expect(
    await decideSignups(null, form({ decision: "approve", userIds: "7,x" })),
  ).toEqual({ error: messages.moderation.errors.id });
  expect(
    await decideSignups(null, form({ decision: "maybe", userIds: "7" })),
  ).toEqual({ error: messages.moderation.errors.decision });
  const many = Array.from({ length: 51 }, (_, index) => index + 1).join(",");
  expect(
    await decideSignups(null, form({ decision: "approve", userIds: many })),
  ).toEqual({
    error: messages.moderation.errors.signupsTooMany.replace("{count}", "50"),
  });
  expect(backend.asked).toEqual([]);
});

test("the accounts that were skipped or refused come back with the backend's reasons", async () => {
  backend = fakeBackend({
    "signups.decide": () =>
      outcomes([
        { userId: 7, name: "wren", status: "done", message: null },
        {
          userId: 8,
          name: "robin",
          status: "skipped",
          message: "Not waiting for approval any more.",
        },
        {
          userId: null,
          name: "#9",
          status: "failed",
          message: "The email could not be sent.",
        },
      ]),
  });
  const to = await redirectedTo(() =>
    decideSignups(null, form({ decision: "approve", userIds: "7,8,9" })),
  );
  expect(readResult(Object.fromEntries(to?.searchParams ?? []))).toEqual({
    decision: "approve",
    done: 1,
    skipped: 1,
    failed: 1,
    lines: [
      {
        status: "skipped",
        name: "robin",
        message: "Not waiting for approval any more.",
      },
      { status: "failed", name: "#9", message: "The email could not be sent." },
    ],
  });
});

test("a refusal of the whole decision is shown as the form's error", async () => {
  backend = fakeBackend({
    "signups.decide": () =>
      refusal(403, "forbidden", "You may not approve sign-ups."),
  });
  expect(
    await decideSignups(null, form({ decision: "approve", userIds: "7" })),
  ).toEqual({ error: "You may not approve sign-ups." });
});

test("a wrong password is shown as the form's error, with the backend's message", async () => {
  backend = fakeBackend({ "signups.decide": () => wrongPassword() });
  const state = await decideSignups(
    null,
    form({
      decision: "reject",
      userIds: "7",
      mode: "delete",
      actorPassword: "nope",
    }),
  );
  expect(state).toEqual({ error: "That is not your password." });
});
