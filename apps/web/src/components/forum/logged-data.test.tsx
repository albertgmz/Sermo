import { afterAll, expect, mock, test } from "bun:test";
import { IP_LOG_ACTIONS } from "@sermo/core/contracts";
import { renderToStaticMarkup } from "react-dom/server";
import { messages } from "@/i18n/messages";
import { GROUP_OF_ACTION, LOGGED_GROUPS } from "@/lib/consent/logged-data";
import es from "../../../messages/es/cookies.json";

const intl = await import("next-intl/server");
mock.module("next-intl/server", () => ({
  getLocale: async () => "en",
  getTranslations: async (namespace: string) => (key: string) => {
    let value: unknown = messages;
    for (const part of `${namespace}.${key}`.split(".")) {
      value = (value as Record<string, unknown> | undefined)?.[part];
    }
    return typeof value === "string" ? value : key;
  },
}));
mock.module("server-only", () => ({}));
let days: number | null = 180;
mock.module("@/lib/sermo/privacy", () => ({
  getLogRetentionDays: async () => days,
}));

const { LoggedData } = await import("./logged-data");

afterAll(() => {
  mock.module("next-intl/server", () => intl);
});

test("every kind of action the backend logs belongs to a group the pages describe", () => {
  expect(Object.keys(GROUP_OF_ACTION).sort()).toEqual(
    [...IP_LOG_ACTIONS].sort(),
  );
  for (const group of Object.values(GROUP_OF_ACTION)) {
    expect(LOGGED_GROUPS).toContain(group);
  }
});

test("each group, the session record, the age and the access rule have text in both languages", () => {
  for (const language of [messages.cookies.logged, es.logged]) {
    for (const group of LOGGED_GROUPS) {
      expect(language.items[group].title.length).toBeGreaterThan(0);
      expect(language.items[group].text.length).toBeGreaterThan(0);
    }
    expect(language.sessions.text.length).toBeGreaterThan(0);
    expect(language.retention.text).toContain("{days");
    expect(language.access.text.length).toBeGreaterThan(0);
  }
});

test("the page lists every group and says it keeps no fingerprint", async () => {
  days = 180;
  const page = renderToStaticMarkup(await LoggedData());
  for (const group of LOGGED_GROUPS) {
    expect(page).toContain(messages.cookies.logged.items[group].title);
  }
  expect(page).toContain("fingerprint");
  expect(page).toContain(messages.cookies.logged.retention.title);
});

test("without the backend's answer the age is left out, not invented", async () => {
  days = null;
  const page = renderToStaticMarkup(await LoggedData());
  expect(page).toContain(messages.cookies.logged.retention.unknown);
  expect(page).not.toContain("180");
});
