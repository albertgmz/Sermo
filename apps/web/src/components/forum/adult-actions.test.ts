import { afterAll, afterEach, expect, mock, test } from "bun:test";
import {
  fakeBackend,
  refusal,
} from "@/app/[locale]/(staff)/admin/groups/test-backend";
import { messages } from "@/i18n/messages";
import { translator } from "@/lib/test-intl";

mock.module("server-only", () => ({}));
const intl = await import("next-intl/server");
const cacheModule = await import("next/cache");
const revalidated: unknown[][] = [];
mock.module("next-intl/server", () => ({
  getLocale: async () => "en",
  getTranslations: async (namespace: string) => translator(namespace),
}));
mock.module("next/cache", () => ({
  ...cacheModule,
  revalidatePath: (...args: unknown[]) => revalidated.push(args),
}));
mock.module("next/headers", () => ({
  headers: async () => new Headers({ host: "forum.test" }),
  cookies: async () => ({ set: () => {} }),
}));

const { confirmAdult } = await import("./adult-actions");

let backend: ReturnType<typeof fakeBackend> | undefined;
afterEach(() => {
  backend?.restore();
  revalidated.length = 0;
});
afterAll(() => {
  mock.module("next-intl/server", () => intl);
  mock.module("next/cache", () => cacheModule);
});

const standing = (refusal: string | null) => () => Response.json({ refusal });
const form = (fields: [string, string][] = []) => {
  const data = new FormData();
  for (const [name, value] of fields) data.set(name, value);
  return data;
};
const operations = () => backend?.asked.map((entry) => entry.operation);

test("a member with a stored date confirms the warning, and every page is read again", async () => {
  backend = fakeBackend({ "profiles.acceptAdult": standing(null) });
  expect(await confirmAdult({}, form())).toEqual({ done: true });
  expect(operations()).toEqual(["profiles.acceptAdult"]);
  expect(revalidated).toEqual([["/[locale]", "layout"]]);
});

test("a member without one stores the date first, then confirms", async () => {
  backend = fakeBackend({
    "profiles.setBirthDate": standing("acceptance"),
    "profiles.acceptAdult": standing(null),
  });
  expect(await confirmAdult({}, form([["birthDate", "1990-02-28"]]))).toEqual({
    done: true,
  });
  expect(operations()).toEqual([
    "profiles.setBirthDate",
    "profiles.acceptAdult",
  ]);
  expect(backend.asked[0]?.body).toEqual({ year: 1990, month: 2, day: 28 });
});

test("a date that makes the member a minor stops there: nothing is confirmed or read again", async () => {
  backend = fakeBackend({ "profiles.setBirthDate": standing("minor") });
  expect(await confirmAdult({}, form([["birthDate", "2015-06-01"]]))).toEqual({
    minor: true,
  });
  expect(operations()).toEqual(["profiles.setBirthDate"]);
  expect(revalidated).toEqual([]);
});

test("a date field left incomplete is refused without a call", async () => {
  backend = fakeBackend({});
  expect(await confirmAdult({}, form([["birthDate", ""]]))).toEqual({
    error: messages.forum.adultGate.dateMissing,
  });
  expect(operations()).toEqual([]);
});

test("the backend's refusal of a date (one that does not exist) is shown", async () => {
  backend = fakeBackend({
    "profiles.setBirthDate": () =>
      refusal(400, "validation", "Invalid", [
        { path: ["day"], message: "That day does not exist." },
      ]),
  });
  expect(await confirmAdult({}, form([["birthDate", "1990-02-30"]]))).toEqual({
    error: "That day does not exist.",
  });
  expect(revalidated).toEqual([]);
});

test("a date field's value is read as a full date, or not sent at all", async () => {
  backend = fakeBackend({ "profiles.setBirthDate": standing("minor") });
  for (const typed of ["2001-12", "09/12/2001", "2001-12-9"])
    expect(await confirmAdult({}, form([["birthDate", typed]]))).toEqual({
      error: messages.forum.adultGate.dateMissing,
    });
  expect(operations()).toEqual([]);
  await confirmAdult({}, form([["birthDate", "2001-12-09"]]));
  expect(backend.asked[0]?.body).toEqual({ year: 2001, month: 12, day: 9 });
});
