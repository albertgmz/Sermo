import { afterAll, afterEach, expect, mock, test } from "bun:test";
import { renderToReadableStream } from "react-dom/server";
import { messages } from "@/i18n/messages";
import { notificationTypeBody } from "@/lib/test-bodies";
import { withIntl } from "@/lib/test-intl";

const realFetch = globalThis.fetch;
const intl = await import("next-intl/server");
const settingsData = await import("../settings/data");
mock.module("server-only", () => ({}));
mock.module("next/headers", () => ({
  headers: async () => new Headers(),
  cookies: async () => ({ get: () => undefined, toString: () => "" }),
}));
mock.module("next-intl/server", () => ({
  getLocale: async () => "en",
  getTranslations: async (namespace: string) => {
    const t = (key: string) => {
      let value: unknown = messages;
      for (const part of `${namespace}.${key}`.split(".")) {
        value = (value as Record<string, unknown> | undefined)?.[part];
      }
      return typeof value === "string" ? value : key;
    };
    return Object.assign(t, { has: (key: string) => t(key) !== key });
  },
}));
mock.module("../settings/data", () => ({
  getSettings: async () => ({ notificationRetentionDays: 90 }),
}));

const { DefaultsForm } = await import("./defaults-form");

afterEach(() => {
  globalThis.fetch = realFetch;
});
afterAll(() => {
  mock.module("next-intl/server", () => intl);
  mock.module("../settings/data", () => settingsData);
});

async function page() {
  globalThis.fetch = (async (input: string) => {
    if (new URL(input).pathname === "/api/v1/notifications/types") {
      return Response.json({
        items: [
          notificationTypeBody("reply", {
            channels: ["inApp", "email", "push"],
          }),
          notificationTypeBody("thread.watched", {
            defaults: { inApp: true, email: true, push: false },
            emailFollowsWatch: true,
            channels: ["inApp", "email", "push"],
          }),
        ],
      });
    }
    return Response.json({});
  }) as unknown as typeof fetch;
  const stream = await renderToReadableStream(withIntl(await DefaultsForm()));
  await stream.allReady;
  return (await new Response(stream).text()).replaceAll("&#x27;", "'");
}

// The attributes of the checkbox input of a cell.
function cell(html: string, name: string) {
  const match = new RegExp(`<input[^>]*name="${name}"[^>]*>`).exec(html);
  return match?.[0] ?? "";
}

test("the email cell of a type that follows each watch is disabled and says why", async () => {
  const html = await page();
  expect(cell(html, "thread.watched:email")).toContain("disabled");
  expect(cell(html, "thread.watched:inApp")).not.toContain("disabled");
  expect(cell(html, "reply:email")).not.toContain("disabled");
  expect(
    html.split(messages.adminCommunication.notifications.followsWatch),
  ).toHaveLength(2);
});

test("the general help line about watched content is gone", async () => {
  expect(await page()).not.toContain("whatever the email default");
});
